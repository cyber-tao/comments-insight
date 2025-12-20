import * as React from 'react';
import { useTranslation } from 'react-i18next';
import type { PageInfo, PageStatus as PageStatusType, SiteAccessInfo } from '../hooks/usePageInfo';

interface PageStatusProps {
  pageInfo: PageInfo | null;
  pageStatus: PageStatusType;
  siteAccessInfo: SiteAccessInfo;
}

export const PageStatus: React.FC<PageStatusProps> = ({ pageInfo, pageStatus, siteAccessInfo }) => {
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
    <div className="p-4 bg-white border-b">
      <div className="flex justify-between items-start mb-2">
        <h2 className="text-sm font-semibold text-gray-700">{t('popup.currentPage')}</h2>
      </div>
      {pageInfo ? (
        <div className="space-y-2">
          <div className="text-sm mb-2">
            <span className="font-medium text-gray-800 line-clamp-2">{pageInfo.title}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">{t('popup.platform')}:</span>
            <span className="font-medium">{pageInfo.domain}</span>
          </div>

          {siteAccessInfo.sitePattern && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{t('popup.siteAccess')}:</span>
              <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-800">
                {siteAccessInfo.isRequired
                  ? t('popup.siteAccessStatusRequired')
                  : siteAccessInfo.hasSiteAccess
                    ? t('popup.siteAccessStatusGranted')
                    : t('popup.siteAccessStatusNotGranted')}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-600">{t('popup.status')}:</span>
            <span
              className={`px-2 py-1 rounded text-xs font-medium ${
                pageStatus.analyzed
                  ? 'bg-green-100 text-green-700'
                  : pageStatus.extracted
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-700'
              }`}
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
                <span className="text-gray-600">{t('popup.commentsCount')}:</span>
                <span className="font-medium">{pageStatus.commentsCount}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">{t('popup.extractedAt')}:</span>
                <span className="text-gray-500 text-xs">{formatDate(pageStatus.extractedAt!)}</span>
              </div>
              {pageStatus.analyzed && pageStatus.analyzedAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">{t('popup.analyzedAt')}:</span>
                  <span className="text-gray-500 text-xs">{formatDate(pageStatus.analyzedAt)}</span>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="text-sm text-gray-500 text-center py-2">{t('popup.invalidPage')}</div>
      )}
    </div>
  );
};
