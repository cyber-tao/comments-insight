import { Comment, Task, Settings, AIConfig } from './index';

export type SystemMessage =
  | { type: 'PING'; payload?: never }
  | { type: 'GET_PLATFORM_INFO'; payload?: never };

export type InjectionMessage = {
  type: 'ENSURE_CONTENT_SCRIPT';
  payload?: { tabId?: number };
};

export type SettingsMessage =
  | { type: 'GET_SETTINGS'; payload?: never }
  | { type: 'SAVE_SETTINGS'; payload: { settings: Partial<Settings> } };

export type ExtractionMessage =
  | { type: 'START_EXTRACTION'; payload: { taskId?: string; url: string; maxComments?: number; tabId?: number } }
  | { type: 'CANCEL_EXTRACTION'; payload: { taskId: string } }
  | {
      type: 'EXTRACTION_PROGRESS';
      payload: { taskId: string; progress: number; message: string; data?: unknown };
    }
  | {
      type: 'EXTRACTION_COMPLETED';
      payload: {
        taskId: string;
        success: boolean;
        comments?: Comment[];
        postInfo?: { url?: string; title?: string; videoTime?: string };
        error?: string;
      };
    }
  | { type: 'GET_DOM_STRUCTURE'; payload?: never };

export type AnalysisMessage =
  | {
      type: 'START_ANALYSIS';
      payload: {
        comments: Comment[];
        historyId?: string;
        promptTemplate?: string;
        language?: string;
        metadata?: {
          platform?: string;
          url?: string;
          title?: string;
          datetime?: string;
          videoTime?: string;
        };
      };
    }
  | { type: 'AI_ANALYZE_STRUCTURE'; payload: { prompt: string } }
  | { type: 'AI_EXTRACT_CONTENT'; payload: { chunks: string[]; systemPrompt?: string } };

export type TaskMessage =
  | { type: 'TASK_UPDATE'; payload: Task }
  | { type: 'GET_TASK_STATUS'; payload?: { taskId?: string } }
  | { type: 'CANCEL_TASK'; payload: { taskId: string } };

export type HistoryMessage =
  | {
      type: 'GET_HISTORY';
      payload?: { page?: number; limit?: number; query?: string; id?: string };
    }
  | { type: 'GET_HISTORY_BY_URL'; payload: { url: string } }
  | { type: 'DELETE_HISTORY'; payload: { id: string } }
  | { type: 'CLEAR_ALL_HISTORY'; payload?: never };

export type AIModelMessage =
  | { type: 'GET_AVAILABLE_MODELS'; payload: { apiUrl: string; apiKey: string } }
  | { type: 'TEST_MODEL'; payload: { config: AIConfig } };

export type ExportMessage = {
  type: 'EXPORT_DATA';
  payload:
    | { type: 'settings' }
    | { format: 'csv' | 'md' | 'json'; taskId: string }
    | { format: 'csv' | 'md' | 'json'; historyId: string };
};

export type Message =
  | SystemMessage
  | InjectionMessage
  | SettingsMessage
  | ExtractionMessage
  | AnalysisMessage
  | TaskMessage
  | HistoryMessage
  | AIModelMessage
  | ExportMessage;

export type MessageType = Message['type'];
