import 'fake-indexeddb/auto';
import { beforeEach } from 'vitest';
import { container } from '../src/background/ServiceContainer';

// Mock ResizeObserver for virtua in jsdom
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserverMock;
if (typeof window !== 'undefined') {
  window.ResizeObserver = ResizeObserverMock;
}
globalThis.ResizeObserver = ResizeObserverMock;

// Fail fast on unhandled rejections so tests don't silently pass with hidden async errors.
process.on('unhandledRejection', (reason) => {
  if (reason instanceof Error) {
    throw reason;
  }
  throw new Error(String(reason));
});

// Reset the global service container before each test so suites that touch
// ServiceContainer-backed services start from a clean slate. This prevents
// fake-indexeddb instances and TaskManager state from bleeding across tests.
beforeEach(() => {
  container.resetAll();
});
