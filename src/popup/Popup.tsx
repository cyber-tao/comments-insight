import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, HistoryItem } from '../types';

interface PageInfo {
  url: string;
  platform: Platform;
  isValid: boolean;
}

interface PageStatus {
  extracted: boolean;
  analyzed: boolean;
  extractedAt?: number;
  analyzedAt?: number;
  commentsCount?: number;
  historyId?: string;
}

const Popup: React.FC = () => {
  const { t } = useTranslation();
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [pageStatus, setPageStatus] = useState<PageStatus>({
    extracted: false,
    analyzed: false,
  });
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState('');

  useEffect(() => {
    loadLanguage();
    loadPageInfo();
    loadVersion();
  }, []);

  const loadLanguage = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.settings?.language) {
        const i18nModule = await import('../utils/i18n');
        i18nModule.default.changeLanguage(response.settings.language);
      }
    } catch (error) {
      console.error('[Popup] Failed to load language:', error);
    }
  };

  const loadVersion = async () => {
    try {
      const manifest = chrome.runtime.getManifest();
      setVersion(manifest.version);
    } catch (error) {
      console.error('[Popup] Failed to load version:', error);
    }
  };

  const loadPageInfo = async () => {
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      
      if (!tab?.url) {
        setLoading(false);
        return;
      }

      // Send message to content script to detect platform
      try {
        const response = await chrome.tabs.sendMessage(tab.id!, { type: 'DETECT_PLATFORM' });
        
        if (response?.platform) {
          setPageInfo({
            url: tab.url,
            platform: response.platform,
            isValid: response.platform !== 'unknown',
          });
          
          // Check if this page has been extracted/analyzed
          await checkPageStatus(tab.url);
        } else {
          // No response or invalid response
          setPageInfo({
            url: tab.url,
            platform: 'unknown',
            isValid: false,
          });
        }
      } catch (error) {
        // Content script not loaded or page doesn't support it
        // This is normal for chrome:// pages, extension pages, etc.
        console.log('[Popup] Content script not available (this is normal for some pages)');
        setPageInfo({
          url: tab.url,
          platform: 'unknown',
          isValid: false,
        });
      }
    } catch (error) {
      console.error('[Popup] Failed to load page info:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkPageStatus = async (url: string) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_HISTORY_BY_URL',
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
        });
      }
    } catch (error) {
      console.error('[Popup] Failed to check page status:', error);
    }
  };

  const handleExtractComments = async () => {
    if (!pageInfo?.isValid) return;

    try {
      await chrome.runtime.sendMessage({
        type: 'START_EXTRACTION',
        payload: {
          url: pageInfo.url,
          platform: pageInfo.platform,
        },
      });

      // Close popup after starting extraction
      window.close();
    } catch (error) {
      console.error('[Popup] Failed to start extraction:', error);
    }
  };

  const handleAnalyzeComments = async () => {
    if (!pageStatus.extracted || !pageStatus.historyId) return;

    try {
      // Get history item
      const response = await chrome.runtime.sendMessage({
        type: 'GET_HISTORY',
        payload: { id: pageStatus.historyId },
      });

      if (response?.item) {
        await chrome.runtime.sendMessage({
          type: 'START_ANALYSIS',
          payload: {
            comments: response.item.comments,
            url: pageInfo?.url,
            platform: pageInfo?.platform,
            historyId: pageStatus.historyId,
          },
        });

        // Close popup after starting analysis
        window.close();
      }
    } catch (error) {
      console.error('[Popup] Failed to start analysis:', error);
    }
  };

  const handleOpenHistory = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/history/index.html') });
    window.close();
  };

  const handleOpenSettings = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') });
    window.close();
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t('popup.justNow') || 'Just now';
    if (minutes < 60) return `${minutes}${t('popup.minutesAgo') || ' min ago'}`;
    if (hours < 24) return `${hours}${t('popup.hoursAgo') || ' hours ago'}`;
    return `${days}${t('popup.daysAgo') || ' days ago'}`;
  };

  if (loading) {
    return (
      <div className="w-96 p-6 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="text-center text-gray-600">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="w-96 bg-gradient-to-br from-blue-50 to-purple-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{t('popup.title')}</h1>
            <p className="text-xs opacity-90">{t('popup.version')} {version}</p>
          </div>
          <button
            onClick={handleOpenSettings}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            title={t('popup.settings')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Page Status */}
      <div className="p-4 bg-white border-b">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('popup.currentPage')}</h2>
        {pageInfo?.isValid ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{t('popup.platform')}:</span>
              <span className="font-medium capitalize">{pageInfo.platform}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{t('popup.status')}:</span>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                pageStatus.analyzed ? 'bg-green-100 text-green-700' :
                pageStatus.extracted ? 'bg-blue-100 text-blue-700' :
                'bg-gray-100 text-gray-700'
              }`}>
                {pageStatus.analyzed ? t('popup.analyzed') :
                 pageStatus.extracted ? t('popup.extracted') :
                 t('popup.notExtracted')}
              </span>
            </div>
            {pageStatus.extracted && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{t('popup.commentsCount')}:</span>
                  <span className="font-medium">{pageStatus.commentsCount}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{t('popup.extractedAt')}:</span>
                  <span className="text-gray-500 text-xs">{formatDate(pageStatus.extractedAt!)}</span>
                </div>
                {pageStatus.analyzed && pageStatus.analyzedAt && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{t('popup.analyzedAt')}:</span>
                    <span className="text-gray-500 text-xs">{formatDate(pageStatus.analyzedAt)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-500 text-center py-2">
            {t('popup.invalidPage')}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="p-4 space-y-3">
        <button
          onClick={handleExtractComments}
          disabled={!pageInfo?.isValid}
          className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
          </svg>
          {t('popup.extractComments')}
        </button>

        <button
          onClick={handleAnalyzeComments}
          disabled={!pageStatus.extracted}
          className="w-full py-3 px-4 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-medium hover:from-purple-600 hover:to-purple-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          {t('popup.analyzeComments')}
        </button>

        <button
          onClick={handleOpenHistory}
          className="w-full py-3 px-4 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg font-medium hover:from-green-600 hover:to-green-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {t('popup.viewHistory')}
        </button>
      </div>
    </div>
  );
};

export default Popup;
