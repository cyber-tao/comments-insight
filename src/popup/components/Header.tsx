import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { BrandIcon, SettingsIcon, TerminalIcon } from '@/components/Icons';

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
    <div
      className="px-4 py-3.5"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderBottom: '1px solid var(--border-primary)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BrandIcon size={28} />
            <h1
              className="text-base font-bold tracking-tight truncate font-serif-editorial"
              style={{ color: 'var(--text-primary)' }}
            >
              {t('popup.title')}
            </h1>
            {version && (
              <span
                className="text-[11px] font-mono-code px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: 'var(--bg-tertiary)',
                  color: 'var(--text-muted)',
                }}
              >
                {t('popup.version')} {version}
              </span>
            )}
          </div>
          {aiModelName && (
            <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: 'var(--accent-primary)' }}
              />
              <span style={{ color: 'var(--text-tertiary)' }}>{t('options.model')}:</span>
              <span
                className="font-mono-code font-medium truncate max-w-[190px]"
                style={{ color: 'var(--text-primary)' }}
              >
                {aiModelName}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {developerMode && (
            <button
              onClick={onOpenLogs}
              className="p-1.5 rounded-lg transition-colors border border-transparent hover:border-[var(--border-primary)] hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-secondary)' }}
              aria-label={t('popup.viewLogs')}
              title={t('popup.viewLogs')}
            >
              <TerminalIcon size={17} />
            </button>
          )}
          <a
            href="https://github.com/cyber-tao/comments-insight"
            target="_blank"
            rel="noopener noreferrer"
            className="p-1.5 rounded-lg transition-colors border border-transparent hover:border-[var(--border-primary)] hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-secondary)' }}
            title="GitHub"
            aria-label={t('popup.viewGitHub')}
          >
            <svg className="w-[17px] h-[17px] fill-current" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.042-1.416-4.042-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
            </svg>
          </a>
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg transition-colors border border-transparent hover:border-[var(--border-primary)] hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-secondary)' }}
            aria-label={t('popup.settings')}
            title={t('popup.settings')}
          >
            <SettingsIcon size={17} />
          </button>
        </div>
      </div>
    </div>
  );
};
