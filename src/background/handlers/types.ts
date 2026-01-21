import { TaskManager } from '../TaskManager';
import { AIService } from '../AIService';
import { StorageManager } from '../StorageManager';
import { Task, Comment, SelectorMap } from '../../types';

export interface HandlerContext {
  taskManager: TaskManager;
  aiService: AIService;
  storageManager: StorageManager;
  sender?: chrome.runtime.MessageSender;
}

export interface TaskResponse {
  taskId: string;
}

export interface TaskStatusResponse {
  task?: Task;
  tasks?: Task[];
}

export interface ExtractionResponse {
  success: boolean;
  comments?: Comment[];
  postInfo?: {
    url?: string;
    title?: string;
    videoTime?: string;
    postContent?: string;
  };
  error?: string;
}

export interface AIAnalysisResponse {
  selectors: SelectorMap;
  structure: {
    hasReplies: boolean;
    repliesNested: boolean;
    needsExpand: boolean;
  };
  confidence: number;
}

export interface HistoryResponse {
  item?: import('../../types').HistoryItem;
  items?: import('../../types').HistoryItem[];
  total?: number;
}

export interface SettingsResponse {
  settings: import('../../types').Settings;
}

export interface ModelInfo {
  id: string;
}

export interface SuccessResponse {
  success: boolean;
  error?: string;
}

export interface PingResponse {
  status: string;
  timestamp: number;
}
