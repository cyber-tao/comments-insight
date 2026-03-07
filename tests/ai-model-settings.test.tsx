/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIModelSettings } from '../src/options/components/AIModelSettings';
import { DEFAULT_ANALYSIS_PROMPT_TEMPLATE } from '../src/utils/prompts';
import type { Settings } from '../src/types';

const extensionApiMock = vi.hoisted(() => ({
  getAvailableModels: vi.fn(),
  testModel: vi.fn(),
}));

vi.mock('../src/utils/extension-api', () => ({
  ExtensionAPI: extensionApiMock,
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
      contextWindowSize: 131072,
      maxOutputTokens: 4096,
      temperature: 0.8,
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

function renderComponent(initialSettings: Settings = createSettings()) {
  const toast = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  const onSettingsChange = vi.fn();

  function Harness() {
    const [settings, setSettings] = React.useState(initialSettings);

    return (
      <AIModelSettings
        settings={settings}
        onSettingsChange={(next) => {
          onSettingsChange(next);
          setSettings((current) => ({
            ...current,
            ...next,
            aiModel: next.aiModel ?? current.aiModel,
          }));
        }}
        toast={toast}
      />
    );
  }

  return {
    ...render(<Harness />),
    onSettingsChange,
    toast,
  };
}

describe('AIModelSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extensionApiMock.getAvailableModels.mockResolvedValue([]);
    extensionApiMock.testModel.mockResolvedValue({ success: true });
  });

  it('warns when fetching or testing without required model configuration', async () => {
    const { toast } = renderComponent(
      createSettings({
        aiModel: {
          apiUrl: '',
          apiKey: '',
          model: '',
          contextWindowSize: 131072,
          maxOutputTokens: 4096,
          temperature: 0.8,
          topP: 0.95,
        },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
    fireEvent.click(screen.getByRole('button', { name: /options.testModel/i }));

    expect(toast.warning).toHaveBeenNthCalledWith(1, 'options.configureApiFirst');
    expect(toast.warning).toHaveBeenNthCalledWith(2, 'options.configureAllFields');
    expect(extensionApiMock.getAvailableModels).not.toHaveBeenCalled();
    expect(extensionApiMock.testModel).not.toHaveBeenCalled();
  });

  it('fetches models, switches to select mode, and applies the first available model', async () => {
    extensionApiMock.getAvailableModels.mockResolvedValue(['gpt-4.1', 'gpt-4o-mini']);
    const { onSettingsChange, toast } = renderComponent(
      createSettings({
        aiModel: {
          apiUrl: 'https://api.example.com/v1',
          apiKey: 'secret-key',
          model: 'missing-model',
          contextWindowSize: 131072,
          maxOutputTokens: 4096,
          temperature: 0.8,
          topP: 0.95,
        },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));

    await waitFor(() => {
      expect(extensionApiMock.getAvailableModels).toHaveBeenCalledWith(
        'https://api.example.com/v1',
        'secret-key',
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('options.modelsFound');
    });

    const modelSelect = (await screen.findByRole('combobox')) as HTMLSelectElement;
    expect(modelSelect.value).toBe('gpt-4.1');
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        aiModel: expect.objectContaining({
          model: 'gpt-4.1',
        }),
      }),
    );
  });

  it('shows info for empty model results and error for fetch failures', async () => {
    const { toast } = renderComponent();

    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith('options.noModelsFound');
    });

    extensionApiMock.getAvailableModels.mockRejectedValueOnce(new Error('network'));

    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('options.fetchModelsFailed');
    });
  });

  it('tests the configured model and reports success and failure responses', async () => {
    const { toast } = renderComponent();

    extensionApiMock.testModel.mockResolvedValueOnce({ success: true, response: 'pong' });
    fireEvent.click(screen.getByRole('button', { name: /options.testModel/i }));

    await waitFor(() => {
      expect(extensionApiMock.testModel).toHaveBeenCalledWith(
        expect.objectContaining({
          apiUrl: 'https://api.example.com/v1',
          model: 'gpt-4o-mini',
        }),
      );
    });

    expect(toast.success).toHaveBeenCalledWith('options.testSuccess: pong');

    extensionApiMock.testModel.mockResolvedValueOnce({ success: false, error: 'denied' });
    fireEvent.click(screen.getByRole('button', { name: /options.testModel/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('options.testFailed: denied');
    });
  });

  it('supports api key visibility, prompt reset, and placeholder details', () => {
    const { onSettingsChange } = renderComponent();

    const apiKeyInput = screen.getByPlaceholderText(
      'options.apiKeyPlaceholder',
    ) as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: /👁/ }));
    expect(apiKeyInput.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'options.resetTemplate' }));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        analyzerPromptTemplate: DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /options.availablePlaceholders/i }));

    expect(screen.getByText('{comments_data}')).toBeTruthy();
    expect(screen.getByText('*options.required')).toBeTruthy();
    expect(screen.getByText('options.placeholder_post_content')).toBeTruthy();
  });
});
