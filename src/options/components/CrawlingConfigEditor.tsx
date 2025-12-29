import React from 'react';
import { CrawlingConfig, SelectorRule, FieldSelector, ReplyConfig } from '../../types';
import { useTranslation } from 'react-i18next';

interface Props {
  config: CrawlingConfig;
  onChange: (config: CrawlingConfig) => void;
  onCancel: () => void;
  onSave: () => void;
}

const SelectorInput: React.FC<{
  label: string;
  rule: SelectorRule;
  onChange: (rule: SelectorRule) => void;
  className?: string;
}> = ({ label, rule, onChange, className }) => (
  <div className={`flex flex-col gap-1 ${className}`}>
    <label className="text-sm font-medium text-gray-700">{label}</label>
    <div className="flex gap-2">
      <input
        type="text"
        value={rule.selector}
        onChange={(e) => onChange({ ...rule, selector: e.target.value })}
        className="flex-1 p-2 border rounded text-sm font-mono bg-slate-50"
        placeholder=".class or #id"
      />
      <select
        value={rule.type}
        onChange={(e) => onChange({ ...rule, type: e.target.value as 'css' | 'xpath' })}
        className="p-2 border rounded text-sm"
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
}> = ({ fields, onChange }) => {
  const updateField = (index: number, updates: Partial<FieldSelector>) => {
    const newFields = [...fields];
    newFields[index] = { ...newFields[index], ...updates };
    onChange(newFields);
  };

  const updateRule = (index: number, rule: SelectorRule) => {
    updateField(index, { rule });
  };

  return (
    <div className="space-y-3 pl-4 border-l-2 border-gray-100">
      {fields.map((field, idx) => (
        <div key={field.name} className="grid grid-cols-12 gap-2 items-start">
          <div className="col-span-2 pt-2">
            <span className="text-xs font-semibold uppercase text-gray-500">{field.name}</span>
          </div>
          <div className="col-span-7">
            <SelectorInput label="" rule={field.rule} onChange={(r) => updateRule(idx, r)} />
          </div>
          <div className="col-span-3">
            <input
              type="text"
              value={field.attribute || ''}
              onChange={(e) => updateField(idx, { attribute: e.target.value })}
              className="w-full p-2 border rounded text-sm font-mono mt-0.5"
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

  const handleContainerChange = (rule: SelectorRule) => onChange({ ...config, container: rule });
  const handleItemChange = (rule: SelectorRule) => onChange({ ...config, item: rule });
  const handleFieldsChange = (fields: FieldSelector[]) => onChange({ ...config, fields });

  const handleRepliesChange = (replies: ReplyConfig | undefined) =>
    onChange({ ...config, replies });

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm border space-y-6">
      <div className="flex justify-between items-center border-b pb-4">
        <h3 className="text-lg font-semibold">
          {t('options.crawlingConfigs.editing', { domain: config.domain })}
        </h3>
        <div className="space-x-2">
          <button onClick={onCancel} className="px-3 py-1 text-gray-600 hover:bg-gray-100 rounded">
            {t('options.crawlingConfigs.cancel')}
          </button>
          <button
            onClick={onSave}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {t('options.crawlingConfigs.saveChanges')}
          </button>
        </div>
      </div>

      {/* Main List Config */}
      <section className="space-y-4">
        <div>
          <label className="text-sm font-medium text-gray-700 block mb-1">
            {t('options.crawlingConfigs.domain')}
          </label>
          <input
            type="text"
            value={config.domain}
            onChange={(e) => onChange({ ...config, domain: e.target.value })}
            className="w-full p-2 border rounded text-sm font-mono bg-slate-50"
            placeholder={t('options.crawlingConfigs.domainHint')}
          />
        </div>

        <h4 className="font-medium text-gray-900 flex items-center gap-2 mt-4">
          <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs">
            1
          </span>
          {t('options.crawlingConfigs.commentSection')}
        </h4>
        <div className="pl-8 space-y-4">
          <SelectorInput
            label={t('options.crawlingConfigs.containerSelector')}
            rule={config.container}
            onChange={handleContainerChange}
          />
          <SelectorInput
            label={t('options.crawlingConfigs.itemSelector')}
            rule={config.item}
            onChange={handleItemChange}
          />

          <div className="mt-4">
            <label className="text-sm font-medium text-gray-700 block mb-2">
              {t('options.crawlingConfigs.fieldsExtraction')}
            </label>
            <FieldEditor fields={config.fields} onChange={handleFieldsChange} />
          </div>
        </div>
      </section>

      {/* Replies Config */}
      <section className="space-y-4 pt-4 border-t">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-gray-900 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs">
              2
            </span>
            {t('options.crawlingConfigs.repliesSection')}
          </h4>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
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
          <div className="pl-8 space-y-4 border-l-2 border-indigo-50 ml-3">
            <SelectorInput
              label={t('options.crawlingConfigs.replyToggle')}
              rule={config.replies.expandBtn || { selector: '', type: 'css' }}
              onChange={(r) => handleRepliesChange({ ...config.replies!, expandBtn: r })}
            />

            <SelectorInput
              label={t('options.crawlingConfigs.replyContainer')}
              rule={config.replies.container}
              onChange={(r) => handleRepliesChange({ ...config.replies!, container: r })}
            />

            <SelectorInput
              label={t('options.crawlingConfigs.replyItem')}
              rule={config.replies.item}
              onChange={(r) => handleRepliesChange({ ...config.replies!, item: r })}
            />

            <div className="mt-4">
              <label className="text-sm font-medium text-gray-700 block mb-2">
                {t('options.crawlingConfigs.replyFields')}
              </label>
              <FieldEditor
                fields={config.replies.fields}
                onChange={(f) => handleRepliesChange({ ...config.replies!, fields: f })}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
