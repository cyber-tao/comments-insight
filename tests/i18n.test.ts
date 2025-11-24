import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock i18next
vi.mock('i18next', () => ({
  default: {
    use: vi.fn().mockReturnThis(),
    init: vi.fn(),
    t: vi.fn((key) => key),
  }
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  initReactI18next: {},
}));

describe('i18n Configuration', () => {
  // We need to reset modules to re-evaluate the i18n file logic
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal('navigator', { language: 'en-US' });
  });

  it('should initialize with default English language', async () => {
    const i18n = (await import('../src/utils/i18n')).default;
    expect(i18n.init).toHaveBeenCalledWith(expect.objectContaining({
      lng: 'en-US',
      fallbackLng: 'en-US',
    }));
  });

  it('should detect Chinese language', async () => {
    vi.stubGlobal('navigator', { language: 'zh-CN' });
    const i18n = (await import('../src/utils/i18n')).default;
    
    // Since module is cached, we might need to verify the logic function directly if exposed,
    // or rely on resetModules which re-imports.
    expect(i18n.init).toHaveBeenCalledWith(expect.objectContaining({
      lng: 'zh-CN',
    }));
  });
});

