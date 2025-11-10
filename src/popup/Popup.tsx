import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, HistoryItem } from '../types';

interface PageInfo {
  url: string;
  title: string;
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
  const [extractorModelName, setExtractorModelName] = useState('');
  const [analyzerModelName, setAnalyzerModelName] = useState('');
  const [currentTask, setCurrentTask] = useState<{
    id: string;
    type: 'extract' | 'analyze';
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number;
    message?: string;
  } | null>(null);

  useEffect(() => {
    loadLanguage();
    loadPageInfo();
    loadVersion();
    loadModelName();
    loadCurrentTask();
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

  const loadModelName = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.settings) {
        if (response.settings.extractorModel?.model) {
          setExtractorModelName(response.settings.extractorModel.model);
        }
        if (response.settings.analyzerModel?.model) {
          setAnalyzerModelName(response.settings.analyzerModel.model);
        }
      }
    } catch (error) {
      console.error('[Popup] Failed to load model names:', error);
    }
  };

  const loadCurrentTask = async () => {
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;

      // Get all running tasks
      const response = await chrome.runtime.sendMessage({ type: 'GET_TASK_STATUS' });
      
      if (response?.tasks) {
        // Find task for current URL that is running or pending
        const currentUrlTask = response.tasks.find((task: any) => 
          task.url === tab.url && 
          (task.status === 'running' || task.status === 'pending')
        );

        if (currentUrlTask) {
          console.log('[Popup] Found current task:', currentUrlTask);
          setCurrentTask({
            id: currentUrlTask.id,
            type: currentUrlTask.type,
            status: currentUrlTask.status,
            progress: currentUrlTask.progress,
            message: currentUrlTask.error,
          });

          // Start monitoring if task is running
          if (currentUrlTask.status === 'running' || currentUrlTask.status === 'pending') {
            monitorTask(currentUrlTask.id);
          }
        }
      }
    } catch (error) {
      console.error('[Popup] Failed to load current task:', error);
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
        const response = await chrome.tabs.sendMessage(tab.id!, { type: 'GET_PLATFORM_INFO' });
        
        if (response?.platform) {
          setPageInfo({
            url: tab.url,
            title: tab.title || '',
            platform: response.platform,
            isValid: response.isValid,
          });
          
          // Check if this page has been extracted/analyzed
          await checkPageStatus(tab.url);
        } else {
          // No response or invalid response
          setPageInfo({
            url: tab.url,
            title: tab.title || '',
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
          title: tab.title || '',
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
    
    // Check if task is already running
    if (currentTask && currentTask.status === 'running') {
      alert('Task is already in progress. Please wait for it to complete.');
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_EXTRACTION',
        payload: {
          url: pageInfo.url,
          platform: pageInfo.platform,
        },
      });

      if (response?.taskId) {
        // Set task and start monitoring
        setCurrentTask({
          id: response.taskId,
          type: 'extract',
          status: 'running',
          progress: 0,
        });
        
        // Start polling task status
        monitorTask(response.taskId);
      }
    } catch (error) {
      console.error('[Popup] Failed to start extraction:', error);
      setCurrentTask(null);
    }
  };

  const handleAnalyzeComments = async () => {
    if (!pageStatus.extracted || !pageStatus.historyId) return;
    
    // Check if task is already running
    if (currentTask && currentTask.status === 'running') {
      alert('Task is already in progress. Please wait for it to complete.');
      return;
    }

    try {
      // Get history item
      const response = await chrome.runtime.sendMessage({
        type: 'GET_HISTORY',
        payload: { id: pageStatus.historyId },
      });

      if (response?.item) {
        const analysisResponse = await chrome.runtime.sendMessage({
          type: 'START_ANALYSIS',
          payload: {
            comments: response.item.comments,
            url: pageInfo?.url,
            platform: pageInfo?.platform,
            historyId: pageStatus.historyId,
          },
        });

        if (analysisResponse?.taskId) {
          // Set task and start monitoring
          setCurrentTask({
            id: analysisResponse.taskId,
            type: 'analyze',
            status: 'running',
            progress: 0,
          });
          
          // Start polling task status
          monitorTask(analysisResponse.taskId);
        }
      }
    } catch (error) {
      console.error('[Popup] Failed to start analysis:', error);
      setCurrentTask(null);
    }
  };

  const monitorTask = async (taskId: string) => {
    const checkStatus = async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_TASK_STATUS',
          payload: { taskId },
        });

        if (response?.task) {
          const task = response.task;
          setCurrentTask({
            id: task.id,
            type: task.type,
            status: task.status,
            progress: task.progress,
            message: task.error,
          });

          // If task is still running, check again
          if (task.status === 'running' || task.status === 'pending') {
            setTimeout(checkStatus, 1000);
          } else if (task.status === 'completed') {
            // Reload page status
            if (pageInfo) {
              await checkPageStatus(pageInfo.url);
            }
            // Clear task after a delay
            setTimeout(() => setCurrentTask(null), 2000);
          } else if (task.status === 'failed') {
            // Clear task after showing error
            setTimeout(() => setCurrentTask(null), 5000);
          }
        }
      } catch (error) {
        console.error('[Popup] Failed to check task status:', error);
      }
    };

    checkStatus();
  };

  const handleOpenHistory = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/history/index.html') });
    window.close();
  };

  const handleOpenSettings = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/index.html') });
    window.close();
  };

  const handleOpenLogs = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/logs/index.html') });
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
          <div className="flex gap-2">
            <button
              onClick={handleOpenLogs}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title="View AI Logs"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
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
      </div>

      {/* Page Status */}
      <div className="p-4 bg-white border-b">
        <h2 className="text-sm font-semibold text-gray-700 mb-2">{t('popup.currentPage')}</h2>
        {pageInfo?.isValid ? (
          <div className="space-y-2">
            <div className="text-sm mb-2">
              <span className="font-medium text-gray-800 line-clamp-2">{pageInfo.title}</span>
            </div>
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

      {/* Task Status */}
      {currentTask && (
        <div className="px-4 py-3 bg-blue-50 border-t border-b">
          <div className="flex items-center gap-2">
            {currentTask.status === 'running' && (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent"></div>
            )}
            {currentTask.status === 'completed' && (
              <div className="text-green-500">✓</div>
            )}
            {currentTask.status === 'failed' && (
              <div className="text-red-500">✗</div>
            )}
            <span className="text-sm text-gray-700">
              {currentTask.message || (currentTask.type === 'extract' ? 'Extracting comments...' : 'Analyzing comments...')}
            </span>
          </div>
        </div>
      )}

      {/* View Data Buttons */}
      {pageStatus.extracted && (
        <div className="px-4 pt-2 pb-3 bg-gray-50 border-t space-y-2">
          <div className="flex gap-2">
            <button
              onClick={() => {
                chrome.tabs.create({ 
                  url: chrome.runtime.getURL(`src/history/index.html?id=${pageStatus.historyId}`) 
                });
                window.close();
              }}
              className="flex-1 py-2 px-3 bg-white border border-blue-300 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-50 transition-all flex items-center justify-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
              {t('popup.viewComments')}
            </button>
            
            {pageStatus.analyzed && (
              <button
                onClick={() => {
                  chrome.tabs.create({ 
                    url: chrome.runtime.getURL(`src/history/index.html?id=${pageStatus.historyId}&tab=analysis`) 
                  });
                  window.close();
                }}
                className="flex-1 py-2 px-3 bg-white border border-purple-300 text-purple-600 rounded-lg text-sm font-medium hover:bg-purple-50 transition-all flex items-center justify-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                {t('popup.viewAnalysis')}
              </button>
            )}
          </div>
          <div className="text-xs text-gray-500 text-center">
            {t('popup.lastUpdated')}: {formatDate(pageStatus.analyzedAt || pageStatus.extractedAt!)}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="p-4 space-y-3">
        <div>
          <button
            onClick={handleExtractComments}
            disabled={!pageInfo?.isValid || (currentTask?.status === 'running')}
            className="w-full py-3 px-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
            </svg>
            {t('popup.extractComments')}
          </button>
          {extractorModelName && (
            <p className="text-xs text-gray-500 mt-1 text-center">🤖 {extractorModelName}</p>
          )}
        </div>

        <div>
          <button
            onClick={handleAnalyzeComments}
            disabled={!pageStatus.extracted || (currentTask?.status === 'running')}
            className="w-full py-3 px-4 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-medium hover:from-purple-600 hover:to-purple-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {t('popup.analyzeComments')}
          </button>
          {analyzerModelName && (
            <p className="text-xs text-gray-500 mt-1 text-center">🤖 {analyzerModelName}</p>
          )}
        </div>

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
