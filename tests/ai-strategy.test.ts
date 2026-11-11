// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AIStrategy } from '@/content/strategies/AIStrategy';
import { AIConfigGenerator } from '@/content/strategies/AIConfigGenerator';
import { ContentAIService } from '@/content/ContentAIService';
import { resetExtractionState, setExtractionActive } from '@/content/extractionState';
import { EXTRACTION_PROGRESS, MESSAGES, TIMING } from '@/config/constants';
import { ErrorCode } from '@/utils/error-types';
import { Tokenizer } from '@/utils/tokenizer';
import type { PageController } from '@/content/PageController';
import type { Comment, CrawlingConfig } from '@/types';

const aiServiceMock = vi.hoisted(() => ({
  callAI: vi.fn(),
  disconnect: vi.fn(),
}));
const sendMessageMock = vi.hoisted(() => vi.fn());

vi.mock('@/content/ContentAIService', () => ({
  ContentAIService: class {
    callAI = aiServiceMock.callAI;
    disconnect = aiServiceMock.disconnect;
  },
}));

vi.mock('@/utils/chrome-message', () => ({
  sendMessage: sendMessageMock,
}));

vi.mock('@/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

type AIStrategyInternals = {
  extractFromChunks(chunks: string[], signal?: AbortSignal, timeoutMs?: number): Promise<Comment[]>;
};

function createComment(id: string): Comment {
  return {
    id,
    username: `user-${id}`,
    timestamp: '2025-01-01T00:00:00Z',
    likes: 0,
    content: `comment-${id}`,
    replies: [],
  };
}

function createConfig(itemSelector = '.comment-item'): CrawlingConfig {
  return {
    id: 'generated-config',
    domain: 'localhost',
    container: { selector: '#comments', type: 'css' },
    item: { selector: itemSelector, type: 'css' },
    fields: [
      { name: 'username', rule: { selector: '.username', type: 'css' } },
      { name: 'content', rule: { selector: '.content', type: 'css' } },
    ],
    lastUpdated: 1,
  };
}

function createConfigGenerator(): AIConfigGenerator {
  return new AIConfigGenerator(new ContentAIService());
}

beforeEach(() => {
  document.body.innerHTML = '';
  setExtractionActive(true, 'ai-strategy-test');
  aiServiceMock.callAI.mockReset();
  aiServiceMock.disconnect.mockReset();
  sendMessageMock.mockReset();
  sendMessageMock.mockResolvedValue({ settings: { selectorCache: [] } });
});

afterEach(() => {
  resetExtractionState();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AIStrategy.extractFromChunks', () => {
  function extractFromChunks(strategy: AIStrategy, chunks: string[]): Promise<Comment[]> {
    return (strategy as unknown as AIStrategyInternals).extractFromChunks(chunks);
  }

  it('aggregates comments returned for every chunk', async () => {
    const first = createComment('first');
    const second = createComment('second');
    const third = createComment('third');
    aiServiceMock.callAI
      .mockResolvedValueOnce({ comments: [first] })
      .mockResolvedValueOnce({ comments: [second, third] });
    const strategy = new AIStrategy({} as PageController);

    await expect(extractFromChunks(strategy, ['chunk-one', 'chunk-two'])).resolves.toEqual([
      first,
      second,
      third,
    ]);
    expect(aiServiceMock.callAI).toHaveBeenCalledTimes(2);
    expect(aiServiceMock.callAI).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: MESSAGES.AI_EXTRACT_CONTENT,
        payload: expect.objectContaining({ chunks: ['chunk-one'] }),
      }),
      undefined,
      expect.any(Number),
    );
    expect(aiServiceMock.callAI).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: MESSAGES.AI_EXTRACT_CONTENT,
        payload: expect.objectContaining({ chunks: ['chunk-two'] }),
      }),
      undefined,
      expect.any(Number),
    );
  });

  it('propagates a port failure from any chunk', async () => {
    const portError = new Error('AI port disconnected');
    aiServiceMock.callAI
      .mockResolvedValueOnce({ comments: [createComment('first')] })
      .mockRejectedValueOnce(portError);
    const strategy = new AIStrategy({} as PageController);

    await expect(extractFromChunks(strategy, ['chunk-one', 'chunk-two'])).rejects.toBe(portError);
  });
});

