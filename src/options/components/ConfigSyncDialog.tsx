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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[1px]">
      <div
        className="rounded-xl shadow-lg w-full max-w-md p-6"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-primary)',
        }}
      >
        <h3
          className="text-lg font-bold mb-3 font-serif-editorial"
          style={{ color: 'var(--text-primary)' }}
        >
          {t('options.crawlingConfigs.syncDialogTitle')}
        </h3>
        <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {t('options.crawlingConfigs.syncDialogDescription')}
        </p>
        <div className="mb-5">
          <div className="text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
            {t('options.crawlingConfigs.syncDialogSourceUrl')}
          </div>
          <div
            className="text-xs font-mono-code break-all p-2.5 rounded-lg border"
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
        <div className="flex justify-end gap-2.5">
          <button onClick={onClose} className="px-4 py-2 text-sm theme-button-secondary">
            {t('common.cancel')}
          </button>
          <button onClick={onConfirm} className="px-4 py-2 text-sm theme-button-primary">
            {t('options.crawlingConfigs.syncDialogConfirm')}
          </button>
        </div>
      </div>
    </div>
  );
};
