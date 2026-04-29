import { Settings, HistoryItem, CrawlingConfig } from '../types';
import { PAGINATION } from '@/config/constants';
import { SettingsStore } from './storage/SettingsStore';
import { HistoryStore } from './storage/HistoryStore';
import { EncryptionService } from './storage/EncryptionService';
import { LogStore } from './storage/LogStore';

export class StorageManager {
  private encryptionService: EncryptionService;
  private settingsStore: SettingsStore;
  private historyStore: HistoryStore;
  private logStore: LogStore;

  constructor() {
    this.encryptionService = new EncryptionService();
    this.settingsStore = new SettingsStore(this.encryptionService);
    this.historyStore = new HistoryStore();
    this.logStore = new LogStore();
  }

  async getSettings(): Promise<Settings> {
    return this.settingsStore.getSettings();
  }

  async saveSettings(settings: Partial<Settings>): Promise<void> {
    return this.settingsStore.saveSettings(settings);
  }

  async exportSettings(): Promise<string> {
    return this.settingsStore.exportSettings();
  }

  async importSettings(data: string): Promise<void> {
    return this.settingsStore.importSettings(data);
  }

  async updateSelectorCache(hostname: string, selector: string): Promise<void> {
    return this.settingsStore.updateSelectorCache(hostname, selector);
  }

  async getCrawlingConfig(domain: string): Promise<CrawlingConfig | null> {
    return this.settingsStore.getCrawlingConfig(domain);
  }

  async saveCrawlingConfig(config: CrawlingConfig): Promise<void> {
    return this.settingsStore.saveCrawlingConfig(config);
  }

  async syncCrawlingConfigs(): Promise<{ added: number; updated: number }> {
    return this.settingsStore.syncCrawlingConfigs();
  }

  async recordTokenUsage(tokens: number): Promise<void> {
    return this.settingsStore.recordTokenUsage(tokens);
  }

  async getTokenStats(): Promise<{ today: number; total: number; lastReset: number }> {
    return this.settingsStore.getTokenStats();
  }

  async enableEncryption(passphrase: string): Promise<void> {
    return this.encryptionService.enableEncryption(passphrase);
  }

  disableEncryption(): void {
    return this.encryptionService.disableEncryption();
  }

  async saveHistory(item: HistoryItem): Promise<void> {
    return this.historyStore.saveHistory(item);
  }

  async getLatestHistoryIdByUrl(url: string): Promise<string | null> {
    return this.historyStore.getLatestHistoryIdByUrl(url);
  }

  async clearAllHistory(): Promise<number> {
    return this.historyStore.clearAllHistory();
  }

  async getHistory(): Promise<HistoryItem[]> {
    return this.historyStore.getHistory();
  }

  async getHistoryPage(page: number = 0, pageSize: number = PAGINATION.DEFAULT_PER_PAGE) {
    return this.historyStore.getHistoryPage(page, pageSize);
  }

  async getHistoryMetadataPage(page: number = 0, pageSize: number = PAGINATION.DEFAULT_PER_PAGE) {
    return this.historyStore.getHistoryMetadataPage(page, pageSize);
  }

  async searchHistoryMetadataPage(
    query: string,
    page: number = 0,
    pageSize: number = PAGINATION.DEFAULT_PER_PAGE,
  ) {
    return this.historyStore.searchHistoryMetadataPage(query, page, pageSize);
  }

  async searchHistoryPaginated(
    query: string,
    page: number = 0,
    pageSize: number = PAGINATION.DEFAULT_PER_PAGE,
  ) {
    return this.historyStore.searchHistoryPaginated(query, page, pageSize);
  }

  async getHistoryItem(id: string): Promise<HistoryItem | undefined> {
    return this.historyStore.getHistoryItem(id);
  }

  async deleteHistoryItem(id: string): Promise<void> {
    return this.historyStore.deleteHistoryItem(id);
  }

  async searchHistory(query: string): Promise<HistoryItem[]> {
    return this.historyStore.searchHistory(query);
  }

  invalidateSortedIndexCache(): void {
    return this.historyStore.invalidateSortedIndexCache();
  }

  async saveAiLog(
    logKey: string,
    entry: { type: 'extraction' | 'analysis'; timestamp: number; prompt: string; response: string },
  ): Promise<void> {
    return this.logStore.saveAiLog(logKey, entry);
  }
}
