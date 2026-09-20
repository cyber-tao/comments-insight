import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TIMING } from '@/config/constants';
import { Settings, SettingsPatch } from '@/types';
import { crawlingConfigsFingerprint } from '@/utils/crawling-config';
import { ExtensionError } from '@/utils/error-types';
import { changeLanguage } from '@/utils/i18n';
import { useToast } from '@/hooks/useToast';
import { Logger } from '@/utils/logger';
import { ExtensionAPI } from '@/utils/extension-api';

function mergePatch(previous: SettingsPatch, next: SettingsPatch): SettingsPatch {
  return {
    ...previous,
    ...next,
    ...(next.aiModel ? { aiModel: { ...previous.aiModel, ...next.aiModel } } : {}),
    ...(next.domAnalysisConfig
      ? { domAnalysisConfig: { ...previous.domAnalysisConfig, ...next.domAnalysisConfig } }
      : {}),
  };
}

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
  const pendingPatchRef = useRef<SettingsPatch>({});
  const rulesFingerprintRef = useRef('');
  const importGenerationRef = useRef(0);
  const importingRef = useRef(false);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
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
        rulesFingerprintRef.current = crawlingConfigsFingerprint(settings.crawlingConfigs);
        if (settings.language) {
          Logger.debug('[useSettings] Setting language to', {
            language: settings.language,
          });
          void changeLanguage(settings.language);
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
    if (!settings || isInitialLoad || !isUserChangeRef.current || importingRef.current) return;

    if (isSavingRef.current) {
      pendingSaveRef.current = true;
      return;
    }

    const generation = importGenerationRef.current;
    const saveSettings = async () => {
      if (generation !== importGenerationRef.current || importingRef.current) return;
      const revisionToSave = changeRevisionRef.current;
      const patch = pendingPatchRef.current;
      pendingPatchRef.current = {};
      isSavingRef.current = true;
      setSaving(true);

      try {
        const response = patch.crawlingConfigs
          ? await ExtensionAPI.saveSettings(patch, rulesFingerprintRef.current)
          : await ExtensionAPI.saveSettings(patch);

        if (!response?.success) {
          throw new Error(response?.error || tRef.current('options.savedError'));
        }

        savedRevisionRef.current = Math.max(savedRevisionRef.current, revisionToSave);
        if (patch.crawlingConfigs) {
          rulesFingerprintRef.current = crawlingConfigsFingerprint(patch.crawlingConfigs);
        }
        if (changeRevisionRef.current === revisionToSave) {
          toastRef.current.success(tRef.current('options.savedSuccess'));
          isUserChangeRef.current = false;
        } else {
          pendingSaveRef.current = true;
        }
      } catch (error) {
        pendingPatchRef.current = mergePatch(patch, pendingPatchRef.current);
        toastRef.current.error(
          error instanceof ExtensionError &&
            error.details?.messageKey === 'options.settingsConflict'
            ? tRef.current('options.settingsConflict')
            : tRef.current('options.savedError') +
                (error instanceof Error ? `: ${error.message}` : ''),
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

    const timeoutId = setTimeout(() => {
      saveInFlightRef.current = saveSettings();
    }, TIMING.DEBOUNCE_SAVE_MS);
    return () => clearTimeout(timeoutId);
  }, [settings, isInitialLoad, saveRequestSeq]);

  const handleSettingsChange = useCallback((newSettings: SettingsPatch) => {
    if (importingRef.current) return;
    const {
      selectorCache: _selectorCache,
      crawlingConfigValidationByDomain: _validation,
      disabledDefaultConfigDomains: _disabled,
      ...patch
    } = newSettings;
    isUserChangeRef.current = true;
    changeRevisionRef.current += 1;
    pendingPatchRef.current = mergePatch(pendingPatchRef.current, patch);
    setSettings((prev) => (prev ? (mergePatch(prev, patch) as Settings) : prev));
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
          importingRef.current = true;
          importGenerationRef.current += 1;
          await saveInFlightRef.current;
          await ExtensionAPI.importSettings(data);
          pendingPatchRef.current = {};
          pendingSaveRef.current = false;
          isUserChangeRef.current = false;
          savedRevisionRef.current = changeRevisionRef.current;
          await loadSettings({ force: true });
          toastRef.current.success(tRef.current('options.importedSuccess'));
        } catch (_error) {
          toastRef.current.error(tRef.current('options.importError'));
        } finally {
          importingRef.current = false;
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
