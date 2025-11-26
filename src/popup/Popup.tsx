import * as React from 'react';
import { PATHS, MESSAGES, TIMING } from '@/config/constants';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { HistoryItem, Task } from '../types';
import { useToast } from '../hooks/useToast';
import { Logger } from '@/utils/logger';
import { getDomain } from '@/utils/url';

interface PageInfo {
  url: string;
  title: string;
  domain: string; // Domain extracted from URL
  hasConfig: boolean;
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
  const toast = useToast();
  const [pageInfo, setPageInfo] = useState<PageInfo | null>(null);
  const [pageStatus, setPageStatus] = useState<PageStatus>({
    extracted: false,
    analyzed: false,
  });
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState('');
  const [aiModelName, setAIModelName] = useState('');
  const [developerMode, setDeveloperMode] = useState(false);
  const [currentTask, setCurrentTask] = useState<{
    id: string;
    type: 'extract' | 'analyze' | 'generate-config';
    status: 'pending' | 'running' | 'completed' | 'failed';
    progress: number;
    message?: string;
  } | null>(null);
  const [generatingConfig, setGeneratingConfig] = useState(false);
  const [testSelector, setTestSelector] = useState('');
  const [testItems, setTestItems] = useState<any[]>([]);
  const [testPage, setTestPage] = useState(1);
  const [testPageSize, setTestPageSize] = useState(20);
  const monitorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);

  const handleTestSelectorQuery = async () => {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tabId = tabs[0]?.id;
      if (!tabId) return;
      const resp = await chrome.tabs.sendMessage(tabId, {
        type: MESSAGES.TEST_SELECTOR_QUERY,
        payload: { selector: testSelector },
      });
      if (resp?.success) {
        setTestItems(resp.items || []);
        setTestPage(1);
        toast.success(t('popup.selectorTestSuccess', { count: resp.total }));
      } else {
        toast.error(resp?.error || t('popup.selectorTestFailed'));
      }
    } catch (e) {
      toast.error(t('popup.selectorTestFailed'));
    }
  };


  useEffect(() => {
    isUnmountedRef.current = false;

    const initialize = async () => {
      await loadLanguage();
      await loadPageInfo();
      await loadVersion();
      await loadSettings();
      await loadCurrentTask();
    };

    initialize();

    return () => {
      isUnmountedRef.current = true;
      if (monitorTimeoutRef.current) {
        clearTimeout(monitorTimeoutRef.current);
        monitorTimeoutRef.current = null;
      }
    };
  }, []);

  const loadSettings = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.settings) {
        if (response.settings.aiModel?.model) {
          setAIModelName(response.settings.aiModel.model);
        }
        setDeveloperMode(!!response.settings.developerMode);
      }
    } catch (error) {
      Logger.error('[Popup] Failed to load settings', { error });
    }
  };

  const loadLanguage = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response?.settings?.language) {
        const i18nModule = await import('../utils/i18n');
        i18nModule.default.changeLanguage(response.settings.language);
      }
    } catch (error) {
      Logger.error('[Popup] Failed to load language', { error });
    }
  };

  const loadVersion = async () => {
    try {
      const manifest = chrome.runtime.getManifest();
      setVersion(manifest.version);
    } catch (error) {
      Logger.error('[Popup] Failed to load version', { error });
    }
  };

  const loadCurrentTask = async () => {
    try {
      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.url) return;

      // Get all running tasks
      const response = await chrome.runtime.sendMessage({ type: MESSAGES.GET_TASK_STATUS });

      if (response?.tasks) {
      const currentUrlTask = response.tasks.find(
        (task: Task) =>
          task.url === tab.url && (task.status === 'running' || task.status === 'pending'),
      );

        if (currentUrlTask) {
          Logger.debug('[Popup] Found current task', { task: currentUrlTask });
          setCurrentTask({
            id: currentUrlTask.id,
            type: currentUrlTask.type,
            status: currentUrlTask.status,
            progress: currentUrlTask.progress,
            message: currentUrlTask.message || currentUrlTask.error,
          });

          // Start monitoring if task is running
          if (currentUrlTask.status === 'running' || currentUrlTask.status === 'pending') {
            monitorTask(currentUrlTask.id);
          }
        }
      }
    } catch (error) {
      Logger.error('[Popup] Failed to load current task', { error });
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

      // Check if there's a matching scraper config
      Logger.debug('[Popup] Checking scraper config', { url: tab.url });
      const configResponse = await chrome.runtime.sendMessage({
        type: MESSAGES.CHECK_SCRAPER_CONFIG,
        payload: { url: tab.url },
      });

      Logger.debug('[Popup] Config check response', { response: configResponse });
      const hasConfig = configResponse?.hasConfig || false;
      Logger.debug('[Popup] Has config', { hasConfig });

      setPageInfo({
        url: tab.url,
        title: tab.title || '',
        domain: getDomain(tab.url) || 'unknown',
        hasConfig,
      });

      // Check if this page has been extracted/analyzed
      await checkPageStatus(tab.url);
    } catch (error) {
      Logger.error('[Popup] Failed to load page info', { error });
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
      Logger.error('[Popup] Failed to check page status', { error });
    }
  };

  const handleGenerateConfig = async () => {
    if (!pageInfo) return;

    setGeneratingConfig(true);
    toast.info(t('popup.analysisConfigStarted'));

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.GENERATE_SCRAPER_CONFIG,
        payload: {
          url: pageInfo.url,
          title: pageInfo.title,
        },
      });

      if (response?.success) {
        toast.success(t('popup.generateConfigSuccess'));
        // Reload page info to update hasConfig status
        await loadPageInfo();
      } else {
        toast.error(
          t('popup.generateConfigFailedWithMsg', { msg: response?.error || 'Unknown error' }),
        );
      }
    } catch (error) {
      Logger.error('[Popup] Failed to generate config', { error });
      toast.error(t('popup.generateConfigFailed'));
    } finally {
      setGeneratingConfig(false);
    }
  };

  const handleExtractComments = async () => {
    if (!pageInfo?.hasConfig) return;

    // Check if task is already running
    if (currentTask && currentTask.status === 'running') {
      toast.warning(t('popup.taskAlreadyRunning'));
      return;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'START_EXTRACTION',
        payload: {
          url: pageInfo.url,
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
        toast.info(t('popup.extractionStarted'));

        // Start polling task status
        monitorTask(response.taskId);
      }
    } catch (error) {
      Logger.error('[Popup] Failed to start extraction', { error });
      setCurrentTask(null);
      toast.error(t('popup.extractionFailed'));
    }
  };

  const handleAnalyzeComments = async () => {
    if (!pageStatus.extracted || !pageStatus.historyId) return;

    // Check if task is already running
    if (currentTask && currentTask.status === 'running') {
      toast.warning(t('popup.taskAlreadyRunning'));
      return;
    }

    try {
      // Get history item
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.GET_HISTORY,
        payload: { id: pageStatus.historyId },
      });

      if (response?.item) {
        const analysisResponse = await chrome.runtime.sendMessage({
          type: MESSAGES.START_ANALYSIS,
          payload: {
            comments: response.item.comments,
            historyId: pageStatus.historyId,
            metadata: {
              url: pageInfo?.url,
              platform: pageInfo?.domain,
              title: pageInfo?.title,
            },
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
          toast.info(t('popup.analysisStarted'));

          // Start polling task status
          monitorTask(analysisResponse.taskId);
        }
      }
    } catch (error) {
      Logger.error('[Popup] Failed to start analysis', { error });
      setCurrentTask(null);
      toast.error(t('popup.analysisFailed'));
    }
  };

  const monitorTask = useCallback(async (taskId: string) => {
    const checkStatus = async () => {
      if (isUnmountedRef.current) return;

      try {
        const response = await chrome.runtime.sendMessage({
          type: MESSAGES.GET_TASK_STATUS,
          payload: { taskId },
        });

        if (isUnmountedRef.current) return;

        if (response?.task) {
          const task = response.task;
          setCurrentTask({
            id: task.id,
            type: task.type,
            status: task.status,
            progress: task.progress,
            message: task.message || task.error,
          });

          if (task.status === 'running' || task.status === 'pending') {
            monitorTimeoutRef.current = setTimeout(checkStatus, TIMING.POLL_TASK_RUNNING_MS);
          } else if (task.status === 'completed') {
            // Get current tab URL directly instead of relying on pageInfo state
            // This fixes the issue where pageInfo might not be updated yet after popup reopens
            try {
              const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
              if (tab?.url) {
                await checkPageStatus(tab.url);
              }
            } catch (e) {
              Logger.error('[Popup] Failed to get tab URL for status update', { error: e });
            }
            toast.success(
              task.type === 'extract'
                ? t('popup.extractionCompleted')
                : t('popup.analysisCompleted'),
            );
            monitorTimeoutRef.current = setTimeout(() => {
              if (!isUnmountedRef.current) {
                setCurrentTask(null);
              }
            }, TIMING.CLEAR_TASK_DELAY_MS);
          } else if (task.status === 'failed') {
            toast.error(
              task.error ? `${t('popup.taskFailed')}: ${task.error}` : t('popup.taskFailed'),
            );
            monitorTimeoutRef.current = setTimeout(() => {
              if (!isUnmountedRef.current) {
                setCurrentTask(null);
              }
            }, TIMING.CLEAR_TASK_FAILED_MS);
          }
        }
      } catch (error) {
        Logger.error('[Popup] Failed to check task status', { error });
      }
    };

    checkStatus();
  }, [t, toast]);

  const handleOpenHistory = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(PATHS.HISTORY_PAGE) });
    window.close();
  };

  const handleOpenSettings = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(PATHS.OPTIONS_PAGE) });
    window.close();
  };

  const handleOpenLogs = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL(PATHS.LOGS_PAGE) });
    window.close();
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t('popup.justNow');
    if (minutes < 60) return `${minutes}${t('popup.minutesAgo')}`;
    if (hours < 24) return `${hours}${t('popup.hoursAgo')}`;
    return `${days}${t('popup.daysAgo')}`;
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
      <toast.ToastContainer />
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{t('popup.title')}</h1>
            <div className="flex flex-col gap-1">
              <p className="text-xs opacity-90">
                {t('popup.version')} {version}
              </p>
              {aiModelName && (
                <div className="flex items-center text-xs opacity-90 bg-white/20 px-2 py-0.5 rounded w-fit mt-1">
                  <span className="mr-1">🤖</span>
                  <span>{t('options.model')}: {aiModelName}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {developerMode && (
              <button
                onClick={handleOpenLogs}
                className="p-2 hover:bg-white/20 rounded-lg transition-colors"
                title={t('popup.viewAILogs')}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </button>
            )}
            <button
              onClick={handleOpenSettings}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title={t('popup.settings')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Page Status */}
      <div className="p-4 bg-white border-b">
        <div className="flex justify-between items-start mb-2">
            <h2 className="text-sm font-semibold text-gray-700">{t('popup.currentPage')}</h2>
        </div>
        {pageInfo ? (
          <div className="space-y-2">
            <div className="text-sm mb-2">
              <span className="font-medium text-gray-800 line-clamp-2">{pageInfo.title}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{t('popup.platform')}:</span>
              <span className="font-medium">{pageInfo.domain}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{t('popup.status')}:</span>
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                  pageStatus.analyzed
                    ? 'bg-green-100 text-green-700'
                    : pageStatus.extracted
                      ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-700'
                }`}
              >
                {pageStatus.analyzed
                  ? t('popup.analyzed')
                  : pageStatus.extracted
                    ? t('popup.extracted')
                    : t('popup.notExtracted')}
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
                  <span className="text-gray-500 text-xs">
                    {formatDate(pageStatus.extractedAt!)}
                  </span>
                </div>
                {pageStatus.analyzed && pageStatus.analyzedAt && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{t('popup.analyzedAt')}:</span>
                    <span className="text-gray-500 text-xs">
                      {formatDate(pageStatus.analyzedAt)}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-500 text-center py-2">{t('popup.invalidPage')}</div>
        )}
      </div>

      {/* Task Status removed to prevent layout shift; use button states and toasts instead */}

      {/* View Data Buttons removed to keep header compact; access via dynamic action buttons below */}

      {/* Action Buttons */}
      <div className="p-4 space-y-3">
        {/* Show AI Generate Config button if no config exists */}
        {pageInfo && !pageInfo?.hasConfig && (
          <div>
            <button
              onClick={handleGenerateConfig}
              disabled={generatingConfig || currentTask?.status === 'running'}
              className="w-full py-3 px-4 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-medium hover:from-purple-600 hover:to-purple-700 disabled:from-gray-300 disabled:to-gray-400 disabled:cursor-not-allowed transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
            >
              {generatingConfig ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                  {t('popup.analyzingConfig')}
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                    />
                  </svg>
                  {t('popup.generateConfig')}
                </>
              )}
            </button>
            <p className="text-xs text-gray-500 mt-2 text-center">{t('popup.noConfigHint')}</p>
          </div>
        )}

        {/* Extract Comments button - only enabled if config exists */}
        {pageInfo?.hasConfig && (
          <div>
            <button
              onClick={() => {
                if (pageStatus.extracted) {
                  chrome.tabs.create({
                    url: chrome.runtime.getURL(`${PATHS.HISTORY_PAGE}?id=${pageStatus.historyId}&tab=comments`),
                  });
                  window.close();
                } else {
                  handleExtractComments();
                }
              }}
              disabled={
                !pageInfo?.hasConfig ||
                (currentTask?.status === 'running' && currentTask?.type === 'extract')
              }
              className={`w-full py-3 px-4 rounded-lg font-medium transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 ${currentTask?.status === 'running' && currentTask?.type === 'extract' ? 'bg-gray-300 text-gray-700 cursor-not-allowed' : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700'}`}
            >
              {currentTask?.status === 'running' && currentTask?.type === 'extract' ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                  <span className="truncate max-w-[220px]">
                    {(() => {
                      const msg = currentTask.message || '';
                      const parts = msg.split(':');
                      if (parts.length >= 3) {
                        const [stage, count, max] = parts;
                        const stageKey = `popup.progress${stage.charAt(0).toUpperCase() + stage.slice(1)}`;
                        const stageText = t(stageKey);
                        const countNum = parseInt(count, 10);
                        return countNum >= 0 ? `${stageText} ${count}/${max}` : stageText;
                      }
                      return t('popup.extracting');
                    })()}
                  </span>
                </>
              ) : pageStatus.extracted ? (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                    />
                  </svg>
                  {t('popup.viewComments')}
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10"
                    />
                  </svg>
                  {t('popup.extractComments')}
                </>
              )}
            </button>
          </div>
        )}

        <div>
          <button
            onClick={() => {
              if (pageStatus.analyzed && pageStatus.historyId) {
                chrome.tabs.create({
                  url: chrome.runtime.getURL(
                    `${PATHS.HISTORY_PAGE}?id=${pageStatus.historyId}&tab=analysis`,
                  ),
                });
                window.close();
              } else {
                handleAnalyzeComments();
              }
            }}
            disabled={
              !pageStatus.extracted ||
              (currentTask?.status === 'running' && currentTask?.type === 'analyze')
            }
            className={`w-full py-3 px-4 rounded-lg font-medium transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2 ${!pageStatus.extracted || (currentTask?.status === 'running' && currentTask?.type === 'analyze') ? 'bg-gray-300 text-gray-700 cursor-not-allowed' : 'bg-gradient-to-r from-purple-500 to-purple-600 text-white hover:from-purple-600 hover:to-purple-700'}`}
          >
            {currentTask?.status === 'running' && currentTask?.type === 'analyze' ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent"></div>
                {t('popup.analyzing')}
              </>
            ) : pageStatus.analyzed ? (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                {t('popup.viewAnalysis')}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                  />
                </svg>
                {t('popup.analyzeComments')}
              </>
            )}
          </button>
        </div>

        <button
          onClick={handleOpenHistory}
          className="w-full py-3 px-4 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg font-medium hover:from-green-600 hover:to-green-700 transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          {t('popup.viewHistory')}
        </button>

        {developerMode && (
          <div className="px-4 py-3">
            <div className="flex gap-2 items-center">
              <input
                value={testSelector}
                onChange={(e) => setTestSelector(e.target.value)}
                placeholder={t('popup.enterSelector')}
                className="flex-1 px-3 py-2 border rounded"
              />
              <select
                value={testPageSize}
                onChange={(e) => setTestPageSize(Number(e.target.value))}
                className="px-2 py-2 border rounded"
              >
                {[10, 20, 50, 100].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
              <button
                onClick={handleTestSelectorQuery}
                className="px-4 py-2 bg-blue-600 text-white rounded"
              >
                {t('popup.search')}
              </button>
            </div>
            <div className="mt-2">
              {testItems.length === 0 ? (
                <div className="text-sm text-gray-500">{t('popup.noResults')}</div>
              ) : (
                <div className="border rounded">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-100">
                        <th className="p-2 text-left">#</th>
                        <th className="p-2 text-left">{t('popup.tag')}</th>
                        <th className="p-2 text-left">{t('popup.id')}</th>
                        <th className="p-2 text-left">{t('popup.class')}</th>
                        <th className="p-2 text-left">{t('popup.text')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {testItems
                        .slice((testPage - 1) * testPageSize, (testPage - 1) * testPageSize + testPageSize)
                        .map((it) => (
                          <tr key={`${it.tag}-${it.index}`} className="border-t">
                            <td className="p-2">{it.index + 1}</td>
                            <td className="p-2">{it.tag}</td>
                            <td className="p-2">{it.id}</td>
                            <td className="p-2">{it.className}</td>
                            <td className="p-2">{it.text}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between p-2">
                    <div className="text-xs text-gray-600">
                      {t('popup.total')}: {testItems.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="px-2 py-1 border rounded"
                        onClick={() => setTestPage(Math.max(1, testPage - 1))}
                        disabled={testPage === 1}
                      >
                        {t('popup.prev')}
                      </button>
                      <span className="text-xs">
                        {t('popup.page')}: {testPage} / {Math.max(1, Math.ceil(testItems.length / testPageSize))}
                      </span>
                      <button
                        className="px-2 py-1 border rounded"
                        onClick={() => setTestPage(Math.min(Math.ceil(testItems.length / testPageSize), testPage + 1))}
                        disabled={testPage >= Math.ceil(testItems.length / testPageSize)}
                      >
                        {t('popup.next')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Popup;
