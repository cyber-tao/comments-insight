import * as React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { UI_LIMITS } from '@/config/constants';

interface SearchableModelSelectProps {
  models: string[];
  value: string;
  onChange: (model: string) => void;
}

export const SearchableModelSelect: React.FC<SearchableModelSelectProps> = ({
  models,
  value,
  onChange,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filteredModels = useMemo(() => {
    if (!searchTerm) return models;
    const lower = searchTerm.toLowerCase();
    return models.filter((m) => m.toLowerCase().includes(lower));
  }, [models, searchTerm]);

  useEffect(() => {
    setHighlightedIndex(-1);
  }, [filteredModels]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen && highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement | undefined;
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex, isOpen]);

  const handleSelect = useCallback(
    (model: string) => {
      onChange(model);
      setIsOpen(false);
      setSearchTerm('');
    },
    [onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex((prev) => (prev < filteredModels.length - 1 ? prev + 1 : prev));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < filteredModels.length) {
            handleSelect(filteredModels[highlightedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setSearchTerm('');
          break;
      }
    },
    [isOpen, filteredModels, highlightedIndex, handleSelect],
  );

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setIsOpen(true);
  }, []);

  const handleInputFocus = useCallback(() => {
    setIsOpen(true);
  }, []);

  const renderHighlightedText = useCallback(
    (text: string) => {
      if (!searchTerm) return text;
      const lower = text.toLowerCase();
      const idx = lower.indexOf(searchTerm.toLowerCase());
      if (idx === -1) return text;
      return (
        <>
          {text.slice(0, idx)}
          <mark
            style={{
              backgroundColor: 'var(--accent-primary-soft)',
              color: 'var(--accent-primary)',
              borderRadius: '2px',
              padding: '0 2px',
            }}
          >
            {text.slice(idx, idx + searchTerm.length)}
          </mark>
          {text.slice(idx + searchTerm.length)}
        </>
      );
    },
    [searchTerm],
  );

  const dropdownMaxHeight =
    UI_LIMITS.MODEL_SELECT_VISIBLE_ITEMS * UI_LIMITS.MODEL_SELECT_ITEM_HEIGHT_PX;

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex items-center theme-input cursor-pointer"
        onClick={() => {
          setIsOpen(true);
          inputRef.current?.focus();
        }}
        style={{ padding: 0, overflow: 'hidden' }}
      >
        <input
          ref={inputRef}
          type="text"
          value={isOpen ? searchTerm : value}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={isOpen ? t('options.searchModels') : value || t('options.modelPlaceholder')}
          className="flex-1 bg-transparent border-none outline-none"
          style={{
            color: 'var(--text-primary)',
            padding: '0.5rem 0.75rem',
            fontSize: 'inherit',
          }}
        />
        <div
          className="flex items-center justify-center px-2"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease',
            }}
          >
            <path
              d="M2 4L6 8L10 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {isOpen && (
        <div
          className="absolute z-50 w-full mt-1 rounded-lg shadow-lg overflow-hidden"
          style={{
            backgroundColor: 'var(--bg-input)',
            border: '1px solid var(--border-focus)',
          }}
        >
          {filteredModels.length === 0 ? (
            <div className="px-3 py-3 text-sm text-center" style={{ color: 'var(--text-muted)' }}>
              {t('options.noMatchingModels')}
            </div>
          ) : (
            <>
              <div
                className="text-xs px-3 py-1.5"
                style={{
                  color: 'var(--text-muted)',
                  borderBottom: '1px solid var(--border-primary)',
                }}
              >
                {t('options.matchingModelsCount', {
                  filtered: filteredModels.length,
                  total: models.length,
                })}
              </div>
              <div ref={listRef} style={{ maxHeight: `${dropdownMaxHeight}px`, overflowY: 'auto' }}>
                {filteredModels.map((model, index) => (
                  <div
                    key={model}
                    className="px-3 py-2 text-sm cursor-pointer transition-colors"
                    style={{
                      color: model === value ? 'var(--accent-primary)' : 'var(--text-primary)',
                      backgroundColor:
                        index === highlightedIndex ? 'var(--bg-tertiary)' : 'transparent',
                      fontWeight: model === value ? 600 : 400,
                    }}
                    onMouseEnter={() => setHighlightedIndex(index)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelect(model);
                    }}
                  >
                    {model === value && (
                      <span className="mr-1.5" style={{ fontSize: '10px' }}>
                        ✓
                      </span>
                    )}
                    {renderHighlightedText(model)}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
