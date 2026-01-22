import * as React from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from './hooks/useSettings';
import { BasicSettings } from './components/BasicSettings';
import { AIModelSettings } from './components/AIModelSettings';
import { AdvancedSettings } from './components/AdvancedSettings';
import { ConfigSettings } from './components/ConfigSettings';

type Tab = 'extension' | 'crawling';

const Options: React.FC = () => {
  const { t } = useTranslation();
  const { settings, saving, handleSettingsChange, handleExport, handleImport, ToastContainer } =
    useSettings();
  const [activeTab, setActiveTab] = useState<Tab>('extension');

  if (!settings) {
    return <div className="container mx-auto p-8">{t('common.loading')}</div>;
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: 'extension', label: t('options.extensionSettings') },
    { id: 'crawling', label: t('options.crawlingConfigs.title') },
  ];

  return (
    <>
      <ToastContainer />
      <div className="container mx-auto p-8 max-w-6xl">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">{t('options.title')}</h1>
        </div>

        {/* Tabs Navigation */}
        <div className="flex border-b border-gray-200 mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-2 px-4 font-medium text-sm focus:outline-none transition-colors duration-200 border-b-2 ${
                activeTab === tab.id
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
          {activeTab === 'extension' && (
            <div className="space-y-6">
              <div className="flex gap-3">
                <button
                  onClick={handleExport}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
                >
                  {t('common.export')}
                </button>
                <label className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium cursor-pointer">
                  {t('common.import')}
                  <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                </label>
              </div>
              <BasicSettings settings={settings} onSettingsChange={handleSettingsChange} />
              <AIModelSettings settings={settings} onSettingsChange={handleSettingsChange} />
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
