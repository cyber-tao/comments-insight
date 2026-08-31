import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentAIService } from '../src/content/ContentAIService';
import { ErrorCode } from '../src/utils/errors';
import { AI } from '../src/config/constants';
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

    await vi.advanceTimersByTimeAsync(122);
    await Promise.resolve();
    let settled = false;
    promise.catch(() => {
      settled = true;
    });
    expect(settled).toBe(false);

    const request = postMessageMock.mock.calls[0]?.[0] as { id: string };
    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).rejects.toThrow('AI Bridge response timeout');
    expect(postMessageMock).toHaveBeenLastCalledWith({
      type: PORT_CANCEL_MESSAGE_TYPE,
      id: request.id,
    });
  });
});
