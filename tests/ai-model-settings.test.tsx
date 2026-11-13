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
      protocol: 'openai-chat-completions',
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

  it.each([
    ['openai', 'https://api.openai.com/v1', 'openai-responses'],
    ['anthropic', 'https://api.anthropic.com/v1', 'anthropic-messages'],
    [
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta/openai',
      'openai-chat-completions',
    ],
    ['deepseek', 'https://api.deepseek.com', 'openai-chat-completions'],
    ['openrouter', 'https://openrouter.ai/api/v1', 'openai-chat-completions'],
  ])(
    'applies the %s preset while preserving existing credentials and model',
    (id, apiUrl, protocol) => {
      const { onSettingsChange } = renderComponent();
      fireEvent.change(screen.getByLabelText('options.providerPreset'), { target: { value: id } });
      expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({
        aiModel: { apiUrl, protocol },
      });
      expect((screen.getByLabelText('options.apiUrl') as HTMLInputElement).value).toBe(apiUrl);
      expect((screen.getByLabelText('options.apiProtocol') as HTMLSelectElement).value).toBe(
        protocol,
      );
      expect((screen.getByLabelText('options.apiKey') as HTMLInputElement).value).toBe(
        'secret-key',
      );
      expect((screen.getByLabelText('options.model') as HTMLInputElement).value).toBe(
        'gpt-4o-mini',
      );
      expect(screen.getByDisplayValue('200')).toBeTruthy();
      expect(screen.getByDisplayValue('4')).toBeTruthy();
      expect(screen.queryByText('options.temperature')).toBeNull();
      expect(screen.queryByText('options.topP')).toBeNull();
      expect(extensionApiMock.getAvailableModels).not.toHaveBeenCalled();
      expect(extensionApiMock.testModel).not.toHaveBeenCalled();
    },
  );

  it('keeps the current fields when selecting custom after a preset', () => {
    const { onSettingsChange } = renderComponent();
    fireEvent.change(screen.getByLabelText('options.providerPreset'), {
      target: { value: 'openai' },
    });
    fireEvent.change(screen.getByLabelText('options.apiKey'), { target: { value: 'openai-key' } });
    fireEvent.change(screen.getByLabelText('options.model'), { target: { value: 'manual-model' } });
    onSettingsChange.mockClear();
    fireEvent.change(screen.getByLabelText('options.providerPreset'), {
      target: { value: 'custom' },
    });
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
    expect(screen.getByDisplayValue('openai-key')).toBeTruthy();
    expect(screen.getByDisplayValue('manual-model')).toBeTruthy();
    expect((screen.getByLabelText('options.providerPreset') as HTMLSelectElement).value).toBe(
      'custom',
    );
    fireEvent.change(screen.getByLabelText('options.apiProtocol'), {
      target: { value: 'openai-chat-completions' },
    });
    expect((screen.getByLabelText('options.providerPreset') as HTMLSelectElement).value).toBe(
      'custom',
    );
  });

  it('keeps the key and model when a preset only changes the protocol at the same endpoint', () => {
    const initial = createSettings();
    initial.aiModel.apiUrl = ' https://API.openai.com:443/v1/chat/completions ';
    const { onSettingsChange } = renderComponent(initial);
    fireEvent.change(screen.getByLabelText('options.providerPreset'), {
      target: { value: 'openai' },
    });
    expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({
      aiModel: { apiUrl: 'https://api.openai.com/v1', protocol: 'openai-responses' },
    });
    expect(screen.getByDisplayValue('secret-key')).toBeTruthy();
    expect(screen.getByDisplayValue('gpt-4o-mini')).toBeTruthy();
  });

  it('identifies the provider by its endpoint after switching protocols', () => {
    const initial = createSettings();
    initial.aiModel.apiUrl = 'https://api.openai.com/v1';
    initial.aiModel.protocol = 'openai-responses';
    renderComponent(initial);
    fireEvent.change(screen.getByLabelText('options.apiProtocol'), {
      target: { value: 'openai-chat-completions' },
    });
    expect((screen.getByLabelText('options.providerPreset') as HTMLSelectElement).value).toBe(
      'openai',
    );
    expect(screen.getByDisplayValue('secret-key')).toBeTruthy();
    expect(screen.getByDisplayValue('gpt-4o-mini')).toBeTruthy();
  });

  it('leaves an empty model unselected after discovery and allows a custom model', async () => {
    const initial = createSettings();
    initial.aiModel.model = '';
    extensionApiMock.getAvailableModels.mockResolvedValue(['embedding-model', 'chat-model']);
    const { onSettingsChange, toast } = renderComponent(initial);
    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
    const input = screen.getByLabelText('options.model');
    expect((input as HTMLInputElement).value).toBe('');
    expect(onSettingsChange).not.toHaveBeenCalled();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'private-chat-model' } });
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('private-chat-model')).toBeTruthy();
    expect(onSettingsChange).toHaveBeenCalledExactlyOnceWith({
      aiModel: { model: 'private-chat-model' },
    });
  });

  it('ignores a connection test from a previous protocol and permits a new test', async () => {
    let resolveOld!: (result: { success: boolean; response: string }) => void;
    extensionApiMock.testModel
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValueOnce({ success: true, response: 'current response' });
    const { toast } = renderComponent();
    fireEvent.click(screen.getByRole('button', { name: /options.testModel/i }));
    fireEvent.change(screen.getByLabelText('options.apiProtocol'), {
      target: { value: 'anthropic-messages' },
    });
    expect(screen.getByDisplayValue('secret-key')).toBeTruthy();
    expect(screen.getByDisplayValue('gpt-4o-mini')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /options.testModel/i }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledExactlyOnceWith(
        'options.testSuccess: current response',
      ),
    );
    await act(async () => {
      resolveOld({ success: true, response: 'obsolete response' });
    });
    expect(toast.success).toHaveBeenCalledOnce();
    expect(extensionApiMock.testModel).toHaveBeenLastCalledWith(
      expect.objectContaining({ protocol: 'anthropic-messages' }),
    );
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
          protocol: 'openai-chat-completions',
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

  it('fetches model choices without overwriting a manually configured model', async () => {
    extensionApiMock.getAvailableModels.mockResolvedValue(['gpt-4.1', 'gpt-4o-mini']);
    const { onSettingsChange, toast } = renderComponent(
      createSettings({
        aiModel: {
          apiUrl: 'https://api.example.com/v1',
          apiKey: 'secret-key',
          model: 'missing-model',
          contextWindowSize: 200000,
          maxOutputTokens: 4096,
          protocol: 'openai-chat-completions',
        },
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));

    await waitFor(() => {
      expect(extensionApiMock.getAvailableModels).toHaveBeenCalledWith(
        'https://api.example.com/v1',
        'secret-key',
        'openai-chat-completions',
      );
    });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('options.modelsFound');
    });

    const modelInput = screen.getByDisplayValue('missing-model');
    expect(modelInput).toBeTruthy();
    expect(onSettingsChange).not.toHaveBeenCalled();
    fireEvent.focus(modelInput);
    expect(screen.getByRole('option', { name: 'gpt-4.1' })).toBeTruthy();
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
      expect(toast.error).toHaveBeenCalledWith('options.fetchModelsFailed: network');
    });
  });

  it.each([
    [ErrorCode.API_ERROR, 'HTTP 401: Invalid API key [REDACTED]'],
    [ErrorCode.AI_TIMEOUT, 'Model discovery timed out'],
  ])(
    'shows the safe discovery error %s and preserves the manually configured model',
    async (code, message) => {
      extensionApiMock.getAvailableModels.mockRejectedValueOnce(new ExtensionError(code, message));
      const { toast } = renderComponent();
      fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
      await waitFor(() =>
        expect(toast.error).toHaveBeenCalledExactlyOnceWith(
          `options.fetchModelsFailed: ${message}`,
        ),
      );
      expect(toast.info).not.toHaveBeenCalled();
      const input = screen.getByLabelText('options.model');
      expect((input as HTMLInputElement).value).toBe('gpt-4o-mini');
      fireEvent.change(input, { target: { value: 'manual-after-discovery-error' } });
      expect(screen.getByDisplayValue('manual-after-discovery-error')).toBeTruthy();
    },
  );

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

  it.each(['apiUrl', 'apiKey', 'protocol'] as const)(
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
      const { toast } = renderComponent();
      fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
      const input =
        field === 'apiUrl'
          ? screen.getByDisplayValue('https://api.example.com/v1')
          : field === 'apiKey'
            ? screen.getByPlaceholderText('options.apiKeyPlaceholder')
            : screen.getByLabelText('options.apiProtocol');
      fireEvent.change(input, {
        target: {
          value:
            field === 'apiUrl'
              ? 'https://second.example/v1'
              : field === 'apiKey'
                ? 'new-key'
                : 'openai-responses',
        },
      });
      fireEvent.click(screen.getByRole('button', { name: /options.fetchModels/i }));
      await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
      fireEvent.focus(screen.getByLabelText('options.model'));
      expect(screen.getByRole('option', { name: 'new-model' })).toBeTruthy();
      await act(async () => {
        resolveOld(['old-model']);
      });
      expect(screen.getByRole('option', { name: 'new-model' })).toBeTruthy();
      expect(screen.queryByRole('option', { name: 'old-model' })).toBeNull();
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
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce());
    fireEvent.focus(screen.getByLabelText('options.model'));
    expect(screen.getByRole('option', { name: 'current-model' })).toBeTruthy();
    await act(async () => {
      resolveOld(['obsolete-model']);
    });
    expect(screen.getByRole('option', { name: 'current-model' })).toBeTruthy();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it.each(['apiUrl', 'apiKey', 'protocol'] as const)(
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
          : field === 'apiKey'
            ? screen.getByPlaceholderText('options.apiKeyPlaceholder')
            : screen.getByLabelText('options.apiProtocol');
      fireEvent.change(input, {
        target: {
          value:
            field === 'apiUrl'
              ? 'https://new.example/v1'
              : field === 'apiKey'
                ? 'replacement-key'
                : 'anthropic-messages',
        },
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
        outcome === 'empty'
          ? 'options.noModelsFound'
          : 'options.fetchModelsFailed: discovery failed',
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
    fireEvent.focus(screen.getByLabelText('options.model'));
    expect(screen.getByRole('option', { name: 'new-model' })).toBeTruthy();
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

  it('ignores invalid numeric model input and uses the configured default token value in K', () => {
    const settings = createSettings({
      aiModel: {
        apiUrl: 'https://api.example.com/v1',
        apiKey: 'secret-key',
        model: 'gpt-4o-mini',
        contextWindowSize: 200000,
        maxOutputTokens: undefined,
        protocol: 'openai-chat-completions',
      },
    });
    const { onSettingsChange } = renderComponent(settings);
    const numericInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];

    expect(numericInputs[0].value).toBe('200');
    expect(numericInputs[1].value).toBe(String(AI.DEFAULT_MAX_OUTPUT_TOKENS / AI.TOKENS_PER_K));

    for (const input of numericInputs) {
      fireEvent.change(input, { target: { value: '' } });
    }

    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it('edits context window and max output tokens in K units and supports quick preset buttons', () => {
    const { onSettingsChange } = renderComponent();
    const numericInputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];

    fireEvent.change(numericInputs[0], { target: { value: '128' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      aiModel: {
        contextWindowSize: 128000,
        maxOutputTokens: 4096,
      },
    });

    fireEvent.change(numericInputs[1], { target: { value: '8' } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      aiModel: {
        maxOutputTokens: 8000,
      },
    });

    fireEvent.click(screen.getAllByRole('button', { name: '64K' })[0]);
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      aiModel: {
        contextWindowSize: 64000,
        maxOutputTokens: 8000,
      },
    });

    // When context window is 64K, max allowed output is 61000, so 64K and 128K output presets are disabled
    const presetButtons64K = screen.getAllByRole('button', { name: '64K' }) as HTMLButtonElement[];
    expect(presetButtons64K[1].disabled).toBe(true);
    expect((screen.getByRole('button', { name: '16K' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: '16K' }));
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      aiModel: {
        maxOutputTokens: 16000,
      },
    });
  });
});
