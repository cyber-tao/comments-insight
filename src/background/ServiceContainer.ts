import { AIService } from './AIService';
import { TaskManager } from './TaskManager';
import { StorageManager } from './StorageManager';

export interface ServiceInstances {
  aiService: AIService;
  taskManager: TaskManager;
  storageManager: StorageManager;
}

class ServiceContainer {
  private services: Partial<ServiceInstances> = {};
  private defaultServices: ServiceInstances | null = null;

  private getDefaults(): ServiceInstances {
    if (!this.defaultServices) {
      this.defaultServices = {
        aiService: new AIService(),
        taskManager: new TaskManager(),
        storageManager: new StorageManager(),
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
export const getTaskManager = () => container.get('taskManager');
export const getStorageManager = () => container.get('storageManager');

export const setAIService = (service: AIService) => container.set('aiService', service);
export const setTaskManager = (service: TaskManager) => container.set('taskManager', service);
export const setStorageManager = (service: StorageManager) =>
  container.set('storageManager', service);
