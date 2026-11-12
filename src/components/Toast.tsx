import * as React from 'react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TIMING } from '@/config/constants';
import { AlertTriangleIcon, CheckIcon, InfoIcon, XIcon } from '@/components/Icons';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastProps {
  message: string;
  type: ToastType;
  duration?: number;
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({
  message,
  type,
  duration = TIMING.TOAST_DEFAULT_DURATION_MS,
  onClose,
}) => {
  const { t } = useTranslation();
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getAccentColor = (): string => {
    switch (type) {
      case 'success':
        return 'var(--accent-success)';
      case 'error':
        return 'var(--accent-danger)';
      case 'warning':
        return 'var(--accent-warning)';
      case 'info':
      default:
        return 'var(--accent-primary)';
    }
  };

  const getIcon = (): React.ReactNode => {
    switch (type) {
      case 'success':
        return <CheckIcon size={18} />;
      case 'error':
        return <XIcon size={18} />;
      case 'warning':
        return <AlertTriangleIcon size={18} />;
      case 'info':
      default:
        return <InfoIcon size={18} />;
    }
  };

  const accentColor = getAccentColor();

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="px-4 py-3 rounded-lg flex items-center gap-3 animate-slide-in"
      style={{
        backgroundColor: 'var(--bg-card)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-primary)',
        borderLeft: `4px solid ${accentColor}`,
        boxShadow: 'var(--shadow-lg)',
        minWidth: '300px',
        maxWidth: '480px',
      }}
    >
      <span className="flex items-center justify-center shrink-0" style={{ color: accentColor }}>
        {getIcon()}
      </span>
      <span className="flex-1 text-sm font-medium leading-snug">{message}</span>
      <button
        onClick={onClose}
        className="p-1 rounded transition-colors hover:bg-[var(--bg-hover)]"
        style={{ color: 'var(--text-tertiary)' }}
        aria-label={t('common.close')}
      >
        <XIcon size={15} />
      </button>
    </div>
  );
};

export default Toast;
