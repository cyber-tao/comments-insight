import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CrawlingConfig, SelectorRule, FieldSelector, ReplyConfig } from '../../types';
import {
  ConflictItem,
  MERGE_FIELDS,
  MergeChoice,
  MergeField,
} from '../components/ConfigImportDialog';

export const useConfigImport = (currentConfigs: CrawlingConfig[]) => {
  const { t } = useTranslation();
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importFileName, setImportFileName] = useState('');
  const [importAdditions, setImportAdditions] = useState<CrawlingConfig[]>([]);
  const [importConflicts, setImportConflicts] = useState<ConflictItem[]>([]);
  const [isRemoteSync, setIsRemoteSync] = useState(false);

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

  const processConfigs = (configsToProcess: unknown[], isRemote: boolean) => {
    const validated = configsToProcess.filter(isCrawlingConfig).map(normalizeImportedConfig);
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

    const existingByDomain = new Map(currentConfigs.map((config) => [config.domain, config]));
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
          acc[field] = isRemote ? 'incoming' : 'current';
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
    setIsRemoteSync(isRemote);
    setImportOpen(true);
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
        const rawConfigs = JSON.parse(data) as unknown;
        if (!Array.isArray(rawConfigs)) {
          setImportError(t('options.crawlingConfigs.importInvalidFile'));
          setImportOpen(true);
          return;
        }
        processConfigs(rawConfigs, false);
      } catch {
        setImportError(t('options.crawlingConfigs.importInvalidFile'));
        setImportOpen(true);
      } finally {
        event.target.value = '';
      }
    };
    reader.readAsText(file);
  };

  const closeImport = () => {
    setImportOpen(false);
    setImportAdditions([]);
    setImportConflicts([]);
    setImportFileName('');
    setImportError(null);
    setIsRemoteSync(false);
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

  return {
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
    setImportError,
    setImportOpen,
    setIsRemoteSync,
    setImportAdditions,
    setImportConflicts,
  };
};
