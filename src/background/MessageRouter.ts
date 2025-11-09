import { Message } from '../types';
import { TaskManager } from './TaskManager';
import { AIService } from './AIService';
import { StorageManager } from './StorageManager';

/**
 * MessageRouter handles all incoming messages and routes them
 * to the appropriate service
 */
export class MessageRouter {
  constructor(
    private taskManager: TaskManager,
    private aiService: AIService,
    private storageManager: StorageManager
  ) {}

  /**
   * Handle incoming message
   * @param message - Message to handle
   * @param sender - Message sender
   * @returns Response data
   */
  async handleMessage(
    message: Message,
    sender: chrome.runtime.MessageSender
  ): Promise<any> {
    console.log('[MessageRouter] Handling message:', message.type, sender);

    try {
      switch (message.type) {
        case 'PING':
          return this.handlePing();

        case 'START_EXTRACTION':
          return await this.handleStartExtraction(message, sender);

        case 'AI_EXTRACT_COMMENTS':
          return await this.handleAIExtractComments(message);

        case 'EXTRACTION_PROGRESS':
          return this.handleExtractionProgress(message);

        case 'START_ANALYSIS':
          return await this.handleStartAnalysis(message);

        case 'GET_TASK_STATUS':
          return this.handleGetTaskStatus(message);

        case 'CANCEL_TASK':
          return this.handleCancelTask(message);

        case 'GET_SETTINGS':
          return await this.handleGetSettings();

        case 'SAVE_SETTINGS':
          return await this.handleSaveSettings(message);

        case 'GET_HISTORY':
          return await this.handleGetHistory(message);

        case 'GET_HISTORY_BY_URL':
          return await this.handleGetHistoryByUrl(message);

        case 'EXPORT_DATA':
          return await this.handleExportData(message);

        case 'DELETE_HISTORY':
          return await this.handleDeleteHistory(message);

        case 'CLEAR_ALL_HISTORY':
          return await this.handleClearAllHistory();

        case 'GET_AVAILABLE_MODELS':
          return await this.handleGetAvailableModels(message);

        case 'TEST_MODEL':
          return await this.handleTestModel(message);

        default:
          throw new Error(`Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error('[MessageRouter] Error handling message:', error);
      throw error;
    }
  }

  /**
   * Handle ping message
   */
  private handlePing(): any {
    return { status: 'ok', timestamp: Date.now() };
  }

  /**
   * Handle start extraction message
   */
  private async handleStartExtraction(
    message: Message,
    sender: chrome.runtime.MessageSender
  ): Promise<any> {
    const { url, platform, maxComments } = message.payload || {};

    if (!url || !platform) {
      throw new Error('URL and platform are required');
    }

    const taskId = this.taskManager.createTask('extract', url, platform);
    
    // Get tab ID - either from sender or current active tab
    let tabId = sender.tab?.id;
    
    // If no tab ID (e.g., message from popup), get the active tab
    if (!tabId) {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      } catch (error) {
        console.error('[MessageRouter] Failed to get active tab:', error);
      }
    }
    
    // Start the extraction task asynchronously
    this.startExtractionTask(taskId, tabId, maxComments || 100).catch(error => {
      console.error('[MessageRouter] Extraction task failed:', error);
      this.taskManager.failTask(taskId, error.message);
    });

    return { taskId };
  }

  /**
   * Handle AI extract comments message (from content script)
   */
  private async handleAIExtractComments(message: Message): Promise<any> {
    const { prompt } = message.payload || {};

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    try {
      // Get settings for AI configuration
      const settings = await this.storageManager.getSettings();
      
      // Call AI service to extract comments
      const response = await this.aiService.callAI({
        prompt,
        config: settings.extractorModel
      });

      // Parse JSON response
      let comments = [];
      try {
        // Remove markdown code blocks if present
        let jsonText = response.content.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        }
        comments = JSON.parse(jsonText);
      } catch (parseError) {
        console.error('[MessageRouter] Failed to parse AI response:', parseError);
        throw new Error('AI returned invalid JSON');
      }

      return { comments };
    } catch (error) {
      console.error('[MessageRouter] AI extraction failed:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error', comments: [] };
    }
  }

  /**
   * Handle extraction progress update
   */
  private handleExtractionProgress(message: Message): any {
    const { taskId, progress, message: progressMessage } = message.payload || {};

    if (taskId) {
      this.taskManager.updateTaskProgress(taskId, progress, progressMessage);
    }

    return { success: true };
  }

  /**
   * Handle start analysis message
   */
  private async handleStartAnalysis(message: Message): Promise<any> {
    const { comments, url, platform, historyId } = message.payload || {};

    if (!comments || !Array.isArray(comments)) {
      throw new Error('Comments array is required');
    }

    const taskId = this.taskManager.createTask('analyze', url || 'unknown', platform || 'unknown');
    
    // Start the analysis task asynchronously
    this.startAnalysisTask(taskId, comments, historyId).catch(error => {
      console.error('[MessageRouter] Analysis task failed:', error);
      this.taskManager.failTask(taskId, error.message);
    });

    return { taskId };
  }

  /**
   * Handle get task status message
   */
  private handleGetTaskStatus(message: Message): any {
    const { taskId } = message.payload || {};

    if (taskId) {
      const task = this.taskManager.getTask(taskId);
      return { task };
    }

    // Return all tasks if no specific ID
    const tasks = this.taskManager.getAllTasks();
    return { tasks };
  }

  /**
   * Handle cancel task message
   */
  private handleCancelTask(message: Message): any {
    const { taskId } = message.payload || {};

    if (!taskId) {
      throw new Error('Task ID is required');
    }

    this.taskManager.cancelTask(taskId);
    return { success: true };
  }

  /**
   * Handle get settings message
   */
  private async handleGetSettings(): Promise<any> {
    console.log('[MessageRouter] Getting settings...');
    const settings = await this.storageManager.getSettings();
    console.log('[MessageRouter] Settings retrieved:', settings);
    return { settings };
  }

  /**
   * Handle save settings message
   */
  private async handleSaveSettings(message: Message): Promise<any> {
    const { settings } = message.payload || {};

    if (!settings) {
      throw new Error('Settings data is required');
    }

    await this.storageManager.saveSettings(settings);
    return { success: true };
  }

  /**
   * Handle get history message
   */
  private async handleGetHistory(message: Message): Promise<any> {
    const { id, query } = message.payload || {};

    if (id) {
      const item = await this.storageManager.getHistoryItem(id);
      return { item };
    }

    if (query) {
      const items = await this.storageManager.searchHistory(query);
      return { items };
    }

    const history = await this.storageManager.getHistory();
    return { history };
  }

  /**
   * Handle get history by URL message
   */
  private async handleGetHistoryByUrl(message: Message): Promise<any> {
    const { url } = message.payload || {};

    if (!url) {
      throw new Error('URL is required');
    }

    const history = await this.storageManager.getHistory();
    const item = history.find(h => h.url === url);
    
    return { item: item || null };
  }

  /**
   * Handle export data message
   */
  private async handleExportData(message: Message): Promise<any> {
    const { type } = message.payload || {};

    if (type === 'settings') {
      const data = await this.storageManager.exportSettings();
      return { data };
    }

    throw new Error('Invalid export type');
  }

  /**
   * Handle delete history message
   */
  private async handleDeleteHistory(message: Message): Promise<any> {
    const { id } = message.payload || {};

    if (!id) {
      throw new Error('History item ID is required');
    }

    await this.storageManager.deleteHistoryItem(id);
    return { success: true };
  }

  /**
   * Handle clear all history message
   */
  private async handleClearAllHistory(): Promise<any> {
    const history = await this.storageManager.getHistory();
    
    // Delete all history items
    for (const item of history) {
      await this.storageManager.deleteHistoryItem(item.id);
    }
    
    return { success: true, count: history.length };
  }

  /**
   * Handle get available models message
   */
  private async handleGetAvailableModels(message: Message): Promise<any> {
    const { apiUrl, apiKey } = message.payload || {};

    if (!apiUrl || !apiKey) {
      throw new Error('API URL and API Key are required');
    }

    try {
      const models = await this.aiService.getAvailableModels(apiUrl, apiKey);
      return { models };
    } catch (error) {
      console.error('[MessageRouter] Failed to get models:', error);
      return { models: [], error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handle test model message
   */
  private async handleTestModel(message: Message): Promise<any> {
    const { config } = message.payload || {};

    if (!config || !config.apiUrl || !config.apiKey || !config.model) {
      throw new Error('Complete model configuration is required');
    }

    try {
      // Send a simple test prompt to the model
      const response = await this.aiService.callAI({
        prompt: 'Hello! Please respond with "OK" if you can read this message.',
        config: config
      });

      if (response && response.content) {
        return { 
          success: true, 
          message: 'Model is working correctly',
          response: response.content.substring(0, 100) // Return first 100 chars of response
        };
      } else {
        throw new Error('No response from model');
      }
    } catch (error) {
      console.error('[MessageRouter] Model test failed:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Start extraction task (async)
   */
  private async startExtractionTask(
    taskId: string,
    tabId: number | undefined,
    maxComments: number
  ): Promise<void> {
    await this.taskManager.startTask(taskId);

    if (!tabId) {
      throw new Error('No tab ID available');
    }

    try {
      // Send message to content script to start extraction
      const response = await chrome.tabs.sendMessage(tabId, {
        type: 'START_EXTRACTION',
        data: { taskId, maxComments }
      });

      if (!response.success) {
        throw new Error(response.error || 'Extraction failed');
      }

      const { comments, postInfo } = response;

      // Save to history
      const task = this.taskManager.getTask(taskId);
      if (task && comments && comments.length > 0) {
        const historyItem = {
          id: `history_${Date.now()}`,
          url: postInfo?.url || task.url,
          title: postInfo?.title || 'Untitled',
          platform: task.platform,
          extractedAt: Date.now(),
          commentsCount: comments.length,
          comments,
          // No analysis yet - user needs to manually trigger it
        };

        await this.storageManager.saveHistory(historyItem);
      }

      this.taskManager.completeTask(taskId, { tokensUsed: 0, commentsCount: comments?.length || 0 });
    } catch (error) {
      throw error;
    }
  }

  /**
   * Start analysis task (async)
   */
  private async startAnalysisTask(
    taskId: string,
    comments: any[],
    historyId?: string
  ): Promise<void> {
    await this.taskManager.startTask(taskId);

    try {
      // Get settings for AI configuration
      const settings = await this.storageManager.getSettings();
      
      this.taskManager.updateTaskProgress(taskId, 25);

      // Analyze comments using AI
      const result = await this.aiService.analyzeComments(
        comments,
        settings.analyzerModel,
        settings.analyzerPromptTemplate
      );

      this.taskManager.updateTaskProgress(taskId, 75);

      // Update history with analysis result
      if (historyId) {
        const historyItem = await this.storageManager.getHistoryItem(historyId);
        if (historyItem) {
          historyItem.analysis = result;
          historyItem.analyzedAt = Date.now();
          await this.storageManager.saveHistory(historyItem);
        }
      } else {
        // Save new history item (shouldn't happen normally)
        const task = this.taskManager.getTask(taskId);
        if (task) {
          await this.storageManager.saveHistory({
            id: `history_${Date.now()}`,
            url: task.url,
            title: `Analysis ${new Date().toLocaleString()}`,
            platform: task.platform,
            extractedAt: Date.now(),
            commentsCount: comments.length,
            comments,
            analysis: result,
            analyzedAt: Date.now(),
          });
        }
      }

      this.taskManager.completeTask(taskId, { tokensUsed: result.tokensUsed, commentsCount: comments.length });
    } catch (error) {
      throw error;
    }
  }
}
