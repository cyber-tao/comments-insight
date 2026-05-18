import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEnsureContentScript } from '../../src/background/handlers/misc';
import type { Message } from '../../src/types';
import { createMockHandlerContext } from '../helpers/handler-context';

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
  const mockTabsGet = vi.fn(async () => ({ id: 1, url: 'https://example.com/post' }));

  beforeEach(() => {
    injected = false;
    vi.clearAllMocks();

    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage: mockSendMessage,
        query: mockQuery,
        get: mockTabsGet,
      },
      scripting: {
        executeScript: mockExecuteScript,
      },
      runtime: {
        getManifest: () => ({
          content_scripts: [{ js: ['src/content/index.ts'] }],
        }),
      },
    });
  });

  it('should inject when ping fails', async () => {
    const res = await handleEnsureContentScript(
      { type: 'ENSURE_CONTENT_SCRIPT' } as Extract<Message, { type: 'ENSURE_CONTENT_SCRIPT' }>,
      createMockHandlerContext(),
    );

    expect(res.success).toBe(true);
    expect(mockExecuteScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['src/content/index.ts'],
    });
  });

  it('should not inject when already injected', async () => {
    injected = true;

    const res = await handleEnsureContentScript(
      { type: 'ENSURE_CONTENT_SCRIPT' } as Extract<Message, { type: 'ENSURE_CONTENT_SCRIPT' }>,
      createMockHandlerContext(),
    );

    expect(res.success).toBe(true);
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });

  it('should short-circuit on restricted URLs without retrying injection', async () => {
    mockTabsGet.mockResolvedValueOnce({ id: 1, url: 'chrome://extensions' });

    const res = await handleEnsureContentScript(
      { type: 'ENSURE_CONTENT_SCRIPT' } as Extract<Message, { type: 'ENSURE_CONTENT_SCRIPT' }>,
      createMockHandlerContext(),
    );

    expect(res.success).toBe(false);
    expect(mockExecuteScript).not.toHaveBeenCalled();
  });
});
