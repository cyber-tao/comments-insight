import type { HandlerContext } from '../../src/background/handlers/types';

export function createMockHandlerContext(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    taskManager: {} as HandlerContext['taskManager'],
    aiService: {} as HandlerContext['aiService'],
    settingsStore: {} as HandlerContext['settingsStore'],
    historyStore: {} as HandlerContext['historyStore'],
    encryptionService: {} as HandlerContext['encryptionService'],
    logStore: {} as HandlerContext['logStore'],
    sender: { tab: { id: 1 } },
    ...overrides,
  } as HandlerContext;
}
