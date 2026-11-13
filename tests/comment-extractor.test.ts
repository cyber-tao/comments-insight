import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommentExtractor } from '../src/content/CommentExtractor';
import { MESSAGES } from '../src/config/constants';
import type { PageController } from '../src/content/PageController';
import type { CrawlingConfig } from '../src/types';
import { mockComment, mockComments } from './fixtures';

const {
  sendMessageMock,
  mockAIExecute,
  mockAICleanup,
  mockConfiguredExecute,
  mockConfiguredCleanup,
} = vi.hoisted(() => ({
  sendMessageMock: vi.fn(),
  mockAIExecute: vi.fn(),
  mockAICleanup: vi.fn(),
  mockConfiguredExecute: vi.fn(),
  mockConfiguredCleanup: vi.fn(),
}));

vi.mock('../src/utils/chrome-message', () => ({
  sendMessage: sendMessageMock,
}));

vi.mock('../src/utils/url', () => ({
  getCurrentHostname: vi.fn().mockReturnValue('youtube.com'),
}));

vi.mock('../src/utils/logger', () => ({
  Logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../src/content/strategies/AIStrategy', () => ({
  AIStrategy: class MockAIStrategy {
    execute = mockAIExecute;
    cleanup = mockAICleanup;
  },
}));

vi.mock('../src/content/strategies/ConfiguredStrategy', () => ({
  ConfiguredStrategy: class MockConfiguredStrategy {
    execute = mockConfiguredExecute;
    cleanup = mockConfiguredCleanup;
  },
}));

const mockPageController = {} as unknown as PageController;

describe('CommentExtractor', () => {
  let extractor: CommentExtractor;

  beforeEach(() => {
    vi.clearAllMocks();
    sendMessageMock.mockResolvedValue({ config: null });
    extractor = new CommentExtractor(mockPageController);
  });

  describe('extractWithAI', () => {
    it('should extract comments using AI strategy when no config matches', async () => {
      const comments = mockComments(5);
      mockAIExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(sendMessageMock).toHaveBeenCalledWith({
        type: MESSAGES.GET_CRAWLING_CONFIG,
        payload: { domain: 'youtube.com' },
      });
      expect(mockAIExecute).toHaveBeenCalled();
      expect(mockConfiguredExecute).not.toHaveBeenCalled();
      expect(result).toHaveLength(5);
    });

    it('should use ConfiguredStrategy when a domain crawling config exists and clamp progress', async () => {
      const config = { id: 'yt-1', domain: 'youtube.com' } as unknown as CrawlingConfig;
      sendMessageMock.mockResolvedValue({ config });
      mockConfiguredExecute.mockImplementation(
        async (
          _target: number,
          _platform: string,
          onProgress?: (
            progress: number,
            stage: string,
            message: string,
            current: number,
            total: number,
          ) => void,
        ) => {
          onProgress?.(60, 'extracting', 'extracting', 12, 14);
          return mockComments(3);
        },
      );
      const onProgress = vi.fn();

      const result = await extractor.extractWithAI(10, 'YouTube', onProgress);

      expect(mockConfiguredExecute).toHaveBeenCalled();
      expect(mockAIExecute).not.toHaveBeenCalled();
      expect(onProgress).toHaveBeenCalledWith(60, 'extracting', 'extracting', 10, 10);
      expect(mockConfiguredCleanup).toHaveBeenCalledOnce();
      expect(result).toHaveLength(3);
    });

    it('should call progress callback during extraction', async () => {
      const comments = mockComments(3);
      mockAIExecute.mockResolvedValue(comments);
      const onProgress = vi.fn();

      await extractor.extractWithAI(10, 'YouTube', onProgress);

      // Should call progress at validation (80%) and complete (100%)
      expect(onProgress).toHaveBeenCalledWith(80, 'validating');
      expect(onProgress).toHaveBeenCalledWith(100, 'complete');
    });

    it('should limit comments to maxComments', async () => {
      const comments = mockComments(20);
      mockAIExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(5, 'YouTube');

      expect(result).toHaveLength(5);
    });

    it('should cleanup strategy after extraction', async () => {
      const comments = mockComments(3);
      mockAIExecute.mockResolvedValue(comments);

      await extractor.extractWithAI(10, 'YouTube');

      expect(mockAICleanup).toHaveBeenCalled();
    });

    it('should cleanup strategy even if extraction fails', async () => {
      mockAIExecute.mockRejectedValue(new Error('Extraction failed'));

      await expect(extractor.extractWithAI(10, 'YouTube')).rejects.toThrow('Extraction failed');

      expect(mockAICleanup).toHaveBeenCalled();
    });

    it('should set platform on all comments', async () => {
      const comments = [
        mockComment({ platform: undefined }),
        mockComment({ platform: 'OtherPlatform' }),
      ];
      mockAIExecute.mockResolvedValue(comments);

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
      mockAIExecute.mockResolvedValue(comments);

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
      mockAIExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result).toHaveLength(1);
      expect(result[0].username).toBe('ValidUser');
    });

    it('should backfill missing timestamps with the unknown placeholder', async () => {
      const comments = [mockComment({ timestamp: '' }), mockComment({ timestamp: '2h ago' })];
      mockAIExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result).toHaveLength(2);
      expect(result[0].timestamp).toBe('N/A');
      expect(result[1].timestamp).toBe('2h ago');
    });

    it('should ensure likes are non-negative', async () => {
      const comments = [
        mockComment({ likes: 10 }),
        mockComment({ likes: -5 }),
        mockComment({ likes: 0 }),
      ];
      mockAIExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result.every((c) => c.likes >= 0)).toBe(true);
      expect(result[1].likes).toBe(0); // -5 should become 0
    });

    it('should ensure replies array exists', async () => {
      const comments = [
        mockComment({ replies: undefined as unknown as [] }),
        mockComment({ replies: [] }),
        mockComment({ replies: [mockComment()] }),
      ];
      mockAIExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result.every((c) => Array.isArray(c.replies))).toBe(true);
    });

    it('should handle null likes', async () => {
      const comments = [mockComment({ likes: null as unknown as number })];
      mockAIExecute.mockResolvedValue(comments);

      const result = await extractor.extractWithAI(10, 'YouTube');

      expect(result[0].likes).toBe(0);
    });
  });
});
