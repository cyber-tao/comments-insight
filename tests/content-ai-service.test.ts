import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentAIService } from '../src/content/services/ContentAIService';
import { ErrorCode } from '../src/utils/errors';

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

    messageListener({ id: postedMessage.id, response: { error: 'Bridge failed' } });

    await expect(promise).rejects.toThrow('Bridge failed');
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

    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: ErrorCode.TASK_CANCELLED });
    expect(vi.getTimerCount()).toBe(0);
  });
});
