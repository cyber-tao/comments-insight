import { MESSAGES, TEXT } from '@/config/constants';
import type { Comment, HistoryItem, Settings, Task } from '@/types';
import { sendMessage } from './chrome-message';

interface GetSettingsResponse {
  settings?: Settings;
}

interface SaveSettingsResponse {
  success?: boolean;
  error?: string;
}

interface GetHistoryItemResponse {
  item?: HistoryItem | null;
}

interface GetHistoryByUrlResponse {
  item?: HistoryItem | null;
}

interface GetHistoryMetadataPageResponse {
  entries?: Array<{
    id: string;
    extractedAt: number;
    url: string;
    title: string;
    platform: string;
  }>;
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}

interface GetTaskListResponse {
  tasks?: Task[];
}

interface GetTaskStatusResponse {
  task?: Task;
}

interface StartTaskResponse {
  taskId?: string;
}

interface SuccessResponse {
  success?: boolean;
}

interface EnsureContentScriptResponse {
  success?: boolean;
  injected?: boolean;
}

interface GetCrawlingConfigResponse {
  config?: unknown;
}

interface GetAvailableModelsResponse {
  models?: string[];
}

interface TestModelResponse {
  success?: boolean;
  response?: string;
  error?: string;
}

interface ExportSettingsResponse {
  data?: string;
}

interface StartAnalysisParams {
  comments: Comment[];
  historyId?: string;
  metadata?: {
    platform?: string;
    url?: string;
    title?: string;
    datetime?: string;
    videoTime?: string;
    postContent?: string;
  };
}

interface StartAnalysisResponse {
  taskId?: string;
}

export const ExtensionAPI = {
  async getSettings(): Promise<Settings | null> {
    const response = await sendMessage<GetSettingsResponse>({ type: MESSAGES.GET_SETTINGS });
    return response?.settings ?? null;
  },

  async saveSettings(settings: Partial<Settings>): Promise<SaveSettingsResponse> {
    return sendMessage<SaveSettingsResponse>({
      type: MESSAGES.SAVE_SETTINGS,
      payload: { settings },
    });
  },

  async getHistoryItem(id: string): Promise<HistoryItem | null> {
    const response = await sendMessage<GetHistoryItemResponse>({
      type: MESSAGES.GET_HISTORY,
      payload: { id },
    });
    return response?.item ?? null;
  },

  async getHistoryByUrl(url: string): Promise<HistoryItem | null> {
    const response = await sendMessage<GetHistoryByUrlResponse>({
      type: MESSAGES.GET_HISTORY_BY_URL,
      payload: { url },
    });
    return response?.item ?? null;
  },

  async getHistoryMetadataPage(
    page: number,
    pageSize: number,
    query?: string,
  ): Promise<GetHistoryMetadataPageResponse> {
    return sendMessage<GetHistoryMetadataPageResponse>({
      type: MESSAGES.GET_HISTORY,
      payload: {
        page,
        pageSize,
        query: query || undefined,
        metadataOnly: true,
      },
    });
  },

  async getTasks(): Promise<Task[]> {
    const response = await sendMessage<GetTaskListResponse>({ type: MESSAGES.GET_TASK_STATUS });
    return response?.tasks ?? [];
  },

  async getTaskStatus(taskId: string): Promise<Task | null> {
    const response = await sendMessage<GetTaskStatusResponse>({
      type: MESSAGES.GET_TASK_STATUS,
      payload: { taskId },
    });
    return response?.task ?? null;
  },

  async ensureContentScript(tabId: number): Promise<void> {
    const response = await sendMessage<EnsureContentScriptResponse>({
      type: MESSAGES.ENSURE_CONTENT_SCRIPT,
      payload: { tabId },
    });

    if (!response?.success && !response?.injected) {
      throw new Error(TEXT.CONTENT_SCRIPT_INJECT_FAILED);
    }
  },

  async startExtraction(url: string): Promise<StartTaskResponse> {
    return sendMessage<StartTaskResponse>({
      type: MESSAGES.START_EXTRACTION,
      payload: { url },
    });
  },

  async startConfigGeneration(url: string): Promise<StartTaskResponse> {
    return sendMessage<StartTaskResponse>({
      type: MESSAGES.START_CONFIG_GENERATION,
      payload: { url },
    });
  },

  async startAnalysis(params: StartAnalysisParams): Promise<StartAnalysisResponse> {
    return sendMessage<StartAnalysisResponse>({
      type: MESSAGES.START_ANALYSIS,
      payload: params,
    });
  },

  async cancelTask(taskId: string): Promise<SuccessResponse> {
    return sendMessage<SuccessResponse>({
      type: MESSAGES.CANCEL_TASK,
      payload: { taskId },
    });
  },

  async getCrawlingConfig(domain: string): Promise<unknown | null> {
    const response = await sendMessage<GetCrawlingConfigResponse>({
      type: MESSAGES.GET_CRAWLING_CONFIG,
      payload: { domain },
    });
    return response?.config ?? null;
  },

  async deleteHistory(id: string): Promise<SuccessResponse> {
    return sendMessage<SuccessResponse>({
      type: MESSAGES.DELETE_HISTORY,
      payload: { id },
    });
  },

  async clearAllHistory(): Promise<SuccessResponse> {
    return sendMessage<SuccessResponse>({
      type: MESSAGES.CLEAR_ALL_HISTORY,
    });
  },

  async exportSettings(): Promise<string | null> {
    const response = await sendMessage<ExportSettingsResponse>({
      type: MESSAGES.EXPORT_DATA,
      payload: { type: 'settings' },
    });
    return response?.data ?? null;
  },

  async getAvailableModels(apiUrl: string, apiKey: string): Promise<string[]> {
    const response = await sendMessage<GetAvailableModelsResponse>({
      type: MESSAGES.GET_AVAILABLE_MODELS,
      payload: { apiUrl, apiKey },
    });
    return response?.models ?? [];
  },

  async testModel(config: Settings['aiModel']): Promise<TestModelResponse> {
    return sendMessage<TestModelResponse>({
      type: MESSAGES.TEST_MODEL,
      payload: { config },
    });
  },
};
