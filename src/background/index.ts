// Service Worker for Comments Insight Extension
import {
  container,
  getSettingsStore,
  getTaskManager,
  getNotificationService,
  getLogStore,
} from './ServiceContainer';
import { MessageRouter, isLogMessageType } from './MessageRouter';
import { DataMigrator } from './storage/DataMigrator';
import { Message } from '../types';
import { Logger } from '../utils/logger';
import { toExtensionErrorPayload } from '@/utils/error-types';
import { STORAGE } from '@/config/constants';
import i18n, { changeLanguage } from '../utils/i18n';

// Runtime messages do not loop back to their sending context. Keep background
// writes local while UI/content contexts delegate to this same LogStore.
Logger.setStorageWriter((entry) => getLogStore().saveSystemLog(entry));
Logger.info('Comments Insight Service Worker loaded');

// Migration: remove legacy plaintext AI key persisted under chrome.storage.local
// The verified config now lives only in AIService memory; see AIService.rememberVerifiedConfig.
chrome.storage.local
  .remove(STORAGE.LAST_VERIFIED_AI_MODEL_KEY)
  .catch((error) =>
    Logger.warn('[Background] Failed to clear legacy verified AI model key', { error }),
  );

const initPromise = (async () => {
  await new DataMigrator().migrate();
  // Apply the user's language preference before any background-originated
  // strings (notifications, persisted task errors) are produced.
  const settings = await getSettingsStore().getSettings();
  await changeLanguage(settings.language);
  await getTaskManager().initialize();
  Logger.info('[Background] Migration and TaskManager initialized');
})();
void initPromise.catch((error) => {
  Logger.error('[Background] Service worker initialization failed', { error });
});

// Keep the service worker locale in sync when the user changes it in Options,
// mirroring how Logger tracks developerMode via the same listener.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[STORAGE.SETTINGS_KEY]) {
    return;
  }
  const language = (changes[STORAGE.SETTINGS_KEY].newValue as { language?: string } | undefined)
    ?.language;
  if (typeof language === 'string' && language && language !== i18n.language) {
    void changeLanguage(language);
  }
});

getNotificationService().setupNotificationHandlers();

const messageRouter = new MessageRouter(container.getAll(), { readyPromise: initPromise });

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
  Logger.info('Comments Insight Extension installed');
  getSettingsStore()
    .getSettings()
    .then((settings) => {
      Logger.debug('Settings initialized', { settings });
    })
    .catch((error) => {
      Logger.error('[Background] Failed to initialize settings on install', { error });
    });
});

// Listen for long-lived port connections
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'ai-bridge') {
    Logger.debug('[Background] AI Bridge Port connected');
    port.onMessage.addListener((message) => {
      messageRouter.handlePortMessage(port, message).catch((err) => {
        Logger.error('[Background] Port message handling error', { error: err });
      });
    });
  }
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  if (!isLogMessageType(message?.type)) {
    Logger.debug('Message received', { message });
  }
  messageRouter
    .handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ error: toExtensionErrorPayload(error) }));
  return true;
});
