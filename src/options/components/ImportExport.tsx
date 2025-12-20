import * as React from 'react';
import { useTranslation } from 'react-i18next';

interface ImportExportProps {
  onExport: () => void;
  onImport: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const ImportExport: React.FC<ImportExportProps> = ({ onExport, onImport }) => {
  const { t } = useTranslation();

  return (
    <section className="mb-8 bg-white p-6 rounded-lg shadow">
      <h2 className="text-xl font-semibold mb-4">{t('options.importExport')}</h2>

      <div className="flex gap-4">
        <button
          onClick={onExport}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          {t('options.exportSettings')}
        </button>
        <label className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 cursor-pointer">
          {t('options.importSettings')}
          <input type="file" accept=".json" onChange={onImport} className="hidden" />
        </label>
      </div>
    </section>
  );
};
