import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from './hooks/useSettings';
import { BasicSettings } from './components/BasicSettings';
import { AIModelSettings } from './components/AIModelSettings';
import { AdvancedSettings } from './components/AdvancedSettings';
import { ConfigSettings } from './components/ConfigSettings';
import { useTheme } from '@/hooks/useTheme';
import { useConfirm } from '@/hooks/useConfirm';
import { BrandIcon, DownloadIcon, GlobeIcon, SettingsIcon, UploadIcon } from '@/components/Icons';

type Tab = 'extension' | 'crawling';

const Options: React.FC = () => {
  const { t } = useTranslation();
  const {
    settings,
    saving,
    loading,
    loadError,
    hasExternalConflict,
    retryLoad,
    handleSettingsChange,
    handleExport,
    handleImport,
    toast,
    ToastContainer,
  } = useSettings();
  const [activeTab, setActiveTab] = useState<Tab>('extension');
  const { setTheme } = useTheme();
  const { confirm, ConfirmHost } = useConfirm();

  if (!settings) {
    return (
      <>
        <ToastContainer />
        <div
          className="container mx-auto p-8 max-w-5xl"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
        >
          {loadError ? (
            <div role="alert" className="theme-card p-6">
              <p className="mb-4 text-sm" style={{ color: 'var(--accent-danger)' }}>
                {loadError}
              </p>
              <button
                type="button"
                className="px-4 py-2 rounded-lg text-sm theme-button-secondary"
                disabled={loading}
                onClick={() => void retryLoad()}
              >
                {t('options.retryLoadSettings')}
              </button>
            </div>
          ) : (
            t('common.loading')
          )}
        </div>
      </>
    );
  }

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'extension', label: t('options.extensionSettings'), icon: <SettingsIcon size={15} /> },
    { id: 'crawling', label: t('options.crawlingConfigs.title'), icon: <GlobeIcon size={15} /> },
  ];

  return (
    <>
      <ToastContainer />
      <div
        className="container mx-auto px-6 py-8 max-w-5xl min-h-screen"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        <div
          className="flex flex-wrap justify-between items-center gap-4 pb-5 mb-6 border-b"
          style={{ borderColor: 'var(--border-primary)' }}
        >
          <div className="flex items-center gap-3">
            <BrandIcon size={40} />
            <div>
              <h1
                className="text-2xl font-bold tracking-tight font-serif-editorial"
                style={{ color: 'var(--text-primary)' }}
              >
                {t('options.title')}
              </h1>
            </div>
          </div>

          <div
            className="inline-flex p-1 rounded-lg gap-1"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-primary)',
            }}
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="py-1.5 px-3.5 rounded-md font-medium text-sm focus:outline-none transition-all inline-flex items-center gap-2"
                style={{
                  backgroundColor: activeTab === tab.id ? 'var(--bg-card)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-tertiary)',
                  boxShadow: activeTab === tab.id ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>

        {hasExternalConflict && (
          <div
            role="alert"
            className="mb-5 p-4 rounded-xl text-sm font-medium"
            style={{
              backgroundColor: 'var(--accent-warning-soft)',
              color: 'var(--accent-warning)',
              border: '1px solid rgba(217, 119, 6, 0.3)',
            }}
          >
            {t('options.settingsConflict')}
          </div>
        )}

        <div className="animate-fade-in">
          {activeTab === 'extension' && (
            <div className="space-y-6">
              <section className="theme-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h2
                    className="text-lg font-bold font-serif-editorial"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {t('options.extensionSettings')}
                  </h2>
                  <div className="flex gap-2.5">
                    <label className="theme-button-secondary px-3.5 py-2 text-xs inline-flex items-center gap-1.5 cursor-pointer">
                      <UploadIcon size={14} />
                      <span>{t('common.import')}</span>
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleImport}
                        className="hidden"
                      />
                    </label>
                    <button
                      onClick={handleExport}
                      className="theme-button-primary px-3.5 py-2 text-xs inline-flex items-center gap-1.5"
                    >
                      <DownloadIcon size={14} />
                      <span>{t('common.export')}</span>
                    </button>
                  </div>
                </div>
              </section>
              <BasicSettings
                settings={settings}
                onSettingsChange={handleSettingsChange}
                onThemeChange={setTheme}
              />
              <AIModelSettings
                settings={settings}
                onSettingsChange={handleSettingsChange}
                toast={toast}
              />
              <AdvancedSettings settings={settings} onSettingsChange={handleSettingsChange} />
            </div>
          )}

          {activeTab === 'crawling' && (
            <ConfigSettings
              settings={settings}
              onSettingsChange={handleSettingsChange}
              showToast={toast.showToast}
              confirm={confirm}
            />
          )}
        </div>

        {saving && (
          <div
            className="fixed bottom-5 right-5 px-4 py-2 rounded-full text-xs font-medium shadow-lg z-50 flex items-center gap-2"
            style={{
              backgroundColor: 'var(--accent-ink)',
              color: '#ffffff',
            }}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>{t('options.saving')}</span>
          </div>
        )}
      </div>
      <ConfirmHost />
    </>
  );
};

export default Options;
