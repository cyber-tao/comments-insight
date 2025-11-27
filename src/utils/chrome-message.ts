import { Message } from '../types';

export function sendMessage<T = unknown>(message: Message): Promise<T> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response as T);
    });
  });
}

export function sendMessageToTab<T = unknown>(tabId: number, message: Message): Promise<T> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(response as T);
    });
  });
}

export function sendMessageVoid(message: Message): Promise<void> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, () => {
      resolve();
    });
  });
}
