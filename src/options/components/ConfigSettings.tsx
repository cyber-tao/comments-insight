import React, { useState } from 'react';
import { Settings, CrawlingConfig } from '../../types';
import { useTranslation } from 'react-i18next';
import { CrawlingConfigEditor } from './CrawlingConfigEditor';

interface Props {
  settings: Settings;
  onSettingsChange: (newSettings: Partial<Settings>) => void;
}

const DEFAULT_EMPTY_CONFIG: CrawlingConfig = {
  id: '',
  domain: 'new-site.com',
  lastUpdated: Date.now(),
  container: { selector: '', type: 'css' },
  item: { selector: '', type: 'css' },
  fields: [
    { name: 'username', rule: { selector: '', type: 'css' } },
    { name: 'content', rule: { selector: '', type: 'css' } },
    { name: 'timestamp', rule: { selector: '', type: 'css' } },
    { name: 'likes', rule: { selector: '', type: 'css' } },
  ],
};

export const ConfigSettings: React.FC<Props> = ({ settings, onSettingsChange }) => {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempConfig, setTempConfig] = useState<CrawlingConfig | null>(null);

  // Safely access configs (it might be undefined if loaded from old initialized storage)
  const configs = settings.crawlingConfigs || [];

  const handleAdd = () => {
    const newConfig = { ...DEFAULT_EMPTY_CONFIG, id: `manual_${Date.now()}` };
    setTempConfig(newConfig);
    setEditingId(newConfig.id);
  };

  const handleEdit = (config: CrawlingConfig) => {
    setTempConfig({ ...config });
    setEditingId(config.id);
  };

  const handleDelete = (id: string) => {
    if (confirm(t('options.crawlingConfigs.confirmDelete'))) {
      const newConfigs = configs.filter((c) => c.id !== id);
      onSettingsChange({ crawlingConfigs: newConfigs });
    }
  };

  const handleSave = () => {
    if (tempConfig) {
      const exists = configs.find((c) => c.id === tempConfig.id);
      let newConfigs;
      if (exists) {
        newConfigs = configs.map((c) => (c.id === tempConfig.id ? tempConfig : c));
      } else {
        newConfigs = [...configs, tempConfig];
      }
      onSettingsChange({ crawlingConfigs: newConfigs });
      setEditingId(null);
      setTempConfig(null);
    }
  };

  if (editingId && tempConfig) {
    return (
      <CrawlingConfigEditor
        config={tempConfig}
        onChange={setTempConfig}
        onCancel={() => {
          setEditingId(null);
          setTempConfig(null);
        }}
        onSave={handleSave}
      />
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">
            {t('options.crawlingConfigs.title')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{t('options.crawlingConfigs.subtitle')}</p>
        </div>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium flex items-center gap-2"
        >
          <span>+</span> {t('options.crawlingConfigs.addConfig')}
        </button>
      </div>

      {configs.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 rounded border border-dashed text-gray-500">
          {t('options.crawlingConfigs.noConfigs')}
        </div>
      ) : (
        <div className="grid gap-4">
          {configs.map((config) => (
            <div
              key={config.id}
              className="flex items-center justify-between p-4 border rounded hover:border-blue-300 transition-colors bg-gray-50"
            >
              <div>
                <h3 className="font-semibold text-gray-900">{config.domain}</h3>
                <div className="text-xs text-gray-500 mt-1 flex gap-3">
                  <span>
                    {t('options.crawlingConfigs.items')}:{' '}
                    <code className="bg-gray-200 px-1 rounded">{config.item.selector}</code>
                  </span>
                  <span>
                    {t('options.crawlingConfigs.replies')}:{' '}
                    {config.replies
                      ? t('options.crawlingConfigs.enabled')
                      : t('options.crawlingConfigs.disabled')}
                  </span>
                  <span>
                    {t('options.crawlingConfigs.updated')}:{' '}
                    {new Date(config.lastUpdated).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(config)}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(config.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
