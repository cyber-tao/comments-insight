import React from 'react';
import { createRoot } from 'react-dom/client';
import Logs from './Logs';
import '../utils/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';

// Suppress benign ResizeObserver error commonly caused by virtua in Chrome extensions
window.addEventListener('error', (e) => {
  if (e.message === 'ResizeObserver loop completed with undelivered notifications.') {
    e.stopImmediatePropagation();
  }
});

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        <Logs />
      </ErrorBoundary>
    </React.StrictMode>,
  );
} else {
  console.error('Failed to find root element');
}
