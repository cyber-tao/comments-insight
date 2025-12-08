import { Message } from '../../types';
import { HandlerContext } from './types';
import { Logger } from '../../utils/logger';
import { ERRORS } from '@/config/constants';

export async function handleGetSettings(
  _message: Extract<Message, { type: 'GET_SETTINGS' }>,
  context: HandlerContext,
): Promise<any> {
  Logger.debug('[SettingsHandler] Getting settings');
  const settings = await context.storageManager.getSettings();
  Logger.debug('[SettingsHandler] Settings retrieved', { settings });
  return { settings };
}

export async function handleSaveSettings(
  message: Extract<Message, { type: 'SAVE_SETTINGS' }>,
  context: HandlerContext,
): Promise<any> {
  const { settings } = message.payload || {};

  if (!settings) {
    throw new Error(ERRORS.SETTINGS_DATA_REQUIRED);
  }

  await context.storageManager.saveSettings(settings);
  return { success: true };
}
