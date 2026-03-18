import { Logger } from '../../utils/logger';
import { PortMessage, PortMessageResponse } from '../../types/handlers';
import { AI } from '@/config/constants';

export class ContentAIService {
  private port: chrome.runtime.Port | null = null;

  connect(): void {
    if (!this.port) {
      this.port = chrome.runtime.connect({ name: 'ai-bridge' });
      this.port.onDisconnect.addListener(this.handleDisconnect);
    }
  }

  disconnect(): void {
    if (this.port) {
      try {
        this.port.onDisconnect.removeListener(this.handleDisconnect);
        this.port.disconnect();
      } catch (e) {
        Logger.debug('[ContentAIService] Error disconnecting port', { error: e });
      }
      this.port = null;
    }
  }

  private handleDisconnect = () => {
    Logger.debug('[ContentAIService] AI Bridge Port disconnected');
    this.port = null;
  };

  private getPort(): chrome.runtime.Port {
    if (!this.port) {
      this.connect();
    }

    return this.port!;
  }

  async callAI<T>(message: Omit<PortMessage, 'id'>): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      try {
        const port = this.getPort();
        const id = Math.random().toString(36).slice(2);

        const finalize = (callback: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          port.onMessage.removeListener(listener);
          port.onDisconnect.removeListener(disconnectListener);
          callback();
        };

        // Create a listener for this specific message ID
        const listener = (msg: PortMessageResponse) => {
          if (msg.id === id) {
            finalize(() => resolve(msg.response as T));
          }
        };

        const disconnectListener = (): void => {
          const messageText =
            chrome.runtime.lastError?.message || '[ContentAIService] AI Bridge Port disconnected';
          finalize(() => reject(new Error(messageText)));
        };

        port.onMessage.addListener(listener);
        port.onDisconnect.addListener(disconnectListener);
        timer = setTimeout(() => {
          finalize(() => reject(new Error('AI Bridge response timeout')));
        }, AI.DEFAULT_TIMEOUT);
        port.postMessage({ ...message, id });
      } catch (err) {
        if (timer) {
          clearTimeout(timer);
        }
        reject(err);
      }
    });
  }
}
