import { useState, useCallback } from 'react';
import { HistoryItem } from '@/types';
import { Logger } from '@/utils/logger';
import { getDomain } from '@/utils/url';
import { ExtensionAPI } from '@/utils/extension-api';

export interface PageInfo {
  url: string;
  title: string;
  domain: string;
}

export interface PageStatus {
  extracted: boolean;
  analyzed: boolean;
  extractedAt?: number;
  analyzedAt?: number;
  commentsCount?: number;
  historyId?: string;
  hasConfig?: boolean;
}

export function usePageInfo() {
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [pageStatus, setPageStatus] = useState<PageStatus>({
    extracted: false,
    analyzed: false,
    hasConfig: false,
  });
  const [loading, setLoading] = useState(true);

  const checkPageStatus = useCallback(
    async (url: string) => {
      try {
        const item = await ExtensionAPI.getHistoryByUrl(url);

        if (item) {
          const historyItem: HistoryItem = item;
          setPageStatus((prev) => ({
            extracted: true,
            analyzed: !!historyItem.analysis,
            extractedAt: historyItem.extractedAt,
            analyzedAt: historyItem.analyzedAt,
            commentsCount: historyItem.commentsCount,
            historyId: historyItem.id,
            hasConfig: prev.hasConfig,
          }));
        } else {
          setPageStatus((prev) => ({
            ...prev,
            extracted: false,
            analyzed: false,
          }));
        }
      } catch (error) {
        Logger.error('[usePageInfo] Failed to check page status', { error });
      }
    },
    [],
  );

  const checkConfigStatus = useCallback(async (domain: string) => {
    try {
      const config = await ExtensionAPI.getCrawlingConfig(domain);
      setPageStatus((prev) => ({ ...prev, hasConfig: !!config }));
    } catch (error) {
      Logger.warn('[usePageInfo] Failed to check config status', { error });
      setPageStatus((prev) => ({ ...prev, hasConfig: false }));
    }
  }, []);

  const loadPageInfo = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!tab?.url) {
        setLoading(false);
        return null;
      }

      const info: PageInfo = {
        url: tab.url,
        title: tab.title || '',
        domain: getDomain(tab.url) || 'unknown',
      };
      setPageInfo(info);

      if (tab.url) {
        try {
          const u = new URL(tab.url);
          await checkConfigStatus(u.hostname);
        } catch {
          // ignore invalid url
        }
      }
      await checkPageStatus(tab.url);

      return info;
    } catch (error) {
      Logger.error('[usePageInfo] Failed to load page info', { error });
      return null;
    } finally {
      setLoading(false);
    }
  }, [checkPageStatus, checkConfigStatus]);

  const refreshPageStatus = useCallback(async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        // Refresh both history status AND config status
        // We use full hostname for config check to support suffix matching in StorageManager
        const u = new URL(tab.url);
        await checkConfigStatus(u.hostname);
        await checkPageStatus(tab.url);
      }
    } catch (error) {
      Logger.error('[usePageInfo] Failed to refresh page status', { error });
    }
  }, [checkPageStatus, checkConfigStatus]);

  return {
    pageInfo,
    pageStatus,
    loading,
    loadPageInfo,
    checkPageStatus,
    refreshPageStatus,
  };
}
