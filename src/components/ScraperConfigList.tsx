import * as React from 'react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScraperConfig } from '../types/scraper';
import { ScraperConfigManager } from '../utils/ScraperConfigManager';
import { ScraperConfigEditor } from './ScraperConfigEditor';

interface ScraperConfigListProps {
  onConfigChange?: () => void;
}

interface ImportConflict {
  imported: ScraperConfig;
  existing: ScraperConfig;
  reason: string;
}

export const ScraperConfigList: React.FC<ScraperConfigListProps> = ({ onConfigChange }) => {
  const { t } = useTranslation();
  const [configs, setConfigs] = useState<ScraperConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingConfig, setEditingConfig] = useState<ScraperConfig | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [showConflictDialog, setShowConflictDialog] = useState(false);
  const [conflictDecisions, setConflictDecisions] = useState<Array<'skip' | 'overwrite'>>([]);

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const loaded = await ScraperConfigManager.getAll();
      setConfigs(loaded);
    } catch (error) {
      console.error('[ScraperConfigList] Failed to load configs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('scraper.deleteConfirm'))) {
      return;
    }

    try {
      await ScraperConfigManager.delete(id);
      await loadConfigs();
      onConfigChange?.();
    } catch (error) {
      console.error('[ScraperConfigList] Failed to delete config:', error);
      alert(t('scraper.importError'));
    }
  };

  const handleEdit = (config: ScraperConfig) => {
    setEditingConfig(config);
    setShowEditor(true);
  };

  const handleNew = () => {
    setEditingConfig(null);
    setShowEditor(true);
  };

  const handleSave = async () => {
    setShowEditor(false);
    setEditingConfig(null);
    await loadConfigs();
    onConfigChange?.();
  };

  const handleCancel = () => {
    setShowEditor(false);
    setEditingConfig(null);
  };

  const handleExport = async () => {
    try {
      const json = await ScraperConfigManager.exportConfigs();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scraper-configs-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[ScraperConfigList] Failed to export:', error);
      alert('Failed to export configurations');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = event.target?.result as string;
        const result = await ScraperConfigManager.importConfigs(json, 'ask');

        // Check if there are conflicts
        if (result.conflicts && result.conflicts.length > 0) {
          setImportConflicts(result.conflicts);
          setConflictDecisions(new Array(result.conflicts.length).fill('skip'));
          setShowConflictDialog(true);
        } else {
          // No conflicts, import successful
          alert(t('scraper.importSuccess', { count: result.imported }));
          await loadConfigs();
          onConfigChange?.();
        }
      } catch (error) {
        console.error('[ScraperConfigList] Failed to import:', error);
        alert(
          t('scraper.importError') +
            ': ' +
            (error instanceof Error ? error.message : 'Unknown error'),
        );
      }
    };
    reader.readAsText(file);

    // Reset file input
    e.target.value = '';
  };

  const handleConflictDecision = (index: number, decision: 'skip' | 'overwrite') => {
    const newDecisions = [...conflictDecisions];
    newDecisions[index] = decision;
    setConflictDecisions(newDecisions);
  };

  const handleResolveConflicts = async () => {
    try {
      const importedCount = await ScraperConfigManager.resolveImportConflicts(
        importConflicts,
        conflictDecisions,
      );

      const skippedCount = conflictDecisions.filter((d) => d === 'skip').length;
      const overwrittenCount = conflictDecisions.filter((d) => d === 'overwrite').length;

      let message = '';
      if (importedCount > 0) {
        message += t('scraper.importSuccess', { count: importedCount });
      }
      if (skippedCount > 0) {
        message += `\n${t('scraper.skippedCount', { count: skippedCount })}`;
      }
      if (overwrittenCount > 0) {
        message += `\n${t('scraper.overwrittenCount', { count: overwrittenCount })}`;
      }

      alert(message || t('scraper.noChanges'));

      setShowConflictDialog(false);
      setImportConflicts([]);
      setConflictDecisions([]);
      await loadConfigs();
      onConfigChange?.();
    } catch (error) {
      console.error('[ScraperConfigList] Failed to resolve conflicts:', error);
      alert(
        t('scraper.importError') +
          ': ' +
          (error instanceof Error ? error.message : 'Unknown error'),
      );
    }
  };

  if (showEditor) {
    return (
      <ScraperConfigEditor
        config={editingConfig || undefined}
        onSave={handleSave}
        onCancel={handleCancel}
      />
    );
  }

  // Conflict resolution dialog
  if (showConflictDialog) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-white p-6 rounded-lg shadow-lg">
          <h2 className="text-2xl font-bold mb-4">{t('scraper.importConflicts')}</h2>
          <p className="text-gray-600 mb-6">{t('scraper.importConflictsHint')}</p>

          <div className="space-y-4 mb-6 max-h-96 overflow-y-auto">
            {importConflicts.map((conflict, index) => (
              <div key={index} className="border rounded-lg p-4 bg-gray-50">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-lg text-red-600">
                      ⚠️{' '}
                      {conflict.reason === 'duplicate_id'
                        ? t('scraper.duplicateId')
                        : t('scraper.duplicateDomain')}
                    </h3>
                    <div className="mt-2 grid grid-cols-2 gap-4">
                      <div className="bg-blue-50 p-3 rounded">
                        <p className="text-xs font-semibold text-blue-800 mb-1">
                          {t('scraper.importedConfig')}
                        </p>
                        <p className="font-medium">{conflict.imported.name}</p>
                        <p className="text-sm text-gray-600">
                          {conflict.imported.domains.join(', ')}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">ID: {conflict.imported.id}</p>
                      </div>
                      <div className="bg-yellow-50 p-3 rounded">
                        <p className="text-xs font-semibold text-yellow-800 mb-1">
                          {t('scraper.existingConfig')}
                        </p>
                        <p className="font-medium">{conflict.existing.name}</p>
                        <p className="text-sm text-gray-600">
                          {conflict.existing.domains.join(', ')}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">ID: {conflict.existing.id}</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleConflictDecision(index, 'skip')}
                    className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                      conflictDecisions[index] === 'skip'
                        ? 'bg-gray-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {t('scraper.skipThis')}
                  </button>
                  <button
                    onClick={() => handleConflictDecision(index, 'overwrite')}
                    className={`flex-1 px-4 py-2 rounded font-medium transition-colors ${
                      conflictDecisions[index] === 'overwrite'
                        ? 'bg-red-600 text-white'
                        : 'bg-red-200 text-red-700 hover:bg-red-300'
                    }`}
                  >
                    {t('scraper.overwriteThis')}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3 justify-end">
            <button
              onClick={() => {
                setShowConflictDialog(false);
                setImportConflicts([]);
                setConflictDecisions([]);
              }}
              className="px-6 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleResolveConflicts}
              className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              {t('scraper.applyDecisions')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold">{t('scraper.title')}</h2>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={configs.length === 0}
            className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300 text-sm"
          >
            📤 {t('scraper.exportAll')}
          </button>
          <label className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 cursor-pointer text-sm">
            📥 {t('scraper.importConfigs')}
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
          <button
            onClick={handleNew}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            + {t('scraper.newConfig')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-500">{t('common.loading')}</div>
      ) : configs.length === 0 ? (
        <div className="text-center py-12 bg-gray-50 rounded-lg">
          <p className="text-gray-600 mb-4">{t('scraper.noConfigs')}</p>
          <p className="text-sm text-gray-500 mb-6">{t('scraper.noConfigsHint')}</p>
          <button
            onClick={handleNew}
            className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            {t('scraper.createFirst')}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {configs.map((config) => (
            <div
              key={config.id}
              className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex justify-between items-start mb-3">
                <div>
                  <h3 className="text-lg font-semibold">{config.name}</h3>
                  <p className="text-sm text-gray-600 mt-1">
                    <span className="font-medium">{t('scraper.domains')}:</span>{' '}
                    {config.domains.join(', ')}
                  </p>
                  {config.urlPatterns.length > 0 && (
                    <p className="text-sm text-gray-600 mt-1">
                      <span className="font-medium">{t('scraper.urlPatterns')}:</span>{' '}
                      {config.urlPatterns.length} {t('scraper.patterns')}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">
                    {t('scraper.created')}: {new Date(config.createdAt).toLocaleString()} |
                    {t('scraper.updated')}: {new Date(config.updatedAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleEdit(config)}
                    className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm"
                  >
                    {t('scraper.edit')}
                  </button>
                  <button
                    onClick={() => handleDelete(config.id)}
                    className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm"
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>

              <details className="mt-3">
                <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:text-blue-800">
                  {t('scraper.viewSelectors')}
                </summary>
                <div className="mt-2 pl-4 space-y-1 text-sm font-mono bg-gray-50 p-3 rounded">
                  {Object.entries(config.selectors).map(([key, value]) => {
                    if (!value) return null;

                    const validationStatus = config.selectorValidation?.[key];
                    let statusIcon = null;

                    if (validationStatus === 'success') {
                      statusIcon = (
                        <span className="text-green-600 ml-2" title="Validated successfully">
                          ✓
                        </span>
                      );
                    } else if (validationStatus === 'failed') {
                      statusIcon = (
                        <span className="text-red-600 ml-2" title="Validation failed">
                          ✗
                        </span>
                      );
                    }

                    return (
                      <div key={key} className="flex items-center">
                        <span className="text-gray-600 w-40">{key}:</span>
                        <span className="text-gray-800 flex-1">{value}</span>
                        {statusIcon}
                      </div>
                    );
                  })}
                </div>
              </details>

              {config.scrollConfig?.enabled && (
                <div className="mt-2 text-sm text-gray-600 bg-blue-50 p-2 rounded">
                  🔄 {t('scraper.autoScrollEnabled')}: {config.scrollConfig.maxScrolls}{' '}
                  {t('scraper.scrollsDelay')} {config.scrollConfig.scrollDelay}ms
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
