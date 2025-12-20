import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from './hooks/useSettings';
import { BasicSettings } from './components/BasicSettings';
import { AIModelSettings } from './components/AIModelSettings';
import { AdvancedSettings } from './components/AdvancedSettings';
import { ImportExport } from './components/ImportExport';

const Options: React.FC = () => {
  const { t } = useTranslation();
  const { settings, saving, handleSettingsChange, handleExport, handleImport, ToastContainer } =
    useSettings();

  if (!settings) {
    return <div className="container mx-auto p-8">{t('common.loading')}</div>;
  }

  return (
    <>
      <ToastContainer />
      <div className="container mx-auto p-8 max-w-6xl">
        <h1 className="text-3xl font-bold mb-6">{t('options.title')}</h1>

        <div>
          <BasicSettings settings={settings} onSettingsChange={handleSettingsChange} />

          <AIModelSettings settings={settings} onSettingsChange={handleSettingsChange} />

          <AdvancedSettings settings={settings} onSettingsChange={handleSettingsChange} />

          <ImportExport onExport={handleExport} onImport={handleImport} />

          {/* Auto-save indicator */}
          {saving && (
            <div className="fixed bottom-4 right-4 bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg">
              {t('options.saving')}
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default Options;
