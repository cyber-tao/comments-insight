import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ErrorCode,
  ErrorHandler,
  ExtensionError,
  createNetworkError,
  getUserFriendlyMessage,
} from '../src/utils/errors';
import {
  fromExtensionErrorPayload,
  isExtensionErrorPayload,
  toExtensionErrorPayload,
} from '../src/utils/error-types';

describe('extension error transport', () => {
  it('round-trips conflict translation metadata without exposing arbitrary details', () => {
    const error = new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Settings changed', {
      messageKey: 'options.settingsConflict',
      apiKey: 'synthetic-private-value',
      diagnostic: { stack: 'source-only diagnostic' },
    });
    const payload = toExtensionErrorPayload(error);
    expect(payload).toEqual({
      code: ErrorCode.VALIDATION_ERROR,
      message: 'Settings changed',
      retryable: false,
      messageKey: 'options.settingsConflict',
    });
    const received = fromExtensionErrorPayload(JSON.parse(JSON.stringify(payload)));
    expect(received).toBeInstanceOf(ExtensionError);
    expect((received as ExtensionError).details).toEqual({
      messageKey: 'options.settingsConflict',
    });
    expect(JSON.stringify(payload)).not.toContain('synthetic-private-value');
    expect(JSON.stringify(payload)).not.toContain('source-only diagnostic');
  });

  it('accepts legacy error envelopes and rejects malformed translation metadata', () => {
    const payload = { code: ErrorCode.API_ERROR, message: 'Legacy error', retryable: true };
    expect(isExtensionErrorPayload(payload)).toBe(true);
    expect(fromExtensionErrorPayload(payload)).toMatchObject({
      code: ErrorCode.API_ERROR,
      message: 'Legacy error',
      retryable: true,
      details: undefined,
    });
    expect(isExtensionErrorPayload({ ...payload, messageKey: 123 })).toBe(false);
  });
});

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

  it('should honor an explicit non-retryable decision for a normally retryable code', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new ExtensionError(ErrorCode.API_ERROR, 'bad request', {}, false));

    await expect(ErrorHandler.withRetry(fn, 'test.withRetry.explicit')).rejects.toMatchObject({
      code: ErrorCode.API_ERROR,
      retryable: false,
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should use code defaults when retryability was not explicitly specified', async () => {
    const fn = vi.fn().mockRejectedValue(new ExtensionError(ErrorCode.API_ERROR, 'server error'));
    const promise = ErrorHandler.withRetry(fn, 'test.withRetry.default', {
      maxAttempts: 3,
      initialDelay: 10,
      maxDelay: 10,
    });
    const rejection = expect(promise).rejects.toMatchObject({ code: ErrorCode.API_ERROR });

    await vi.runAllTimersAsync();
    await rejection;
    expect(fn).toHaveBeenCalledTimes(3);
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
