import { Message } from '../types';
import { TaskManager } from './TaskManager';
import { AIService } from './AIService';
import { StorageManager } from './StorageManager';
import { Logger } from '../utils/logger';
import { ErrorHandler, ExtensionError, ErrorCode } from '../utils/errors';
import { ScraperConfigManager } from '../utils/ScraperConfigManager';
import { 
  generateScraperConfigPrompt, 
  SCRAPER_CONFIG_GENERATION_SYSTEM_PROMPT 
} from '../utils/prompts-scraper';

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
    Logger.debug('[MessageRouter] Handling message', { 
      type: message.type, 
      hasPayload: !!message.payload 
    });

    try {
      switch (message.type) {
        case 'PING':
          return this.handlePing();

        case 'START_EXTRACTION':
          return await this.handleStartExtraction(message, sender);

        case 'AI_EXTRACT_COMMENTS':
          return await this.handleAIExtractComments(message);

        case 'AI_EXTRACT_PROGRESSIVE':
          return await this.handleAIExtractProgressive(message);

        case 'AI_ANALYZE_STRUCTURE':
          return await this.handleAIAnalyzeStructure(message);

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

        case 'CHECK_SCRAPER_CONFIG':
          return await this.handleCheckScraperConfig(message);

        case 'GENERATE_SCRAPER_CONFIG':
          return await this.handleGenerateScraperConfig(message, sender);

        case 'GET_SCRAPER_CONFIGS':
          return await this.handleGetScraperConfigs();

        case 'SAVE_SCRAPER_CONFIG':
          return await this.handleSaveScraperConfig(message);

        case 'DELETE_SCRAPER_CONFIG':
          return await this.handleDeleteScraperConfig(message);

        case 'UPDATE_SELECTOR_VALIDATION':
          return await this.handleUpdateSelectorValidation(message);

        default:
          throw new ExtensionError(
            ErrorCode.VALIDATION_ERROR,
            `Unknown message type: ${message.type}`,
            { type: message.type }
          );
      }
    } catch (error) {
      await ErrorHandler.handleError(
        error as Error,
        `MessageRouter.handleMessage(${message.type})`
      );
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
    const { url, maxComments } = message.payload || {};

    if (!url) {
      throw new Error('URL is required');
    }

    // Extract domain from URL
    let domain = 'unknown';
    try {
      const urlObj = new URL(url);
      domain = urlObj.hostname.replace('www.', '');
    } catch (e) {
      console.warn('[MessageRouter] Failed to parse URL:', url);
    }

    const taskId = this.taskManager.createTask('extract', url, domain);
    
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
    
    // Get maxComments from settings if not provided
    let finalMaxComments = maxComments;
    if (!finalMaxComments) {
      const settings = await this.storageManager.getSettings();
      finalMaxComments = settings.maxComments || 100;
    }
    
    console.log('[MessageRouter] Starting extraction with maxComments:', finalMaxComments);
    
    // Start the extraction task asynchronously
    this.startExtractionTask(taskId, tabId, finalMaxComments).catch(error => {
      console.error('[MessageRouter] Extraction task failed:', error);
      this.taskManager.failTask(taskId, error.message);
    });

    return { taskId };
  }

  /**
   * Handle AI extract comments message (from content script)
   */
  private async handleAIExtractComments(message: Message): Promise<any> {
    // Content script sends 'data' instead of 'payload'
    const payload = (message as any).data || message.payload || {};
    const { prompt } = payload;

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
   * Handle AI progressive extraction (new iterative approach)
   */
  private async handleAIExtractProgressive(message: Message): Promise<any> {
    const payload = (message as any).data || message.payload || {};
    const { prompt } = payload;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    try {
      // Get settings for AI configuration
      const settings = await this.storageManager.getSettings();
      
      // Call AI service
      const response = await this.aiService.callAI({
        prompt,
        config: settings.extractorModel
      });

      // Parse JSON response
      let data;
      try {
        // Remove markdown code blocks if present
        let jsonText = response.content.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        }
        
        // Remove any leading/trailing text that's not JSON
        const jsonStart = jsonText.indexOf('{');
        const jsonEnd = jsonText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
        }
        
        data = JSON.parse(jsonText);
        
        // Validate response structure
        if (!data.comments || !Array.isArray(data.comments)) {
          data.comments = [];
        }
        if (!data.nodesToExpand || !Array.isArray(data.nodesToExpand)) {
          data.nodesToExpand = [];
        }
        if (typeof data.needsScroll !== 'boolean') {
          data.needsScroll = false;
        }
        if (typeof data.completed !== 'boolean') {
          data.completed = false;
        }
        if (!data.analysis) {
          data.analysis = '';
        }
        
      } catch (parseError) {
        console.error('[MessageRouter] Failed to parse AI progressive response:', parseError);
        console.error('[MessageRouter] Raw response:', response.content);
        
        // Return empty response instead of failing
        data = {
          comments: [],
          nodesToExpand: [],
          needsScroll: false,
          completed: true,
          analysis: 'Failed to parse AI response'
        };
      }

      return { data };
    } catch (error) {
      console.error('[MessageRouter] AI progressive extraction failed:', error);
      return { 
        error: error instanceof Error ? error.message : 'Unknown error',
        data: {
          comments: [],
          nodesToExpand: [],
          needsScroll: false,
          completed: true,
          analysis: 'Error occurred'
        }
      };
    }
  }

  /**
   * Handle AI structure analysis (selector-based extraction)
   */
  private async handleAIAnalyzeStructure(message: Message): Promise<any> {
    const payload = (message as any).data || message.payload || {};
    const { prompt } = payload;

    if (!prompt) {
      throw new Error('Prompt is required');
    }

    try {
      // Get settings for AI configuration
      const settings = await this.storageManager.getSettings();
      
      // Call AI service
      const response = await this.aiService.callAI({
        prompt,
        config: settings.extractorModel
      });

      // Parse JSON response
      let data;
      try {
        // Remove markdown code blocks if present
        let jsonText = response.content.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        }
        
        // Remove any leading/trailing text that's not JSON
        const jsonStart = jsonText.indexOf('{');
        const jsonEnd = jsonText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
        }
        
        data = JSON.parse(jsonText);
        
        // Validate response structure
        if (!data.selectors) {
          throw new Error('Missing selectors in response');
        }
        if (typeof data.confidence !== 'number') {
          data.confidence = 0.5;
        }
        
      } catch (parseError) {
        console.error('[MessageRouter] Failed to parse AI structure analysis:', parseError);
        console.error('[MessageRouter] Raw response:', response.content);
        throw new Error('Failed to parse AI response');
      }

      return { data };
    } catch (error) {
      console.error('[MessageRouter] AI structure analysis failed:', error);
      return { 
        error: error instanceof Error ? error.message : 'Unknown error'
      };
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
    const { comments, url, historyId } = message.payload || {};

    if (!comments || !Array.isArray(comments)) {
      throw new Error('Comments array is required');
    }

    // Extract domain from URL
    let domain = 'unknown';
    if (url) {
      try {
        const urlObj = new URL(url);
        domain = urlObj.hostname.replace('www.', '');
      } catch (e) {
        console.warn('[MessageRouter] Failed to parse URL:', url);
      }
    }

    const taskId = this.taskManager.createTask('analyze', url || 'unknown', domain);
    
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
          platform: task.platform || 'unknown',
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

      // Get history item to extract metadata
      let platform = 'Unknown Platform';
      let url = 'N/A';
      let title = 'Untitled';
      let datetime = new Date().toISOString();
      
      if (historyId) {
        const historyItem = await this.storageManager.getHistoryItem(historyId);
        if (historyItem) {
          platform = historyItem.platform || 'Unknown Platform';
          url = historyItem.url || 'N/A';
          title = historyItem.title || 'Untitled';
          datetime = new Date(historyItem.extractedAt).toISOString();
        }
      } else {
        const task = this.taskManager.getTask(taskId);
        if (task) {
          platform = task.platform || 'Unknown Platform';
          url = task.url || 'N/A';
          datetime = new Date(task.startTime).toISOString();
        }
      }

      // Analyze comments using AI with metadata
      const result = await this.aiService.analyzeComments(
        comments,
        settings.analyzerModel,
        settings.analyzerPromptTemplate,
        settings.language,
        {
          platform,
          url,
          title,
          datetime,
        }
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
            platform: task.platform || 'unknown',
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

  /**
   * Handle check scraper config message
   */
  private async handleCheckScraperConfig(message: Message): Promise<any> {
    const { url } = message.payload || {};

    console.log('[MessageRouter] handleCheckScraperConfig called with URL:', url);

    if (!url) {
      console.error('[MessageRouter] URL is required but not provided');
      throw new Error('URL is required');
    }

    try {
      console.log('[MessageRouter] Calling findMatchingConfig...');
      const config = await ScraperConfigManager.findMatchingConfig(url);
      console.log('[MessageRouter] findMatchingConfig result:', config ? 'Found' : 'Not found');
      
      return { hasConfig: !!config, config };
    } catch (error) {
      console.error('[MessageRouter] Failed to check scraper config:', error);
      console.error('[MessageRouter] Error stack:', error instanceof Error ? error.stack : 'No stack');
      return { hasConfig: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Handle generate scraper config message
   */
  private async handleGenerateScraperConfig(
    message: Message,
    sender: chrome.runtime.MessageSender
  ): Promise<any> {
    const { url, title } = message.payload || {};

    if (!url) {
      throw new Error('URL is required');
    }

    try {
      // Get tab ID
      let tabId = sender.tab?.id;
      if (!tabId) {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        tabId = activeTab?.id;
      }

      if (!tabId) {
        throw new Error('No tab ID available');
      }

      // Request DOM structure from content script
      const domResponse = await chrome.tabs.sendMessage(tabId, {
        type: 'GET_DOM_STRUCTURE',
      });

      if (!domResponse?.domStructure) {
        throw new Error('Failed to get DOM structure');
      }

      // Generate prompt for AI
      const prompt = generateScraperConfigPrompt(
        domResponse.domStructure,
        url,
        title || 'Untitled'
      );

      // Get settings for AI configuration
      const settings = await this.storageManager.getSettings();

      // Call AI to generate config
      const response = await this.aiService.callAI({
        prompt,
        systemPrompt: SCRAPER_CONFIG_GENERATION_SYSTEM_PROMPT,
        config: settings.extractorModel,
      });

      // Parse AI response
      let configData;
      try {
        let jsonText = response.content.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        }
        
        const jsonStart = jsonText.indexOf('{');
        const jsonEnd = jsonText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
        }
        
        configData = JSON.parse(jsonText);
      } catch (parseError) {
        console.error('[MessageRouter] Failed to parse AI config response:', parseError);
        throw new Error('AI returned invalid configuration format');
      }

      // Extract domain from URL safely
      let domain: string;
      try {
        const urlObj = new URL(url);
        domain = urlObj.hostname.replace('www.', '');
      } catch (e) {
        // Fallback: extract domain manually
        const match = url.match(/^(?:https?:\/\/)?(?:www\.)?([^\/\?#]+)/i);
        domain = match ? match[1] : 'unknown';
      }

      // Create scraper config
      const config = await ScraperConfigManager.create({
        name: `${domain} - Auto-generated`,
        domains: [domain, `www.${domain}`],
        urlPatterns: [],
        selectors: configData.selectors,
        scrollConfig: configData.scrollConfig,
      });

      return { success: true, config };
    } catch (error) {
      console.error('[MessageRouter] Failed to generate scraper config:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Handle get scraper configs message
   */
  private async handleGetScraperConfigs(): Promise<any> {
    try {
      const configs = await ScraperConfigManager.getAll();
      return { configs };
    } catch (error) {
      console.error('[MessageRouter] Failed to get scraper configs:', error);
      return { configs: [] };
    }
  }

  /**
   * Handle save scraper config message
   */
  private async handleSaveScraperConfig(message: Message): Promise<any> {
    const { config } = message.payload || {};

    if (!config) {
      throw new Error('Config data is required');
    }

    try {
      if (config.id) {
        // Update existing
        const updated = await ScraperConfigManager.update(config.id, config);
        return { success: true, config: updated };
      } else {
        // Create new
        const created = await ScraperConfigManager.create(config);
        return { success: true, config: created };
      }
    } catch (error) {
      console.error('[MessageRouter] Failed to save scraper config:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Handle delete scraper config message
   */
  private async handleDeleteScraperConfig(message: Message): Promise<any> {
    const { id } = message.payload || {};

    if (!id) {
      throw new Error('Config ID is required');
    }

    try {
      const success = await ScraperConfigManager.delete(id);
      return { success };
    } catch (error) {
      console.error('[MessageRouter] Failed to delete scraper config:', error);
      return { success: false };
    }
  }

  /**
   * Handle update selector validation message
   */
  private async handleUpdateSelectorValidation(message: Message): Promise<any> {
    const { configId, selectorKey, status } = message.payload || {};

    if (!configId || !selectorKey || !status) {
      throw new Error('Config ID, selector key, and status are required');
    }

    try {
      await ScraperConfigManager.updateSelectorValidation(configId, selectorKey, status);
      return { success: true };
    } catch (error) {
      console.error('[MessageRouter] Failed to update selector validation:', error);
      return { success: false };
    }
  }
}
