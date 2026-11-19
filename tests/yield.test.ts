import { afterEach, describe, expect, it, vi } from 'vitest';
import { createYieldBudget, yieldToMain } from '../src/content/utils/yield';
import { ErrorCode, ExtensionError } from '../src/utils/error-types';

describe('content yield utilities', () => {
  const originalScheduler = (globalThis as { scheduler?: unknown }).scheduler;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalScheduler === undefined) {
      delete (globalThis as { scheduler?: unknown }).scheduler;
    } else {
      Object.defineProperty(globalThis, 'scheduler', {
        configurable: true,
        value: originalScheduler,
      });
    }
  });

  it('uses scheduler.yield() with scheduler bound as receiver when available', async () => {
    const schedulerObj = {
      yield: vi.fn(function (this: unknown) {
        if (this !== schedulerObj) {
          return Promise.reject(
            new TypeError("Failed to execute 'yield' on 'Scheduler': Illegal invocation"),
          );
        }
        return Promise.resolve(undefined);
      }),
    };
    Object.defineProperty(globalThis, 'scheduler', {
      configurable: true,
      value: schedulerObj,
    });

    await yieldToMain();

    expect(schedulerObj.yield).toHaveBeenCalledOnce();
  });

  it('falls back to setTimeout when scheduler.yield() is absent', async () => {
    delete (globalThis as { scheduler?: unknown }).scheduler;
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await yieldToMain();

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it('throws TASK_CANCELLED when signal is already aborted or aborts during yield', async () => {
    const preAborted = new AbortController();
    preAborted.abort();

    await expect(yieldToMain(preAborted.signal)).rejects.toMatchObject({
      code: ErrorCode.TASK_CANCELLED,
    });

    const controller = new AbortController();
    Object.defineProperty(globalThis, 'scheduler', {
      configurable: true,
      value: {
        yield: () => {
          controller.abort();
          return Promise.resolve();
        },
      },
    });

    await expect(yieldToMain(controller.signal)).rejects.toBeInstanceOf(ExtensionError);
  });

  it('enforces the time budget before yielding to the main thread', async () => {
    const yieldSpy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'scheduler', {
      configurable: true,
      value: { yield: yieldSpy },
    });

    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    const budget = createYieldBudget(50);

    // Within 50ms budget: no yield
    now = 1030;
    await budget.yieldIfNeeded();
    expect(yieldSpy).not.toHaveBeenCalled();

    // Past 50ms deadline: yields and advances next deadline
    now = 1055;
    await budget.yieldIfNeeded();
    expect(yieldSpy).toHaveBeenCalledTimes(1);

    now = 1080;
    await budget.yieldIfNeeded();
    expect(yieldSpy).toHaveBeenCalledTimes(1);
  });
});
