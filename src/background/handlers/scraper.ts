import { Message } from '../../types';
import { ScraperConfig, ScraperSelectors, ScrollConfig } from '../../types/scraper';
import { HandlerContext } from './types';
import { Logger } from '../../utils/logger';
import { ScraperConfigManager } from '../../utils/ScraperConfigManager';
import { MESSAGES, AI, REGEX } from '@/config/constants';
import { getDomain } from '../../utils/url';
import {
  generateScraperConfigPrompt,
  SCRAPER_CONFIG_GENERATION_SYSTEM_PROMPT,
} from '../../utils/prompts-scraper';
import i18n from '../../utils/i18n';
import { chunkDomText } from './extraction';

interface CheckScraperConfigResponse {
  hasConfig: boolean;
  config?: ScraperConfig | null;
  error?: string;
}

interface GenerateScraperConfigResponse {
  success: boolean;
  config?: ScraperConfig;
  error?: string;
}

interface GetScraperConfigsResponse {
  configs: ScraperConfig[];
}

interface SaveScraperConfigResponse {
  success: boolean;
  config?: ScraperConfig | null;
  error?: string;
}

interface DeleteScraperConfigResponse {
  success: boolean;
}

interface UpdateSelectorValidationResponse {
  success: boolean;
}

interface DomStructureResponse {
  domStructure?: string;
}

interface GeneratedConfigData {
  name: string;
  domains: string[];
  urlPatterns: string[];
  selectors: Partial<ScraperSelectors>;
  scrollConfig?: ScrollConfig;
}

