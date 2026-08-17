import { AIService } from './AIService';
import { CommentAnalyzer } from './ai/CommentAnalyzer';
import { TimestampNormalizer } from './ai/TimestampNormalizer';
import { TaskManager } from './TaskManager';
import { NotificationService } from './NotificationService';
import { SettingsStore } from './storage/SettingsStore';
import { HistoryStore } from './storage/HistoryStore';
import { EncryptionService } from './storage/EncryptionService';
import { LogStore } from './storage/LogStore';
import { TokenStatsStore } from './storage/TokenStatsStore';
import { CrawlingConfigStore } from './storage/CrawlingConfigStore';

export interface ServiceInstances {
  aiService: AIService;
  commentAnalyzer: CommentAnalyzer;
  timestampNormalizer: TimestampNormalizer;
  taskManager: TaskManager;
  notificationService: NotificationService;
  settingsStore: SettingsStore;
  historyStore: HistoryStore;
  encryptionService: EncryptionService;
  logStore: LogStore;
  tokenStatsStore: TokenStatsStore;
  crawlingConfigStore: CrawlingConfigStore;
}

class ServiceContainer {
  private services: Partial<ServiceInstances> = {};
  private defaultServices: ServiceInstances | null = null;

  private getDefaults(): ServiceInstances {
    if (!this.defaultServices) {
      const encryptionService = new EncryptionService();
      const settingsStore = new SettingsStore(encryptionService);
      const crawlingConfigStore = new CrawlingConfigStore(settingsStore);
      const tokenStatsStore = new TokenStatsStore();
      const logStore = new LogStore();
      const notificationService = new NotificationService();
      const aiService = new AIService(settingsStore, logStore, tokenStatsStore);
      const commentAnalyzer = new CommentAnalyzer(aiService);
      const timestampNormalizer = new TimestampNormalizer(aiService);

      this.defaultServices = {
        aiService,
        commentAnalyzer,
        timestampNormalizer,
        taskManager: new TaskManager(notificationService, { enablePersistence: true }),
        notificationService,
        settingsStore,
        historyStore: new HistoryStore(),
        encryptionService,
        logStore,
        tokenStatsStore,
        crawlingConfigStore,
      };
    }
    return this.defaultServices;
  }

  get<K extends keyof ServiceInstances>(key: K): ServiceInstances[K] {
    if (this.services[key]) {
      return this.services[key] as ServiceInstances[K];
    }
    return this.getDefaults()[key];
  }

  getAll(): ServiceInstances {
    const defaults = this.getDefaults();
    return { ...defaults, ...this.services } as ServiceInstances;
  }

  set<K extends keyof ServiceInstances>(key: K, instance: ServiceInstances[K]): void {
    this.services[key] = instance;
  }

  reset(): void {
    this.services = {};
  }

  resetAll(): void {
    this.services = {};
    this.defaultServices = null;
  }
}

export const container = new ServiceContainer();

export const getAIService = () => container.get('aiService');
export const getCommentAnalyzer = () => container.get('commentAnalyzer');
export const getTimestampNormalizer = () => container.get('timestampNormalizer');
export const getTaskManager = () => container.get('taskManager');
export const getNotificationService = () => container.get('notificationService');
export const getSettingsStore = () => container.get('settingsStore');
export const getHistoryStore = () => container.get('historyStore');
export const getEncryptionService = () => container.get('encryptionService');
export const getLogStore = () => container.get('logStore');
export const getTokenStatsStore = () => container.get('tokenStatsStore');
export const getCrawlingConfigStore = () => container.get('crawlingConfigStore');
