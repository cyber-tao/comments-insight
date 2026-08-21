import * as React from 'react';
import { useEffect, useRef } from 'react';

interface DynamicReportViewerProps {
  html: string;
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const DynamicReportViewer: React.FC<DynamicReportViewerProps> = ({
  html,
  title,
  className,
  style,
}) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const postHtml = () => {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage(
          {
            type: 'RENDER_REPORT',
            html,
          },
          '*',
        );
      }
    };

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
  }, [html]);

  const sandboxUrl =
    typeof chrome !== 'undefined' && chrome.runtime?.getURL
      ? chrome.runtime.getURL('src/sandbox/index.html')
      : 'src/sandbox/index.html';

  return (
    <iframe
      ref={iframeRef}
      title={title || 'Dynamic Analysis Report'}
      src={sandboxUrl}
      sandbox="allow-scripts"
      onLoad={() => {
        if (iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage(
            {
              type: 'RENDER_REPORT',
              html,
            },
            '*',
          );
        }
      }}
      className={className || 'w-full h-full border-none'}
      style={style}
    />
  );
};
