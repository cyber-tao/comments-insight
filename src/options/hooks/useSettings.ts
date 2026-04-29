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
  const hasLoadedRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const changeRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  const [saveRequestSeq, setSaveRequestSeq] = useState(0);

  useEffect(() => {
    tRef.current = t;
  }, [t]);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const loadSettings = useCallback(async (options?: { force?: boolean }) => {
    try {
      const settings = await ExtensionAPI.getSettings();
      Logger.debug('[useSettings] Settings response', { settings });

      if (settings) {
        if (!options?.force && (isUserChangeRef.current || isSavingRef.current)) return;
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
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void loadSettings();
  }, [loadSettings]);

  // Auto-save settings when they change
  useEffect(() => {
    if (!settings || isInitialLoad || !isUserChangeRef.current) return;

    if (isSavingRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    const saveSettings = async () => {
      const revisionToSave = changeRevisionRef.current;
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

        savedRevisionRef.current = Math.max(savedRevisionRef.current, revisionToSave);
        if (changeRevisionRef.current === revisionToSave) {
          toastRef.current.success(tRef.current('options.savedSuccess'));
          isUserChangeRef.current = false;
        } else {
          pendingSaveRef.current = true;
        }
      } catch (error) {
        toastRef.current.error(
          tRef.current('options.savedError') + (error instanceof Error ? `: ${error.message}` : ''),
        );
      } finally {
        setSaving(false);
        isSavingRef.current = false;
        if (pendingSaveRef.current && changeRevisionRef.current > savedRevisionRef.current) {
          pendingSaveRef.current = false;
          setSaveRequestSeq((value) => value + 1);
        }
      }
    };

    const timeoutId = setTimeout(saveSettings, TIMING.DEBOUNCE_SAVE_MS);
    return () => clearTimeout(timeoutId);
  }, [settings, isInitialLoad, saveRequestSeq]);

  const handleSettingsChange = useCallback((newSettings: Partial<Settings>) => {
    isUserChangeRef.current = true;
    changeRevisionRef.current += 1;
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
          if (typeof data !== 'string' || data.trim().length === 0) {
            toastRef.current.error(tRef.current('options.importError'));
            return;
          }
          await ExtensionAPI.importSettings(data);
          pendingSaveRef.current = false;
          isUserChangeRef.current = false;
          savedRevisionRef.current = changeRevisionRef.current;
          await loadSettings({ force: true });
          toastRef.current.success(tRef.current('options.importedSuccess'));
        } catch (_error) {
          toastRef.current.error(tRef.current('options.importError'));
        }
      };
      reader.readAsText(file);
    },
    [loadSettings],
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
