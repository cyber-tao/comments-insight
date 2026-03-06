import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PATHS } from '@/config/constants';
import { Logger } from '@/utils/logger';
import i18n from '@/utils/i18n';
import { ExtensionAPI } from '@/utils/extension-api';
import { useTask } from './hooks/useTask';
import { usePageInfo } from './hooks/usePageInfo';
import { useTheme } from '@/hooks/useTheme';
import { Header } from './components/Header';
import { PageStatus } from './components/PageStatus';
import { ActionButtons } from './components/ActionButtons';
import { SelectorTester } from './components/SelectorTester';

const Popup: React.FC = () => {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');
  const [aiModelName, setAIModelName] = useState('');
  const [developerMode, setDeveloperMode] = useState(false);

  const { pageInfo, pageStatus, loading, loadPageInfo, refreshPageStatus } = usePageInfo();
  useTheme();

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

  const loadBootstrapSettings = useCallback(async () => {
    try {
      const settings = await ExtensionAPI.getSettings();
      if (settings) {
        if (settings.language) {
          await i18n.changeLanguage(settings.language);
        }
        if (settings.aiModel?.model) {
          setAIModelName(settings.aiModel.model);
        }
        setDeveloperMode(!!settings.developerMode);
      }
    } catch (error) {
      Logger.error('[Popup] Failed to load bootstrap settings', { error });
    }
  }, []);

  const loadVersion = useCallback(async () => {
    try {
      const manifest = chrome.runtime.getManifest();
      setVersion(manifest.version);
    } catch (error) {
      Logger.error('[Popup] Failed to load version', { error });
    }
  }, []);

  const initialize = useCallback(async () => {
    const info = await loadPageInfo();
    await loadVersion();
    await loadBootstrapSettings();
    if (info?.url) {
      await loadCurrentTask(info.url);
    }
  }, [loadBootstrapSettings, loadCurrentTask, loadPageInfo, loadVersion]);

  useEffect(() => {
    void initialize();
  }, [initialize]);

  const handleExtractComments = async () => {
    if (!pageInfo) return;
    await startExtraction(pageInfo.url);
  };

  const handleAnalyzeComments = async () => {
    if (!pageStatus.extracted || !pageStatus.historyId) return;

    try {
      const item = await ExtensionAPI.getHistoryItem(pageStatus.historyId);

      if (item) {
        await startAnalysis(pageStatus.historyId, item.comments, {
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
      <div className="w-96 p-6" style={{ background: 'var(--gradient-primary)' }}>
        <div className="text-center text-white">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="w-96" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      <Header
        version={version}
        aiModelName={aiModelName}
        developerMode={developerMode}
        onOpenSettings={handleOpenSettings}
        onOpenLogs={handleOpenLogs}
      />
      <PageStatus pageInfo={pageInfo} pageStatus={pageStatus} />
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
      {developerMode && <SelectorTester />}
    </div>
  );
};

export default Popup;
