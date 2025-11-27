// Service Worker for Comments Insight Extension
import { getTaskManager, getStorageManager, getAIService } from './ServiceContainer';
import { MessageRouter } from './MessageRouter';
import { NotificationService } from './NotificationService';
import { Message } from '../types';
import { Logger } from '../utils/logger';

Logger.info('Comments Insight Service Worker loaded');

const messageRouter = new MessageRouter(getTaskManager(), getAIService(), getStorageManager());

// Setup notification handlers
NotificationService.setupNotificationHandlers();

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
  Logger.info('Comments Insight Extension installed');
  getStorageManager()
    .getSettings()
    .then((settings) => {
      Logger.debug('Settings initialized', { settings });
    });
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
