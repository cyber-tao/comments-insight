import * as React from 'react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LIMITS, MESSAGES, STORAGE } from '@/config/constants';
import type { SelectorRule } from '@/types';

interface SelectorTestResult {
  success: boolean;
  total?: number;
  items?: string[];
  error?: string;
}

export const SelectorTester: React.FC = () => {
  const { t } = useTranslation();
  const [selector, setSelector] = useState('');
  const [selectorType, setSelectorType] = useState<SelectorRule['type']>('css');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const loadState = async () => {
      try {
        const stored = await chrome.storage.local.get(STORAGE.SELECTOR_TESTER_STATE_KEY);
        const state = stored?.[STORAGE.SELECTOR_TESTER_STATE_KEY] as
          | {
              selector?: string;
              selectorType?: SelectorRule['type'];
              results?: string[];
              total?: number | null;
            }
          | undefined;
        if (state) {
          if (typeof state.selector === 'string') {
            setSelector(state.selector);
          }
          if (state.selectorType === 'css' || state.selectorType === 'xpath') {
            setSelectorType(state.selectorType);
          }
          if (Array.isArray(state.results)) {
            setResults(state.results);
          }
          if (typeof state.total === 'number' || state.total === null) {
            setTotal(state.total ?? null);
          }
        }
      } finally {
        setHydrated(true);
      }
    };

    loadState();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload = {
      selector,
      selectorType,
      results,
      total,
    };
    chrome.storage.local.set({ [STORAGE.SELECTOR_TESTER_STATE_KEY]: payload });
  }, [hydrated, selector, selectorType, results, total]);

  const handleTest = async () => {
    if (loading) return;
    const trimmed = selector.trim();
    if (!trimmed) {
      setSelector('');
      setSelectorType('css');
      setResults([]);
      setTotal(null);
      setError(null);
      await chrome.storage.local.remove(STORAGE.SELECTOR_TESTER_STATE_KEY);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: MESSAGES.TEST_SELECTOR,
        payload: { selector: trimmed, selectorType },
      })) as SelectorTestResult | undefined;

      if (response?.success) {
        setResults(response.items || []);
        setTotal(typeof response.total === 'number' ? response.total : response.items?.length || 0);
        return;
      }

      setResults([]);
      setTotal(null);
      setError(response?.error || t('popup.selectorTesterFailed'));
    } catch (err) {
      setResults([]);
      setTotal(null);
      setError(err instanceof Error ? err.message : t('popup.selectorTesterFailed'));
    } finally {
      setLoading(false);
    }
  };

  const showEmpty = total === 0 && !loading;
  const showResults = results.length > 0;
  const showTruncated = typeof total === 'number' && total > results.length && results.length > 0;

  return (
    <div
      className="p-4"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderTop: '1px solid var(--border-primary)',
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {t('popup.selectorTesterTitle')}
        </h3>
      </div>
      <div className="space-y-2">
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-2 py-1 rounded text-sm theme-input"
            placeholder={t('popup.selectorTesterPlaceholder')}
            value={selector}
            onChange={(e) => setSelector(e.target.value)}
            maxLength={LIMITS.SELECTOR_TEST_MAX_QUERY_LENGTH}
          />
          <select
            className="px-2 py-1 rounded text-sm theme-input"
            value={selectorType}
            onChange={(e) => setSelectorType(e.target.value as SelectorRule['type'])}
          >
            <option value="css">{t('popup.selectorTypeCss')}</option>
            <option value="xpath">{t('popup.selectorTypeXpath')}</option>
          </select>
          <button
            className="px-3 py-1 text-sm rounded text-white disabled:opacity-50 transition-colors"
            style={{ backgroundColor: 'var(--accent-primary)' }}
            onClick={handleTest}
            disabled={loading}
          >
            {loading ? t('popup.selectorTesterTesting') : t('popup.selectorTesterButton')}
          </button>
        </div>

        {typeof total === 'number' && (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('popup.selectorTesterMatches', { count: total })}
          </div>
        )}

        {showTruncated && (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('popup.selectorTesterTruncated', { count: LIMITS.SELECTOR_TEST_MAX_RESULTS })}
          </div>
        )}

        {error && (
          <div className="text-xs" style={{ color: 'var(--accent-danger)' }}>
            {error}
          </div>
        )}

        {showEmpty && !error && (
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('popup.selectorTesterNoResults')}
          </div>
        )}

        {showResults && (
          <ul
            className="max-h-40 overflow-y-auto rounded text-xs"
            style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-primary)',
              color: 'var(--text-secondary)',
            }}
          >
            {results.map((item, index) => (
              <li
                key={index}
                className="flex items-start gap-2 px-3 py-2"
                style={{ borderBottom: '1px solid var(--border-primary)' }}
              >
                <span
                  className="mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold"
                  style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    color: 'var(--accent-primary)',
                  }}
                >
                  {index + 1}
                </span>
                <span className="flex-1 break-words">
                  {item || t('popup.selectorTesterEmptyItem')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
