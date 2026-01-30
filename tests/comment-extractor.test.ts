import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentExtractor } from '../src/content/CommentExtractor';
import { mockComment, mockComments } from './fixtures';

// Mock Logger
vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock AIStrategy
const mockExecute = vi.fn();
const mockCleanup = vi.fn();

vi.mock('../src/content/strategies/AIStrategy', () => ({
  AIStrategy: class MockAIStrategy {
    execute = mockExecute;
    cleanup = mockCleanup;
  },
}));

// Mock PageController
const mockPageController = {
  getPageInfo: vi.fn(),
  scrollToLoadMore: vi.fn(),
  expandReplies: vi.fn(),
};

describe('CommentExtractor', () => {
  let extractor: CommentExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    extractor = new CommentExtractor(mockPageController as any);
  });

  describe('extractWithAI', () => {
    it('should extract comments using AI strategy', async () => {
      const comments = mockComments(5);
      mockExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(mockExecute).toHaveBeenCalled();
      expect(result).toHaveLength(5);
    });

    it('should call progress callback during extraction', async () => {
      const comments = mockComments(3);
      mockExecute.mockResolvedValue(comments);
      const onProgress = vi.fn();

      await extractor.extractWithAI(10, 'YouTube', onProgress);

      // Should call progress at validation (80%) and complete (100%)
      expect(onProgress).toHaveBeenCalledWith(80, 'validating');
      expect(onProgress).toHaveBeenCalledWith(100, 'complete');
    });

    it('should limit comments to maxComments', async () => {
      const comments = mockComments(20);
      mockExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(5, 'YouTube');

      expect(result).toHaveLength(5);
    });

    it('should cleanup strategy after extraction', async () => {
      const comments = mockComments(3);
      mockExecute.mockResolvedValue(comments);

      await extractor.extractWithAI(10, 'YouTube');

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should cleanup strategy even if extraction fails', async () => {
      mockExecute.mockRejectedValue(new Error('Extraction failed'));

      await expect(extractor.extractWithAI(10, 'YouTube')).rejects.toThrow('Extraction failed');

      expect(mockCleanup).toHaveBeenCalled();
    });

    it('should set platform on all comments', async () => {
      const comments = [
        mockComment({ platform: undefined }),
        mockComment({ platform: 'OtherPlatform' }),
      ];
      mockExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result.every((c) => c.platform === 'YouTube')).toBe(true);
    });
  });

  describe('validateComments', () => {
    it('should filter out comments without content', async () => {
      const comments = [
        mockComment({ content: 'Valid content' }),
        mockComment({ content: '' }),
        mockComment({ content: '   ' }),
      ];
      mockExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Valid content');
    });

    it('should filter out comments without username', async () => {
      const comments = [
        mockComment({ username: 'ValidUser' }),
        mockComment({ username: '' }),
        mockComment({ username: '   ' }),
      ];
      mockExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('ValidUser');
    });

    it('should ensure likes are non-negative', async () => {
      const comments = [
        mockComment({ likes: 10 }),
        mockComment({ likes: -5 }),
        mockComment({ likes: 0 }),
      ];
      mockExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result.every((c) => c.likes >= 0)).toBe(true);
      expect(result[1].likes).toBe(0); // -5 should become 0
    });

    it('should ensure replies array exists', async () => {
      const comments = [
        mockComment({ replies: undefined as any }),
        mockComment({ replies: [] }),
        mockComment({ replies: [mockComment()] }),
      ];
      mockExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result.every((c) => Array.isArray(c.replies))).toBe(true);
    });

    it('should handle null likes', async () => {
      const comments = [mockComment({ likes: null as any })];
      mockExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result[0].likes).toBe(0);
    });
  });
});
