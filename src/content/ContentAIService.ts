import { Logger } from '@/utils/logger';
import { PORT_CANCEL_MESSAGE_TYPE, PortMessage, PortMessageResponse } from '@/types/handlers';
import { AI, TEXT } from '@/config/constants';
import { ErrorCode, ExtensionError } from '@/utils/error-types';

type PortState = 'idle' | 'connecting' | 'connected' | 'disconnected';

interface PendingRequest {
  id: string;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  message: Omit<PortMessage, 'id'>;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

export class ContentAIService {
  private port: chrome.runtime.Port | null = null;
  private portState: PortState = 'idle';
  private reconnectAttempts = 0;
  private pendingRequests = new Map<string, PendingRequest>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect(): void {
    if (this.portState === 'connecting' || this.portState === 'connected') {
      return;
    }

    this.portState = 'connecting';

    try {
      this.port = chrome.runtime.connect({ name: 'ai-bridge' });
      this.port.onDisconnect.addListener(this.handleDisconnect);
      this.port.onMessage.addListener(this.handleMessage);
      this.portState = 'connected';
      this.reconnectAttempts = 0;
      Logger.debug('[ContentAIService] Port connected');
    } catch (e) {
      this.portState = 'disconnected';
      Logger.error('[ContentAIService] Failed to connect port', { error: e });
    }
  }

  disconnect(): void {
    this.clearReconnectTimer();

    for (const requestId of this.pendingRequests.keys()) {
      this.notifyCancellation(requestId);
    }

    if (this.port) {
      try {
        this.port.onDisconnect.removeListener(this.handleDisconnect);
        this.port.onMessage.removeListener(this.handleMessage);
        this.port.disconnect();
      } catch (e) {
        Logger.debug('[ContentAIService] Error disconnecting port', { error: e });
      }
      this.port = null;
    }

    this.rejectAllPending(new Error('Port disconnected by user'));
    this.portState = 'idle';
    this.reconnectAttempts = 0;
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private notifyCancellation(requestId: string): void {
    if (!this.port || this.portState !== 'connected') {
      this.connect();
    }
    if (!this.port || this.portState !== 'connected') {
      return;
    }
    try {
      this.port.postMessage({ type: PORT_CANCEL_MESSAGE_TYPE, id: requestId });
    } catch (error) {
      Logger.debug('[ContentAIService] Failed to notify background cancellation', {
        id: requestId,
        error,
      });
    }
  }

  private handleMessage = (msg: PortMessageResponse): void => {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) {
      Logger.warn('[ContentAIService] Received response for unknown request', { id: msg.id });
      return;
    }

    this.clearPending(pending);
    this.pendingRequests.delete(msg.id);
    if (this.isErrorResponse(msg.response)) {
      pending.reject(new Error(msg.response.error));
      return;
    }
    pending.resolve(msg.response);
  };

  private handleDisconnect = (): void => {
    const errorMessage =
      chrome.runtime.lastError?.message || 'AI Bridge Port disconnected unexpectedly';
    Logger.debug('[ContentAIService] Port disconnected', { error: errorMessage });

    this.port = null;
    this.portState = 'disconnected';

    if (this.pendingRequests.size > 0) {
      this.attemptReconnect();
    } else {
      this.reconnectAttempts = 0;
    }
  };

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= AI.PORT.MAX_RECONNECT_ATTEMPTS) {
      Logger.warn('[ContentAIService] Max reconnect attempts reached, rejecting pending requests');
      this.rejectAllPending(new Error('Port reconnection failed after max attempts'));
      this.reconnectAttempts = 0;
      return;
    }

    const delay = Math.min(
      AI.PORT.RECONNECT_BASE_DELAY_MS *
        Math.pow(AI.PORT.RECONNECT_BACKOFF_MULTIPLIER, this.reconnectAttempts),
      AI.PORT.RECONNECT_MAX_DELAY_MS,
    );

    this.reconnectAttempts++;
    Logger.info('[ContentAIService] Attempting reconnect', {
      attempt: this.reconnectAttempts,
      delay,
    });

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();

      if (this.portState === 'connected') {
        this.resendPendingRequests();
      } else {
        this.attemptReconnect();
      }
    }, delay);
  }

  private resendPendingRequests(): void {
    if (!this.port || this.portState !== 'connected') {
      return;
    }

    for (const [id, pending] of this.pendingRequests) {
      try {
        this.port.postMessage({ ...pending.message, id });
        Logger.debug('[ContentAIService] Resent pending request', { id });
      } catch (e) {
        Logger.error('[ContentAIService] Failed to resend request', { id, error: e });
      }
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [, pending] of this.pendingRequests) {
      this.clearPending(pending);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private clearPending(pending: PendingRequest): void {
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener('abort', pending.abortHandler);
    }
  }

  private isErrorResponse(value: unknown): value is { error: string } {
    return (
      typeof value === 'object' &&
      value !== null &&
      'error' in value &&
      typeof (value as { error?: unknown }).error === 'string'
    );
  }

  private createCancelledError(): ExtensionError {
    return new ExtensionError(
      ErrorCode.TASK_CANCELLED,
      TEXT.EXTRACTION_CANCELLED_BY_USER,
      {},
      false,
    );
  }

  private getPort(): chrome.runtime.Port {
    if (!this.port || this.portState !== 'connected') {
      this.connect();
    }

    if (!this.port) {
      throw new Error('Failed to establish port connection');
    }

    return this.port;
  }

  async callAI<T>(
    message: Omit<PortMessage, 'id'>,
    signal?: AbortSignal,
    timeoutMs: number = AI.DEFAULT_TIMEOUT,
  ): Promise<T> {
    if (signal?.aborted) {
      throw this.createCancelledError();
    }

    return new Promise((resolve, reject) => {
      let id: string | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let abortHandler: (() => void) | undefined;
      try {
        const port = this.getPort();
        const requestId =
          typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
                b.toString(16).padStart(2, '0'),
              ).join('');
        id = requestId;

        timer = setTimeout(() => {
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            this.notifyCancellation(requestId);
            this.clearPending(pending);
            this.pendingRequests.delete(requestId);
            if (this.pendingRequests.size === 0) {
              this.clearReconnectTimer();
            }
          }
          reject(new Error('AI Bridge response timeout'));
        }, timeoutMs);

        abortHandler = () => {
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            this.notifyCancellation(requestId);
            this.clearPending(pending);
            this.pendingRequests.delete(requestId);
            if (this.pendingRequests.size === 0) {
              this.clearReconnectTimer();
            }
          }
          reject(this.createCancelledError());
        };
        signal?.addEventListener('abort', abortHandler, { once: true });

        this.pendingRequests.set(requestId, {
          id: requestId,
          resolve: resolve as (value: unknown) => void,
          reject,
          timer,
          message,
          signal,
          abortHandler,
        });

        try {
          port.postMessage({ ...message, id: requestId });
        } catch (err) {
          const pending = this.pendingRequests.get(requestId);
          if (pending) {
            this.clearPending(pending);
          } else {
            clearTimeout(timer);
            if (signal && abortHandler) {
              signal.removeEventListener('abort', abortHandler);
            }
          }
          this.pendingRequests.delete(requestId);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      } catch (err) {
        if (timer) {
          clearTimeout(timer);
        }
        if (signal && abortHandler) {
          signal.removeEventListener('abort', abortHandler);
        }
        if (id) {
          this.pendingRequests.delete(id);
        }
        reject(err);
      }
    });
  }
}
