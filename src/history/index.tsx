import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/global.css';
import History from './History';
import { ErrorBoundary } from '@/components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <History />
    </ErrorBoundary>
  </React.StrictMode>,
);
