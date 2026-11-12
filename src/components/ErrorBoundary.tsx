import * as React from 'react';
import { Logger } from '@/utils/logger';
import i18n from '@/utils/i18n';
import { AlertTriangleIcon, RefreshIcon } from '@/components/Icons';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    Logger.error('[ErrorBoundary] UI rendering error', { error, errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          className="flex flex-col items-center justify-center min-h-screen p-6"
          style={{ backgroundColor: 'var(--bg-secondary)' }}
        >
          <div
            className="max-w-md w-full p-6 rounded-xl"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-primary)',
              boxShadow: 'var(--shadow-md)',
            }}
          >
            <div className="flex items-center gap-2.5 mb-3">
              <AlertTriangleIcon size={20} style={{ color: 'var(--accent-danger)' }} />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                {i18n.t('errors.renderFailed')}
              </h2>
            </div>
            <p className="mb-4 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {i18n.t('errors.renderRecovery')}
            </p>
            {this.state.error && (
              <pre
                className="p-3 rounded-lg text-xs overflow-auto max-h-40 font-mono-code"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-primary)',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="mt-4 theme-button-primary inline-flex items-center gap-2 text-sm"
            >
              <RefreshIcon size={15} />
              {i18n.t('common.reloadPage')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
