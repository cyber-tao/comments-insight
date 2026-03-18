import React from 'react';
import { useTranslation } from 'react-i18next';
import { API } from '@/config/constants';

interface ConfigSyncDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export const ConfigSyncDialog: React.FC<ConfigSyncDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="rounded-lg shadow-lg w-full max-w-md p-6"
        style={{ backgroundColor: 'var(--bg-card)' }}
      >
        <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          {t('options.crawlingConfigs.syncDialogTitle')}
        </h3>
        <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
          {t('options.crawlingConfigs.syncDialogDescription')}
        </p>
        <div className="mb-4">
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            {t('options.crawlingConfigs.syncDialogSourceUrl')}
          </div>
          <div
            className="text-xs break-all p-2 rounded border"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              borderColor: 'var(--border-primary)',
            }}
          >
            <a
              href={API.CRAWLING_CONFIGS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="theme-link"
            >
              {API.CRAWLING_CONFIGS_URL}
            </a>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded theme-button-secondary">
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm rounded text-white"
            style={{ backgroundColor: '#8b5cf6' }}
          >
            {t('options.crawlingConfigs.syncDialogConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
