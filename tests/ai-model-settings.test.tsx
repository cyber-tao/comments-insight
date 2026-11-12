/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIModelSettings } from '../src/options/components/AIModelSettings';
import { DEFAULT_ANALYSIS_PROMPT_TEMPLATE } from '../src/utils/prompts';
import { AI } from '../src/config/constants';
import { ErrorCode, ExtensionError } from '../src/utils/error-types';
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
    disabledDefaultConfigDomains: [],
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
            aiModel: { ...current.aiModel, ...next.aiModel },
            domAnalysisConfig: { ...current.domAnalysisConfig, ...next.domAnalysisConfig },
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
          contextWindowSize: 200000,
          maxOutputTokens: 4096,
          temperature: 1,
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
          contextWindowSize: 200000,
          maxOutputTokens: 4096,
          temperature: 1,
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

    const modelInput = await screen.findByDisplayValue('gpt-4.1');
    expect(modelInput).toBeTruthy();
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

  it.each(['getAvailableModels', 'testModel'] as const)(
    'explains how to resolve a redirect during %s',
    async (operation) => {
      extensionApiMock[operation].mockRejectedValueOnce(
        new ExtensionError(ErrorCode.AI_ENDPOINT_REDIRECT, 'Redirect'),
      );
      const { toast } = renderComponent();
      fireEvent.click(
        screen.getByRole('button', {
          name: operation === 'getAvailableModels' ? /options.fetchModels/i : /options.testModel/i,
        }),
      );
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('errors.aiEndpointRedirect'));
    },
  );

  it.each(['apiUrl', 'apiKey'] as const)(
    'ignores an old model response after %s changes and a newer request completes',
    async (field) => {
      let resolveOld!: (models: string[]) => void;
      extensionApiMock.getAvailableModels
        .mockReturnValueOnce(
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
        )
        .mockResolvedValueOnce(['new-model']);
      const { onSettingsChange, toast } = renderComponent();
      fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
      const input =
        field === 'apiUrl'
          ? screen.getByDisplayValue('https://api.example.com/v1')
          : screen.getByPlaceholderText('options.apiKeyPlaceholder');
      fireEvent.change(input, {
        target: { value: field === 'apiUrl' ? 'https://second.example/v1' : 'new-key' },
      });
      fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
      await waitFor(() => expect(screen.getByDisplayValue('new-model')).toBeTruthy());
      await act(async () => {
        resolveOld(['old-model']);
      });
      expect(screen.getByDisplayValue('new-model')).toBeTruthy();
      expect(screen.queryByDisplayValue('old-model')).toBeNull();
      expect(onSettingsChange).toHaveBeenLastCalledWith({ aiModel: { model: 'new-model' } });
      expect(toast.success).toHaveBeenCalledTimes(1);
    },
  );

  it('preserves a model entered by the user while discovery is pending', async () => {
    let resolveModels!: (models: string[]) => void;
    extensionApiMock.getAvailableModels.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveModels = resolve;
      }),
    );
    const { onSettingsChange } = renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
    fireEvent.change(screen.getByPlaceholderText('options.modelPlaceholder'), {
      target: { value: 'my-manual-model' },
    });
    await act(async () => {
      resolveModels(['discovered-model']);
    });
    expect(screen.getByDisplayValue('my-manual-model')).toBeTruthy();
    expect(onSettingsChange).toHaveBeenCalledOnce();
    expect(onSettingsChange).toHaveBeenCalledWith({ aiModel: { model: 'my-manual-model' } });
  });

  it('uses request identity even when credentials change away and back to their original value', async () => {
    let resolveOld!: (models: string[]) => void;
    extensionApiMock.getAvailableModels
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValueOnce(['current-model']);
    const { toast } = renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
    const key = screen.getByPlaceholderText('options.apiKeyPlaceholder');
    fireEvent.change(key, { target: { value: 'temporary-key' } });
    fireEvent.change(key, { target: { value: 'secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
    await waitFor(() => expect(screen.getByDisplayValue('current-model')).toBeTruthy());
    await act(async () => {
      resolveOld(['obsolete-model']);
    });
    expect(screen.getByDisplayValue('current-model')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it.each(['apiUrl', 'apiKey'] as const)(
    'clears the discovered list when %s changes',
    async (field) => {
      extensionApiMock.getAvailableModels.mockResolvedValueOnce(['gpt-4o-mini', 'other-model']);
      renderComponent();
      fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
      await waitFor(() =>
        expect(screen.queryByPlaceholderText('options.modelPlaceholder')).toBeNull(),
      );
      const input =
        field === 'apiUrl'
          ? screen.getByDisplayValue('https://api.example.com/v1')
          : screen.getByPlaceholderText('options.apiKeyPlaceholder');
      fireEvent.change(input, {
        target: { value: field === 'apiUrl' ? 'https://new.example/v1' : 'replacement-key' },
      });
      expect(screen.getByPlaceholderText('options.modelPlaceholder')).toBeTruthy();
    },
  );

  it.each(['empty', 'failure'] as const)(
    'restores manual model input after a discovery %s',
    async (outcome) => {
      extensionApiMock.getAvailableModels.mockResolvedValueOnce(['gpt-4o-mini', 'other-model']);
      const { onSettingsChange, toast } = renderComponent();
      fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
      await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
      if (outcome === 'empty') extensionApiMock.getAvailableModels.mockResolvedValueOnce([]);
      else extensionApiMock.getAvailableModels.mockRejectedValueOnce(new Error('discovery failed'));
      fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
      const manualInput = await screen.findByPlaceholderText('options.modelPlaceholder');
      fireEvent.change(manualInput, { target: { value: 'manual-after-failure' } });
      expect(onSettingsChange).toHaveBeenLastCalledWith({
        aiModel: { model: 'manual-after-failure' },
      });
      expect(outcome === 'empty' ? toast.info : toast.error).toHaveBeenCalledWith(
        outcome === 'empty' ? 'options.noModelsFound' : 'options.fetchModelsFailed',
      );
    },
  );

  it('suppresses obsolete discovery errors without changing a newer pending request', async () => {
    let rejectOld!: (reason: Error) => void;
    let resolveNew!: (models: string[]) => void;
    extensionApiMock.getAvailableModels
      .mockReturnValueOnce(
        new Promise((_resolve, reject) => {
          rejectOld = reject;
        }),
      )
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveNew = resolve;
        }),
      );
    const { toast } = renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
    fireEvent.change(screen.getByPlaceholderText('options.apiKeyPlaceholder'), {
      target: { value: 'new-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
    await act(async () => {
      rejectOld(new Error('old request failed'));
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(
      (screen.getByRole('button', { name: 'common.loading' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    await act(async () => {
      resolveNew(['new-model']);
    });
    expect(screen.getByDisplayValue('new-model')).toBeTruthy();
  });

  it('supports api key visibility, prompt reset, and placeholder details', () => {
    const { onSettingsChange } = renderComponent();

    const apiKeyInput = screen.getByPlaceholderText(
      'options.apiKeyPlaceholder',
    ) as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: /Show API Key/i }));
    expect(apiKeyInput.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: /Hide API Key/i }));
    expect(apiKeyInput.type).toBe('password');

    const resetButtons = screen.getAllByRole('button', { name: 'options.resetTemplate' });
    fireEvent.click(resetButtons[0]);
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        analyzerPromptTemplate: DEFAULT_ANALYSIS_PROMPT_TEMPLATE,
      }),
    );

    fireEvent.click(screen.getAllByRole('button', { name: /options.availablePlaceholders/i })[0]);

    expect(screen.getByText('{comments_data}')).toBeTruthy();
    expect(screen.getByText('*options.required')).toBeTruthy();
    expect(screen.getByText('options.placeholder_post_content')).toBeTruthy();
  });

  it('ignores invalid numeric model input and uses the configured default token value', () => {
    const settings = createSettings({
      aiModel: {
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'secret-key',
        model: 'gpt-4o-mini',
        contextWindowSize: 200000,
        maxOutputTokens: undefined,
        temperature: 1,
        topP: 0.95,
      },
    });
    const { onSettingsChange } = renderComponent(settings);
    const numericInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];

    expect(numericInputs[1].value).toBe(String(AI.DEFAULT_MAX_OUTPUT_TOKENS));

    for (const input of numericInputs) {
      fireEvent.change(input, { target: { value: '' } });
    }

    expect(onSettingsChange).not.toHaveBeenCalled();
  });
});
