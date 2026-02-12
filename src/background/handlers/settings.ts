import { Message, CrawlingConfig } from '../../types';
import { HandlerContext, SettingsResponse, SuccessResponse } from './types';
import { Logger } from '../../utils/logger';
import { ExtensionError, ErrorCode } from '../../utils/errors';

export async function handleGetSettings(
  _message: Extract<Message, { type: 'GET_SETTINGS' }>,
  context: HandlerContext,
): Promise<SettingsResponse> {
  Logger.debug('[SettingsHandler] Getting settings');
  const settings = await context.storageManager.getSettings();
  Logger.debug('[SettingsHandler] Settings retrieved', { settings });
  return { settings };
}

export async function handleSaveSettings(
  message: Extract<Message, { type: 'SAVE_SETTINGS' }>,
  context: HandlerContext,
): Promise<SuccessResponse> {
  const { settings } = message.payload || {};

  if (!settings) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Settings data is required');
  }

  await context.storageManager.saveSettings(settings);
  return { success: true };
}

export async function handleCacheSelector(
  message: Extract<Message, { type: 'CACHE_SELECTOR' }>,
  context: HandlerContext,
): Promise<SuccessResponse> {
  const { hostname, selector } = message.payload;

  if (!hostname || !selector) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Hostname and selector required');
  }

  await context.storageManager.updateSelectorCache(hostname, selector);
  return { success: true };
}

export async function handleGetCrawlingConfig(
  message: Extract<Message, { type: 'GET_CRAWLING_CONFIG' }>,
  context: HandlerContext,
): Promise<{ config: CrawlingConfig | null }> {
  const { domain } = message.payload;
  if (!domain) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Domain is required');
  }
  const config = await context.storageManager.getCrawlingConfig(domain);
  return { config };
}

export async function handleSaveCrawlingConfig(
  message: Extract<Message, { type: 'SAVE_CRAWLING_CONFIG' }>,
  context: HandlerContext,
): Promise<SuccessResponse> {
  const { config } = message.payload;
  if (!config || !config.domain) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Valid config with domain is required');
  }
  await context.storageManager.saveCrawlingConfig(config);
  return { success: true };
}

export async function handleSyncCrawlingConfigs(
  _message: Extract<Message, { type: 'SYNC_CRAWLING_CONFIGS' }>,
  context: HandlerContext,
): Promise<{ success: boolean; added: number; updated: number }> {
  const result = await context.storageManager.syncCrawlingConfigs();
  return { success: true, ...result };
}

export async function handleUpdateFieldValidation(
  message: Extract<Message, { type: 'UPDATE_FIELD_VALIDATION' }>,
  context: HandlerContext,
): Promise<SuccessResponse> {
  const { domain, fieldValidation } = message.payload;

  if (!domain || !fieldValidation) {
    throw new ExtensionError(ErrorCode.VALIDATION_ERROR, 'Domain and fieldValidation are required');
  }

  const config = await context.storageManager.getCrawlingConfig(domain);
  if (config) {
    config.fieldValidation = fieldValidation;
    await context.storageManager.saveCrawlingConfig(config);
    Logger.debug('[SettingsHandler] Field validation updated', { domain });
  }

  return { success: true };
}
