import { TaskManager } from '../TaskManager';
import { AIService } from '../AIService';
import { StorageManager } from '../StorageManager';

export interface HandlerContext {
  taskManager: TaskManager;
  aiService: AIService;
  storageManager: StorageManager;
  sender?: chrome.runtime.MessageSender;
}
