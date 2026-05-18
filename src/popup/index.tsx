import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/global.css';
import '../utils/i18n'; // Initialize i18n
import Popup from './Popup';
import { ErrorBoundary } from '@/components/ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <Popup />
    </ErrorBoundary>
  </React.StrictMode>,
);
