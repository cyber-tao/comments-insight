import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEnsureContentScript } from '../../src/background/handlers/misc';
import type { HandlerContext } from '../../src/background/handlers/types';

vi.mock('../../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('misc handlers - content script injection', () => {
  let injected = false;

  const mockExecuteScript = vi.fn(async () => {
    injected = true;
    return [];
  });

  const mockSendMessage = vi.fn(async () => {
    if (!injected) {
      throw new Error('No receiver');
    }
    return { status: 'ok' };
  });

  const mockQuery = vi.fn(async () => [{ id: 1 }]);

  beforeEach(() => {
    injected = false;
    vi.clearAllMocks();

    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage: mockSendMessage,
        query: mockQuery,
      },
      scripting: {
        executeScript: mockExecuteScript,
      },
      runtime: {
        getManifest: () => ({
          content_scripts: [{ js: ['assets/content-script.js'] }],
        }),
      },
    });
  });

  const ctx = (overrides: Partial<HandlerContext> = {}): HandlerContext =>
    ({
      taskManager: {} as any,
      aiService: {} as any,
      storageManager: {} as any,
      sender: { tab: { id: 1 } },
      ...overrides,
    }) as HandlerContext;

  it('should inject when ping fails', async () => {
    const res = await handleEnsureContentScript({ type: 'ENSURE_CONTENT_SCRIPT' } as any, ctx());

    expect(res.success).toBe(true);
    expect(mockExecuteScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['assets/content-script.js'],
    });
  });

  it('should not inject when already injected', async () => {
    injected = true;

    const res = await handleEnsureContentScript({ type: 'ENSURE_CONTENT_SCRIPT' } as any, ctx());

    expect(res.success).toBe(true);
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });
});
