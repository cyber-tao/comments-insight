/**
 * @vitest-environment jsdom
 */

import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Options from '../src/options/Options';

const useSettingsMock = vi.hoisted(() => vi.fn());
const useThemeMock = vi.hoisted(() => vi.fn());

vi.mock('../src/options/hooks/useSettings', () => ({
  useSettings: useSettingsMock,
}));

vi.mock('../src/hooks/useTheme', () => ({
  useTheme: useThemeMock,
}));

vi.mock('../src/options/components/BasicSettings', () => ({
  BasicSettings: ({ onThemeChange }: { onThemeChange: (theme: 'light' | 'dark' | 'system') => void }) => (
    <button onClick={() => onThemeChange('dark')}>basic-settings</button>
  ),
}));

vi.mock('../src/options/components/AIModelSettings', () => ({
  AIModelSettings: () => <div>ai-model-settings</div>,
}));

vi.mock('../src/options/components/AdvancedSettings', () => ({
  AdvancedSettings: () => <div>advanced-settings</div>,
}));

vi.mock('../src/options/components/ConfigSettings', () => ({
  ConfigSettings: () => <div>config-settings</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function createSettingsState(overrides: Partial<ReturnType<typeof useSettingsMock>> = {}) {
  return {
    settings: {
      theme: 'system',
      aiModel: { model: 'gpt-4o-mini' },
    },
    saving: false,
    handleSettingsChange: vi.fn(),
    handleExport: vi.fn(),
    handleImport: vi.fn(),
    toast: { success: vi.fn(), error: vi.fn() },
    ToastContainer: () => <div>toast-container</div>,
    ...overrides,
  };
}

describe('Options', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsMock.mockReturnValue(createSettingsState());
    useThemeMock.mockReturnValue({ setTheme: vi.fn() });
  });

  it('shows loading state until settings are available', () => {
    useSettingsMock.mockReturnValue(createSettingsState({ settings: null }));

    render(<Options />);

    expect(screen.getByText('common.loading')).toBeTruthy();
  });

  it('renders extension tab actions and delegates import/export/theme changes', () => {
    render(<Options />);

    const settingsState = useSettingsMock.mock.results[0]?.value;
    const themeState = useThemeMock.mock.results[0]?.value;

    expect(screen.getByText('toast-container')).toBeTruthy();
    expect(screen.getByText('basic-settings')).toBeTruthy();
    expect(screen.getByText('ai-model-settings')).toBeTruthy();
    expect(screen.getByText('advanced-settings')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('common.import'), {
      target: { files: [new File(['{}'], 'settings.json', { type: 'application/json' })] },
    });
    expect(settingsState.handleImport).toHaveBeenCalled();

    fireEvent.click(screen.getByText('common.export'));
    expect(settingsState.handleExport).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByText('basic-settings'));
    expect(themeState.setTheme).toHaveBeenCalledWith('dark');
  });

  it('switches to crawling tab and shows saving indicator when active', () => {
    useSettingsMock.mockReturnValue(createSettingsState({ saving: true }));

    render(<Options />);

    fireEvent.click(screen.getByText('options.crawlingConfigs.title'));

    expect(screen.getByText('config-settings')).toBeTruthy();
    expect(screen.getByText('options.saving')).toBeTruthy();
  });
});