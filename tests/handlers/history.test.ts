import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleGetHistory,
  handleGetHistoryByUrl,
  handleDeleteHistory,
  handleClearAllHistory,
  handleExportData,
} from '../../src/background/handlers/history';
import { ExtensionError, ErrorCode } from '../../src/utils/errors';
import type { HistoryItem, Message } from '../../src/types';

describe('History Handlers', () => {
  const mockStorageManager = {
    getHistory: vi.fn(),
    getHistoryItem: vi.fn(),
    searchHistory: vi.fn(),
    deleteHistoryItem: vi.fn(),
    clearAllHistory: vi.fn(),
    getLatestHistoryIdByUrl: vi.fn(),
    exportSettings: vi.fn(),
  } as any;

  const context = {
    storageManager: mockStorageManager,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleGetHistory', () => {
    it('should return all history when no id or query provided', async () => {
      const mockHistory: HistoryItem[] = [
        {
          id: '1',
          url: 'https://example.com',
          title: 'Example',
          platform: 'youtube',
          extractedAt: Date.now(),
          commentsCount: 100,
          comments: [],
        },
      ];
      mockStorageManager.getHistory.mockResolvedValue(mockHistory);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: {},
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual({ history: mockHistory });
      expect(mockStorageManager.getHistory).toHaveBeenCalledOnce();
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
      mockStorageManager.getHistoryItem.mockResolvedValue(mockItem);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { id: '123' },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual({ item: mockItem });
      expect(mockStorageManager.getHistoryItem).toHaveBeenCalledWith('123');
    });

    it('should return null when history item not found', async () => {
      mockStorageManager.getHistoryItem.mockResolvedValue(null);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { id: 'non-existent' },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual({ item: null });
      expect(mockStorageManager.getHistoryItem).toHaveBeenCalledWith('non-existent');
    });

    it('should search history when query is provided', async () => {
      const mockItems: HistoryItem[] = [
        {
          id: '1',
          url: 'https://example.com',
          title: 'Search Result',
          platform: 'youtube',
          extractedAt: Date.now(),
          commentsCount: 50,
          comments: [],
        },
      ];
      mockStorageManager.searchHistory.mockResolvedValue(mockItems);

      const message: Extract<Message, { type: 'GET_HISTORY' }> = {
        type: 'GET_HISTORY',
        payload: { query: 'search term' },
      };

      const result = await handleGetHistory(message, context);

      expect(result).toEqual({ items: mockItems });
      expect(mockStorageManager.searchHistory).toHaveBeenCalledWith('search term');
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
      mockStorageManager.getLatestHistoryIdByUrl.mockResolvedValue('123');
      mockStorageManager.getHistoryItem.mockResolvedValue(mockItem);

      const message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }> = {
        type: 'GET_HISTORY_BY_URL',
        payload: { url: 'https://example.com/video' },
      };

      const result = await handleGetHistoryByUrl(message, context);

      expect(result).toEqual({ item: mockItem });
      expect(mockStorageManager.getLatestHistoryIdByUrl).toHaveBeenCalledWith(
        'https://example.com/video',
      );
      expect(mockStorageManager.getHistoryItem).toHaveBeenCalledWith('123');
    });

    it('should return null when no history found for URL', async () => {
      mockStorageManager.getLatestHistoryIdByUrl.mockResolvedValue(null);

      const message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }> = {
        type: 'GET_HISTORY_BY_URL',
        payload: { url: 'https://example.com/new' },
      };

      const result = await handleGetHistoryByUrl(message, context);

      expect(result).toEqual({ item: null });
      expect(mockStorageManager.getLatestHistoryIdByUrl).toHaveBeenCalledWith(
        'https://example.com/new',
      );
      expect(mockStorageManager.getHistoryItem).not.toHaveBeenCalled();
    });

    it('should throw error when URL is missing', async () => {
      const message: Extract<Message, { type: 'GET_HISTORY_BY_URL' }> = {
        type: 'GET_HISTORY_BY_URL',
        payload: { url: '' },
      };

      await expect(handleGetHistoryByUrl(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleGetHistoryByUrl(message, context)).rejects.toThrow('URL is required');
    });

    it('should return null when history item not found by id', async () => {
      mockStorageManager.getLatestHistoryIdByUrl.mockResolvedValue('123');
      mockStorageManager.getHistoryItem.mockResolvedValue(null);

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
      mockStorageManager.deleteHistoryItem.mockResolvedValue(undefined);

      const message: Extract<Message, { type: 'DELETE_HISTORY' }> = {
        type: 'DELETE_HISTORY',
        payload: { id: '123' },
      };

      const result = await handleDeleteHistory(message, context);

      expect(result).toEqual({ success: true });
      expect(mockStorageManager.deleteHistoryItem).toHaveBeenCalledWith('123');
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
  });

  describe('handleClearAllHistory', () => {
    it('should clear all history and return count', async () => {
      mockStorageManager.clearAllHistory.mockResolvedValue(5);

      const message: Extract<Message, { type: 'CLEAR_ALL_HISTORY' }> = {
        type: 'CLEAR_ALL_HISTORY',
        payload: {},
      };

      const result = await handleClearAllHistory(message, context);

      expect(result).toEqual({ success: true, count: 5 });
      expect(mockStorageManager.clearAllHistory).toHaveBeenCalledOnce();
    });

    it('should return zero count when no history to clear', async () => {
      mockStorageManager.clearAllHistory.mockResolvedValue(0);

      const message: Extract<Message, { type: 'CLEAR_ALL_HISTORY' }> = {
        type: 'CLEAR_ALL_HISTORY',
        payload: {},
      };

      const result = await handleClearAllHistory(message, context);

      expect(result).toEqual({ success: true, count: 0 });
    });
  });

  describe('handleExportData', () => {
    it('should export settings successfully', async () => {
      const mockData = { settings: { maxComments: 100 } };
      mockStorageManager.exportSettings.mockResolvedValue(mockData);

      const message: Extract<Message, { type: 'EXPORT_DATA' }> = {
        type: 'EXPORT_DATA',
        payload: { type: 'settings' },
      };

      const result = await handleExportData(message, context);

      expect(result).toEqual({ data: mockData });
      expect(mockStorageManager.exportSettings).toHaveBeenCalledOnce();
    });

    it('should throw error for invalid export type', async () => {
      const message: Extract<Message, { type: 'EXPORT_DATA' }> = {
        type: 'EXPORT_DATA',
        payload: { type: 'invalid' },
      };

      await expect(handleExportData(message, context)).rejects.toThrow(ExtensionError);
      await expect(handleExportData(message, context)).rejects.toThrow('Invalid export type');
    });

    it('should throw error when type is missing', async () => {
      const message: Extract<Message, { type: 'EXPORT_DATA' }> = {
        type: 'EXPORT_DATA',
        payload: {},
      };

      await expect(handleExportData(message, context)).rejects.toThrow('Invalid export type');
    });
  });
});
