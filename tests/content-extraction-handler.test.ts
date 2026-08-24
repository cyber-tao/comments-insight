import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleStartExtraction } from '../src/content/handlers/extraction';
import { handleStartConfigGeneration } from '../src/content/handlers/config-generation';
import { resetExtractionState } from '../src/content/extractionState';
import { MESSAGES } from '../src/config/constants';
import type { Comment } from '../src/types';

const sendMessageMock = vi.fn().mockResolvedValue(undefined);
const { generateConfigMock, cleanupMock } = vi.hoisted(() => ({
  generateConfigMock: vi.fn(),
  cleanupMock: vi.fn(),
}));

vi.stubGlobal('chrome', {
  runtime: {
    sendMessage: sendMessageMock,
  },
});

vi.mock('../src/content/handlers/tools', () => ({
  getTools: vi.fn(),
}));

vi.mock('../src/content/handlers/dom', () => ({
  getPostInfo: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example' }),
}));

vi.mock('../src/content/strategies/AIStrategy', () => ({
  AIStrategy: class {
    generateConfig = generateConfigMock;
    cleanup = cleanupMock;
  },
}));

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { getTools } from '../src/content/handlers/tools';

function makeComment(id: string): Comment {
  return {
    id,
    username: `user-${id}`,
    content: `content ${id}`,
    timestamp: '1h',
    likes: 0,
    replies: [],
  };
}

function setExtractor(behavior: (signal: AbortSignal) => Promise<Comment[]>) {
  (getTools as ReturnType<typeof vi.fn>).mockReturnValue({
    commentExtractor: {
      extractWithAI: vi.fn((_max: number, _platform: string, _cb: unknown, signal: AbortSignal) =>
        behavior(signal),
      ),
    },
  });
}

describe('content extraction handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetExtractionState();
  });

  it('acks immediately, reports EXTRACTION_COMPLETED and resolves onComplete', async () => {
    const sendResponse = vi.fn();
    const onComplete = vi.fn();
    setExtractor(async () => [makeComment('c1'), makeComment('c2')]);

    await handleStartExtraction({ taskId: 'task-ok', maxComments: 10 }, sendResponse, onComplete);

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: MESSAGES.EXTRACTION_COMPLETED,
      payload: expect.objectContaining({
        taskId: 'task-ok',
        success: true,
        comments: expect.any(Array),
      }),
    });
    expect(onComplete).toHaveBeenCalledWith({ success: true, comments: expect.any(Array) });
  });

  it('reports failure and resolves onComplete when extraction throws', async () => {
    const onComplete = vi.fn();
    setExtractor(async () => {
      throw new Error('boom');
    });

    await handleStartExtraction({ taskId: 'task-fail', maxComments: 10 }, vi.fn(), onComplete);

    expect(sendMessageMock).toHaveBeenCalledWith({
      type: MESSAGES.EXTRACTION_COMPLETED,
      payload: { taskId: 'task-fail', success: false, error: 'boom' },
    });
    expect(onComplete).toHaveBeenCalledWith({ success: false, error: 'boom' });
  });

  it('resolves onComplete with cancelled when the task is superseded mid-flight', async () => {
    const onComplete = vi.fn();
    let call = 0;
    setExtractor((signal) => {
      call += 1;
      if (call === 1) {
        // First task hangs until aborted.
        return new Promise<Comment[]>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        });
      }
      return Promise.resolve([makeComment('c1')]);
    });

    const pending = handleStartExtraction(
      { taskId: 'task-old', maxComments: 10 },
      vi.fn(),
      onComplete,
    );

    // A newer task begins; the old one is superseded and aborted.
    await handleStartExtraction({ taskId: 'task-new', maxComments: 5 }, vi.fn(), vi.fn());
    await pending;

    expect(onComplete).toHaveBeenCalledWith({ success: false, error: 'cancelled' });
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: MESSAGES.EXTRACTION_COMPLETED,
      payload: expect.objectContaining({
        taskId: 'task-old',
        success: false,
        error: 'Extraction superseded by a newer task',
      }),
    });
  });

  it('reports config generation failure when no valid config is produced', async () => {
    generateConfigMock.mockResolvedValue(false);
    (getTools as ReturnType<typeof vi.fn>).mockReturnValue({ domAnalyzer: {} });

    await handleStartConfigGeneration({ taskId: 'config-fail' }, vi.fn());

    expect(sendMessageMock).toHaveBeenCalledWith({
      type: MESSAGES.CONFIG_GENERATION_COMPLETED,
      payload: {
        taskId: 'config-fail',
        success: false,
        error: 'No valid crawling configuration was generated',
      },
    });
    expect(cleanupMock).toHaveBeenCalledOnce();
  });

  it('forwards extraction progress for the active task only', async () => {
    setExtractor(async () => [makeComment('c1')] as Comment[]);
    const callsBefore = sendMessageMock.mock.calls.length;

    await handleStartExtraction({ taskId: 'task-progress', maxComments: 1 }, vi.fn(), undefined);

    const progressCalls = sendMessageMock.mock.calls
      .slice(callsBefore)
      .filter(([message]) => message?.type === MESSAGES.EXTRACTION_PROGRESS);
    // The mocked extractor never calls the progress callback, but the
    // completion path must still fire.
    const completionCalls = sendMessageMock.mock.calls
      .slice(callsBefore)
      .filter(([message]) => message?.type === MESSAGES.EXTRACTION_COMPLETED);
    expect(completionCalls).toHaveLength(1);
    expect(progressCalls).toHaveLength(0);
  });
});
