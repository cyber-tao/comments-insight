import React, { useEffect, useMemo, useState } from 'react';
import { Settings, CrawlingConfig, SelectorRule, FieldSelector, ReplyConfig } from '../../types';
import { useTranslation } from 'react-i18next';
import { CrawlingConfigEditor } from './CrawlingConfigEditor';

interface Props {
  settings: Settings;
  onSettingsChange: (newSettings: Partial<Settings>) => void;
}

type MergeChoice = 'current' | 'incoming';
type MergeField =
  | 'siteName'
  | 'container'
  | 'item'
  | 'fieldUsername'
  | 'fieldContent'
  | 'fieldTimestamp'
  | 'fieldLikes'
  | 'repliesContainer'
  | 'repliesItem'
  | 'repliesFieldUsername'
  | 'repliesFieldContent'
  | 'repliesFieldTimestamp'
  | 'repliesFieldLikes'
  | 'repliesExpandBtn'
  | 'videoTime'
  | 'postContent';

interface ConflictItem {
  existing: CrawlingConfig;
  incoming: CrawlingConfig;
  diffFields: MergeField[];
  choices: Record<MergeField, MergeChoice>;
}

const MERGE_FIELDS: MergeField[] = [
  'siteName',
  'container',
  'item',
  'fieldUsername',
  'fieldContent',
  'fieldTimestamp',
  'fieldLikes',
  'repliesContainer',
  'repliesItem',
  'repliesFieldUsername',
  'repliesFieldContent',
  'repliesFieldTimestamp',
  'repliesFieldLikes',
  'repliesExpandBtn',
  'videoTime',
  'postContent',
];

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

