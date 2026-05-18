import * as React from 'react';
import { Logger } from '@/utils/logger';

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
            className="max-w-md w-full p-6 rounded-xl shadow-lg"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <h2 className="text-xl font-bold mb-4" style={{ color: 'var(--accent-danger)' }}>
              Something went wrong
            </h2>
            <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
              An unexpected error occurred. Please try refreshing the page.
            </p>
            {this.state.error && (
              <pre
                className="p-3 rounded text-sm overflow-auto max-h-40"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)',
                }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 rounded-lg text-white font-medium transition-all hover:scale-105"
              style={{ background: 'var(--gradient-primary)' }}
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
