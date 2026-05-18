import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/global.css';
import Options from './Options';
import { ErrorBoundary } from '@/components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Options />
    </ErrorBoundary>
  </React.StrictMode>,
);
