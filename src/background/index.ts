// Service Worker for Comments Insight Extension
import { taskManager } from './TaskManager';
import { storageManager } from './StorageManager';
import { aiService } from './AIService';
import { MessageRouter } from './MessageRouter';
import { NotificationService } from './NotificationService';
import { Message } from '../types';

console.log('Comments Insight Service Worker loaded');

// Initialize message router
const messageRouter = new MessageRouter(taskManager, aiService, storageManager);

// Setup notification handlers
NotificationService.setupNotificationHandlers();

// Listen for extension installation
chrome.runtime.onInstalled.addListener(() => {
  console.log('Comments Insight Extension installed');
  
  // Initialize default settings
  storageManager.getSettings().then(settings => {
    console.log('Settings initialized:', settings);
  });
});

// Listen for messages from content scripts and popup
chrome.runtime.onMessage.addListener((message: Message, sender, sendResponse) => {
  console.log('Message received:', message);
  
  // Handle message using router
  messageRouter.handleMessage(message, sender)
    .then(response => sendResponse(response))
    .catch(error => sendResponse({ error: error.message }));
  
  return true; // Keep the message channel open for async responses
});
