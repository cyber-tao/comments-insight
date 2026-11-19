import * as React from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

interface DynamicReportViewerProps {
  html: string;
  title?: string;
  resolvedTheme?: 'light' | 'dark';
  className?: string;
  style?: React.CSSProperties;
}

export const DynamicReportViewer: React.FC<DynamicReportViewerProps> = ({
  html,
  title,
  resolvedTheme,
  className,
  style,
}) => {
  const { t, i18n } = useTranslation();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const locale = i18n?.resolvedLanguage;
  const errorTitle = t('history.reportRenderFailed');
  const errorMessage = t('history.reportRenderRecovery');
  const effectiveTheme: 'light' | 'dark' =
    resolvedTheme ??
    (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light');
  const themeRef = useRef(effectiveTheme);
  themeRef.current = effectiveTheme;

  const postHtml = useCallback(() => {
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: 'RENDER_REPORT',
        html,
        locale,
        theme: themeRef.current,
        errorTitle,
        errorMessage,
      },
      '*',
    );
  }, [html, locale, errorTitle, errorMessage]);

  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'SET_THEME', theme: effectiveTheme },
      '*',
    );
  }, [effectiveTheme]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const handleMessage = (event: MessageEvent) => {
      if (event.source === iframe.contentWindow && event.data?.type === 'SANDBOX_READY') {
        postHtml();
      }
    };

    window.addEventListener('message', handleMessage);
    postHtml();

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [postHtml]);

  const sandboxUrl =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('src/sandbox/index.html')
      : 'src/sandbox/index.html';

  return (
    <iframe
      ref={iframeRef}
      title={title || t('history.dynamicReport')}
      src={sandboxUrl}
      sandbox="allow-scripts"
      onLoad={postHtml}
      className={className || 'w-full h-full border-none'}
      style={style}
    />
  );
};
