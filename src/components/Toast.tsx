import * as React from 'react';
import { useEffect } from 'react';
import { TIMING } from '@/config/constants';

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
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const getTypeStyles = () => {
    switch (type) {
      case 'success':
        return 'bg-green-500 text-white';
      case 'error':
        return 'bg-red-500 text-white';
      case 'warning':
        return 'bg-yellow-500 text-white';
      case 'info':
        return 'bg-blue-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      case 'info':
        return 'ℹ';
      default:
        return '';
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={`px-6 py-3 rounded-lg shadow-lg flex items-center gap-3 animate-slide-in ${getTypeStyles()}`}
      style={{
        animation: 'slideIn 0.3s ease-out',
        minWidth: '300px',
        maxWidth: '500px',
      }}
    >
      <span className="text-xl font-bold">{getIcon()}</span>
      <span className="flex-1">{message}</span>
      <button
        onClick={onClose}
        className="text-white hover:opacity-80 font-bold text-lg"
        aria-label="Close"
      >
        ×
      </button>
    </div>
  );
};

export default Toast;
