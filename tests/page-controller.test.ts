// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PageController } from '../src/content/PageController';
import { ErrorCode } from '../src/utils/errors';
import { TIMING } from '../src/config/constants';

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

describe('PageController scroll mutation detection', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<section><p>first</p></section>';
    container = document.querySelector('section')!;
    Object.defineProperties(container, {
      scrollHeight: { value: 1000 },
      clientHeight: { value: 200 },
    });
    container.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it.each(['during scroll', 'after scroll'])(
    'detects text updates %s while height and element count stay unchanged',
    async (timing) => {
      const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
      vi.mocked(container.scrollTo).mockImplementation(() => {
        const update = () => {
          container.querySelector('p')!.firstChild!.nodeValue = 'second';
        };
        if (timing === 'during scroll') update();
        else setTimeout(update, TIMING.SCROLL_PAUSE_MS + 20);
      });

      const result = new PageController().scrollContainer(container);
      await vi.runAllTimersAsync();

      await expect(result).resolves.toEqual({ contentChanged: true });
      expect(container.scrollHeight).toBe(1000);
      expect(container.childElementCount).toBe(1);
      expect(disconnect).toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('detects subtree replacement before the post-scroll wait starts', async () => {
    vi.mocked(container.scrollTo).mockImplementation(() => {
      container.innerHTML = '<p>replacement</p>';
    });

    const result = new PageController().scrollContainer(container);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ contentChanged: true });
    expect(container.childElementCount).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports no change after a bounded wait and releases both observers', async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');

    const result = new PageController().scrollContainer(container);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toEqual({ contentChanged: false });
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('releases the pre-scroll observer when cancellation interrupts the scroll pause', async () => {
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const controller = new AbortController();
    const rejected = expect(
      new PageController().scrollContainer(container, controller.signal),
    ).rejects.toMatchObject({ code: ErrorCode.TASK_CANCELLED });
    controller.abort();

    await rejected;
    expect(disconnect).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
