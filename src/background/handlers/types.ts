import type { ServiceInstances } from '@/background/ServiceContainer';
import type { Task, HistoryItem, Settings, Comment, SelectorMap } from '@/types';

export type HandlerContext = ServiceInstances & {
  sender?: chrome.runtime.MessageSender;
};

export interface TaskResponse {
  taskId: string;
}

export interface TaskStatusResponse {
  task?: Task;
  tasks?: Task[];
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
  item?: HistoryItem;
  items?: HistoryItem[];
  total?: number;
}

export interface SettingsResponse {
  settings: Settings;
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

export interface PortResponseError {
  error: string;
}

export type SelectorTestResponse = import('@/types/messages').SelectorTestResponse;
export type ExtractionResponse = import('@/types/messages').ExtractionResponse;
export type { Comment };
