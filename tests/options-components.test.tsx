/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BasicSettings } from '../src/options/components/BasicSettings';
import { AdvancedSettings } from '../src/options/components/AdvancedSettings';
import type { Settings } from '../src/types';

const i18nMock = vi.hoisted(() => ({
  changeLanguage: vi.fn(),
}));

vi.mock('../src/utils/i18n', () => ({
  default: i18nMock,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function createSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    maxComments: 100,
    aiModel: {
      apiUrl: 'https://api.example.com/v1',
      apiKey: 'secret-key',
      model: 'gpt-4o-mini',
      contextWindowSize: 200000,
      maxOutputTokens: 4096,
      temperature: 1,
      topP: 0.95,
    },
    aiTimeout: 120000,
    analyzerPromptTemplate: 'Custom template {comments_data}',
    language: 'en-US',
    theme: 'system',
    normalizeTimestamps: true,
    exportPostContentInMarkdown: false,
    selectorRetryAttempts: 3,
    selectorCache: [],
    crawlingConfigs: [],
    domAnalysisConfig: {
      initialDepth: 3,
      expandDepth: 2,
      maxDepth: 10,
    },
    developerMode: false,
    ...overrides,
  };
}

describe('BasicSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates max comments, language, theme, and checkbox settings', () => {
    const settings = createSettings();
    const onSettingsChange = vi.fn();
    const onThemeChange = vi.fn();

    render(
      <BasicSettings
        settings={settings}
        onSettingsChange={onSettingsChange}
        onThemeChange={onThemeChange}
      />,
    );

    const numberInput = screen.getByDisplayValue('100');
    fireEvent.change(numberInput, { target: { value: '250' } });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        maxComments: 250,
      }),
    );

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ja-JP' } });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        language: 'ja-JP',
      }),
    );
    expect(i18nMock.changeLanguage).toHaveBeenCalledWith('ja-JP');

    fireEvent.click(screen.getByRole('button', { name: /options.themeDark/i }));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: 'dark',
      }),
    );
    expect(onThemeChange).toHaveBeenCalledWith('dark');

    fireEvent.click(screen.getByLabelText('options.normalizeTimestamps'));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizeTimestamps: false,
      }),
    );

    fireEvent.click(screen.getByLabelText('options.exportPostContentInMarkdown'));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        exportPostContentInMarkdown: true,
      }),
    );
  });
});

describe('AdvancedSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates timeout, dom analysis config, and developer mode', () => {
    const settings = createSettings();
    const onSettingsChange = vi.fn();

    render(<AdvancedSettings settings={settings} onSettingsChange={onSettingsChange} />);

    const numericInputs = screen.getAllByRole('spinbutton');
    fireEvent.change(numericInputs[0], { target: { value: '180' } });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        aiTimeout: 180000,
      }),
    );

    fireEvent.change(numericInputs[1], { target: { value: '4' } });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        domAnalysisConfig: expect.objectContaining({
          initialDepth: 4,
          expandDepth: 2,
          maxDepth: 10,
        }),
      }),
    );

    fireEvent.change(numericInputs[2], { target: { value: '3' } });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        domAnalysisConfig: expect.objectContaining({
          initialDepth: 3,
          expandDepth: 3,
          maxDepth: 10,
        }),
      }),
    );

    fireEvent.change(numericInputs[3], { target: { value: '12' } });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        domAnalysisConfig: expect.objectContaining({
          initialDepth: 3,
          expandDepth: 2,
          maxDepth: 12,
        }),
      }),
    );

    fireEvent.click(screen.getByLabelText('options.developerMode'));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        developerMode: true,
      }),
    );
  });

  it('falls back to default dom analysis values when config is missing', () => {
    const settings = createSettings({
      domAnalysisConfig: undefined as unknown as Settings['domAnalysisConfig'],
    });
    const onSettingsChange = vi.fn();

    render(<AdvancedSettings settings={settings} onSettingsChange={onSettingsChange} />);

    fireEvent.change(screen.getByDisplayValue('5'), { target: { value: '6' } });
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        domAnalysisConfig: {
          initialDepth: 6,
          expandDepth: 3,
          maxDepth: 25,
        },
      }),
    );
  });
});
