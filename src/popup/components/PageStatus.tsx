import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { TIMING } from '@/config/constants';
import { AlertTriangleIcon, CheckIcon } from '@/components/Icons';
import type { PageInfo, PageStatus as PageStatusType } from '../hooks/usePageInfo';

export interface PageStatusProps {
  pageInfo: PageInfo | null;
  pageStatus: PageStatusType;
}

export const PageStatus: React.FC<PageStatusProps> = ({ pageInfo, pageStatus }) => {
  const { t } = useTranslation();

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / TIMING.MS_PER_MINUTE);
    const hours = Math.floor(diff / TIMING.MS_PER_HOUR);
    const days = Math.floor(diff / TIMING.MS_PER_DAY);

    if (minutes < 1) return t('popup.justNow');
    if (minutes < 60) return `${minutes}${t('popup.minutesAgo')}`;
    if (hours < 24) return `${hours}${t('popup.hoursAgo')}`;
    return `${days}${t('popup.daysAgo')}`;
  };

  return (
    <div className="px-4 pt-3.5 pb-1">
      <div
        className="rounded-xl p-3.5"
        style={{
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border-primary)',
          boxShadow: 'var(--shadow-sm)',
        }}
      >
        <div className="flex justify-between items-center mb-2">
          <h2
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('popup.currentPage')}
          </h2>
          {pageInfo && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
              style={{
                backgroundColor: pageStatus.analyzed
                  ? 'var(--accent-primary-soft)'
                  : pageStatus.extracted
                    ? 'var(--accent-secondary-soft)'
                    : 'var(--bg-tertiary)',
                color: pageStatus.analyzed
                  ? 'var(--accent-primary)'
                  : pageStatus.extracted
                    ? 'var(--accent-secondary)'
                    : 'var(--text-muted)',
              }}
            >
              {pageStatus.analyzed ? (
                <CheckIcon size={12} />
              ) : pageStatus.extracted ? (
                <CheckIcon size={12} />
              ) : (
                <AlertTriangleIcon size={12} />
              )}
              {pageStatus.analyzed
                ? t('popup.analyzed')
                : pageStatus.extracted
                  ? t('popup.extracted')
                  : t('popup.notExtracted')}
            </span>
          )}
        </div>

        {pageInfo ? (
          <div className="space-y-2.5">
            <div className="text-sm">
              <span
                className="font-semibold line-clamp-2 leading-snug"
                style={{ color: 'var(--text-primary)' }}
              >
                {pageInfo.title}
              </span>
            </div>

            <div
              className="pt-2.5 space-y-1.5 text-xs"
              style={{ borderTop: '1px solid var(--border-primary)' }}
            >
              <div className="flex items-center justify-between">
                <span style={{ color: 'var(--text-muted)' }}>{t('popup.platform')}:</span>
                <span
                  className="font-mono-code font-medium"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {pageInfo.domain}
                </span>
              </div>

              {pageStatus.extracted && (
                <>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>{t('popup.commentsCount')}:</span>
                    <span
                      className="font-mono-code font-semibold tabular-nums"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {pageStatus.commentsCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span style={{ color: 'var(--text-muted)' }}>{t('popup.extractedAt')}:</span>
                    <span className="tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDate(pageStatus.extractedAt!)}
                    </span>
                  </div>
                  {pageStatus.analyzed && pageStatus.analyzedAt && (
                    <div className="flex items-center justify-between">
                      <span style={{ color: 'var(--text-muted)' }}>{t('popup.analyzedAt')}:</span>
                      <span className="tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                        {formatDate(pageStatus.analyzedAt)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="text-sm text-center py-3" style={{ color: 'var(--text-muted)' }}>
            {t('popup.invalidPage')}
          </div>
        )}
      </div>
    </div>
  );
};
