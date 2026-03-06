import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ErrorCode,
  ErrorHandler,
  createNetworkError,
  getUserFriendlyMessage,
} from '../src/utils/errors';

describe('getUserFriendlyMessage', () => {
  it('returns predefined message for MISSING_API_KEY', () => {
    const msg = getUserFriendlyMessage(ErrorCode.MISSING_API_KEY, 'tech');
    expect(msg).toBeTruthy();
    expect(msg).not.toBe('tech');
  });

  it('falls back to technical message for unknown code', () => {
    const msg = getUserFriendlyMessage('UNKNOWN' as unknown as ErrorCode, 'tech');
    expect(msg).toBe('tech');
  });
});

describe('ErrorHandler.withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should stop retry backoff immediately when abortSignal is cancelled', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockRejectedValue(createNetworkError('network failed'));

    const promise = ErrorHandler.withRetry(fn, 'test.withRetry.abort', {
      maxAttempts: 3,
      initialDelay: 1000,
      maxDelay: 1000,
      abortSignal: controller.signal,
    });

    await Promise.resolve();
    controller.abort();

    await expect(promise).rejects.toMatchObject({
      code: ErrorCode.TASK_CANCELLED,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
