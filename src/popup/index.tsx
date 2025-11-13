import React from 'react';
import ReactDOM from 'react-dom/client';
import '../styles/global.css';
import '../utils/i18n'; // Initialize i18n
import Popup from './Popup';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
