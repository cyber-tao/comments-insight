import React, { useEffect, useMemo, useState } from 'react';
import { Settings, CrawlingConfig, FieldSelector } from '../../types';
import { useTranslation } from 'react-i18next';
import { CrawlingConfigEditor } from './CrawlingConfigEditor';
import { API } from '@/config/constants';
import { resolveCrawlingConfigLastUpdated } from '@/utils/crawling-config';
import { crawlingConfigSchema } from '@/utils/storage-validation';
import { Logger } from '../../utils/logger';
import { DownloadIcon, RefreshIcon, UploadIcon } from '@/components/Icons';
import { ConfigList } from './ConfigList';
import { ConfigImportDialog, ConflictItem, MERGE_FIELDS } from './ConfigImportDialog';
import { ConfigSyncDialog } from './ConfigSyncDialog';
import { useConfigImport } from '../hooks/useConfigImport';
import type { ConfirmFunction } from '@/hooks/useConfirm';

interface Props {
  settings: Settings;
  onSettingsChange: (newSettings: Partial<Settings>) => void;
  showToast: (message: string, type?: 'info' | 'success' | 'error' | 'warning') => void;
  confirm: ConfirmFunction;
}

type ExportableCrawlingConfig = Omit<CrawlingConfig, 'fieldValidation'>;

const DEFAULT_EMPTY_CONFIG: CrawlingConfig = {
  id: '',
  domain: 'new-site.com',
  lastUpdated: Date.now(),
  container: { selector: '', type: 'css' },
  item: { selector: '', type: 'css' },
  fields: [
    { name: 'username', rule: { selector: '', type: 'css' } },
    { name: 'content', rule: { selector: '', type: 'css' } },
    { name: 'timestamp', rule: { selector: '', type: 'css' } },
    { name: 'likes', rule: { selector: '', type: 'css' } },
  ],
};

const toExportableCrawlingConfig = ({
  fieldValidation: _fieldValidation,
  ...config
}: CrawlingConfig): ExportableCrawlingConfig => config;

