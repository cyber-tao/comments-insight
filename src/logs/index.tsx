import React from 'react';
import { createRoot } from 'react-dom/client';
import Logs from './Logs';
import '../utils/i18n';
import { ErrorBoundary } from '@/components/ErrorBoundary';

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
