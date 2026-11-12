import { describe, expect, it, vi } from 'vitest';
import { CommentAnalyzer } from '../src/background/ai/CommentAnalyzer';
import type { AIService } from '../src/background/AIService';
import type { AIRequest, Comment } from '../src/types';
import { AI } from '../src/config/constants';
import { ErrorCode } from '../src/utils/errors';
import { Tokenizer } from '../src/utils/tokenizer';
import { mockAIConfig, mockComment } from './fixtures';

function setup() {
  const callAI = vi
    .fn<
      (request: AIRequest) => Promise<{
        content: string;
        tokensUsed: number;
        finishReason: string;
      }>
    >()
    .mockResolvedValue({
      content: '<!DOCTYPE html><html><body>Report</body></html>',
      tokensUsed: 10,
      finishReason: 'stop',
    });
  return {
    callAI,
    analyzer: new CommentAnalyzer({ callAI } as unknown as AIService),
  };
}

const compactConfig = () => mockAIConfig({ contextWindowSize: 8192, maxOutputTokens: 1024 });
const requestTokens = (request: AIRequest) =>
  Tokenizer.estimateTokens(request.prompt) + Tokenizer.estimateTokens(request.systemPrompt || '');

describe('Dynamic report context budget', () => {
  it('keeps a multi-batch analysis intact while fitting representative comments into one request', async () => {
    const { analyzer, callAI } = setup();
    const comments = Array.from({ length: 10 }, (_, index) =>
      mockComment({
        id: `root-${index}`,
        content: `root-${index}: ${'评'.repeat(1600)}`,
        likes: 10 - index,
      }),
    );
    const config = compactConfig();
    callAI.mockResolvedValue({
      content: '# Summary\nComplete findings.',
      tokensUsed: 10,
      finishReason: 'stop',
    });
    const analysis = await analyzer.analyzeComments(comments, config, '{comments_data}', 'en-US');
    expect(callAI.mock.calls.length).toBeGreaterThan(1);
    callAI.mockClear();

    await analyzer.generateDynamicHtml(
      analysis.markdown,
      config,
      undefined,
      'en-US',
      { title: 'Original title', postContent: 'Original post' },
      comments.length,
      undefined,
      undefined,
      undefined,
      comments,
    );

    expect(callAI).toHaveBeenCalledOnce();
    const request = callAI.mock.calls[0][0];
    expect(requestTokens(request)).toBeLessThanOrEqual(
      config.contextWindowSize - config.maxOutputTokens! - AI.INPUT_TOKEN_BUFFER,
    );
    expect(request.prompt).toContain(analysis.markdown);
    expect(request.prompt).toContain('Original title');
    expect(request.prompt).toContain(comments[0].content);
    expect(request.prompt).not.toContain(comments[9].content);
  });

  it('omits an oversized leading thread without splitting replies or skipping to lower-ranked comments', async () => {
    const { analyzer, callAI } = setup();
    const comments = [
      mockComment({ content: 'lower-ranked', likes: 1 }),
      mockComment({
        content: 'leading-parent',
        likes: 10,
        replies: [mockComment({ content: `large-reply: ${'评'.repeat(10000)}` })],
      }),
    ];
    const original = structuredClone(comments);

    await analyzer.generateDynamicHtml(
      'Unchanged analysis',
      compactConfig(),
      undefined,
      'en-US',
      undefined,
      comments.length,
      undefined,
      undefined,
      undefined,
      comments,
    );

    const request = callAI.mock.calls[0][0];
    expect(request.prompt).toContain('Unchanged analysis');
    expect(request.prompt).not.toContain('leading-parent');
    expect(request.prompt).not.toContain('large-reply');
    expect(request.prompt).not.toContain('lower-ranked');
    expect(comments).toEqual(original);
  });

  it('accounts for repeated source placeholders in custom templates', async () => {
    const { analyzer, callAI } = setup();
    const config = compactConfig();
    const template =
      'Custom instructions\n{title}\n{post_content}\n{analysis_markdown}\n' +
      '{top_comments_data}\n{comments_data}\n{top_comments_data}';
    const comments = [mockComment({ content: `oversized-example: ${'评'.repeat(1600)}` })];

    await analyzer.generateDynamicHtml(
      '# Complete analysis',
      config,
      template,
      'en-US',
      { title: 'Title', postContent: 'Post' },
      1,
      undefined,
      undefined,
      undefined,
      comments,
    );

    const request = callAI.mock.calls[0][0];
    expect(request.prompt).toBe(
      'Custom instructions\nTitle\nPost\n# Complete analysis\nN/A\nN/A\nN/A',
    );
    expect(requestTokens(request)).toBeLessThanOrEqual(
      config.contextWindowSize - config.maxOutputTokens! - AI.INPUT_TOKEN_BUFFER,
    );
  });

  it('keeps at most ten complete threads in descending like order when they all fit', async () => {
    const { analyzer, callAI } = setup();
    const comments: Comment[] = Array.from({ length: 12 }, (_, index) =>
      mockComment({ content: `body-${index.toString().padStart(2, '0')}`, likes: index }),
    );
    comments[11].replies = [mockComment({ content: 'included-reply' })];

    await analyzer.generateDynamicHtml(
      'Analysis',
      mockAIConfig(),
      undefined,
      'en-US',
      undefined,
      comments.length,
      undefined,
      undefined,
      undefined,
      comments,
    );

    const prompt = callAI.mock.calls[0][0].prompt;
    expect(prompt).toContain('included-reply');
    expect(prompt).not.toContain('body-00');
    expect(prompt).not.toContain('body-01');
    expect(prompt.indexOf('body-11')).toBeLessThan(prompt.indexOf('body-10'));
    expect(prompt).toContain('body-02');
  });

  it.each(['analysis', 'template'])(
    'rejects oversized %s before calling the model',
    async (source) => {
      const { analyzer, callAI } = setup();
      const oversized = '报告'.repeat(4000);

      await expect(
        analyzer.generateDynamicHtml(
          source === 'analysis' ? oversized : 'Original analysis',
          compactConfig(),
          source === 'template' ? `${oversized}\n{analysis_markdown}` : undefined,
          source === 'template' ? 'zh-CN' : 'en-US',
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_CONFIG,
        retryable: false,
        message: expect.stringContaining(
          source === 'template' ? 'Markdown 报告已保留' : 'Markdown report remains saved',
        ),
        details: { messageKey: 'errors.dynamicReportContextExceeded' },
      });
      expect(callAI).not.toHaveBeenCalled();
    },
  );

  it('reserves space for the system prompt as well as the rendered report', async () => {
    const { analyzer, callAI } = setup();
    const markdown = '评'.repeat(2000);
    await analyzer.generateDynamicHtml(markdown, mockAIConfig(), '{analysis_markdown}', 'en-US');
    const promptOnlyTokens = Tokenizer.estimateTokens(callAI.mock.calls[0][0].prompt);
    callAI.mockClear();
    const config = mockAIConfig({
      contextWindowSize: promptOnlyTokens + 1024 + AI.INPUT_TOKEN_BUFFER,
      maxOutputTokens: 1024,
    });

    await expect(
      analyzer.generateDynamicHtml(markdown, config, '{analysis_markdown}', 'en-US'),
    ).rejects.toMatchObject({ code: ErrorCode.INVALID_CONFIG, retryable: false });
    expect(callAI).not.toHaveBeenCalled();
  });
});
