import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from './hooks/useSettings';
import { BasicSettings } from './components/BasicSettings';
import { AIModelSettings } from './components/AIModelSettings';
import { AdvancedSettings } from './components/AdvancedSettings';
import { ConfigSettings } from './components/ConfigSettings';

type Tab = 'basic' | 'advanced' | 'crawling';

const Options: React.FC = () => {
  const { t } = useTranslation();
  const { settings, saving, handleSettingsChange, handleExport, handleImport, ToastContainer } =
    useSettings();
  const [activeTab, setActiveTab] = useState<Tab>('basic');

  if (!settings) {
    return <div className="container mx-auto p-8">{t('common.loading')}</div>;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'basic', label: t('options.basicSettings') },
    { id: 'crawling', label: t('options.crawlingConfigs.title') },
    { id: 'advanced', label: t('options.advancedSettings') },
  ];

  return (
    <>
      <ToastContainer />
      <div className="container mx-auto p-8 max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">{t('options.title')}</h1>
          <div className="flex gap-4">
            <button
              onClick={handleExport}
              className="px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm flex items-center gap-2"
              title={t('options.exportSettings')}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              {t('common.export')}
            </button>
            <label className="px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 cursor-pointer text-sm flex items-center gap-2" title={t('options.importSettings')}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
              {t('common.import')}
              <input type="file" accept=".json" onChange={handleImport} className="hidden" />
            </label>
          </div>
        </div>

        {/* Tabs Navigation */}
        <div className="flex border-b border-gray-200 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-4 font-medium text-sm focus:outline-none transition-colors duration-200 border-b-2 ${activeTab === tab.id
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="animate-fade-in">
          {activeTab === 'basic' && (
            <div className="space-y-6">
              <BasicSettings settings={settings} onSettingsChange={handleSettingsChange} />
              <AIModelSettings settings={settings} onSettingsChange={handleSettingsChange} />
            </div>
          )}

          {activeTab === 'crawling' && (
            <ConfigSettings
              settings={settings}
              onSettingsChange={(s) => handleSettingsChange({ ...settings, ...s })}
            />
          )}

          {activeTab === 'advanced' && (
            <div className="space-y-6">
              <AdvancedSettings settings={settings} onSettingsChange={handleSettingsChange} />
            </div>
          )}
        </div>

        {/* Auto-save indicator */}
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
