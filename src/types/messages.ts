import {
  Comment,
  Task,
  SettingsPatch,
  AIConfig,
  CrawlingConfig,
  FieldValidationStatus,
  ProgressStage,
} from './index';

export type SystemMessage = { type: 'PING'; payload?: never };

export type InjectionMessage = {
  type: 'ENSURE_CONTENT_SCRIPT';
  payload?: { tabId?: number };
};

export type SettingsMessage =
  | { type: 'GET_SETTINGS'; payload?: never }
  | {
      type: 'SAVE_SETTINGS';
      payload: { settings: SettingsPatch; expectedCrawlingConfigsFingerprint?: string };
    }
  | { type: 'IMPORT_SETTINGS'; payload: { data: string } }
  | { type: 'CACHE_SELECTOR'; payload: { hostname: string; selector: string } }
  | { type: 'GET_CRAWLING_CONFIG'; payload: { domain: string } }
  | { type: 'SAVE_CRAWLING_CONFIG'; payload: { config: CrawlingConfig } }
  | {
      type: 'UPDATE_FIELD_VALIDATION';
      payload: { domain: string; fieldValidation: Record<string, FieldValidationStatus> };
    };

export type ExtractionMessage =
  | {
      type: 'START_EXTRACTION';
      payload: { taskId?: string; url: string; maxComments?: number; tabId?: number };
    }
  | {
      type: 'START_CONFIG_GENERATION';
      payload: { url: string; tabId?: number };
    }
  | {
      type: 'EXTRACTION_PROGRESS';
      payload: { taskId: string; data?: unknown } & (
        | {
            progress: number;
            message?: string;
            stage?: ProgressStage;
            current?: number;
            total?: number;
          }
        | {
            progress?: number;
            message?: string;
            stage: ProgressStage;
            current: number;
            total: number;
          }
      );
    }
  | {
      type: 'EXTRACTION_COMPLETED';
      payload: {
        taskId: string;
        success: boolean;
        comments?: Comment[];
        postInfo?: { url?: string; title?: string; videoTime?: string; postContent?: string };
        error?: string;
      };
    }
  | {
      type: 'CONFIG_GENERATION_COMPLETED';
      payload: {
        taskId: string;
        success: boolean;
        error?: string;
      };
    }
  | {
      type: 'TEST_SELECTOR';
      payload: { selector: string; selectorType: 'css' | 'xpath'; tabId?: number };
    };

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
          postContent?: string;
        };
      };
    }
  | {
      type: 'GENERATE_DYNAMIC_REPORT';
      payload: {
        historyId: string;
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
      payload?: {
        page?: number;
        pageSize?: number;
        query?: string;
        id?: string;
        metadataOnly?: boolean;
      };
    }
  | { type: 'GET_HISTORY_BY_URL'; payload: { url: string } }
  | { type: 'DELETE_HISTORY'; payload: { id: string } }
  | { type: 'CLEAR_ALL_HISTORY'; payload?: never };

export type AIModelMessage =
  | { type: 'GET_AVAILABLE_MODELS'; payload: { apiUrl: string; apiKey: string } }
  | { type: 'TEST_MODEL'; payload: { config: AIConfig } };

export type ExportMessage = {
  type: 'EXPORT_DATA';
  payload: { type: 'settings' };
};

export interface GenerateCrawlingConfigMessage {
  type: 'GENERATE_CRAWLING_CONFIG';
  payload: { prompt: string };
}

export type Message =
  | SystemMessage
  | InjectionMessage
  | SettingsMessage
  | ExtractionMessage
  | AnalysisMessage
  | TaskMessage
  | HistoryMessage
  | AIModelMessage
  | ExportMessage
  | GenerateCrawlingConfigMessage;

export type MessageType = Message['type'];

export type ContentMessage =
  | { type: 'PING'; payload?: never }
  | { type: 'GET_PLATFORM_INFO'; payload?: never }
  | { type: 'RUN_EXTRACTION'; payload: { taskId: string; maxComments: number } }
  | { type: 'RUN_CONFIG_GENERATION'; payload: { taskId: string } }
  | { type: 'CANCEL_EXTRACTION'; payload: { taskId: string } }
  | { type: 'GET_DOM_STRUCTURE'; payload?: never }
  | {
      type: 'TEST_SELECTOR';
      payload: { selector: string; selectorType: 'css' | 'xpath' };
    };

export interface ExtractionResponse {
  success: boolean;
  error?: string;
  comments?: Comment[];
  postInfo?: {
    url?: string;
    title?: string;
    videoTime?: string;
    postContent?: string;
  };
}

export interface ConfigGenerationResponse {
  success: boolean;
  error?: string;
}

export interface DomStructureResponse {
  success: boolean;
  domStructure?: string;
  textSamples?: string[];
  error?: string;
}

export interface SelectorTestResponse {
  success: boolean;
  total?: number;
  items?: string[];
  error?: string;
}
