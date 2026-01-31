import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { PageInfo, PageStatus as PageStatusType } from '../hooks/usePageInfo';

interface PageStatusProps {
  pageInfo: PageInfo | null;
  pageStatus: PageStatusType;
}

export const PageStatus: React.FC<PageStatusProps> = ({ pageInfo, pageStatus }) => {
  const { t } = useTranslation();

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return t('popup.justNow');
    if (minutes < 60) return `${minutes}${t('popup.minutesAgo')}`;
    if (hours < 24) return `${hours}${t('popup.hoursAgo')}`;
    return `${days}${t('popup.daysAgo')}`;
  };

  return (
    <div
      className="p-4"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-primary)',
      }}
    >
      <div className="flex justify-between items-start mb-2">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {t('popup.currentPage')}
        </h2>
      </div>
      {pageInfo ? (
        <div className="space-y-2">
          <div className="text-sm mb-2">
            <span className="font-medium line-clamp-2" style={{ color: 'var(--text-primary)' }}>
              {pageInfo.title}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--text-muted)' }}>{t('popup.platform')}:</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {pageInfo.domain}
            </span>
          </div>

          <div className="flex items-center justify-between text-sm">
            <span style={{ color: 'var(--text-muted)' }}>{t('popup.status')}:</span>
            <span
              className="px-2 py-1 rounded text-xs font-medium"
              style={{
                backgroundColor: pageStatus.analyzed
                  ? 'rgba(16, 185, 129, 0.2)'
                  : pageStatus.extracted
                    ? 'rgba(59, 130, 246, 0.2)'
                    : 'var(--bg-tertiary)',
                color: pageStatus.analyzed
                  ? 'var(--accent-secondary)'
                  : pageStatus.extracted
                    ? 'var(--accent-primary)'
                    : 'var(--text-muted)',
              }}
            >
              {pageStatus.analyzed
                ? t('popup.analyzed')
                : pageStatus.extracted
                  ? t('popup.extracted')
                  : t('popup.notExtracted')}
            </span>
          </div>
          {pageStatus.extracted && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-muted)' }}>{t('popup.commentsCount')}:</span>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {pageStatus.commentsCount}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-muted)' }}>{t('popup.extractedAt')}:</span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {formatDate(pageStatus.extractedAt!)}
                </span>
              </div>
              {pageStatus.analyzed && pageStatus.analyzedAt && (
                <div className="flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--text-muted)' }}>{t('popup.analyzedAt')}:</span>
                  <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    {formatDate(pageStatus.analyzedAt)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="text-sm text-center py-2" style={{ color: 'var(--text-muted)' }}>
          {t('popup.invalidPage')}
        </div>
      )}
    </div>
  );
};
