import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MESSAGES, TIMING } from '@/config/constants';
import { Settings } from '@/types';
import i18n from '@/utils/i18n';
import { useToast } from '@/hooks/useToast';
import { Logger } from '@/utils/logger';

export function useSettings() {
  const { t } = useTranslation();
  const toast = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const isSavingRef = useRef(false);
  const isUserChangeRef = useRef(false);

  // Load settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: MESSAGES.GET_SETTINGS });
        Logger.debug('[useSettings] Settings response', { response });

        if (chrome.runtime.lastError) {
          Logger.error('[useSettings] Runtime error', { error: chrome.runtime.lastError });
          toast.error(
            t('options.loadSettingsError', { message: chrome.runtime.lastError.message }),
          );
          return;
        }

        if (response?.settings) {
          setSettings(response.settings);
          if (response.settings.language) {
            Logger.debug('[useSettings] Setting language to', {
              language: response.settings.language,
            });
            i18n.changeLanguage(response.settings.language);
          }
          setTimeout(() => setIsInitialLoad(false), TIMING.MICRO_WAIT_MS);
        } else {
          Logger.error('[useSettings] No settings in response', { response });
          toast.error(t('options.loadSettingsInvalid'));
        }
      } catch (error) {
        Logger.error('[useSettings] Failed to load settings', { error });
        toast.error(
          t('options.loadSettingsError', {
            message: error instanceof Error ? error.message : 'Unknown error',
          }),
        );
      }
    };

    loadSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save settings when they change
  useEffect(() => {
    if (!settings || isInitialLoad || isSavingRef.current) return;

    const saveSettings = async () => {
      isSavingRef.current = true;
      setSaving(true);

      try {
        const { selectorCache: _selectorCache, ...settingsToSave } = settings as Settings & {
          selectorCache?: Settings['selectorCache'];
        };
        await chrome.runtime.sendMessage({
          type: MESSAGES.SAVE_SETTINGS,
          payload: { settings: settingsToSave },
        });

        if (isUserChangeRef.current) {
          toast.success(t('options.savedSuccess'));
          isUserChangeRef.current = false;
        }
      } catch {
        toast.error(t('options.savedError'));
      } finally {
        setSaving(false);
        isSavingRef.current = false;
      }
    };

    const timeoutId = setTimeout(saveSettings, TIMING.DEBOUNCE_SAVE_MS);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, isInitialLoad]);

  const handleSettingsChange = useCallback((newSettings: Partial<Settings>) => {
    isUserChangeRef.current = true;
    setSettings((prev) => (prev ? { ...prev, ...newSettings } : prev));
  }, []);

  const handleExport = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGES.EXPORT_DATA,
        payload: { type: 'settings' },
      });

      if (response?.data) {
        const blob = new Blob([response.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `comments-insight-settings-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(t('options.exportSettings') + ' ' + t('common.save'));
      }
    } catch (_error) {
      toast.error(t('options.exportError'));
    }
  }, [t, toast]);

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
            toast.error(t('options.importError'));
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
          toast.success(t('options.importedSuccess'));
        } catch (_error) {
          toast.error(t('options.importError'));
        }
      };
      reader.readAsText(file);
    },
    [t, toast],
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
