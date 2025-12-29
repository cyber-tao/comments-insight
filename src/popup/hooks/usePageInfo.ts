import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MESSAGES } from '@/config/constants';
import { HistoryItem } from '@/types';
import { Logger } from '@/utils/logger';
import { getDomain } from '@/utils/url';
import { useToast } from '@/hooks/useToast';

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

export interface SiteAccessInfo {
  hasSiteAccess: boolean | null;
  sitePattern: string | null;
  isRequired: boolean;
}

export function usePageInfo() {
  const { t } = useTranslation();
  const toast = useToast();
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [pageStatus, setPageStatus] = useState<PageStatus>({
    extracted: false,
    analyzed: false,
    hasConfig: false,
  });
  const [loading, setLoading] = useState(true);
  const [siteAccessInfo, setSiteAccessInfo] = useState<SiteAccessInfo>({
    hasSiteAccess: null,
    sitePattern: null,
    isRequired: false,
  });

  const computeSitePattern = (url: string): string | null => {
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        return null;
      }
      return `${u.protocol}//${u.hostname}/*`;
    } catch {
      return null;
    }
  };

  const isRequiredOrigin = (origin: string): boolean => {
    const manifest = chrome.runtime.getManifest();
    const required = manifest.content_scripts?.flatMap((x) => x.matches || []) || [];
    return required.includes(origin);
  };

  const refreshSiteAccess = useCallback(async (url: string) => {
    const pattern = computeSitePattern(url);

    if (!pattern) {
      setSiteAccessInfo({
        hasSiteAccess: null,
        sitePattern: null,
        isRequired: false,
      });
      return;
    }

    const isRequired = isRequiredOrigin(pattern);
    if (isRequired) {
      setSiteAccessInfo({
        hasSiteAccess: true,
        sitePattern: pattern,
        isRequired: true,
      });
      return;
    }

    try {
      const has = await chrome.permissions.contains({ origins: [pattern] });
      setSiteAccessInfo({
        hasSiteAccess: has,
        sitePattern: pattern,
        isRequired: false,
      });
    } catch {
      setSiteAccessInfo({
        hasSiteAccess: null,
        sitePattern: pattern,
        isRequired: false,
      });
    }
  }, []);

  const ensureSiteAccess = useCallback(
    async (url: string): Promise<boolean> => {
      const pattern = computeSitePattern(url);
      if (!pattern) {
        return false;
      }

      if (isRequiredOrigin(pattern)) {
        return true;
      }

      const has = await chrome.permissions.contains({ origins: [pattern] });
      if (has) {
        return true;
      }

      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) {
        toast.warning(t('popup.accessRequestDenied'));
        return false;
      }

      toast.success(t('popup.accessGranted'));
      await refreshSiteAccess(url);
      return true;
    },
    [t, toast, refreshSiteAccess],
  );

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

      await refreshSiteAccess(tab.url);
      await refreshSiteAccess(tab.url);
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
  }, [refreshSiteAccess, checkPageStatus, checkConfigStatus]);

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
    siteAccessInfo,
    loadPageInfo,
    checkPageStatus,
    refreshPageStatus,
    ensureSiteAccess,
  };
}
