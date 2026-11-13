import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { AI, STORAGE, TIMING } from '@/config/constants';
import { AIProtocol, Settings, SettingsPatch } from '@/types';
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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasExternalConflict, setHasExternalConflict] = useState(false);
  const settingsRef = useRef<Settings | null>(null);
  const isSavingRef = useRef(false);
  const isUserChangeRef = useRef(false);
  const hasLoadedRef = useRef(false);
  const loadRequestRef = useRef(0);
  const pendingSaveRef = useRef(false);
  const refreshAfterSaveRef = useRef(false);
  const changeRevisionRef = useRef(0);
  const savedRevisionRef = useRef(0);
  const pendingPatchRef = useRef<SettingsPatch>({});
  const rulesFingerprintRef = useRef('');
  // This is the persisted source, not an unsaved URL currently displayed in the form.
  const savedAiEndpointRef = useRef('');
  const savedAiProtocolRef = useRef<AIProtocol>(AI.DEFAULT_PROTOCOL);
  const importGenerationRef = useRef(0);
  const importingRef = useRef(false);
  const [importing, setImporting] = useState(false);
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

  const loadSettings = useCallback(async (options?: { force?: boolean }): Promise<boolean> => {
    const request = ++loadRequestRef.current;
    const generation = importGenerationRef.current;
    setLoading(true);
    setLoadError(null);
    try {
      const loaded = await ExtensionAPI.getSettings();
      if (request !== loadRequestRef.current || generation !== importGenerationRef.current) {
        return false;
      }
      if (!loaded) {
        const message = tRef.current('options.loadSettingsInvalid');
        setLoadError(message);
        toastRef.current.error(message);
        return false;
      }
      if (!options?.force && (isUserChangeRef.current || isSavingRef.current)) {
        setHasExternalConflict(true);
        toastRef.current.error(tRef.current('options.settingsConflict'));
        return false;
      }
      settingsRef.current = loaded;
      setSettings(loaded);
      rulesFingerprintRef.current = crawlingConfigsFingerprint(loaded.crawlingConfigs);
      savedAiEndpointRef.current = loaded.aiModel.apiUrl;
      savedAiProtocolRef.current = loaded.aiModel.protocol;
      setHasExternalConflict(false);
      if (loaded.language) void changeLanguage(loaded.language);
      return true;
    } catch (error) {
      if (request !== loadRequestRef.current || generation !== importGenerationRef.current) {
        return false;
      }
      Logger.error('[useSettings] Failed to load settings', { error });
      const message = tRef.current('options.loadSettingsError', {
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      setLoadError(message);
      toastRef.current.error(message);
      return false;
    } finally {
      if (request === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    hasLoadedRef.current = true;
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local' || !changes[STORAGE.SETTINGS_KEY] || importingRef.current) return;
      if (isUserChangeRef.current || isSavingRef.current) {
        // A storage event may be our own in-flight write. Preserve the draft in either case;
        // the backend endpoint/rules CAS remains the authoritative protection against races.
        if (isSavingRef.current) {
          refreshAfterSaveRef.current = true;
        } else {
          setHasExternalConflict(true);
          toastRef.current.error(tRef.current('options.settingsConflict'));
        }
        return;
      }
      void loadSettings();
    };
    if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return;
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [loadSettings]);

  useEffect(() => {
    if (!settings || !isUserChangeRef.current || importingRef.current) return;
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
      const expectedEndpoint = savedAiEndpointRef.current;
      const expectedProtocol = savedAiProtocolRef.current;
      isSavingRef.current = true;
      setSaving(true);

      try {
        const endpointBoundEdit =
          patch.aiModel?.apiUrl !== undefined ||
          patch.aiModel?.apiKey !== undefined ||
          patch.aiModel?.protocol !== undefined ||
          patch.aiModel?.model !== undefined;
        const response = endpointBoundEdit
          ? await ExtensionAPI.saveSettings(
              patch,
              patch.crawlingConfigs ? rulesFingerprintRef.current : undefined,
              expectedEndpoint,
              expectedProtocol,
            )
          : patch.crawlingConfigs
            ? await ExtensionAPI.saveSettings(patch, rulesFingerprintRef.current)
            : await ExtensionAPI.saveSettings(patch);
        if (!response?.success)
          throw new Error(response?.error || tRef.current('options.savedError'));

        savedRevisionRef.current = Math.max(savedRevisionRef.current, revisionToSave);
        if (patch.crawlingConfigs) {
          rulesFingerprintRef.current = crawlingConfigsFingerprint(patch.crawlingConfigs);
        }
        if (patch.aiModel?.apiUrl !== undefined) savedAiEndpointRef.current = patch.aiModel.apiUrl;
        if (patch.aiModel?.protocol !== undefined)
          savedAiProtocolRef.current = patch.aiModel.protocol;
        if (changeRevisionRef.current === revisionToSave) {
          toastRef.current.success(tRef.current('options.savedSuccess'));
          isUserChangeRef.current = false;
        } else {
          pendingSaveRef.current = true;
        }
      } catch (error) {
        pendingPatchRef.current = mergePatch(patch, pendingPatchRef.current);
        const conflict =
          error instanceof ExtensionError &&
          error.details?.messageKey === 'options.settingsConflict';
        if (conflict) setHasExternalConflict(true);
        toastRef.current.error(
          conflict
            ? tRef.current('options.settingsConflict')
            : tRef.current('options.savedError') +
                (error instanceof Error ? `: ${error.message}` : ''),
        );
      } finally {
        setSaving(false);
        isSavingRef.current = false;
        if (refreshAfterSaveRef.current) {
          refreshAfterSaveRef.current = false;
          if (!importingRef.current) {
            if (isUserChangeRef.current) {
              // Storage notifications do not identify their writer. Keep a remaining draft
              // and report a potential conflict rather than silently replacing it.
              setHasExternalConflict(true);
              toastRef.current.error(tRef.current('options.settingsConflict'));
            } else {
              void loadSettings();
            }
          }
        }
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
  }, [settings, saveRequestSeq, importing, loadSettings]);

  const handleSettingsChange = useCallback((newSettings: SettingsPatch) => {
    if (importingRef.current || !settingsRef.current) return;
    const {
      selectorCache: _selectorCache,
      crawlingConfigValidationByDomain: _validation,
      disabledDefaultConfigDomains: _disabled,
      ...patch
    } = newSettings;
    isUserChangeRef.current = true;
    changeRevisionRef.current += 1;
    pendingPatchRef.current = mergePatch(pendingPatchRef.current, patch);
    const next = mergePatch(settingsRef.current, patch) as Settings;
    settingsRef.current = next;
    setSettings(next);
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
      const input = e.target;
      const file = input.files?.[0];
      input.value = '';
      if (!file || importingRef.current) return;
      importingRef.current = true;
      setImporting(true);
      importGenerationRef.current += 1;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        importingRef.current = false;
        setImporting(false);
        // The previous timer was invalidated even when reading/importing fails. Explicitly resume it.
        if (isUserChangeRef.current) setSaveRequestSeq((value) => value + 1);
      };
      const failReading = () => {
        if (finished) return;
        toastRef.current.error(tRef.current('options.importError'));
        finish();
      };
      try {
        const reader = new FileReader();
        reader.onerror = failReading;
        reader.onabort = failReading;
        reader.onload = async (event) => {
          try {
            const data = event.target?.result;
            if (typeof data !== 'string' || data.trim().length === 0)
              throw new Error('Empty import');
            await saveInFlightRef.current;
            const response = await ExtensionAPI.importSettings(data);
            if (!response?.success) throw new Error('Settings import failed');
            pendingPatchRef.current = {};
            pendingSaveRef.current = false;
            isUserChangeRef.current = false;
            savedRevisionRef.current = changeRevisionRef.current;
            await loadSettings({ force: true });
            toastRef.current.success(tRef.current('options.importedSuccess'));
          } catch (_error) {
            toastRef.current.error(tRef.current('options.importError'));
          } finally {
            finish();
          }
        };
        reader.readAsText(file);
      } catch (_error) {
        failReading();
      }
    },
    [loadSettings],
  );

  return {
    settings,
    saving,
    loading,
    loadError,
    hasExternalConflict,
    retryLoad: loadSettings,
    handleSettingsChange,
    handleExport,
    handleImport,
    toast,
    ToastContainer: toast.ToastContainer,
  };
}
