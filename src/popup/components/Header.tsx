import * as React from 'react';
import { useTranslation } from 'react-i18next';

interface HeaderProps {
  version: string;
  aiModelName: string;
  developerMode: boolean;
  onOpenSettings: () => void;
  onOpenLogs: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  version,
  aiModelName,
  developerMode,
  onOpenSettings,
  onOpenLogs,
}) => {
  const { t } = useTranslation();

  return (
    <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t('popup.title')}</h1>
          <div className="flex flex-col gap-1">
            <p className="text-xs opacity-90">
              {t('popup.version')} {version}
            </p>
            {aiModelName && (
              <div className="flex items-center text-xs opacity-90 bg-white/20 px-2 py-0.5 rounded w-fit mt-1">
                <span className="mr-1">🤖</span>
                <span>
                  {t('options.model')}: {aiModelName}
                </span>
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {developerMode && (
            <button
              onClick={onOpenLogs}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors"
              title={t('popup.viewAILogs')}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </button>
          )}
          <button
            onClick={onOpenSettings}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
            title={t('popup.settings')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};
