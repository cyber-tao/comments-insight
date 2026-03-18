import React from 'react';
import { useTranslation } from 'react-i18next';
import { CrawlingConfig, FieldSelector, SelectorRule } from '../../types';

export type MergeChoice = 'current' | 'incoming';
export type MergeField =
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

export interface ConflictItem {
  existing: CrawlingConfig;
  incoming: CrawlingConfig;
  diffFields: MergeField[];
  choices: Record<MergeField, MergeChoice>;
}

export const MERGE_FIELDS: MergeField[] = [
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

interface ConfigImportDialogProps {
  isOpen: boolean;
  isRemoteSync: boolean;
  importFileName: string;
  importError: string | null;
  importAdditions: CrawlingConfig[];
  importConflicts: ConflictItem[];
  onClose: () => void;
  onApply: (conflicts: ConflictItem[]) => void;
  onConflictChange: (index: number, field: MergeField, choice: MergeChoice) => void;
  onAllConflictsChange: (choice: MergeChoice) => void;
}

export const ConfigImportDialog: React.FC<ConfigImportDialogProps> = ({
  isOpen,
  isRemoteSync,
  importFileName,
  importError,
  importAdditions,
  importConflicts,
  onClose,
  onApply,
  onConflictChange,
  onAllConflictsChange,
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const importHasChanges = importAdditions.length > 0 || importConflicts.length > 0;

  const findField = (fields: FieldSelector[] | undefined, name: string): FieldSelector | null => {
    return fields?.find((f) => f.name === name) || null;
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div
        className="rounded-lg shadow-lg w-full max-w-5xl p-6"
        style={{ backgroundColor: 'var(--bg-card)' }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {isRemoteSync
                ? t('options.crawlingConfigs.syncPreviewTitle')
                : t('options.crawlingConfigs.importTitle')}
            </h3>
            {!isRemoteSync && importFileName && (
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                {importFileName}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="hover:opacity-80 transition-opacity"
            style={{ color: 'var(--text-muted)' }}
            aria-label={t('common.cancel')}
          >
            ×
          </button>
        </div>
        {importError && (
          <div className="text-sm mb-3" style={{ color: 'var(--accent-danger)' }}>
            {importError}
          </div>
        )}
        {!importError && importConflicts.length === 0 && importAdditions.length === 0 && (
          <div className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>
            {t('options.crawlingConfigs.importEmpty')}
          </div>
        )}
        {!importError && (importConflicts.length > 0 || importAdditions.length > 0) && (
          <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
            {importAdditions.length > 0 && (
              <div className="border rounded p-4" style={{ borderColor: 'var(--border-primary)' }}>
                <div
                  className="text-sm font-semibold mb-2"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {t('options.crawlingConfigs.importNewConfigs')}
                </div>
                <div className="grid gap-2">
                  {importAdditions.map((config) => (
                    <div
                      key={config.id}
                      className="text-sm"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {config.domain}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {importConflicts.length > 0 && (
              <div
                className="border rounded-lg"
                style={{
                  borderColor: 'var(--accent-warning)',
                  backgroundColor: 'var(--bg-tertiary)',
                }}
              >
                <div
                  className="flex items-center justify-between p-4 border-b rounded-t-lg"
                  style={{
                    borderColor: 'var(--accent-warning)',
                    backgroundColor: 'rgba(251, 191, 36, 0.1)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-semibold"
                      style={{ color: 'var(--accent-warning)' }}
                    >
                      {t('options.crawlingConfigs.importConflicts')}
                    </span>
                    <span
                      className="px-2 py-0.5 text-xs font-medium rounded-full"
                      style={{
                        backgroundColor: 'rgba(251, 191, 36, 0.2)',
                        color: 'var(--accent-warning)',
                      }}
                    >
                      {importConflicts.length}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => onAllConflictsChange('current')}
                      className="px-3 py-1.5 text-xs font-medium rounded border transition-colors"
                      style={{
                        borderColor: 'var(--border-primary)',
                        backgroundColor: 'var(--bg-card)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {t('options.crawlingConfigs.mergeKeepAllCurrent')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onAllConflictsChange('incoming')}
                      className="px-3 py-1.5 text-xs font-medium rounded border transition-colors"
                      style={{
                        borderColor: 'var(--accent-secondary)',
                        backgroundColor: 'rgba(52, 211, 153, 0.1)',
                        color: 'var(--accent-secondary)',
                      }}
                    >
                      {t('options.crawlingConfigs.mergeUseAllIncoming')}
                    </button>
                  </div>
                </div>
                <div className="p-4 space-y-4">
                  {importConflicts.map((conflict, conflictIndex) => (
                    <div
                      key={conflict.existing.domain}
                      className="border rounded-lg shadow-sm"
                      style={{
                        borderColor: 'var(--border-primary)',
                        backgroundColor: 'var(--bg-card)',
                      }}
                    >
                      <div
                        className="px-4 py-3 border-b rounded-t-lg"
                        style={{
                          backgroundColor: 'var(--bg-tertiary)',
                          borderColor: 'var(--border-primary)',
                        }}
                      >
                        <span
                          className="text-sm font-semibold"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {conflict.existing.domain}
                        </span>
                        <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                          ({conflict.diffFields.length}{' '}
                          {conflict.diffFields.length === 1 ? 'field' : 'fields'})
                        </span>
                      </div>
                      {conflict.diffFields.length === 0 && (
                        <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>
                          {t('options.crawlingConfigs.importNoDifferences')}
                        </div>
                      )}
                      {conflict.diffFields.length > 0 && (
                        <div
                          className="divide-y"
                          style={{ borderColor: 'var(--border-secondary)' }}
                        >
                          {conflict.diffFields.map((field) => (
                            <div
                              key={field}
                              className="p-3"
                              style={{ borderBottom: '1px solid var(--border-secondary)' }}
                            >
                              <div
                                className="text-xs font-medium mb-2"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                {getFieldLabel(field)}
                              </div>
                              <div className="grid grid-cols-2 gap-3">
                                <label
                                  className="flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors"
                                  style={{
                                    borderColor:
                                      conflict.choices[field] === 'current'
                                        ? 'var(--accent-primary)'
                                        : 'var(--border-primary)',
                                    backgroundColor:
                                      conflict.choices[field] === 'current'
                                        ? 'rgba(59, 130, 246, 0.1)'
                                        : 'transparent',
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name={`${conflict.existing.domain}-${field}`}
                                    checked={conflict.choices[field] === 'current'}
                                    onChange={() =>
                                      onConflictChange(conflictIndex, field, 'current')
                                    }
                                    className="mt-0.5"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div
                                      className="text-xs font-medium mb-1"
                                      style={{ color: 'var(--text-secondary)' }}
                                    >
                                      {t('options.crawlingConfigs.mergeKeepCurrent')}
                                    </div>
                                    <div
                                      className="text-xs break-all font-mono px-1.5 py-0.5 rounded"
                                      style={{
                                        backgroundColor: 'var(--bg-tertiary)',
                                        color: 'var(--text-primary)',
                                      }}
                                    >
                                      {formatFieldValue(conflict.existing, field) ||
                                        t('options.crawlingConfigs.valueEmpty')}
                                    </div>
                                  </div>
                                </label>
                                <label
                                  className="flex items-start gap-2 p-2 rounded border cursor-pointer transition-colors"
                                  style={{
                                    borderColor:
                                      conflict.choices[field] === 'incoming'
                                        ? 'var(--accent-secondary)'
                                        : 'var(--border-primary)',
                                    backgroundColor:
                                      conflict.choices[field] === 'incoming'
                                        ? 'rgba(16, 185, 129, 0.1)'
                                        : 'transparent',
                                  }}
                                >
                                  <input
                                    type="radio"
                                    name={`${conflict.existing.domain}-${field}`}
                                    checked={conflict.choices[field] === 'incoming'}
                                    onChange={() =>
                                      onConflictChange(conflictIndex, field, 'incoming')
                                    }
                                    className="mt-0.5"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <div
                                      className="text-xs font-medium mb-1"
                                      style={{ color: 'var(--accent-secondary)' }}
                                    >
                                      {t('options.crawlingConfigs.mergeUseIncoming')}
                                    </div>
                                    <div
                                      className="text-xs break-all font-mono px-1.5 py-0.5 rounded"
                                      style={{
                                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                        color: 'var(--text-primary)',
                                      }}
                                    >
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
            onClick={onClose}
            className="px-4 py-2 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => onApply(importConflicts)}
            className="px-4 py-2 text-sm rounded bg-green-600 text-white hover:bg-green-700"
            disabled={!!importError || !importHasChanges}
          >
            {t('options.crawlingConfigs.importApply')}
          </button>
        </div>
      </div>
    </div>
  );
};