export const ConfigSettings: React.FC<Props> = ({
  settings,
  onSettingsChange,
  showToast,
  confirm,
}) => {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempConfig, setTempConfig] = useState<CrawlingConfig | null>(null);
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({});
  const [exportError, setExportError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);

  // Safely access configs (it might be undefined if loaded from old initialized storage)
  const configs = useMemo(() => settings.crawlingConfigs || [], [settings.crawlingConfigs]);

  const {
    importOpen,
    importError,
    importFileName,
    importAdditions,
    importConflicts,
    isRemoteSync,
    handleImportFile,
    closeImport,
    setChoice,
    setAllChoices,
    processConfigs,
  } = useConfigImport(configs);

  useEffect(() => {
    setExportSelection((prev) => {
      const next: Record<string, boolean> = {};
      for (const config of configs) {
        next[config.id] = prev[config.id] ?? true;
      }
      return next;
    });
  }, [configs]);

  const handleAdd = () => {
    const newConfig = {
      ...DEFAULT_EMPTY_CONFIG,
      id: `manual_${Date.now()}`,
      lastUpdated: Date.now(),
    };
    setTempConfig(newConfig);
    setEditingId(newConfig.id);
  };

  const handleEdit = (config: CrawlingConfig) => {
    setTempConfig({ ...config });
    setEditingId(config.id);
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm({
      message: t('options.crawlingConfigs.confirmDelete'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (confirmed) {
      onSettingsChange({ crawlingConfigs: configs.filter((c) => c.id !== id) });
    }
  };

  const handleExportSelected = () => {
    const selectedConfigs = configs.filter((config) => exportSelection[config.id]);
    if (selectedConfigs.length === 0) {
      setExportError(t('options.crawlingConfigs.exportSelectAtLeastOne'));
      return;
    }
    setExportError(null);
    const exportConfigs = selectedConfigs.map(toExportableCrawlingConfig);
    const json = JSON.stringify(exportConfigs, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comments-insight-crawling-configs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateFieldInArray = (
    fields: FieldSelector[],
    name: string,
    incoming: FieldSelector | null,
  ): FieldSelector[] => {
    if (!incoming) return fields;
    const idx = fields.findIndex((f) => f.name === name);
    if (idx >= 0) {
      const updated = [...fields];
      updated[idx] = incoming;
      return updated;
    }
    return [...fields, incoming];
  };

  const findField = (fields: FieldSelector[] | undefined, name: string): FieldSelector | null => {
    return fields?.find((f) => f.name === name) || null;
  };

  const buildMergedConfig = (conflict: ConflictItem): CrawlingConfig => {
    const merged: CrawlingConfig = {
      ...conflict.existing,
      id: conflict.existing.id,
      domain: conflict.existing.domain,
      lastUpdated: conflict.existing.lastUpdated,
      fields: [...conflict.existing.fields],
    };

    const mergedReplies = {
      ...conflict.existing.replies,
      fields: conflict.existing.replies?.fields ? [...conflict.existing.replies.fields] : [],
    };

    for (const field of MERGE_FIELDS) {
      const choice = conflict.choices[field];
      if (choice === 'incoming') {
        switch (field) {
          case 'siteName':
            merged.siteName = conflict.incoming.siteName;
            break;
          case 'container':
            merged.container = conflict.incoming.container;
            break;
          case 'item':
            merged.item = conflict.incoming.item;
            break;
          case 'fieldUsername':
            merged.fields = updateFieldInArray(
              merged.fields,
              'username',
              findField(conflict.incoming.fields, 'username'),
            );
            break;
          case 'fieldContent':
            merged.fields = updateFieldInArray(
              merged.fields,
              'content',
              findField(conflict.incoming.fields, 'content'),
            );
            break;
          case 'fieldTimestamp':
            merged.fields = updateFieldInArray(
              merged.fields,
              'timestamp',
              findField(conflict.incoming.fields, 'timestamp'),
            );
            break;
          case 'fieldLikes':
            merged.fields = updateFieldInArray(
              merged.fields,
              'likes',
              findField(conflict.incoming.fields, 'likes'),
            );
            break;
          case 'repliesContainer':
            if (conflict.incoming.replies?.container) {
              mergedReplies.container = conflict.incoming.replies.container;
            }
            break;
          case 'repliesItem':
            if (conflict.incoming.replies?.item) {
              mergedReplies.item = conflict.incoming.replies.item;
            }
            break;
          case 'repliesFieldUsername':
            if (conflict.incoming.replies?.fields) {
              mergedReplies.fields = updateFieldInArray(
                mergedReplies.fields,
                'username',
                findField(conflict.incoming.replies.fields, 'username'),
              );
            }
            break;
          case 'repliesFieldContent':
            if (conflict.incoming.replies?.fields) {
              mergedReplies.fields = updateFieldInArray(
                mergedReplies.fields,
                'content',
                findField(conflict.incoming.replies.fields, 'content'),
              );
            }
            break;
          case 'repliesFieldTimestamp':
            if (conflict.incoming.replies?.fields) {
              mergedReplies.fields = updateFieldInArray(
                mergedReplies.fields,
                'timestamp',
                findField(conflict.incoming.replies.fields, 'timestamp'),
              );
            }
            break;
          case 'repliesFieldLikes':
            if (conflict.incoming.replies?.fields) {
              mergedReplies.fields = updateFieldInArray(
                mergedReplies.fields,
                'likes',
                findField(conflict.incoming.replies.fields, 'likes'),
              );
            }
            break;
          case 'repliesExpandBtn':
            mergedReplies.expandBtn = conflict.incoming.replies?.expandBtn;
            break;
          case 'videoTime':
            merged.videoTime = conflict.incoming.videoTime;
            break;
          case 'postContent':
            merged.postContent = conflict.incoming.postContent;
            break;
          default:
            break;
        }
      }
    }

    if (mergedReplies.container && mergedReplies.item) {
      merged.replies = mergedReplies as typeof merged.replies;
    }

    merged.lastUpdated = resolveCrawlingConfigLastUpdated({
      previous: conflict.existing,
      next: merged,
      preferredLastUpdated: conflict.incoming.lastUpdated,
    });

    return merged;
  };

  const handleApplyImport = (conflicts: ConflictItem[]) => {
    const mergedMap = new Map(
      conflicts.map((conflict) => [conflict.existing.domain, buildMergedConfig(conflict)]),
    );
    const baseConfigs = configs.map((config) => mergedMap.get(config.domain) || config);
    const newConfigs = importAdditions.filter((config) => !mergedMap.has(config.domain));
    const merged = [...baseConfigs, ...newConfigs];
    onSettingsChange({ crawlingConfigs: merged });
    if (isRemoteSync) {
      showToast(
        t('options.crawlingConfigs.syncSuccessWithCount', {
          added: newConfigs.length,
          updated: mergedMap.size,
        }),
        'success',
      );
    }
    closeImport();
  };

  const handleSyncRemoteConfirm = async () => {
    setSyncDialogOpen(false);
    try {
      setSyncing(true);
      const response = await fetch(API.CRAWLING_CONFIGS_RAW_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }
      const remoteConfigs = (await response.json()) as unknown[];

      const result = processConfigs(remoteConfigs, true);
      if (result && result.additions === 0 && result.conflicts === 0) {
        showToast(t('options.crawlingConfigs.syncNoChanges'), 'info');
      }
    } catch (error) {
      Logger.error('Failed to sync configs:', { error });
      showToast(t('options.crawlingConfigs.syncError'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = () => {
    if (tempConfig) {
      const result = crawlingConfigSchema.safeParse({
        ...tempConfig,
        ...(tempConfig.replies
          ? {
              replies: {
                ...tempConfig.replies,
                expandBtn: tempConfig.replies.expandBtn?.selector.trim()
                  ? tempConfig.replies.expandBtn
                  : undefined,
              },
            }
          : {}),
      });
      if (!result.success) {
        showToast(t('options.crawlingConfigs.invalidDraft'), 'error');
        return;
      }
      const draft = result.data;
      const exists = configs.find((c) => c.id === draft.id);
      const savedConfig = exists
        ? {
            ...draft,
            lastUpdated: resolveCrawlingConfigLastUpdated({
              previous: exists,
              next: draft,
            }),
          }
        : {
            ...draft,
            lastUpdated: Date.now(),
          };
      let newConfigs;
      if (exists) {
        newConfigs = configs.map((c) => (c.id === tempConfig.id ? savedConfig : c));
      } else {
        newConfigs = [...configs, savedConfig];
      }
      onSettingsChange({ crawlingConfigs: newConfigs });
      setEditingId(null);
      setTempConfig(null);
    }
  };

  if (editingId && tempConfig) {
    return (
      <CrawlingConfigEditor
        config={tempConfig}
        onChange={setTempConfig}
        onCancel={() => {
          setEditingId(null);
          setTempConfig(null);
        }}
        onSave={handleSave}
      />
    );
  }

  return (
    <div className="theme-card p-6">
      <div className="flex flex-wrap justify-between items-start gap-4 mb-5">
        <div>
          <h2
            className="text-lg font-bold font-serif-editorial"
            style={{ color: 'var(--text-primary)' }}
          >
            {t('options.crawlingConfigs.title')}
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('options.crawlingConfigs.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setSyncDialogOpen(true)}
            disabled={syncing}
            className="theme-button-secondary px-3.5 py-2 text-xs inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <RefreshIcon size={14} className={syncing ? 'animate-spin' : ''} />
            <span>
              {syncing
                ? t('options.crawlingConfigs.syncing')
                : t('options.crawlingConfigs.syncRemote')}
            </span>
          </button>
          <label className="theme-button-secondary px-3.5 py-2 text-xs inline-flex items-center gap-1.5 cursor-pointer">
            <UploadIcon size={14} />
            <span>{t('options.crawlingConfigs.importConfig')}</span>
            <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />
          </label>
          <button
            onClick={handleExportSelected}
            className="theme-button-secondary px-3.5 py-2 text-xs inline-flex items-center gap-1.5"
          >
            <DownloadIcon size={14} />
            <span>{t('options.crawlingConfigs.exportConfig')}</span>
          </button>
          <button onClick={handleAdd} className="theme-button-primary px-3.5 py-2 text-xs">
            {t('options.crawlingConfigs.newConfig')}
          </button>
        </div>
      </div>
      {exportError && (
        <div className="mb-4 text-sm" style={{ color: 'var(--accent-danger)' }}>
          {exportError}
        </div>
      )}

      <ConfigList
        configs={configs}
        exportSelection={exportSelection}
        onSelectionChange={(id, selected) =>
          setExportSelection((prev) => ({ ...prev, [id]: selected }))
        }
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <ConfigImportDialog
        isOpen={importOpen}
        isRemoteSync={isRemoteSync}
        importFileName={importFileName}
        importError={importError}
        importAdditions={importAdditions}
        importConflicts={importConflicts}
        onClose={closeImport}
        onApply={handleApplyImport}
        onConflictChange={setChoice}
        onAllConflictsChange={setAllChoices}
      />

      <ConfigSyncDialog
        isOpen={syncDialogOpen}
        onClose={() => setSyncDialogOpen(false)}
        onConfirm={handleSyncRemoteConfirm}
      />
    </div>
  );
};
