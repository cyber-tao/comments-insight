import React from 'react';
import { useTranslation } from 'react-i18next';
import { CrawlingConfig } from '../../types';

interface ConfigListProps {
  configs: CrawlingConfig[];
  exportSelection: Record<string, boolean>;
  onSelectionChange: (id: string, selected: boolean) => void;
  onEdit: (config: CrawlingConfig) => void;
  onDelete: (id: string) => void;
}

export const ConfigList: React.FC<ConfigListProps> = ({
  configs,
  exportSelection,
  onSelectionChange,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation();

  if (configs.length === 0) {
    return (
      <div
        className="text-center py-10 rounded border border-dashed"
        style={{
          backgroundColor: 'var(--bg-tertiary)',
          color: 'var(--text-muted)',
          borderColor: 'var(--border-secondary)',
        }}
      >
        {t('options.crawlingConfigs.noConfigs')}
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {configs.map((config) => (
        <div
          key={config.id}
          className="flex items-center justify-between p-4 border rounded transition-colors"
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            borderColor: 'var(--border-primary)',
          }}
        >
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1"
              checked={!!exportSelection[config.id]}
              onChange={(e) => onSelectionChange(config.id, e.target.checked)}
            />
            <div>
              <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                {config.domain}
              </h3>
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {t('options.crawlingConfigs.updated')}:{' '}
                {new Date(config.lastUpdated).toLocaleDateString()}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(config)}
              className="p-2 rounded theme-button-secondary"
              style={{ color: 'var(--accent-primary)' }}
            >
              {t('options.crawlingConfigs.edit')}
            </button>
            <button
              onClick={() => onDelete(config.id)}
              className="p-2 rounded theme-button-secondary"
              style={{ color: 'var(--accent-danger)' }}
            >
              {t('options.crawlingConfigs.delete')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
