import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleGetHistory,
  handleGetHistoryByUrl,
  handleDeleteHistory,
  handleClearAllHistory,
  handleExportData,
} from '../../src/background/handlers/history';
import { ExtensionError } from '../../src/utils/errors';
import type { HistoryItem, Message } from '../../src/types';
import type { HandlerContext } from '../../src/background/handlers/types';

describe('History Handlers', () => {
  const mockHistoryStore = {
    getHistoryMetadataPage: vi.fn(),
    getHistoryItem: vi.fn(),
    searchHistoryMetadataPage: vi.fn(),
    deleteHistoryItem: vi.fn(),
    clearAllHistory: vi.fn(),
    getLatestHistoryIdByUrl: vi.fn(),
    exportSettings: vi.fn(),
  };

  const mockSettingsStore = {
    exportSettings: vi.fn(),
  } as unknown as Record<string, ReturnType<typeof vi.fn>>;

  const context = {
    historyStore: mockHistoryStore,
    settingsStore: mockSettingsStore,
  } as unknown as HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleGetHistory', () => {
    it('should return metadata first page when no id or query provided', async () => {
      const mockResult = {
        entries: [
          {
            id: '1',
            url: 'https://example.com',
            title: 'Example',
            platform: 'youtube',
            extractedAt: Date.now(),
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
        totalPages: 1,
      };
      mockHistoryStore.getHistoryMetadataPage.mockResolvedValue(mockResult);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: {},
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual(mockResult);
      expect(mockHistoryStore.getHistoryMetadataPage).toHaveBeenCalledWith(0, 20);
    });

    it('should return single history item when id is provided', async () => {
      const mockItem: HistoryItem = {
        id: '123',
        url: 'https://example.com',
        title: 'Example',
        platform: 'youtube',
        extractedAt: Date.now(),
        commentsCount: 100,
        comments: [],
      };
      mockHistoryStore.getHistoryItem.mockResolvedValue(mockItem);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { id: '123' },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual({ item: mockItem });
      expect(mockHistoryStore.getHistoryItem).toHaveBeenCalledWith('123');
    });

    it('should return null when history item not found', async () => {
      mockHistoryStore.getHistoryItem.mockResolvedValue(null);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { id: 'non-existent' },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual({ item: null });
      expect(mockHistoryStore.getHistoryItem).toHaveBeenCalledWith('non-existent');
    });

    it('should search metadata page when query is provided', async () => {
      const mockResult = {
        entries: [
          {
            id: '1',
            url: 'https://example.com',
            title: 'Search Result',
            platform: 'youtube',
            extractedAt: Date.now(),
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
        totalPages: 1,
      };
      mockHistoryStore.searchHistoryMetadataPage.mockResolvedValue(mockResult);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { query: 'search term' },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual(mockResult);
      expect(mockHistoryStore.searchHistoryMetadataPage).toHaveBeenCalledWith('search term', 0, 20);
    });

    it('should return metadata page when metadataOnly is true', async () => {
      const mockResult = {
        entries: [
          {
            id: '1',
            url: 'https://example.com',
            title: 'Metadata Item',
            platform: 'youtube',
            extractedAt: Date.now(),
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
        totalPages: 1,
      };
      mockHistoryStore.getHistoryMetadataPage.mockResolvedValue(mockResult);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { metadataOnly: true },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual(mockResult);
      expect(mockHistoryStore.getHistoryMetadataPage).toHaveBeenCalledWith(0, 20);
    });

    it('should search metadata page when metadataOnly and query are provided', async () => {
      const mockResult = {
        entries: [
          {
            id: '1',
            url: 'https://example.com/search',
            title: 'Metadata Search Result',
            platform: 'youtube',
            extractedAt: Date.now(),
          },
        ],
        total: 1,
        page: 0,
        pageSize: 20,
        totalPages: 1,
      };
      mockHistoryStore.searchHistoryMetadataPage.mockResolvedValue(mockResult);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { query: 'search term', metadataOnly: true },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual(mockResult);
      expect(mockHistoryStore.searchHistoryMetadataPage).toHaveBeenCalledWith('search term', 0, 20);
    });

    it('should return paged metadata when page parameters are provided', async () => {
      const mockResult = {
        entries: [
          {
            id: '1',
            url: 'https://example.com',
            title: 'Paged Item',
            platform: 'youtube',
            extractedAt: Date.now(),
          },
        ],
        total: 25,
        page: 1,
        pageSize: 10,
        totalPages: 3,
      };
      mockHistoryStore.getHistoryMetadataPage.mockResolvedValue(mockResult);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { page: 1, pageSize: 10 },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual(mockResult);
      expect(mockHistoryStore.getHistoryMetadataPage).toHaveBeenCalledWith(1, 10);
    });

    it('should fallback to default paging values for invalid page params', async () => {
      const mockResult = {
        entries: [],
        total: 0,
        page: 0,
        pageSize: 20,
        totalPages: 0,
      };
      mockHistoryStore.getHistoryMetadataPage.mockResolvedValue(mockResult);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { page: -1, pageSize: 0 },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual(mockResult);
      expect(mockHistoryStore.getHistoryMetadataPage).toHaveBeenCalledWith(0, 20);
    });
  });

  describe('handleGetHistoryByUrl', () => {
    it('should return history item by URL', async () => {
      const mockItem: HistoryItem = {
        id: '123',
        url: 'https://example.com/video',
        title: 'Video',
        platform: 'youtube',
        extractedAt: Date.now(),
        commentsCount: 100,
        comments: [],
      };
      mockHistoryStore.getLatestHistoryIdByUrl.mockResolvedValue('123');
      mockHistoryStore.getHistoryItem.mockResolvedValue(mockItem);

      const message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }> = {
        type: 'GET_HISTORY_BY_URL',
        payload: { url: 'https://example.com/video' },
      };

      const result = await handleGetHistoryByUrl(message, context);

      expect(result).toEqual({ item: mockItem });
      expect(mockHistoryStore.getLatestHistoryIdByUrl).toHaveBeenCalledWith(
        'https://example.com/video',
      );
      expect(mockHistoryStore.getHistoryItem).toHaveBeenCalledWith('123');
    });

    it('should return null when no history found for URL', async () => {
      mockHistoryStore.getLatestHistoryIdByUrl.mockResolvedValue(null);

      const message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }> = {
        type: 'GET_HISTORY_BY_URL',
        payload: { url: 'https://example.com/new' },
      };

      const result = await handleGetHistoryByUrl(message, context);

      expect(result).toEqual({ item: null });
      expect(mockHistoryStore.getLatestHistoryIdByUrl).toHaveBeenCalledWith(
        'https://example.com/new',
      );
      expect(mockHistoryStore.getHistoryItem).not.toHaveBeenCalled();
    });

    it('should throw error when URL is missing', async () => {
      const message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }> = {
        type: 'GET_HISTORY_BY_URL',
        payload: { url: '' },
      };

      await expect(handleGetHistoryByUrl(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleGetHistoryByUrl(message, context)).rejects.toThrow('URL is required');
    });

    it('should throw error when payload is missing', async () => {
      const message = {
        type: 'GET_HISTORY_BY_URL' as const,
        payload: undefined,
      } as unknown as Extract<Message, { type: 'GET_HISTORY_BY_URL' }>;

      await expect(handleGetHistoryByUrl(message, context)).rejects.toThrow('URL is required');
    });

    it('should return null when history item not found by id', async () => {
      mockHistoryStore.getLatestHistoryIdByUrl.mockResolvedValue('123');
      mockHistoryStore.getHistoryItem.mockResolvedValue(null);

      const message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }> = {
        type: 'GET_HISTORY_BY_URL',
        payload: { url: 'https://example.com/video' },
      };

      const result = await handleGetHistoryByUrl(message, context);

      expect(result).toEqual({ item: null });
    });
  });

  describe('handleDeleteHistory', () => {
    it('should delete history item successfully', async () => {
      mockHistoryStore.deleteHistoryItem.mockResolvedValue(undefined);

      const message: Extract<Message, { type: 'DELETE_HISTORY' }> = {
        type: 'DELETE_HISTORY',
        payload: { id: '123' },
      };

      const result = await handleDeleteHistory(message, context);

      expect(result).toEqual({ success: true });
      expect(mockHistoryStore.deleteHistoryItem).toHaveBeenCalledWith('123');
    });

    it('should throw error when id is missing', async () => {
      const message: Extract<Message, { type: 'DELETE_HISTORY' }> = {
        type: 'DELETE_HISTORY',
        payload: { id: '' },
      };

      await expect(handleDeleteHistory(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleDeleteHistory(message, context)).rejects.toThrow(
        'History item ID is required',
      );
    });

    it('should throw error when payload is missing', async () => {
      const message = {
        type: 'DELETE_HISTORY' as const,
        payload: undefined,
      } as unknown as Extract<Message, { type: 'DELETE_HISTORY' }>;

      await expect(handleDeleteHistory(message, context)).rejects.toThrow(
        'History item ID is required',
      );
    });
  });

  describe('handleClearAllHistory', () => {
    it('should clear all history and return count', async () => {
      mockHistoryStore.clearAllHistory.mockResolvedValue(5);

      const message: Extract<Message, { type: 'CLEAR_ALL_HISTORY' }> = {
        type: 'CLEAR_ALL_HISTORY',
      };

      const result = await handleClearAllHistory(message, context);

      expect(result).toEqual({ success: true, count: 5 });
      expect(mockHistoryStore.clearAllHistory).toHaveBeenCalledOnce();
    });

    it('should return zero count when no history to clear', async () => {
      mockHistoryStore.clearAllHistory.mockResolvedValue(0);

      const message: Extract<Message, { type: 'CLEAR_ALL_HISTORY' }> = {
        type: 'CLEAR_ALL_HISTORY',
      };

      const result = await handleClearAllHistory(message, context);

      expect(result).toEqual({ success: true, count: 0 });
    });

    it('should propagate storage failures', async () => {
      mockHistoryStore.clearAllHistory.mockRejectedValue(new Error('clear failed'));

      const message: Extract<Message, { type: 'CLEAR_ALL_HISTORY' }> = {
        type: 'CLEAR_ALL_HISTORY',
      };

      await expect(handleClearAllHistory(message, context)).rejects.toThrow('clear failed');
    });
  });

  describe('handleExportData', () => {
    it('should export settings successfully', async () => {
      const mockData = { settings: { maxComments: 100 } };
      mockSettingsStore.exportSettings.mockResolvedValue(mockData);

      const message: Extract<Message, { type: 'EXPORT_DATA' }> = {
        type: 'EXPORT_DATA',
        payload: { type: 'settings' },
      };

      const result = await handleExportData(message, context);

      expect(result).toEqual({ data: mockData });
      expect(mockSettingsStore.exportSettings).toHaveBeenCalledOnce();
    });

    it('should throw error for invalid export type', async () => {
      const message = {
        type: 'EXPORT_DATA',
        payload: { type: 'invalid' },
      } as unknown as Extract<Message, { type: 'EXPORT_DATA' }>;

      await expect(handleExportData(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleExportData(message, context)).rejects.toThrow('Invalid export type');
    });

    it('should throw error when type is missing', async () => {
      const message = {
        type: 'EXPORT_DATA',
        payload: {},
      } as unknown as Extract<Message, { type: 'EXPORT_DATA' }>;

      await expect(handleExportData(message, context)).rejects.toThrow('Invalid export type');
    });
  });
});
