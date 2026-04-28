import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageController } from '../src/content/PageController';
import { ErrorCode } from '../src/utils/errors';

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PageController', () => {
  const observeMock = vi.fn();
  const disconnectMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    class TestMutationObserver {
      observe = observeMock;
      disconnect = disconnectMock;
    }

    vi.stubGlobal('MutationObserver', TestMutationObserver);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('rejects DOM waits when the abort signal is triggered', async () => {
    const pageController = new PageController();
    const abortController = new AbortController();
    const target = {} as Node;

    const promise = pageController.waitForDOMChanges(target, 1000, abortController.signal);
    abortController.abort();

    await expect(promise).rejects.toMatchObject({ code: ErrorCode.TASK_CANCELLED });
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects scroll operations before touching the page when already aborted', async () => {
    const pageController = new PageController();
    const abortController = new AbortController();
    const container = {} as Element;

    abortController.abort();

    await expect(
      pageController.scrollContainer(container, abortController.signal),
    ).rejects.toMatchObject({
      code: ErrorCode.TASK_CANCELLED,
    });
  });
});
