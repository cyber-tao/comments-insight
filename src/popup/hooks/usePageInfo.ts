import { useState, useCallback } from 'react';
import { MESSAGES } from '@/config/constants';
import { HistoryItem } from '@/types';
import { Logger } from '@/utils/logger';
import { getDomain } from '@/utils/url';

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
        const response = await chrome.runtime.sendMessage({
          type: MESSAGES.GET_HISTORY_BY_URL,
          payload: { url },
        });

        if (response?.item) {
          const item: HistoryItem = response.item;
          setPageStatus({
            extracted: true,
            analyzed: !!item.analysis,
            extractedAt: item.extractedAt,
            analyzedAt: item.analyzedAt,
            commentsCount: item.commentsCount,
            historyId: item.id,
            hasConfig: pageStatus.hasConfig, // Preserve existing config status
          });
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
    [pageStatus.hasConfig],
  ); // Depend on hasConfig to avoid stale closures if needed, though mostly independent

  const checkConfigStatus = useCallback(async (domain: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.GET_CRAWLING_CONFIG,
        payload: { domain },
      });
      setPageStatus((prev) => ({ ...prev, hasConfig: !!response?.config }));
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