describe('AIConfigGenerator.detectCommentSection', () => {
  it('uses a valid cached selector without making an AI request', async () => {
    document.body.innerHTML = '<section id="comments"></section>';
    sendMessageMock.mockResolvedValueOnce({
      settings: {
        selectorCache: [
          {
            domain: window.location.hostname,
            selectors: { commentContainer: '#comments' },
            lastUsed: 1,
            successCount: 1,
          },
        ],
      },
    });

    await expect(createConfigGenerator().detectCommentSection(8, 100, 10_000)).resolves.toBe(
      '#comments',
    );
    expect(aiServiceMock.callAI).not.toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('returns the AI candidate and caches it when no cache is available', async () => {
    document.body.innerHTML = '<main><section id="comments"></section></main>';
    aiServiceMock.callAI.mockResolvedValueOnce({
      data: {
        selectors: { commentContainer: '#comments' },
        confidence: 0.99,
      },
    });

    await expect(createConfigGenerator().detectCommentSection(8, 100, 10_000)).resolves.toBe(
      '#comments',
    );
    expect(aiServiceMock.callAI).toHaveBeenCalledTimes(1);
    expect(sendMessageMock).toHaveBeenCalledWith({
      type: MESSAGES.CACHE_SELECTOR,
      payload: {
        hostname: window.location.hostname,
        selector: '#comments',
      },
    });
  });

  it('returns null when every DOM chunk AI request fails', async () => {
    document.body.innerHTML = '<main><section id="comments"></section></main>';
    vi.spyOn(Tokenizer, 'chunkTextWithOverhead').mockReturnValue(['chunk-one', 'chunk-two']);
    aiServiceMock.callAI.mockRejectedValue(new Error('AI port unavailable'));

    await expect(createConfigGenerator().detectCommentSection(8, 100, 10_000)).resolves.toBeNull();
    expect(aiServiceMock.callAI).toHaveBeenCalledTimes(2);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });
});

describe('AIConfigGenerator.generateIntelligentConfig', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <article id="post">Post body</article>
      <section id="comments">
        <article class="comment-item"><span class="username">Alice</span><p class="content">A comment</p></article>
      </section>
    `;
  });

  it('returns an AI configuration that matches live comment items', async () => {
    const config = createConfig();
    aiServiceMock.callAI
      .mockResolvedValueOnce({
        config: { postContent: { selector: '#post', type: 'css' } },
      })
      .mockResolvedValueOnce({ config });

    const result = await createConfigGenerator().generateIntelligentConfig(
      window.location.hostname,
      { maxDepth: 8 },
      100,
      undefined,
      '#comments',
    );

    expect(result).toBe(config);
    expect(result?.fields.map((field) => field.name)).toEqual(['username', 'content']);
    expect(result?.postContent).toEqual({ selector: '#post', type: 'css' });
    expect(aiServiceMock.callAI).toHaveBeenCalledTimes(2);
  });

  it.each([
    'missing username rule',
    'empty username',
    'fields on different items',
    'item outside container',
  ])('rejects an unusable generated config: %s', async (scenario) => {
    const config = createConfig();
    if (scenario === 'missing username rule') {
      config.fields = config.fields.filter((field) => field.name !== 'username');
    } else if (scenario === 'empty username') {
      document.querySelector('.username')!.textContent = '   ';
    } else if (scenario === 'fields on different items') {
      document.querySelector('.username')!.remove();
      document
        .querySelector('#comments')!
        .insertAdjacentHTML(
          'beforeend',
          '<article class="comment-item"><span class="username">Bob</span></article>',
        );
    } else {
      document.body.append(document.querySelector('.comment-item')!);
    }
    aiServiceMock.callAI.mockResolvedValueOnce({ config: {} }).mockResolvedValueOnce({ config });

    await expect(
      createConfigGenerator().generateIntelligentConfig(
        window.location.hostname,
        { maxDepth: 8 },
        100,
        undefined,
        '#comments',
      ),
    ).rejects.toMatchObject({ code: ErrorCode.DOM_ANALYSIS_FAILED });
  });

  it('throws DOM_ANALYSIS_FAILED when the generated item selector matches nothing', async () => {
    const config = createConfig('.missing-comment');
    aiServiceMock.callAI.mockResolvedValueOnce({ config: {} }).mockResolvedValueOnce({ config });

    await expect(
      createConfigGenerator().generateIntelligentConfig(
        window.location.hostname,
        { maxDepth: 8 },
        100,
        undefined,
        '#comments',
      ),
    ).rejects.toMatchObject({
      code: ErrorCode.DOM_ANALYSIS_FAILED,
    });
  });
});

describe('AIStrategy execution', () => {
  function createPageController(): PageController {
    return {
      scrollContainer: vi.fn().mockResolvedValue({ contentChanged: false }),
      scrollToBottom: vi.fn().mockResolvedValue(undefined),
    } as unknown as PageController;
  }

  it('extracts comments, applies the platform, and reports completion', async () => {
    const longContent = `${'complete text '.repeat(30)}TAIL_SENTINEL`;
    document.body.innerHTML = `
      <section id="comments">
        <article class="comment-item"><p class="content">${longContent}</p></article>
      </section>
    `;
    const comment = createComment('');
    const progress = vi.fn();
    vi.spyOn(AIConfigGenerator.prototype, 'detectCommentSection').mockResolvedValue('#comments');
    vi.spyOn(AIConfigGenerator.prototype, 'generateIntelligentConfig').mockResolvedValue(null);
    aiServiceMock.callAI.mockResolvedValue({ comments: [comment] });
    const strategy = new AIStrategy(createPageController());

    const result = await strategy.execute(1, 'test-platform', progress);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ platform: 'test-platform', content: comment.content });
    expect(result[0].id).not.toBe('');
    expect(progress).toHaveBeenLastCalledWith(
      EXTRACTION_PROGRESS.MAX,
      'validating results',
      'validating',
      1,
      1,
    );
    expect(aiServiceMock.callAI).toHaveBeenCalledTimes(1);
    expect(aiServiceMock.callAI.mock.calls[0][0].payload.chunks.join('')).toContain(longContent);
  });

  it('fails when AI cannot locate a comment section', async () => {
    vi.spyOn(AIConfigGenerator.prototype, 'detectCommentSection').mockResolvedValue(null);
    const strategy = new AIStrategy(createPageController());

    await expect(strategy.execute(1, 'test-platform')).rejects.toMatchObject({
      code: ErrorCode.DOM_ANALYSIS_FAILED,
    });
    expect(aiServiceMock.callAI).not.toHaveBeenCalled();
  });

  it('disconnects the content AI service during cleanup', () => {
    const strategy = new AIStrategy(createPageController());

    strategy.cleanup();

    expect(aiServiceMock.disconnect).toHaveBeenCalledOnce();
  });

  it('generates, normalizes, and saves a manual crawling config', async () => {
    vi.useFakeTimers();
    const config = createConfig();
    const progress = vi.fn();
    const pageController = createPageController();
    vi.spyOn(AIConfigGenerator.prototype, 'generateIntelligentConfig').mockResolvedValue(config);
    sendMessageMock
      .mockResolvedValueOnce({ settings: { aiTimeout: 12_000 } })
      .mockResolvedValueOnce({ success: true });
    const strategy = new AIStrategy(pageController);

    const resultPromise = strategy.generateConfig(progress);
    await vi.advanceTimersByTimeAsync(TIMING.SCROLL_DELAY_MS);

    await expect(resultPromise).resolves.toBe(true);
    expect(pageController.scrollToBottom).toHaveBeenCalledOnce();
    expect(sendMessageMock).toHaveBeenLastCalledWith({
      type: MESSAGES.SAVE_CRAWLING_CONFIG,
      payload: {
        config: expect.objectContaining({
          domain: window.location.hostname,
          id: expect.stringMatching(new RegExp(`^${window.location.hostname}_\\d+$`)),
        }),
      },
    });
    expect(progress).toHaveBeenLastCalledWith(100, 'Configuration Generation Complete!');
  });

  it('returns false when manual config generation produces no config', async () => {
    vi.useFakeTimers();
    vi.spyOn(AIConfigGenerator.prototype, 'generateIntelligentConfig').mockResolvedValue(null);
    const strategy = new AIStrategy(createPageController());

    const resultPromise = strategy.generateConfig();
    await vi.advanceTimersByTimeAsync(TIMING.SCROLL_DELAY_MS);

    await expect(resultPromise).resolves.toBe(false);
    expect(sendMessageMock).toHaveBeenCalledTimes(1);
  });

  it('does not report rule generation complete when persistence rejects the rule', async () => {
    vi.useFakeTimers();
    const progress = vi.fn();
    vi.spyOn(AIConfigGenerator.prototype, 'generateIntelligentConfig').mockResolvedValue(
      createConfig(),
    );
    sendMessageMock.mockResolvedValueOnce({ settings: {} }).mockResolvedValueOnce({
      error: {
        code: ErrorCode.STORAGE_WRITE_ERROR,
        message: 'Rejected crawling rule',
        retryable: false,
      },
    });
    const strategy = new AIStrategy(createPageController());

    const rejected = expect(strategy.generateConfig(progress)).rejects.toMatchObject({
      code: ErrorCode.STORAGE_WRITE_ERROR,
      message: 'Rejected crawling rule',
    });
    await vi.advanceTimersByTimeAsync(TIMING.SCROLL_DELAY_MS);
    await rejected;
    expect(progress).not.toHaveBeenCalledWith(100, expect.any(String));
  });
});
