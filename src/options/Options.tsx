import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from './hooks/useSettings';
import { BasicSettings } from './components/BasicSettings';
import { AIModelSettings } from './components/AIModelSettings';
import { AdvancedSettings } from './components/AdvancedSettings';
import { ConfigSettings } from './components/ConfigSettings';
import { useTheme } from '@/hooks/useTheme';

type Tab = 'extension' | 'crawling';

const Options: React.FC = () => {
  const { t } = useTranslation();
  const {
    settings,
    saving,
    handleSettingsChange,
    handleExport,
    handleImport,
    toast,
    ToastContainer,
  } = useSettings();
  const [activeTab, setActiveTab] = useState<Tab>('extension');
  const { setTheme } = useTheme();

  if (!settings) {
    return (
      <div
        className="container mx-auto p-8"
        style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }}
      >
        {t('common.loading')}
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'extension', label: t('options.extensionSettings') },
    { id: 'crawling', label: t('options.crawlingConfigs.title') },
  ];

  return (
    <>
      <ToastContainer />
      <div
        className="container mx-auto p-8 max-w-6xl min-h-screen"
        style={{ backgroundColor: 'var(--bg-secondary)' }}
      >
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {t('options.title')}
          </h1>
        </div>

        <div className="flex border-b mb-6" style={{ borderColor: 'var(--border-primary)' }}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-4 font-medium text-sm focus:outline-none transition-colors duration-200 border-b-2 ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent hover:border-gray-300'
              }`}
              style={{
                color: activeTab === tab.id ? undefined : 'var(--text-tertiary)',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="animate-fade-in">
          {activeTab === 'extension' && (
            <div className="space-y-6">
              <section className="theme-card p-6">
                <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
                  {t('options.extensionSettings')}
                </h2>
                <div className="flex gap-3">
                  <label className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium cursor-pointer transition-colors">
                    {t('common.import')}
                    <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                  </label>
                  <button
                    onClick={handleExport}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium transition-colors"
                  >
                    {t('common.export')}
                  </button>
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
              onSettingsChange={(s) => handleSettingsChange({ ...settings, ...s })}
            />
          )}
        </div>

        {saving && (
          <div className="fixed bottom-4 right-4 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg z-50">
            {t('options.saving')}
          </div>
        )}
      </div>
    </>
  );
};

export default Options;
