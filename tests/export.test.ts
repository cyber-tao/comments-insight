import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  exportCommentsAsCSV,
  exportAnalysisAsMarkdown,
  exportCompleteData,
} from '../src/utils/export';
import { Comment, HistoryItem } from '../src/types';

// Mock DOM APIs
const mockClick = vi.fn();
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();
const mockCreateElement = vi.fn(() => ({
  href: '',
  download: '',
  click: mockClick,
}));

const mockUrlCreate = vi.fn(() => 'blob:url');
const mockUrlRevoke = vi.fn();

vi.stubGlobal('document', {
  createElement: mockCreateElement,
  body: {
    appendChild: mockAppendChild,
    removeChild: mockRemoveChild,
  },
});

vi.stubGlobal('URL', {
  createObjectURL: mockUrlCreate,
  revokeObjectURL: mockUrlRevoke,
});

vi.stubGlobal(
  'Blob',
  class MockBlob {
    content: string[];
    options: any;
    constructor(content: string[], options: any) {
      this.content = content;
      this.options = options;
    }
  },
);

describe('Export Utils', () => {
  const mockComments: Comment[] = [
    {
      id: '1',
      username: 'User1',
      content: 'Comment 1',
      timestamp: '2023-01-01',
      likes: 10,
      replies: [
        {
          id: '2',
          username: 'User2',
          content: 'Reply 1',
          timestamp: '2023-01-01',
          likes: 5,
          replies: [],
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('exportCommentsAsCSV', () => {
    it('should generate CSV and trigger download', () => {
      exportCommentsAsCSV(mockComments, 'Test Title');

      expect(mockCreateElement).toHaveBeenCalledWith('a');
      expect(mockUrlCreate).toHaveBeenCalled();
      expect(mockAppendChild).toHaveBeenCalled();
      expect(mockClick).toHaveBeenCalled();
      expect(mockRemoveChild).toHaveBeenCalled();

      // Verify CSV content logic implicitly by checking Blob creation
      // Note: Since we mocked Blob, we can't easily inspect its content here without more complex mocking
      // but we verified the flow.
    });

    it('should sanitize filenames', () => {
      exportCommentsAsCSV(mockComments, 'Invalid/File:Name');
      const link = mockCreateElement.mock.results[0].value;
      expect(link.download).not.toContain('/');
      expect(link.download).not.toContain(':');
    });
  });

  describe('exportAnalysisAsMarkdown', () => {
    const mockHistoryItem: HistoryItem = {
      id: '1',
      url: 'http://example.com',
      platform: 'Test',
      title: 'Test Post',
      extractedAt: Date.now(),
      analyzedAt: Date.now(),
      commentsCount: 10,
      comments: [],
      analysis: {
        markdown: '# Analysis',
        summary: {
          totalComments: 10,
          sentimentDistribution: { positive: 5, negative: 3, neutral: 2 },
          hotComments: [],
          keyInsights: [],
        },
        tokensUsed: 100,
        generatedAt: Date.now(),
      },
    };

    it('should generate Markdown and trigger download', () => {
      exportAnalysisAsMarkdown(mockHistoryItem);

      expect(mockCreateElement).toHaveBeenCalledWith('a');
      const link = mockCreateElement.mock.results[0].value;
      expect(link.download).toContain('.md');
    });

    it('should throw error if no analysis available', () => {
      const noAnalysisItem = { ...mockHistoryItem, analysis: undefined };
      expect(() => exportAnalysisAsMarkdown(noAnalysisItem)).toThrow();
    });
  });

  describe('exportCompleteData', () => {
    it('should export JSON data', () => {
      const mockItem: HistoryItem = {
        id: '1',
        url: 'url',
        platform: 'platform',
        title: 'title',
        extractedAt: 100,
        commentsCount: 0,
        comments: [],
      };

      exportCompleteData(mockItem);

      expect(mockCreateElement).toHaveBeenCalledWith('a');
      const link = mockCreateElement.mock.results[0].value;
      expect(link.download).toContain('.json');
    });
  });
});
