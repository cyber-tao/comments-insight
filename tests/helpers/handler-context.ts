import type { HandlerContext } from '../../src/background/handlers/types';

export function createMockHandlerContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    taskManager: {} as HandlerContext['taskManager'],
    aiService: {} as HandlerContext['aiService'],
    storageManager: {} as HandlerContext['storageManager'],
    sender: { tab: { id: 1 } },
    ...overrides,
  } as HandlerContext;
}
