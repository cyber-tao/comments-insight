import React from 'react';
import { useTranslation } from 'react-i18next';
import { CrawlingConfig } from '../../types';
import { GlobeIcon, TrashIcon } from '@/components/Icons';

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
  const { t, i18n } = useTranslation();

  if (configs.length === 0) {
    return (
      <div
        className="text-center py-10 rounded-xl border border-dashed text-sm"
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
    <div className="grid gap-3">
      {configs.map((config) => (
        <div
          key={config.id}
          className="flex items-center justify-between p-4 border rounded-xl transition-colors"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            borderColor: 'var(--border-primary)',
          }}
        >
          <div className="flex items-start gap-3">
            <input
              type="checkbox"
              aria-label={t('options.crawlingConfigs.selectForExport', { domain: config.domain })}
              className="mt-1 h-4 w-4 rounded"
              checked={!!exportSelection[config.id]}
              onChange={(e) => onSelectionChange(config.id, e.target.checked)}
            />
            <div>
              <h3
                className="font-semibold text-sm font-mono-code inline-flex items-center gap-1.5"
                style={{ color: 'var(--text-primary)' }}
              >
                <GlobeIcon size={13} style={{ color: 'var(--accent-primary)' }} />
                {config.domain}
              </h3>
              <div className="text-xs mt-1 tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {t('options.crawlingConfigs.updated')}:{' '}
                {new Date(config.lastUpdated).toLocaleDateString(i18n?.resolvedLanguage)}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onEdit(config)}
              className="px-3 py-1.5 text-xs rounded-lg theme-button-secondary"
              style={{ color: 'var(--accent-primary)' }}
            >
              {t('options.crawlingConfigs.edit')}
            </button>
            <button
              onClick={() => onDelete(config.id)}
              className="px-3 py-1.5 text-xs rounded-lg theme-button-danger inline-flex items-center gap-1"
            >
              <TrashIcon size={13} />
              {t('options.crawlingConfigs.delete')}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
};
