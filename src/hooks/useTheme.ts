import { useState, useEffect, useCallback } from 'react';
import { THEME } from '@/config/constants';
import { ExtensionAPI } from '@/utils/extension-api';

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
    let cancelled = false;

    const loadTheme = async () => {
      try {
        const settings = await ExtensionAPI.getSettings();
        const savedTheme = (settings?.theme as ThemeMode | undefined) || THEME.DEFAULT;
        if (cancelled) {
          return;
        }
        setTheme(savedTheme);
        applyTheme(savedTheme);
      } catch {
        if (!cancelled) {
          applyTheme(THEME.DEFAULT);
        }
      }
    };

    void loadTheme();

    return () => {
      cancelled = true;
    };
  }, [applyTheme]);

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
