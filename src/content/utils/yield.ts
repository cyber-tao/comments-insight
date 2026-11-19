import { checkAborted } from './abort';

interface GlobalWithScheduler {
  scheduler?: {
    yield?: () => Promise<void>;
  };
}

/**
 * Yields control back to the browser event loop using `scheduler.yield()` when supported,
 * falling back to `setTimeout(..., 0)` in older Chrome or test environments.
 */
export async function yieldToMain(signal?: AbortSignal): Promise<void> {
  checkAborted(signal, false);

  const scheduler = (globalThis as GlobalWithScheduler).scheduler;
  if (typeof scheduler?.yield === 'function') {
    await scheduler.yield();
  } else {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  checkAborted(signal, false);
}

/**
 * Creates a time-budget controller (50ms default) to prevent long DOM iteration loops
 * from blocking page responsiveness and user input handling.
 */
export function createYieldBudget(budgetMs: number = 50): {
  yieldIfNeeded: (signal?: AbortSignal) => Promise<void>;
} {
  let deadline = performance.now() + budgetMs;

  return {
    async yieldIfNeeded(signal?: AbortSignal): Promise<void> {
      checkAborted(signal, false);
      if (performance.now() < deadline) {
        return;
      }
      await yieldToMain(signal);
      deadline = performance.now() + budgetMs;
    },
  };
}