export async function handleCheckScraperConfig(
  message: Extract<Message, { type: 'CHECK_SCRAPER_CONFIG' }>,
  _context: HandlerContext,
): Promise<CheckScraperConfigResponse> {
  const { url } = message.payload || {};

  Logger.debug('[ScraperHandler] handleCheckScraperConfig called', { url });

  if (!url) {
    Logger.error('[ScraperHandler] URL is required but not provided');
    throw new Error('URL is required');
  }

  try {
    Logger.debug('[ScraperHandler] Calling findMatchingConfig');
    const config = await ScraperConfigManager.findMatchingConfig(url);
    Logger.debug('[ScraperHandler] findMatchingConfig result', { found: !!config });

    return { hasConfig: !!config, config };
  } catch (error) {
    Logger.error('[ScraperHandler] Failed to check scraper config', { error });
    Logger.error('[ScraperHandler] Error stack', {
      stack: error instanceof Error ? error.stack : 'No stack',
    });
    return { hasConfig: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function handleGenerateScraperConfig(
  message: Extract<Message, { type: 'GENERATE_SCRAPER_CONFIG' }>,
  context: HandlerContext,
): Promise<GenerateScraperConfigResponse> {
  const { url, domStructure, platform: _platform, title: payloadTitle } = message.payload || {};
  const title = payloadTitle || 'Untitled'; 

  if (!url) {
    throw new Error('URL is required');
  }

  try {
    // Note: The original router logic fetched DOM structure from content script here!
    // "const domResponse = await chrome.tabs.sendMessage(tabId, { type: MESSAGES.GET_DOM_STRUCTURE });"
    // But my NEW type payload HAS `domStructure`.
    // If the payload already has it, we don't need to fetch it.
    // This is a change in logic/architecture I implicitly made.
    // IF the caller (popup?) sends `domStructure`, great.
    // BUT the original code didn't require popup to send it; background fetched it.
    // If I stick to the NEW type, I must update the caller to send it.
    // OR I update the type to NOT require it and fetch it here if missing.
    
    // Given "Refactor message types" task, I should arguably stick to the new safer type.
    // But if the caller doesn't send it, it will fail.
    
    // Let's look at `handleGenerateScraperConfig` in Router again.
    // It gets `tabId` from sender.
    // Then `sendMessage` to tab.
    
    // If I want to keep that logic, my type for `GENERATE_SCRAPER_CONFIG` should NOT have `domStructure` as required payload.
    // It should be `payload: { url: string; title?: string }`.
    
    // I will fix the type definition AGAIN.
    // But for now I will implement the logic to fetch it if missing (or ignore the type constraint with casting if needed).
    
    let structure = domStructure;
    if (!structure) {
       // Fetch from tab if not provided (fallback to original logic)
       let tabId = context.sender?.tab?.id;
       if (!tabId) {
         const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
         tabId = activeTab?.id;
       }
       
       if (tabId) {
         const domResponse: DomStructureResponse = await chrome.tabs.sendMessage(tabId, {
            type: MESSAGES.GET_DOM_STRUCTURE,
          });
          structure = domResponse?.domStructure;
       }
    }
    
    if (!structure) {
        throw new Error('Failed to get DOM structure');
    }

    const settings = await context.storageManager.getSettings();
    const chunks = chunkDomText(structure, settings.aiModel.maxTokens ?? AI.DEFAULT_MAX_TOKENS);
    let configData: GeneratedConfigData = {
      name: '',
      domains: [],
      urlPatterns: [],
      selectors: {},
      scrollConfig: undefined,
    };
    for (let i = 0; i < chunks.length; i++) {
      const prompt = generateScraperConfigPrompt(
        chunks[i],
        url,
        title || i18n.t('common.untitled'),
      );
      const response = await context.aiService.callAI({
        prompt,
        systemPrompt: SCRAPER_CONFIG_GENERATION_SYSTEM_PROMPT,
        config: settings.aiModel,
      });
      try {
        let jsonText = response.content.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText
            .replace(REGEX.MD_CODE_JSON_START, '')
            .replace(REGEX.MD_CODE_ANY_END, '')
            .trim();
        }
        const jsonStart = jsonText.indexOf('{');
        const jsonEnd = jsonText.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          jsonText = jsonText.substring(jsonStart, jsonEnd + 1);
        }
        const part = JSON.parse(jsonText);
        if (part.domains)
          configData.domains = Array.from(
            new Set([...(configData.domains || []), ...part.domains]),
          );
        if (part.urlPatterns)
          configData.urlPatterns = Array.from(
            new Set([...(configData.urlPatterns || []), ...part.urlPatterns]),
          );
        if (part.selectors)
          configData.selectors = { ...(configData.selectors || {}), ...part.selectors };
        if (part.scrollConfig) configData.scrollConfig = part.scrollConfig;
        if (part.name && !configData.name) configData.name = part.name;
      } catch (e) {
        Logger.warn('[ScraperHandler] Failed to parse config part', { part: i + 1, error: e });
      }
    }

    const domain = getDomain(url) || 'unknown';

    // Use AI-generated domains and urlPatterns if available, otherwise use fallback
    const domains =
      configData.domains && configData.domains.length > 0
        ? configData.domains
        : [domain, `www.${domain}`];

    const urlPatterns = configData.urlPatterns || [];

    // Create scraper config
    const config = await ScraperConfigManager.create({
      name: configData.name || `${domain} - Auto-generated`,
      domains,
      urlPatterns,
      selectors: configData.selectors as ScraperSelectors,
      scrollConfig: configData.scrollConfig,
    });

    return { success: true, config };
  } catch (error) {
    Logger.error('[ScraperHandler] Failed to generate scraper config', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleGetScraperConfigs(
  _message: Extract<Message, { type: 'GET_SCRAPER_CONFIGS' }>,
  _context: HandlerContext,
): Promise<GetScraperConfigsResponse> {
  try {
    const configs = await ScraperConfigManager.getAll();
    return { configs };
  } catch (error) {
    Logger.error('[ScraperHandler] Failed to get scraper configs', { error });
    return { configs: [] };
  }
}

export async function handleSaveScraperConfig(
  message: Extract<Message, { type: 'SAVE_SCRAPER_CONFIG' }>,
  _context: HandlerContext,
): Promise<SaveScraperConfigResponse> {
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
    Logger.error('[ScraperHandler] Failed to save scraper config', { error });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function handleDeleteScraperConfig(
  message: Extract<Message, { type: 'DELETE_SCRAPER_CONFIG' }>,
  _context: HandlerContext,
): Promise<DeleteScraperConfigResponse> {
  const { id } = message.payload || {};

  if (!id) {
    throw new Error('Config ID is required');
  }

  try {
    const success = await ScraperConfigManager.delete(id);
    return { success };
  } catch (error) {
    Logger.error('[ScraperHandler] Failed to delete scraper config', { error });
    return { success: false };
  }
}

export async function handleUpdateSelectorValidation(
  message: Extract<Message, { type: 'UPDATE_SELECTOR_VALIDATION' }>,
  _context: HandlerContext,
): Promise<UpdateSelectorValidationResponse> {
  const { configId, selectorKey, status, count } = message.payload || {};

  if (!configId || !selectorKey || !status) {
    throw new Error('Config ID, selector key, and status are required');
  }

  try {
    await ScraperConfigManager.updateSelectorValidation(configId, selectorKey, status, count);
    return { success: true };
  } catch (error) {
    Logger.error('[ScraperHandler] Failed to update selector validation', { error });
    return { success: false };
  }
}