export const ConfigSettings: React.FC<Props> = ({ settings, onSettingsChange }) => {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempConfig, setTempConfig] = useState<CrawlingConfig | null>(null);
  const [exportSelection, setExportSelection] = useState<Record<string, boolean>>({});
  const [exportError, setExportError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importAdditions, setImportAdditions] = useState<CrawlingConfig[]>([]);
  const [importConflicts, setImportConflicts] = useState<ConflictItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [isRemoteSync, setIsRemoteSync] = useState(false);

  const SYNC_REMOTE_URL =
    'https://raw.githubusercontent.com/cyber-tao/comments-insight/refs/heads/master/src/config/default_rules.json';

  // Safely access configs (it might be undefined if loaded from old initialized storage)
  const configs = useMemo(() => settings.crawlingConfigs || [], [settings.crawlingConfigs]);
  const importHasChanges = importAdditions.length > 0 || importConflicts.length > 0;

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
    const newConfig = { ...DEFAULT_EMPTY_CONFIG, id: `manual_${Date.now()}` };
    setTempConfig(newConfig);
    setEditingId(newConfig.id);
  };

  const handleEdit = (config: CrawlingConfig) => {
    setTempConfig({ ...config });
    setEditingId(config.id);
  };

  const handleDelete = (id: string) => {
    if (confirm(t('options.crawlingConfigs.confirmDelete'))) {
      const newConfigs = configs.filter((c) => c.id !== id);
      onSettingsChange({ crawlingConfigs: newConfigs });
    }
  };

  const handleExportSelected = () => {
    const selectedConfigs = configs.filter((config) => exportSelection[config.id]);
    if (selectedConfigs.length === 0) {
      setExportError(t('options.crawlingConfigs.exportSelectAtLeastOne'));
      return;
    }
    setExportError(null);
    const payload = {
      metadata: {
        exportedAt: Date.now(),
        total: selectedConfigs.length,
      },
      configs: selectedConfigs,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `comments-insight-crawling-configs-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isSelectorRule = (value: unknown): value is SelectorRule => {
    if (!value || typeof value !== 'object') return false;
    const rule = value as SelectorRule;
    return typeof rule.selector === 'string' && (rule.type === 'css' || rule.type === 'xpath');
  };

  const isFieldSelector = (value: unknown): value is FieldSelector => {
    if (!value || typeof value !== 'object') return false;
    const field = value as FieldSelector;
    return typeof field.name === 'string' && isSelectorRule(field.rule);
  };

  const isReplyConfig = (value: unknown): value is ReplyConfig => {
    if (!value || typeof value !== 'object') return false;
    const reply = value as ReplyConfig;
    return (
      isSelectorRule(reply.container) &&
      isSelectorRule(reply.item) &&
      Array.isArray(reply.fields) &&
      reply.fields.every(isFieldSelector) &&
      (reply.expandBtn === undefined || isSelectorRule(reply.expandBtn))
    );
  };

  const isCrawlingConfig = (value: unknown): value is CrawlingConfig => {
    if (!value || typeof value !== 'object') return false;
    const config = value as CrawlingConfig;
    return (
      typeof config.domain === 'string' &&
      isSelectorRule(config.container) &&
      isSelectorRule(config.item) &&
      Array.isArray(config.fields) &&
      config.fields.every(isFieldSelector) &&
      (config.lastUpdated === undefined || typeof config.lastUpdated === 'number') &&
      (config.replies === undefined || isReplyConfig(config.replies)) &&
      (config.videoTime === undefined || isSelectorRule(config.videoTime)) &&
      (config.postContent === undefined || isSelectorRule(config.postContent)) &&
      (config.postTime === undefined || isSelectorRule(config.postTime))
    );
  };

  const normalizeImportedConfig = (config: CrawlingConfig): CrawlingConfig => {
    const id = config.id && typeof config.id === 'string' ? config.id : `imported_${Date.now()}`;
    return {
      ...config,
      id,
      domain: config.domain.trim(),
      lastUpdated: config.lastUpdated ?? Date.now(),
    };
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportFileName(file.name);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = reader.result as string;
        const parsed = JSON.parse(data) as unknown;
        const rawConfigs = Array.isArray(parsed)
          ? parsed
          : (parsed as { configs?: unknown }).configs;
        if (!Array.isArray(rawConfigs)) {
          setImportError(t('options.crawlingConfigs.importInvalidFile'));
          setImportOpen(true);
          return;
        }
        const validated = rawConfigs.filter(isCrawlingConfig).map(normalizeImportedConfig);
        const dedupedByDomain = new Map<string, CrawlingConfig>();
        for (const config of validated) {
          dedupedByDomain.set(config.domain, config);
        }
        const uniqueConfigs = Array.from(dedupedByDomain.values());
        if (uniqueConfigs.length === 0) {
          setImportError(t('options.crawlingConfigs.importNoConfigs'));
          setImportOpen(true);
          return;
        }
        const existingByDomain = new Map(configs.map((config) => [config.domain, config]));
        const conflicts: ConflictItem[] = [];
        const additions: CrawlingConfig[] = [];
        for (const incoming of uniqueConfigs) {
          const existing = existingByDomain.get(incoming.domain);
          if (!existing) {
            additions.push(incoming);
            continue;
          }
          const diffFields = MERGE_FIELDS.filter((field) => {
            const currentValue = getFieldRawValue(existing, field);
            const incomingValue = getFieldRawValue(incoming, field);
            return JSON.stringify(currentValue) !== JSON.stringify(incomingValue);
          });
          const choices = MERGE_FIELDS.reduce<Record<MergeField, MergeChoice>>(
            (acc, field) => {
              acc[field] = 'current';
              return acc;
            },
            {} as Record<MergeField, MergeChoice>,
          );
          if (diffFields.length > 0) {
            conflicts.push({ existing, incoming, diffFields, choices });
          }
        }
        setImportAdditions(additions);
        setImportConflicts(conflicts);
        setImportOpen(true);
      } catch {
        setImportError(t('options.crawlingConfigs.importInvalidFile'));
        setImportOpen(true);
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const findField = (fields: FieldSelector[] | undefined, name: string): FieldSelector | null => {
    return fields?.find((f) => f.name === name) || null;
  };

  const getFieldRawValue = (config: CrawlingConfig, field: MergeField): unknown => {
    switch (field) {
      case 'siteName':
        return config.siteName || '';
      case 'container':
        return config.container;
      case 'item':
        return config.item;
      case 'fieldUsername':
        return findField(config.fields, 'username');
      case 'fieldContent':
        return findField(config.fields, 'content');
      case 'fieldTimestamp':
        return findField(config.fields, 'timestamp');
      case 'fieldLikes':
        return findField(config.fields, 'likes');
      case 'repliesContainer':
        return config.replies?.container || null;
      case 'repliesItem':
        return config.replies?.item || null;
      case 'repliesFieldUsername':
        return findField(config.replies?.fields, 'username');
      case 'repliesFieldContent':
        return findField(config.replies?.fields, 'content');
      case 'repliesFieldTimestamp':
        return findField(config.replies?.fields, 'timestamp');
      case 'repliesFieldLikes':
        return findField(config.replies?.fields, 'likes');
      case 'repliesExpandBtn':
        return config.replies?.expandBtn || null;
      case 'videoTime':
        return config.videoTime || null;
      case 'postContent':
        return config.postContent || null;
      default:
        return '';
    }
  };

  const formatRule = (rule?: SelectorRule): string => {
    if (!rule) return '';
    return `${rule.type}:${rule.selector}`;
  };

  const formatFieldSelector = (fs: FieldSelector | null): string => {
    if (!fs) return '';
    const attr = fs.attribute ? `@${fs.attribute}` : '';
    return `${formatRule(fs.rule)}${attr}`;
  };

  const formatFieldValue = (config: CrawlingConfig, field: MergeField): string => {
    switch (field) {
      case 'siteName':
        return config.siteName || '';
      case 'container':
        return formatRule(config.container);
      case 'item':
        return formatRule(config.item);
      case 'fieldUsername':
        return formatFieldSelector(findField(config.fields, 'username'));
      case 'fieldContent':
        return formatFieldSelector(findField(config.fields, 'content'));
      case 'fieldTimestamp':
        return formatFieldSelector(findField(config.fields, 'timestamp'));
      case 'fieldLikes':
        return formatFieldSelector(findField(config.fields, 'likes'));
      case 'repliesContainer':
        return formatRule(config.replies?.container);
      case 'repliesItem':
        return formatRule(config.replies?.item);
      case 'repliesFieldUsername':
        return formatFieldSelector(findField(config.replies?.fields, 'username'));
      case 'repliesFieldContent':
        return formatFieldSelector(findField(config.replies?.fields, 'content'));
      case 'repliesFieldTimestamp':
        return formatFieldSelector(findField(config.replies?.fields, 'timestamp'));
      case 'repliesFieldLikes':
        return formatFieldSelector(findField(config.replies?.fields, 'likes'));
      case 'repliesExpandBtn':
        return formatRule(config.replies?.expandBtn);
      case 'videoTime':
        return formatRule(config.videoTime);
      case 'postContent':
        return formatRule(config.postContent);
      default:
        return '';
    }
  };

  const getFieldLabel = (field: MergeField) => {
    switch (field) {
      case 'siteName':
        return t('options.crawlingConfigs.fieldSiteName');
      case 'container':
        return t('options.crawlingConfigs.fieldContainer');
      case 'item':
        return t('options.crawlingConfigs.fieldItem');
      case 'fieldUsername':
        return t('options.crawlingConfigs.fieldUsername');
      case 'fieldContent':
        return t('options.crawlingConfigs.fieldContent');
      case 'fieldTimestamp':
        return t('options.crawlingConfigs.fieldTimestamp');
      case 'fieldLikes':
        return t('options.crawlingConfigs.fieldLikes');
      case 'repliesContainer':
        return t('options.crawlingConfigs.fieldRepliesContainer');
      case 'repliesItem':
        return t('options.crawlingConfigs.fieldRepliesItem');
      case 'repliesFieldUsername':
        return t('options.crawlingConfigs.fieldRepliesUsername');
      case 'repliesFieldContent':
        return t('options.crawlingConfigs.fieldRepliesContent');
      case 'repliesFieldTimestamp':
        return t('options.crawlingConfigs.fieldRepliesTimestamp');
      case 'repliesFieldLikes':
        return t('options.crawlingConfigs.fieldRepliesLikes');
      case 'repliesExpandBtn':
        return t('options.crawlingConfigs.fieldRepliesExpandBtn');
      case 'videoTime':
        return t('options.crawlingConfigs.fieldVideoTime');
      case 'postContent':
        return t('options.crawlingConfigs.fieldPostContent');
      default:
        return field;
    }
  };

  const setChoice = (index: number, field: MergeField, choice: MergeChoice) => {
    setImportConflicts((prev) =>
      prev.map((item, idx) =>
        idx === index ? { ...item, choices: { ...item.choices, [field]: choice } } : item,
      ),
    );
  };

  const setAllChoices = (choice: MergeChoice) => {
    setImportConflicts((prev) =>
      prev.map((item) => ({
        ...item,
        choices: MERGE_FIELDS.reduce<Record<MergeField, MergeChoice>>(
          (acc, field) => {
            acc[field] = choice;
            return acc;
          },
          {} as Record<MergeField, MergeChoice>,
        ),
      })),
    );
  };

  const closeImport = () => {
    setImportOpen(false);
    setImportAdditions([]);
    setImportConflicts([]);
    setImportFileName('');
    setImportError(null);
    setIsRemoteSync(false);
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

  const buildMergedConfig = (conflict: ConflictItem): CrawlingConfig => {
    const merged: CrawlingConfig = {
      ...conflict.existing,
      id: conflict.existing.id,
      domain: conflict.existing.domain,
      lastUpdated: Date.now(),
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

    return merged;
  };

  const handleApplyImport = () => {
    const mergedMap = new Map(
      importConflicts.map((conflict) => [conflict.existing.domain, buildMergedConfig(conflict)]),
    );
    const baseConfigs = configs.map((config) => mergedMap.get(config.domain) || config);
    const newConfigs = importAdditions.filter((config) => !mergedMap.has(config.domain));
    const merged = [...baseConfigs, ...newConfigs];
    onSettingsChange({ crawlingConfigs: merged });
    closeImport();
  };

  const handleSyncDialogOpen = () => {
    setSyncDialogOpen(true);
  };

  const handleSyncDialogClose = () => {
    setSyncDialogOpen(false);
  };

  const handleSyncRemoteConfirm = async () => {
    setSyncDialogOpen(false);
    try {
      setSyncing(true);
      const response = await fetch(SYNC_REMOTE_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.statusText}`);
      }
      const remoteConfigs = (await response.json()) as CrawlingConfig[];
      const validated = remoteConfigs.filter(isCrawlingConfig).map(normalizeImportedConfig);

      const dedupedByDomain = new Map<string, CrawlingConfig>();
      for (const config of validated) {
        dedupedByDomain.set(config.domain, config);
      }
      const uniqueConfigs = Array.from(dedupedByDomain.values());

      if (uniqueConfigs.length === 0) {
        setImportError(t('options.crawlingConfigs.importNoConfigs'));
        setIsRemoteSync(true);
        setImportOpen(true);
        return;
      }

      const existingByDomain = new Map(configs.map((config) => [config.domain, config]));
      const conflicts: ConflictItem[] = [];
      const additions: CrawlingConfig[] = [];

      for (const incoming of uniqueConfigs) {
        const existing = existingByDomain.get(incoming.domain);
        if (!existing) {
          additions.push(incoming);
          continue;
        }
        const diffFields = MERGE_FIELDS.filter((field) => {
          const currentValue = getFieldRawValue(existing, field);
          const incomingValue = getFieldRawValue(incoming, field);
          return JSON.stringify(currentValue) !== JSON.stringify(incomingValue);
        });
        if (diffFields.length === 0) continue;
        const choices = MERGE_FIELDS.reduce<Record<MergeField, MergeChoice>>(
          (acc, field) => {
            acc[field] = 'incoming';
            return acc;
          },
          {} as Record<MergeField, MergeChoice>,
        );
        conflicts.push({ existing, incoming, diffFields, choices });
      }

      if (additions.length === 0 && conflicts.length === 0) {
        alert(t('options.crawlingConfigs.syncSuccessWithCount', { added: 0, updated: 0 }));
        return;
      }

      setImportAdditions(additions);
      setImportConflicts(conflicts);
      setIsRemoteSync(true);
      setImportOpen(true);
    } catch (error) {
      console.error('Failed to sync configs:', error);
      alert(t('options.crawlingConfigs.syncError'));
    } finally {
      setSyncing(false);
    }
  };

  const handleSave = () => {
    if (tempConfig) {
      const exists = configs.find((c) => c.id === tempConfig.id);
      let newConfigs;
      if (exists) {
        newConfigs = configs.map((c) => (c.id === tempConfig.id ? tempConfig : c));
      } else {
        newConfigs = [...configs, tempConfig];
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
    <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-2">
        <div>
          <h2 className="text-xl font-semibold text-gray-800">
            {t('options.crawlingConfigs.title')}
          </h2>
          <p className="text-sm text-gray-500 mt-1">{t('options.crawlingConfigs.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSyncDialogOpen}
            disabled={syncing}
            className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm font-medium disabled:opacity-50"
          >
            {syncing
              ? t('options.crawlingConfigs.syncing')
              : t('options.crawlingConfigs.syncRemote')}
          </button>
          <label className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm font-medium cursor-pointer">
            {t('options.crawlingConfigs.importConfig')}
            <input type="file" accept=".json" onChange={handleImportFile} className="hidden" />
          </label>
          <button
            onClick={handleExportSelected}
            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm font-medium"
          >
            {t('options.crawlingConfigs.exportConfig')}
          </button>
          <button
            onClick={handleAdd}
            className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50 text-sm font-medium"
          >
            {t('options.crawlingConfigs.newConfig')}
          </button>
        </div>
      </div>
      {exportError && <div className="mb-4 text-sm text-red-600">{exportError}</div>}

      {configs.length === 0 ? (
        <div className="text-center py-10 bg-gray-50 rounded border border-dashed text-gray-500">
          {t('options.crawlingConfigs.noConfigs')}
        </div>
      ) : (
        <div className="grid gap-4">
          {configs.map((config) => (
            <div
              key={config.id}
              className="flex items-center justify-between p-4 border rounded hover:border-blue-300 transition-colors bg-gray-50"
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={!!exportSelection[config.id]}
                  onChange={(e) =>
                    setExportSelection((prev) => ({ ...prev, [config.id]: e.target.checked }))
                  }
                />
                <div>
                  <h3 className="font-semibold text-gray-900">{config.domain}</h3>
                  <div className="text-xs text-gray-500 mt-1">
                    {t('options.crawlingConfigs.updated')}:{' '}
                    {new Date(config.lastUpdated).toLocaleDateString()}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleEdit(config)}
                  className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                >
                  {t('options.crawlingConfigs.edit')}
                </button>
                <button
                  onClick={() => handleDelete(config.id)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded"
                >
                  {t('options.crawlingConfigs.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-5xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {isRemoteSync
                    ? t('options.crawlingConfigs.syncPreviewTitle')
                    : t('options.crawlingConfigs.importTitle')}
                </h3>
                {!isRemoteSync && importFileName && (
                  <div className="text-xs text-gray-500 mt-1">{importFileName}</div>
                )}
              </div>
              <button
                onClick={closeImport}
                className="text-gray-400 hover:text-gray-600"
                aria-label={t('common.cancel')}
              >
                ×
              </button>
            </div>
            {importError && <div className="text-sm text-red-600 mb-3">{importError}</div>}
            {!importError && importConflicts.length === 0 && importAdditions.length === 0 && (
              <div className="text-sm text-gray-500 mb-4">
                {t('options.crawlingConfigs.importEmpty')}
              </div>
            )}
            {!importError && (importConflicts.length > 0 || importAdditions.length > 0) && (
              <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
                {importAdditions.length > 0 && (
                  <div className="border rounded p-4">
                    <div className="text-sm font-semibold text-gray-700 mb-2">
                      {t('options.crawlingConfigs.importNewConfigs')}
                    </div>
                    <div className="grid gap-2">
                      {importAdditions.map((config) => (
                        <div key={config.id} className="text-sm text-gray-800">
                          {config.domain}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {importConflicts.length > 0 && (
                  <div className="border border-orange-200 rounded-lg bg-orange-50/50">
                    <div className="flex items-center justify-between p-4 border-b border-orange-200 bg-orange-100/50 rounded-t-lg">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-orange-800">
                          {t('options.crawlingConfigs.importConflicts')}
                        </span>
                        <span className="px-2 py-0.5 text-xs font-medium bg-orange-200 text-orange-800 rounded-full">
                          {importConflicts.length}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setAllChoices('current')}
                          className="px-3 py-1.5 text-xs font-medium rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                        >
                          {t('options.crawlingConfigs.mergeKeepAllCurrent')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAllChoices('incoming')}
                          className="px-3 py-1.5 text-xs font-medium rounded border border-green-300 bg-green-50 text-green-700 hover:bg-green-100"
                        >
                          {t('options.crawlingConfigs.mergeUseAllIncoming')}
                        </button>
                      </div>
                    </div>
                    <div className="p-4 space-y-4">
                      {importConflicts.map((conflict, conflictIndex) => (
                        <div
                          key={conflict.existing.domain}
                          className="border border-gray-200 rounded-lg bg-white shadow-sm"
                        >
                          <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 rounded-t-lg">
                            <span className="text-sm font-semibold text-gray-800">
                              {conflict.existing.domain}
                            </span>
                            <span className="ml-2 text-xs text-gray-500">
                              ({conflict.diffFields.length}{' '}
                              {conflict.diffFields.length === 1 ? 'field' : 'fields'})
                            </span>
                          </div>
                          {conflict.diffFields.length === 0 && (
                            <div className="p-4 text-xs text-gray-500">
                              {t('options.crawlingConfigs.importNoDifferences')}
                            </div>
                          )}
                          {conflict.diffFields.length > 0 && (
                            <div className="divide-y divide-gray-100">
                              {conflict.diffFields.map((field) => (
                                <div key={field} className="p-3">
                                  <div className="text-xs font-medium text-gray-500 mb-2">
                                    {getFieldLabel(field)}
                                  </div>
                                  <div className="grid grid-cols-2 gap-3">
                                    <label
                                      className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors ${
                                        conflict.choices[field] === 'current'
                                          ? 'border-blue-400 bg-blue-50'
                                          : 'border-gray-200 hover:bg-gray-50'
                                      }`}
                                    >
                                      <input
                                        type="radio"
                                        name={`${conflict.existing.domain}-${field}`}
                                        checked={conflict.choices[field] === 'current'}
                                        onChange={() => setChoice(conflictIndex, field, 'current')}
                                        className="mt-0.5"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-gray-600 mb-1">
                                          {t('options.crawlingConfigs.mergeKeepCurrent')}
                                        </div>
                                        <div className="text-xs text-gray-700 break-all font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                                          {formatFieldValue(conflict.existing, field) ||
                                            t('options.crawlingConfigs.valueEmpty')}
                                        </div>
                                      </div>
                                    </label>
                                    <label
                                      className={`flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors ${
                                        conflict.choices[field] === 'incoming'
                                          ? 'border-green-400 bg-green-50'
                                          : 'border-gray-200 hover:bg-gray-50'
                                      }`}
                                    >
                                      <input
                                        type="radio"
                                        name={`${conflict.existing.domain}-${field}`}
                                        checked={conflict.choices[field] === 'incoming'}
                                        onChange={() => setChoice(conflictIndex, field, 'incoming')}
                                        className="mt-0.5"
                                      />
                                      <div className="flex-1 min-w-0">
                                        <div className="text-xs font-medium text-green-700 mb-1">
                                          {t('options.crawlingConfigs.mergeUseIncoming')}
                                        </div>
                                        <div className="text-xs text-gray-700 break-all font-mono bg-green-100 px-1.5 py-0.5 rounded">
                                          {formatFieldValue(conflict.incoming, field) ||
                                            t('options.crawlingConfigs.valueEmpty')}
                                        </div>
                                      </div>
                                    </label>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={closeImport}
                className="px-4 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleApplyImport}
                className="px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700"
                disabled={!!importError || !importHasChanges}
              >
                {t('options.crawlingConfigs.importApply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {syncDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6">
            <h3 className="text-lg font-semibold mb-4">
              {t('options.crawlingConfigs.syncDialogTitle')}
            </h3>
            <p className="text-sm text-gray-600 mb-4">
              {t('options.crawlingConfigs.syncDialogDescription')}
            </p>
            <div className="mb-4">
              <div className="text-xs font-medium text-gray-500 mb-1">
                {t('options.crawlingConfigs.syncDialogSourceUrl')}
              </div>
              <div className="text-xs text-blue-600 break-all bg-gray-50 p-2 rounded border">
                <a href={SYNC_REMOTE_URL} target="_blank" rel="noopener noreferrer">
                  {SYNC_REMOTE_URL}
                </a>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleSyncDialogClose}
                className="px-4 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleSyncRemoteConfirm}
                className="px-4 py-2 text-sm rounded bg-purple-600 text-white hover:bg-purple-700"
              >
                {t('options.crawlingConfigs.syncDialogConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
