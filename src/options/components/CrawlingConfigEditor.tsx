import * as React from 'react';
import {
  CrawlingConfig,
  SelectorRule,
  FieldSelector,
  FieldValidationStatus,
  ReplyConfig,
} from '../../types';
import { useTranslation } from 'react-i18next';

const STANDARD_FIELDS = ['username', 'content', 'timestamp', 'likes'] as const;

const normalizeFields = (fields: FieldSelector[]): FieldSelector[] => {
  const existingNames = new Set(fields.map((f) => f.name));
  const normalized = [...fields];

  for (const name of STANDARD_FIELDS) {
    if (!existingNames.has(name)) {
      normalized.push({
        name,
        rule: { selector: '', type: 'css' },
      });
    }
  }

  return normalized.sort(
    (a, b) => STANDARD_FIELDS.indexOf(a.name as any) - STANDARD_FIELDS.indexOf(b.name as any),
  );
};

interface Props {
  config: CrawlingConfig;
  onChange: (config: CrawlingConfig) => void;
  onCancel: () => void;
  onSave: () => void;
}

const ValidationIndicator: React.FC<{
  status?: FieldValidationStatus;
}> = ({ status }) => {
  if (!status) return null;
  if (status === 'success') {
    return (
      <span className="text-green-500 text-sm font-bold" title="Matched">
        &#10003;
      </span>
    );
  }
  return (
    <span className="text-red-500 text-sm font-bold" title="Not matched">
      &#10007;
    </span>
  );
};

const SelectorInput: React.FC<{
  label: string;
  rule: SelectorRule;
  onChange: (rule: SelectorRule) => void;
  className?: string;
  validationStatus?: FieldValidationStatus;
}> = ({ label, rule, onChange, className, validationStatus }) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    <label
      className="text-sm font-medium flex items-center gap-1.5"
      style={{ color: 'var(--text-secondary)' }}
    >
      {label}
      <ValidationIndicator status={validationStatus} />
    </label>
    <div className="flex gap-2">
      <input
        type="text"
        value={rule.selector}
        onChange={(e) => onChange({ ...rule, selector: e.target.value })}
        className="flex-1 p-2 border rounded text-sm font-mono theme-input"
        placeholder=".class or #id"
      />
      <select
        value={rule.type}
        onChange={(e) => onChange({ ...rule, type: e.target.value as 'css' | 'xpath' })}
        className="p-2 border rounded text-sm theme-input"
      >
        <option value="css">CSS</option>
        <option value="xpath">XPath</option>
      </select>
    </div>
  </div>
);

