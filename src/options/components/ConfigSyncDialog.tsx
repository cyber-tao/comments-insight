import React from 'react';
import { useTranslation } from 'react-i18next';
import { API } from '@/config/constants';
import { ModalDialog } from '@/components/ModalDialog';

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
  const titleId = React.useId();

  return (
    <ModalDialog
      open={isOpen}
      onClose={onClose}
      ariaLabelledBy={titleId}
      className="w-full max-w-md"
    >
      <div className="p-6">
        <h3
          id={titleId}
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
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm theme-button-secondary"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-sm theme-button-primary"
          >
            {t('options.crawlingConfigs.syncDialogConfirm')}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
