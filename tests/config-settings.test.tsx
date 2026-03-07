/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigSettings } from '../src/options/components/ConfigSettings';
import type { CrawlingConfig, Settings } from '../src/types';

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('../src/utils/logger', () => ({
  Logger: loggerMock,
}));

vi.mock('../src/options/components/CrawlingConfigEditor', () => ({
  CrawlingConfigEditor: ({
    config,
    onSave,
    onCancel,
  }: {
    config: { domain: string };
    onSave: () => void;
    onCancel: () => void;
  }) => (
    <div>
      <div>editor:{config.domain}</div>
      <button onClick={onSave}>editor-save</button>
      <button onClick={onCancel}>editor-cancel</button>
    </div>
  ),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'options.crawlingConfigs.syncSuccessWithCount') {
        return `sync:${String(options?.added)}/${String(options?.updated)}`;
      }
      return key;
    },
  }),
}));

function createConfig(overrides: Partial<CrawlingConfig> = {}): CrawlingConfig {
  return {
    id: 'config-1',
    domain: 'example.com',
    siteName: 'Example',
    lastUpdated: 1700000000000,
    container: { selector: '.comments', type: 'css' },
    item: { selector: '.comment', type: 'css' },
    fields: [
      { name: 'username', rule: { selector: '.author', type: 'css' } },
      { name: 'content', rule: { selector: '.content', type: 'css' } },
      { name: 'timestamp', rule: { selector: '.time', type: 'css' } },
      { name: 'likes', rule: { selector: '.likes', type: 'css' } },
    ],
    ...overrides,
  };
}

function createSettings(configs: CrawlingConfig[] = []): Settings {
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
    crawlingConfigs: configs,
    domAnalysisConfig: {
      initialDepth: 5,
      expandDepth: 3,
      maxDepth: 25,
    },
    developerMode: false,
  };
}

describe('ConfigSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('fetch', vi.fn());
  });

  it('renders empty state and validates export selection', () => {
    render(<ConfigSettings settings={createSettings()} onSettingsChange={vi.fn()} />);

    expect(screen.getByText('options.crawlingConfigs.noConfigs')).toBeTruthy();
    fireEvent.click(screen.getByText('options.crawlingConfigs.exportConfig'));
    expect(screen.getByText('options.crawlingConfigs.exportSelectAtLeastOne')).toBeTruthy();
  });

  it('supports add, save, edit cancel, and delete flows', () => {
    const onSettingsChange = vi.fn();
    render(
      <ConfigSettings
        settings={createSettings([createConfig()])}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByText('options.crawlingConfigs.newConfig'));
    expect(screen.getByText('editor:new-site.com')).toBeTruthy();

    fireEvent.click(screen.getByText('editor-save'));
    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        crawlingConfigs: expect.arrayContaining([
          expect.objectContaining({ domain: 'example.com' }),
          expect.objectContaining({ domain: 'new-site.com' }),
        ]),
      }),
    );

    fireEvent.click(screen.getByText('options.crawlingConfigs.edit'));
    expect(screen.getByText('editor:example.com')).toBeTruthy();
    fireEvent.click(screen.getByText('editor-cancel'));
    expect(screen.getByText('example.com')).toBeTruthy();

    fireEvent.click(screen.getByText('options.crawlingConfigs.delete'));
    expect(confirm).toHaveBeenCalledWith('options.crawlingConfigs.confirmDelete');
    expect(onSettingsChange).toHaveBeenCalledWith({ crawlingConfigs: [] });
  });

  it('exports selected configs and can cancel the sync dialog', () => {
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        vi.spyOn(element as HTMLAnchorElement, 'click').mockImplementation(clickSpy);
      }
      return element;
    }) as typeof document.createElement);

    render(
      <ConfigSettings settings={createSettings([createConfig()])} onSettingsChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByText('options.crawlingConfigs.exportConfig'));
    expect(createObjectURLSpy).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test');

    fireEvent.click(screen.getByText('options.crawlingConfigs.syncRemote'));
    expect(screen.getByText('options.crawlingConfigs.syncDialogTitle')).toBeTruthy();
    fireEvent.click(screen.getByText('common.cancel'));
    expect(screen.queryByText('options.crawlingConfigs.syncDialogTitle')).toBeNull();
  });

  it('applies remote sync additions after confirmation', async () => {
    const onSettingsChange = vi.fn();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [createConfig({ id: 'config-2', domain: 'remote.com' })],
    } as Response);

    render(
      <ConfigSettings
        settings={createSettings([createConfig()])}
        onSettingsChange={onSettingsChange}
      />,
    );

    fireEvent.click(screen.getByText('options.crawlingConfigs.syncRemote'));
    fireEvent.click(screen.getByText('options.crawlingConfigs.syncDialogConfirm'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledOnce();
      expect(screen.getByText('remote.com')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('options.crawlingConfigs.importApply'));

    expect(onSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({
        crawlingConfigs: expect.arrayContaining([
          expect.objectContaining({ domain: 'example.com' }),
          expect.objectContaining({ domain: 'remote.com' }),
        ]),
      }),
    );
  });
});