const FieldEditor: React.FC<{
  fields: FieldSelector[];
  onChange: (fields: FieldSelector[]) => void;
  fieldValidation?: Record<string, FieldValidationStatus>;
}> = ({ fields, onChange, fieldValidation }) => {
  const updateField = (index: number, updates: Partial<FieldSelector>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    onChange(newFields);
  };

  const updateRule = (index: number, rule: SelectorRule) => {
    updateField(index, { rule });
  };

  return (
    <div className="space-y-3 pl-4 border-l-2" style={{ borderColor: 'var(--border-secondary)' }}>
      {fields.map((field, idx) => (
        <div key={field.name} className="grid grid-cols-12 gap-2 items-start">
          <div className="col-span-2 pt-2 flex items-center gap-1">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--text-muted)' }}
            >
              {field.name}
            </span>
            <ValidationIndicator status={fieldValidation?.[field.name]} />
          </div>
          <div className="col-span-7">
            <SelectorInput label="" rule={field.rule} onChange={(r) => updateRule(idx, r)} />
          </div>
          <div className="col-span-3">
            <input
              type="text"
              value={field.attribute || ''}
              onChange={(e) => updateField(idx, { attribute: e.target.value })}
              className="w-full p-2 border rounded text-sm font-mono mt-0.5 theme-input"
              placeholder="Attribute (opt)"
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export const CrawlingConfigEditor: React.FC<Props> = ({ config, onChange, onCancel, onSave }) => {
  const { t } = useTranslation();
  const fv = config.fieldValidation;

  const handleContainerChange = (rule: SelectorRule) => onChange({ ...config, container: rule });
  const handleItemChange = (rule: SelectorRule) => onChange({ ...config, item: rule });
  const handleFieldsChange = (fields: FieldSelector[]) => onChange({ ...config, fields });

  const handleRepliesChange = (replies: ReplyConfig | undefined) =>
    onChange({ ...config, replies });

  return (
    <div
      className="p-6 rounded-lg shadow-sm border space-y-6"
      style={{
        backgroundColor: 'var(--bg-card)',
        borderColor: 'var(--border-primary)',
      }}
    >
      <div
        className="flex justify-between items-center border-b pb-4"
        style={{ borderColor: 'var(--border-primary)' }}
      >
        <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          {t('options.crawlingConfigs.editing', { domain: config.domain })}
        </h3>
        <div className="space-x-2">
          <button
            onClick={onCancel}
            className="px-3 py-1 rounded theme-button-secondary"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('options.crawlingConfigs.cancel')}
          </button>
          <button
            onClick={onSave}
            className="px-3 py-1 rounded text-white"
            style={{ backgroundColor: 'var(--accent-primary)' }}
          >
            {t('options.crawlingConfigs.saveChanges')}
          </button>
        </div>
      </div>

      {/* Main List Config */}
      <section className="space-y-4">
        <div>
          <label
            className="text-sm font-medium block mb-1"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('options.crawlingConfigs.domain')}
          </label>
          <input
            type="text"
            value={config.domain}
            onChange={(e) => onChange({ ...config, domain: e.target.value })}
            className="w-full p-2 border rounded text-sm font-mono theme-input"
            placeholder={t('options.crawlingConfigs.domainHint')}
          />
        </div>

        <h4 className="font-medium flex items-center gap-2 mt-4">
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
            style={{
              backgroundColor: 'rgba(59, 130, 246, 0.2)',
              color: 'var(--accent-primary)',
            }}
          >
            1
          </span>
          <span style={{ color: 'var(--text-primary)' }}>
            {t('options.crawlingConfigs.commentSection')}
          </span>
        </h4>
        <div className="pl-8 space-y-4">
          <SelectorInput
            label={t('options.crawlingConfigs.containerSelector')}
            rule={config.container}
            onChange={handleContainerChange}
            validationStatus={fv?.['container']}
          />
          <SelectorInput
            label={t('options.crawlingConfigs.itemSelector')}
            rule={config.item}
            onChange={handleItemChange}
            validationStatus={fv?.['item']}
          />

          <div className="mt-4">
            <label
              className="text-sm font-medium block mb-2"
              style={{ color: 'var(--text-secondary)' }}
            >
              {t('options.crawlingConfigs.fieldsExtraction')}
            </label>
            <FieldEditor
              fields={normalizeFields(config.fields)}
              onChange={handleFieldsChange}
              fieldValidation={fv}
            />
          </div>
        </div>
      </section>

      {/* Replies Config */}
      <section
        className="space-y-4 pt-4 border-t"
        style={{ borderColor: 'var(--border-secondary)' }}
      >
        <div className="flex items-center justify-between">
          <h4 className="font-medium flex items-center gap-2">
            <span
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
              style={{
                backgroundColor: 'rgba(99, 102, 241, 0.2)',
                color: 'var(--accent-secondary)', // Using secondary or indigo-like color
              }}
            >
              2
            </span>
            <span style={{ color: 'var(--text-primary)' }}>
              {t('options.crawlingConfigs.repliesSection')}
            </span>
          </h4>
          <label
            className="flex items-center gap-2 text-sm cursor-pointer theme-checkbox-label"
            style={{ color: 'var(--text-secondary)' }}
          >
            <input
              type="checkbox"
              checked={!!config.replies}
              onChange={(e) => {
                if (e.target.checked) {
                  handleRepliesChange({
                    container: { selector: '', type: 'css' },
                    item: { selector: '', type: 'css' },
                    fields: config.fields.map((f) => ({
                      ...f,
                      rule: { selector: '', type: 'css' },
                      attribute: '',
                    })),
                    expandBtn: { selector: '', type: 'css' },
                  });
                } else {
                  handleRepliesChange(undefined);
                }
              }}
            />
            {t('options.crawlingConfigs.enableReplies')}
          </label>
        </div>

        {config.replies && (
          <div
            className="pl-8 space-y-4 border-l-2 ml-3"
            style={{ borderColor: 'var(--border-secondary)' }}
          >
            <SelectorInput
              label={t('options.crawlingConfigs.replyToggle')}
              rule={config.replies.expandBtn || { selector: '', type: 'css' }}
              onChange={(r) => handleRepliesChange({ ...config.replies!, expandBtn: r })}
              validationStatus={fv?.['replies.expandBtn']}
            />

            <SelectorInput
              label={t('options.crawlingConfigs.replyContainer')}
              rule={config.replies.container}
              onChange={(r) => handleRepliesChange({ ...config.replies!, container: r })}
              validationStatus={fv?.['replies.container']}
            />

            <SelectorInput
              label={t('options.crawlingConfigs.replyItem')}
              rule={config.replies.item}
              onChange={(r) => handleRepliesChange({ ...config.replies!, item: r })}
              validationStatus={fv?.['replies.item']}
            />

            <div className="mt-4">
              <label
                className="text-sm font-medium block mb-2"
                style={{ color: 'var(--text-secondary)' }}
              >
                {t('options.crawlingConfigs.replyFields')}
              </label>
              <FieldEditor
                fields={normalizeFields(config.replies.fields)}
                onChange={(f) => handleRepliesChange({ ...config.replies!, fields: f })}
              />
            </div>
          </div>
        )}
      </section>

      {/* Video/Post Time Config */}
      <section
        className="space-y-4 pt-4 border-t"
        style={{ borderColor: 'var(--border-secondary)' }}
      >
        <h4 className="font-medium flex items-center gap-2">
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              color: 'var(--accent-secondary)',
            }}
          >
            3
          </span>
          <span style={{ color: 'var(--text-primary)' }}>
            {t('options.crawlingConfigs.videoTimeSection')}
          </span>
        </h4>
        <div className="pl-8 space-y-2">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('options.crawlingConfigs.videoTimeHint')}
          </p>
          <SelectorInput
            label={t('options.crawlingConfigs.videoTimeSelector')}
            rule={config.videoTime || { selector: '', type: 'css' }}
            onChange={(r) => onChange({ ...config, videoTime: r.selector ? r : undefined })}
            validationStatus={fv?.['videoTime']}
          />
        </div>
      </section>

      {/* Post Content Config */}
      <section
        className="space-y-4 pt-4 border-t"
        style={{ borderColor: 'var(--border-secondary)' }}
      >
        <h4 className="font-medium flex items-center gap-2">
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
            style={{
              backgroundColor: 'rgba(16, 185, 129, 0.2)',
              color: 'var(--accent-secondary)',
            }}
          >
            4
          </span>
          <span style={{ color: 'var(--text-primary)' }}>
            {t('options.crawlingConfigs.postContentSection')}
          </span>
        </h4>
        <div className="pl-8 space-y-2">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t('options.crawlingConfigs.postContentHint')}
          </p>
          <SelectorInput
            label={t('options.crawlingConfigs.postContentSelector')}
            rule={config.postContent || { selector: '', type: 'css' }}
            onChange={(r) => onChange({ ...config, postContent: r.selector ? r : undefined })}
            validationStatus={fv?.['postContent']}
          />
        </div>
      </section>
    </div>
  );
};
