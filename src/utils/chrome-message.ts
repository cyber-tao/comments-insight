import { Message } from '../types';
import { TIMEOUT } from '@/config/constants';

interface MessageOptions {
  timeoutMs?: number;
}

export function sendMessage<T = unknown>(
  message: Message,
  options: MessageOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT.MESSAGE_RESPONSE_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Message timeout'));
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response as T);
    });
  });
}

export function sendMessageToTab<T = unknown>(
  tabId: number,
  message: Message,
  options: MessageOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT.MESSAGE_RESPONSE_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Message timeout'));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve(response as T);
    });
  });
}

export function sendMessageVoid(message: Message, options: MessageOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? TIMEOUT.MESSAGE_RESPONSE_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Message timeout'));
    }, timeoutMs);

    chrome.runtime.sendMessage(message, () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}
