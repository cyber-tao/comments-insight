// Service Worker for Comments Insight Extension
import {
  getTaskManager,
  getAIService,
  getCommentAnalyzer,
  getTimestampNormalizer,
  getSettingsStore,
  getHistoryStore,
  getEncryptionService,
  getLogStore,
  getNotificationService,
  getTokenStatsStore,
  getCrawlingConfigStore,
} from './ServiceContainer';
import { MessageRouter } from './MessageRouter';
import { Message } from '../types';
import { Logger } from '../utils/logger';
import { STORAGE } from '@/config/constants';

Logger.info('Comments Insight Service Worker loaded');

// Migration: remove legacy plaintext AI key persisted under chrome.storage.local
// The verified config now lives only in AIService memory; see AIService.rememberVerifiedConfig.
chrome.storage.local
  .remove(STORAGE.LAST_VERIFIED_AI_MODEL_KEY)
  .catch((error) =>
    Logger.warn('[Background] Failed to clear legacy verified AI model key', { error }),
  );

getTaskManager()
  .initialize()
  .then(() => {
    Logger.info('[Background] TaskManager initialized');
  })
  .catch((error) => {
    Logger.warn('[Background] TaskManager initialization failed', { error });
  });

getNotificationService().setupNotificationHandlers();

const messageRouter = new MessageRouter(
  getTaskManager(),
  getAIService(),
  getCommentAnalyzer(),
  getTimestampNormalizer(),
  getSettingsStore(),
  getHistoryStore(),
  getEncryptionService(),
  getLogStore(),
  getTokenStatsStore(),
  getCrawlingConfigStore(),
);

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
  Logger.debug('Message received', { message });
  messageRouter
    .handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error) => sendResponse({ error: (error as Error).message }));
  return true;
});
