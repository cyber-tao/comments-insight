import { describe, it, expect } from 'vitest';
import {
  buildAnalysisPrompt,
  validatePromptTemplate,
  getAvailablePlaceholders,
  DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
} from '../src/utils/prompts';

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
      const result = buildAnalysisPrompt(mockComments, DEFAULT_ANALYSIS_PROMPT_TEMPLATE, mockMetadata);
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
      expect(result).toContain('write the entire analysis in 中文');
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

