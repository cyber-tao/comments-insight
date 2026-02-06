import { useState, useEffect, useCallback } from 'react';
import { THEME, MESSAGES } from '@/config/constants';

type ThemeMode = 'light' | 'dark' | 'system';

export function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>(THEME.DEFAULT);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  const applyTheme = useCallback((mode: ThemeMode) => {
    let effectiveTheme: 'light' | 'dark';

    if (mode === 'system') {
      effectiveTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      effectiveTheme = mode;
    }

    setResolvedTheme(effectiveTheme);

    if (effectiveTheme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, []);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS }, (response) => {
      if (response?.settings?.theme) {
        const savedTheme = response.settings.theme as ThemeMode;
        setTheme(savedTheme);
        applyTheme(savedTheme);
      } else {
        applyTheme(theme);
      }
    });
  }, [applyTheme, theme]);

  useEffect(() => {
    if (theme !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyTheme('system');

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [theme, applyTheme]);

  const updateTheme = useCallback(
    (newTheme: ThemeMode) => {
      setTheme(newTheme);
      applyTheme(newTheme);
    },
    [applyTheme],
  );

  return {
    theme,
    resolvedTheme,
    setTheme: updateTheme,
    isDark: resolvedTheme === 'dark',
  };
}
