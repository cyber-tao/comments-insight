import { describe, it, expect } from 'vitest';
import {
  buildAnalysisPrompt,
  buildDynamicReportPrompt,
  validatePromptTemplate,
  getAvailablePlaceholders,
  getAnalysisPromptTemplate,
  getDynamicReportPromptTemplate,
  DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
  DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE,
} from '../src/utils/prompts';
import { PromptBuilder } from '../src/background/ai/PromptBuilder';
import { LANGUAGES } from '../src/config/constants/ui';

describe('Prompts Utils', () => {
  describe('buildAnalysisPrompt', () => {
    const mockComments = 'User1: Hello';
    const mockMetadata = {
      datetime: '2023-01-01T00:00:00Z',
      videoTime: '2022-12-31T23:59:59Z',
      platform: 'TestPlatform',
      url: 'http://example.com',
      title: 'Test Video',
      totalComments: 100,
      language: 'en',
    };

    it('should replace all placeholders with metadata', () => {
      const result = buildAnalysisPrompt(
        mockComments,
        DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
        mockMetadata,
      );
      expect(result).toContain(mockComments);
      expect(result).toContain(mockMetadata.datetime);
      expect(result).toContain(mockMetadata.videoTime);
      expect(result).toContain(mockMetadata.platform);
      expect(result).toContain(mockMetadata.url);
      expect(result).toContain(mockMetadata.title);
      expect(result).toContain(mockMetadata.totalComments.toString());
    });

    it('should handle missing metadata gracefully', () => {
      const result = buildAnalysisPrompt(mockComments);
      expect(result).toContain('Unknown Platform');
      expect(result).toContain('Untitled');
      // Check that language instruction defaults to English
      expect(result).toContain('write the entire analysis in English');
    });

    it('should add language instruction based on language name', () => {
      const result = buildAnalysisPrompt(mockComments, DEFAULT_ANALYSIS_PROMPT_TEMPLATE, {
        ...mockMetadata,
        language: 'zh-CN',
      });
      expect(result).toContain('请用简体中文撰写整份分析报告');
    });

    it('does not replace placeholders or interpret dollar sequences in source data', () => {
      const title = "Title $& $' $`";
      const comments = 'Literal {title} and {platform}';
      expect(buildAnalysisPrompt(comments, '{comments_data}\n{title}', { title })).toContain(
        `${comments}\n${title}`,
      );
    });
  });

  describe('buildDynamicReportPrompt', () => {
    const mockMarkdown = '# Sentiment Analysis\nPositive: 70%';
    const mockMetadata = {
      datetime: '2023-01-01T00:00:00Z',
      platform: 'YouTube',
      url: 'https://youtube.com/watch?v=123',
      title: 'Awesome Video',
      totalComments: 50,
      language: 'en-US',
    };

    it('should replace placeholders in dynamic report prompt', () => {
      const result = buildDynamicReportPrompt(
        mockMarkdown,
        DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE,
        mockMetadata,
      );
      expect(result).toContain(mockMarkdown);
      expect(result).toContain('YouTube');
      expect(result).toContain('Awesome Video');
      expect(result).toContain('50');
      expect(result).toContain('<!DOCTYPE html>');
      expect(result).toContain('Do NOT include <script>');
      expect(result).toContain('Do not create external links');
    });

    it('fills custom report fields while retaining raw Markdown, comments and post content', () => {
      const markdown = 'Markdown $& {title}';
      const topCommentsData = "Comment $' {post_content}";
      const postContent = 'Original $` {language_name}';
      const result = buildDynamicReportPrompt(
        markdown,
        '{analysis_markdown}\n{post_content}\n{comments_data}\n{language_name}',
        { language: 'pt-PT', topCommentsData, postContent },
      );
      expect(result).toBe(
        `${markdown}\n${postContent}\n${topCommentsData}\nportuguês europeu (Portugal)`,
      );
    });

    it('appends required source data when a custom template omits its placeholders', () => {
      const result = buildDynamicReportPrompt('Analysis', 'Custom introduction', {
        topCommentsData: 'Comment',
      });
      expect(result).toBe(
        'Custom introduction\n\n## Analysis Markdown:\nAnalysis\n\n## Top Comments Data:\nComment',
      );
    });

    it.each(LANGUAGES.SUPPORTED)(
      'includes top comments only once in the $code default',
      ({ code }) => {
        const topCommentsData = 'unique-comment-body';
        const prompt = buildDynamicReportPrompt('Analysis', undefined, {
          language: code,
          topCommentsData,
        });
        expect(prompt.split(topCommentsData)).toHaveLength(2);
      },
    );
  });

  describe('localized defaults', () => {
    it.each(LANGUAGES.SUPPORTED)(
      'keeps prompt tokens and static report constraints for $code',
      ({ code }) => {
        const tokens = (template: string) => template.match(/\{[a-z_]+\}/g)?.sort();
        const analysis = getAnalysisPromptTemplate(DEFAULT_ANALYSIS_PROMPT_TEMPLATE, code);
        const dynamic = getDynamicReportPromptTemplate(
          DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE,
          code,
        );
        expect(getAnalysisPromptTemplate(undefined, code)).toBe(analysis);
        expect(getDynamicReportPromptTemplate(undefined, code)).toBe(dynamic);
        expect(validatePromptTemplate(analysis)).toBe(true);
        expect(tokens(analysis)).toEqual(tokens(DEFAULT_ANALYSIS_PROMPT_TEMPLATE));
        expect(tokens(dynamic)).toEqual(tokens(DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE));
        expect(dynamic).toContain('<!DOCTYPE html>');
        expect(dynamic).toContain('<script>');
        expect(dynamic).toContain('chrome-extension://');
        for (const anchor of [
          '#overview',
          '#sentiment',
          '#comments',
          '#insights',
          '#recommendations',
        ]) {
          expect(dynamic).toContain(anchor);
        }
        if (code !== 'en-US') {
          expect(analysis).not.toBe(DEFAULT_ANALYSIS_PROMPT_TEMPLATE);
          expect(dynamic).not.toBe(DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE);
        }
      },
    );

    it('keeps edited templates as entered when the language changes', () => {
      const custom = '  Custom {comments_data}  ';
      expect(getAnalysisPromptTemplate(custom, 'pt-PT')).toBe(custom);
      expect(getDynamicReportPromptTemplate(custom, 'zh-TW')).toBe(custom);
    });

    it('recognizes the persisted legacy English dynamic default without changing edited templates', () => {
      const legacyDefault = DEFAULT_DYNAMIC_REPORT_PROMPT_TEMPLATE.replace(
        'each supplied top comment',
        'each top comment in {top_comments_data}',
      );
      expect(getDynamicReportPromptTemplate(legacyDefault, 'zh-CN')).toBe(
        getDynamicReportPromptTemplate(undefined, 'zh-CN'),
      );
      expect(getDynamicReportPromptTemplate(`${legacyDefault}\nCustom addition`, 'zh-CN')).toBe(
        `${legacyDefault}\nCustom addition`,
      );
    });
  });

  describe('PromptBuilder.extractCleanHtml', () => {
    it('should extract raw HTML without injecting scripts', () => {
      const html =
        '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Hello</h1></body></html>';
      const extracted = PromptBuilder.extractCleanHtml(html);
      expect(extracted).toContain('<!DOCTYPE html>');
      expect(extracted).toContain('<h1>Hello</h1>');
      // Anchor navigation is handled by the sandbox page itself; the report
      // must not carry an injected <script> for it.
      expect(extracted).not.toContain('<script>');
    });

    it('should extract HTML wrapped in ```html code fences and sanitize chrome-extension links', () => {
      const raw =
        'Here is your report:\n```html\n<!DOCTYPE html><html><body><a href="chrome-extension://xyz/src/history/index.html?id=123#comments">Comments</a><h1>Hello</h1><a href="https://example.com">Source</a></body></html>\n```\nEnjoy!';
      const extracted = PromptBuilder.extractCleanHtml(raw);
      expect(extracted).toContain('<!DOCTYPE html>');
      expect(extracted).toContain('href="#comments"');
      expect(extracted).toContain('target="_blank"');
      expect(extracted).toContain('rel="noopener noreferrer"');
    });

    it('should strip thinking tags', () => {
      const raw =
        '<think>I need to generate a dashboard</think>\n```html\n<!DOCTYPE html><html><body>Dashboard</body></html>\n```';
      const extracted = PromptBuilder.extractCleanHtml(raw);
      expect(extracted).toContain('<!DOCTYPE html>');
      expect(extracted).toContain('Dashboard');
      expect(extracted).not.toContain('<think>');
    });
  });

  describe('validatePromptTemplate', () => {
    it('should return true for valid template', () => {
      const validTemplate = 'Analyze this: {comments_data} with valid length... ' + 'a'.repeat(50);
      expect(validatePromptTemplate(validTemplate)).toBe(true);
    });

    it('should return false if {comments_data} is missing', () => {
      const invalidTemplate = 'No data placeholder here... ' + 'a'.repeat(50);
      expect(validatePromptTemplate(invalidTemplate)).toBe(false);
    });

    it('should return false if template is too short', () => {
      const shortTemplate = 'Too short {comments_data}';
      expect(validatePromptTemplate(shortTemplate)).toBe(false);
    });

    it('should return false if template is too long', () => {
      const longTemplate = '{comments_data}' + 'a'.repeat(10001);
      expect(validatePromptTemplate(longTemplate)).toBe(false);
    });
  });

  describe('getAvailablePlaceholders', () => {
    it('should return list of placeholders', () => {
      const placeholders = getAvailablePlaceholders();
      expect(placeholders.length).toBeGreaterThan(0);
      expect(placeholders.some((p) => p.key === '{comments_data}')).toBe(true);
      expect(placeholders.some((p) => p.key === '{platform}')).toBe(true);
    });
  });
});
