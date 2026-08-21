import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportCommentsAsCSV, exportAnalysisAsMarkdown } from '../src/utils/export';
import { Comment, HistoryItem } from '../src/types';

const mockClick = vi.fn();
const mockAppendChild = vi.fn();
const mockRemoveChild = vi.fn();
const mockCreateElement = vi.fn(() => ({
  href: '',
  download: '',
  click: mockClick,
}));

const mockUrlCreate = vi.fn((_blob: Blob) => 'blob:url');
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
    options: Record<string, unknown>;
    constructor(content: string[], options: Record<string, unknown>) {
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
    });

    it('should sanitize filenames', () => {
      exportCommentsAsCSV(mockComments, 'Invalid/File:Name');
      const link = mockCreateElement.mock.results[0].value;
      expect(link.download).not.toContain('/');
      expect(link.download).not.toContain(':');
    });

    it('should neutralize spreadsheet formulas in untrusted text cells', () => {
      exportCommentsAsCSV([
        {
          ...mockComments[0],
          username: '=HYPERLINK("https://example.com")',
          content: '  +SUM(1,1)',
          replies: [],
        },
      ]);

      const blob = mockUrlCreate.mock.calls[0][0] as unknown as { content: string[] };
      const csv = blob.content[0];
      expect(csv).toContain("'=HYPERLINK");
      expect(csv).toContain("'  +SUM");
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

  describe('exportAnalysisAsHTML', () => {
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
        dynamicHtml: '<!DOCTYPE html><html><body><h1>Dashboard</h1></body></html>',
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

    it('should generate HTML file and trigger download', async () => {
      const { exportAnalysisAsHTML } = await import('../src/utils/export');
      exportAnalysisAsHTML(mockHistoryItem);

      expect(mockCreateElement).toHaveBeenCalledWith('a');
      const link = mockCreateElement.mock.results[0].value;
      expect(link.download).toContain('.html');
    });

    it('should throw error if no dynamicHtml available', async () => {
      const { exportAnalysisAsHTML } = await import('../src/utils/export');
      const noHtmlItem = {
        ...mockHistoryItem,
        analysis: { ...mockHistoryItem.analysis!, dynamicHtml: undefined },
      };
      expect(() => exportAnalysisAsHTML(noHtmlItem)).toThrow();
    });
  });
});
