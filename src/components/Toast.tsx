import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
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
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const remainingMsRef = useRef(duration);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = useRef(false);
  const focusedRef = useRef(false);

  const clearDismissTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (startedAtRef.current !== null) {
      const elapsed = Date.now() - startedAtRef.current;
      remainingMsRef.current = Math.max(0, remainingMsRef.current - elapsed);
      startedAtRef.current = null;
    }
  }, []);

  const startDismissTimer = useCallback(() => {
    if (hoveredRef.current || focusedRef.current || timerRef.current !== null) {
      return;
    }
    startedAtRef.current = Date.now();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      startedAtRef.current = null;
      onCloseRef.current();
    }, remainingMsRef.current);
  }, []);

  useEffect(() => {
    clearDismissTimer();
    remainingMsRef.current = duration;
    startDismissTimer();
    return clearDismissTimer;
  }, [duration, clearDismissTimer, startDismissTimer]);

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
  const isError = type === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      aria-atomic="true"
      onMouseEnter={() => {
        hoveredRef.current = true;
        clearDismissTimer();
      }}
      onMouseLeave={() => {
        hoveredRef.current = false;
        startDismissTimer();
      }}
      onFocus={() => {
        focusedRef.current = true;
        clearDismissTimer();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          focusedRef.current = false;
          startDismissTimer();
        }
      }}
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
        type="button"
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
