import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TIMING } from '@/config/constants';
import { Settings } from '@/types';
import i18n from '@/utils/i18n';
import { useToast } from '@/hooks/useToast';
import { Logger } from '@/utils/logger';
import { ExtensionAPI } from '@/utils/extension-api';

export function useSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const isSavingRef = useRef(false);
  const isUserChangeRef = useRef(false);
  const tRef = useRef(t);
  const toastRef = useRef(toast);

  useEffect(() => {
    tRef.current = t;
    toastRef.current = toast;
  }, [t, toast]);

  const loadSettings = useCallback(async () => {
    try {
      const settings = await ExtensionAPI.getSettings();
      Logger.debug('[useSettings] Settings response', { settings });

      if (settings) {
        setSettings(settings);
        if (settings.language) {
          Logger.debug('[useSettings] Setting language to', {
            language: settings.language,
          });
          i18n.changeLanguage(settings.language);
        }
        setTimeout(() => setIsInitialLoad(false), TIMING.MICRO_WAIT_MS);
      } else {
        Logger.error('[useSettings] No settings in response');
        toastRef.current.error(tRef.current('options.loadSettingsInvalid'));
      }
    } catch (error) {
      Logger.error('[useSettings] Failed to load settings', { error });
      toastRef.current.error(
        tRef.current('options.loadSettingsError', {
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    }
  }, []);

  // Load settings on mount
  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  // Auto-save settings when they change
  useEffect(() => {
    if (!settings || isInitialLoad || isSavingRef.current || !isUserChangeRef.current) return;

    const saveSettings = async () => {
      isSavingRef.current = true;
      setSaving(true);

      try {
        const { selectorCache: _selectorCache, ...settingsToSave } = settings as Settings & {
          selectorCache?: Settings['selectorCache'];
        };
        const response = await ExtensionAPI.saveSettings(settingsToSave);

        if (!response?.success) {
          throw new Error(response?.error || tRef.current('options.savedError'));
        }

        if (isUserChangeRef.current) {
          toastRef.current.success(tRef.current('options.savedSuccess'));
          isUserChangeRef.current = false;
        }
      } catch (error) {
        toastRef.current.error(
          tRef.current('options.savedError') + (error instanceof Error ? `: ${error.message}` : ''),
        );
      } finally {
        setSaving(false);
        isSavingRef.current = false;
      }
    };

    const timeoutId = setTimeout(saveSettings, TIMING.DEBOUNCE_SAVE_MS);
    return () => clearTimeout(timeoutId);
  }, [settings, isInitialLoad]);

  const handleSettingsChange = useCallback((newSettings: Partial<Settings>) => {
    isUserChangeRef.current = true;
    setSettings((prev) => (prev ? { ...prev, ...newSettings } : prev));
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const data = await ExtensionAPI.exportSettings();

      if (data) {
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comments-insight-settings-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toastRef.current.success(
          tRef.current('options.exportSettings') + ' ' + tRef.current('common.save'),
        );
      }
    } catch (_error) {
      toastRef.current.error(tRef.current('options.exportError'));
    }
  }, []);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const data = event.target?.result as string;
          const imported = JSON.parse(data);
          if (typeof imported !== 'object' || imported === null || Array.isArray(imported)) {
            toastRef.current.error(tRef.current('options.importError'));
            return;
          }
          setSettings((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              ...imported,
              crawlingConfigs: prev.crawlingConfigs,
              selectorCache: prev.selectorCache,
            };
          });
          toastRef.current.success(tRef.current('options.importedSuccess'));
        } catch (_error) {
          toastRef.current.error(tRef.current('options.importError'));
        }
      };
      reader.readAsText(file);
    },
    [],
  );

  return {
    settings,
    saving,
    handleSettingsChange,
    handleExport,
    handleImport,
    toast,
    ToastContainer: toast.ToastContainer,
  };
}
