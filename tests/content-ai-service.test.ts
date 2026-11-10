import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentAIService } from '../src/content/ContentAIService';
import { ErrorCode } from '../src/utils/errors';
import { AI, TIMEOUT } from '../src/config/constants';
import { PORT_ACTIVITY_MESSAGE_TYPE } from '../src/types/handlers';
import { PORT_CANCEL_MESSAGE_TYPE } from '../src/types';

describe('ContentAIService', () => {
  const connectMock = vi.fn();
  const addDisconnectListener = vi.fn();
  const removeDisconnectListener = vi.fn();
  const addMessageListener = vi.fn();
  const removeMessageListener = vi.fn();
  const disconnectMock = vi.fn();
  const postMessageMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('chrome', {
      runtime: {
        connect: connectMock,
        lastError: null,
      },
    });
    connectMock.mockReturnValue({
      postMessage: postMessageMock,
      disconnect: disconnectMock,
      onDisconnect: {
        addListener: addDisconnectListener,
        removeListener: removeDisconnectListener,
      },
      onMessage: {
        addListener: addMessageListener,
        removeListener: removeMessageListener,
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('clears pending request state when posting to the port fails', async () => {
    const service = new ContentAIService();
    postMessageMock.mockImplementationOnce(() => {
      throw new Error('send failed');
    });

    await expect(
      service.callAI({
        type: 'AI_EXTRACT_CONTENT',
        payload: { chunks: ['<div>comment</div>'] },
      }),
    ).rejects.toThrow('send failed');

    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects when the port response contains an error envelope', async () => {
    const service = new ContentAIService();
    const promise = service.callAI({
      type: 'AI_EXTRACT_CONTENT',
      payload: { chunks: ['<div>comment</div>'] },
    });
    const postedMessage = postMessageMock.mock.calls[0]?.[0] as { id: string };
    const messageListener = addMessageListener.mock.calls[0]?.[0] as (message: {
      id: string;
      response: unknown;
    }) => void;

    messageListener({
      id: postedMessage.id,
      response: {
        error: { code: ErrorCode.AI_TIMEOUT, message: 'Bridge failed', retryable: false },
      },
    });

    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.AI_TIMEOUT,
      message: 'Bridge failed',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects pending requests when the abort signal is triggered', async () => {
    const service = new ContentAIService();
    const controller = new AbortController();
    const promise = service.callAI(
      {
        type: 'AI_EXTRACT_CONTENT',
        payload: { chunks: ['<div>comment</div>'] },
      },
      controller.signal,
    );

    const request = postMessageMock.mock.calls[0]?.[0] as { id: string };
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: ErrorCode.TASK_CANCELLED });
    expect(postMessageMock).toHaveBeenLastCalledWith({
      type: PORT_CANCEL_MESSAGE_TYPE,
      id: request.id,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores responses for unknown request ids without clearing active requests', async () => {
    const service = new ContentAIService();
    const promise = service.callAI<string>({
      type: 'AI_EXTRACT_CONTENT',
      payload: { chunks: ['<div>comment</div>'] },
    });
    const postedMessage = postMessageMock.mock.calls[0]?.[0] as { id: string };
    const messageListener = addMessageListener.mock.calls[0]?.[0] as (message: {
      id: string;
      response: unknown;
    }) => void;

    messageListener({ id: 'unknown-id', response: 'ignored' });
    messageListener({ id: postedMessage.id, response: 'ok' });

    await expect(promise).resolves.toBe('ok');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects pending requests when reconnect attempts are exhausted', async () => {
    const service = new ContentAIService();
    const promise = service.callAI({
      type: 'AI_EXTRACT_CONTENT',
      payload: { chunks: ['<div>comment</div>'] },
    });
    const disconnectListener = addDisconnectListener.mock.calls[0]?.[0] as () => void;

    connectMock.mockImplementation(() => {
      throw new Error('connect failed');
    });
    disconnectListener();
    const rejection = expect(promise).rejects.toThrow(
      'Port reconnection failed after max attempts',
    );

    await vi.advanceTimersByTimeAsync(
      AI.PORT.RECONNECT_BASE_DELAY_MS +
        AI.PORT.RECONNECT_BASE_DELAY_MS * AI.PORT.RECONNECT_BACKOFF_MULTIPLIER +
        AI.PORT.RECONNECT_BASE_DELAY_MS *
          AI.PORT.RECONNECT_BACKOFF_MULTIPLIER *
          AI.PORT.RECONNECT_BACKOFF_MULTIPLIER,
    );

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resets only the idle deadline on each matching heartbeat without completing the request', async () => {
    const service = new ContentAIService();
    const idleTimeout = TIMEOUT.MESSAGE_OVERHEAD_MS + 123;
    const promise = service.callAI<string>(
      { type: 'AI_EXTRACT_CONTENT', payload: { chunks: ['<div>comment</div>'] } },
      undefined,
      123,
    );
    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    const request = postMessageMock.mock.calls[0]?.[0] as { id: string };
    const onMessage = addMessageListener.mock.calls[0]?.[0] as (message: unknown) => void;

    for (let i = 0; i < 3; i += 1) {
      await vi.advanceTimersByTimeAsync(idleTimeout - 1);
      expect(settled).toBe(false);
      onMessage({ id: request.id, type: PORT_ACTIVITY_MESSAGE_TYPE });
      expect(settled).toBe(false);
      expect(vi.getTimerCount()).toBe(1);
    }
    await vi.advanceTimersByTimeAsync(idleTimeout - 1);
    expect(settled).toBe(false);
    const rejection = expect(promise).rejects.toThrow('AI Bridge response timeout');
    await vi.advanceTimersByTimeAsync(1);
    await rejection;

    expect(vi.getTimerCount()).toBe(0);
    expect(postMessageMock).toHaveBeenCalledTimes(2);
    expect(postMessageMock).toHaveBeenLastCalledWith({
      id: request.id,
      type: PORT_CANCEL_MESSAGE_TYPE,
    });
  });

  it('does not let a heartbeat extend another request or an unknown request deadline', async () => {
    const service = new ContentAIService();
    const idleTimeout = TIMEOUT.MESSAGE_OVERHEAD_MS + 123;
    const first = service.callAI<string>(
      { type: 'AI_EXTRACT_CONTENT', payload: { chunks: ['first'] } },
      undefined,
      123,
    );
    const second = service.callAI<string>(
      { type: 'AI_EXTRACT_CONTENT', payload: { chunks: ['second'] } },
      undefined,
      123,
    );
    const rejection = expect(second).rejects.toThrow('AI Bridge response timeout');
    const firstRequest = postMessageMock.mock.calls[0]?.[0] as { id: string };
    const secondRequest = postMessageMock.mock.calls[1]?.[0] as { id: string };
    const onMessage = addMessageListener.mock.calls[0]?.[0] as (message: unknown) => void;

    await vi.advanceTimersByTimeAsync(idleTimeout - 1);
    onMessage({ id: firstRequest.id, type: PORT_ACTIVITY_MESSAGE_TYPE });
    onMessage({ id: 'unknown-request', type: PORT_ACTIVITY_MESSAGE_TYPE });
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(vi.getTimerCount()).toBe(1);
    expect(postMessageMock).toHaveBeenLastCalledWith({
      id: secondRequest.id,
      type: PORT_CANCEL_MESSAGE_TYPE,
    });

    onMessage({ id: firstRequest.id, response: 'first result' });
    await expect(first).resolves.toBe('first result');
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['success', 'error', 'abort', 'disconnect'] as const)(
    'clears a heartbeat-reset idle timer after %s and ignores late activity',
    async (terminal) => {
      const service = new ContentAIService();
      const controller = new AbortController();
      const idleTimeout = TIMEOUT.MESSAGE_OVERHEAD_MS + 123;
      const promise = service.callAI<string>(
        { type: 'AI_EXTRACT_CONTENT', payload: { chunks: ['comment'] } },
        controller.signal,
        123,
      );
      const outcome = promise.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      const request = postMessageMock.mock.calls[0]?.[0] as { id: string };
      const onMessage = addMessageListener.mock.calls[0]?.[0] as (message: unknown) => void;
      await vi.advanceTimersByTimeAsync(idleTimeout - 1);
      onMessage({ id: request.id, type: PORT_ACTIVITY_MESSAGE_TYPE });
      expect(vi.getTimerCount()).toBe(1);

      if (terminal === 'success') {
        onMessage({ id: request.id, response: 'done' });
        await expect(outcome).resolves.toEqual({ value: 'done' });
      } else if (terminal === 'error') {
        onMessage({
          id: request.id,
          response: { error: { code: ErrorCode.AI_TIMEOUT, message: 'Failed', retryable: false } },
        });
        await expect(outcome).resolves.toMatchObject({
          error: { code: ErrorCode.AI_TIMEOUT, message: 'Failed' },
        });
      } else if (terminal === 'abort') {
        controller.abort();
        await expect(outcome).resolves.toMatchObject({ error: { code: ErrorCode.TASK_CANCELLED } });
      } else {
        service.disconnect();
        await expect(outcome).resolves.toMatchObject({
          error: { message: 'Port disconnected by user' },
        });
      }

      expect(vi.getTimerCount()).toBe(0);
      const postsAfterCompletion = postMessageMock.mock.calls.length;
      onMessage({ id: request.id, type: PORT_ACTIVITY_MESSAGE_TYPE });
      await vi.advanceTimersByTimeAsync(idleTimeout * 2);
      expect(vi.getTimerCount()).toBe(0);
      expect(postMessageMock).toHaveBeenCalledTimes(postsAfterCompletion);
      if (terminal === 'abort' || terminal === 'disconnect') {
        expect(postMessageMock).toHaveBeenLastCalledWith({
          id: request.id,
          type: PORT_CANCEL_MESSAGE_TYPE,
        });
      }
    },
  );

  it('uses the provided timeout instead of the default timeout', async () => {
    const service = new ContentAIService();
    const promise = service.callAI(
      {
        type: 'AI_EXTRACT_CONTENT',
        payload: { chunks: ['<div>comment</div>'] },
      },
      undefined,
      123,
    );

    let settled = false;
    void promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await vi.advanceTimersByTimeAsync(TIMEOUT.MESSAGE_OVERHEAD_MS + 122);
    expect(settled).toBe(false);

    const request = postMessageMock.mock.calls[0]?.[0] as { id: string };
    const rejection = expect(promise).rejects.toThrow('AI Bridge response timeout');
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(postMessageMock).toHaveBeenLastCalledWith({
      type: PORT_CANCEL_MESSAGE_TYPE,
      id: request.id,
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
