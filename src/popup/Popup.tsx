import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PATHS, MESSAGES } from '@/config/constants';
import { Logger } from '@/utils/logger';
import { useTask } from './hooks/useTask';
import { usePageInfo } from './hooks/usePageInfo';
import { Header } from './components/Header';
import { PageStatus } from './components/PageStatus';
import { ActionButtons } from './components/ActionButtons';

const Popup: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');
  const [aiModelName, setAIModelName] = useState('');
  const [developerMode, setDeveloperMode] = useState(false);

  const {
    pageInfo,
    pageStatus,
    loading,
    siteAccessInfo,
    loadPageInfo,
    refreshPageStatus,
    ensureSiteAccess,
  } = usePageInfo();

  const {
    currentTask,
    loadCurrentTask,
    startExtraction,
    startConfigGeneration,
    startAnalysis,
    cancelTask,
  } = useTask({
    onStatusRefresh: refreshPageStatus,
  });

  useEffect(() => {
    const initialize = async () => {
      await loadLanguage();
      const info = await loadPageInfo();
      await loadVersion();
      await loadSettings();
      if (info?.url) {
        await loadCurrentTask(info.url);
      }
    };

    initialize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSettings = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS });
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
      const response = await chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS });
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

  const handleExtractComments = async () => {
    if (!pageInfo) return;

    const ok = await ensureSiteAccess(pageInfo.url);
    if (!ok) return;

    await startExtraction(pageInfo.url);
  };

  const handleAnalyzeComments = async () => {
    if (!pageStatus.extracted || !pageStatus.historyId) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.GET_HISTORY,
        payload: { id: pageStatus.historyId },
      });

      if (response?.item) {
        await startAnalysis(pageStatus.historyId, response.item.comments, {
          url: pageInfo?.url,
          platform: pageInfo?.domain,
          title: pageInfo?.title,
        });
      }
    } catch (error) {
      Logger.error('[Popup] Failed to get history for analysis', { error });
    }
  };

  const handleGenerateConfig = async () => {
    if (!pageInfo) return;

    const ok = await ensureSiteAccess(pageInfo.url);
    if (!ok) return;

    await startConfigGeneration(pageInfo.url);
  };

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

  if (loading) {
    return (
      <div className="w-96 p-6 bg-gradient-to-br from-blue-50 to-purple-50">
        <div className="text-center text-gray-600">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="w-96 bg-gradient-to-br from-blue-50 to-purple-50">
      <Header
        version={version}
        aiModelName={aiModelName}
        developerMode={developerMode}
        onOpenSettings={handleOpenSettings}
        onOpenLogs={handleOpenLogs}
      />
      <PageStatus pageInfo={pageInfo} pageStatus={pageStatus} siteAccessInfo={siteAccessInfo} />
      <ActionButtons
        pageInfo={pageInfo}
        pageStatus={pageStatus}
        currentTask={currentTask}
        onExtract={handleExtractComments}
        onGenerateConfig={handleGenerateConfig}
        onAnalyze={handleAnalyzeComments}
        onCancel={cancelTask}
        onOpenHistory={handleOpenHistory}
      />
    </div>
  );
};

export default Popup;
