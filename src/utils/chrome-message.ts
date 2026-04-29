import { Message } from '../types';
import { CHROME_MESSAGE_ERRORS, TIMEOUT } from '@/config/constants';

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
      reject(new Error(CHROME_MESSAGE_ERRORS.TIMEOUT));
    }, timeoutMs);

    chrome.runtime.sendMessage(message, (response) => {
      const lastError = chrome.runtime.lastError; // 立即捕获到局部变量
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (lastError) {
        reject(new Error(lastError.message ?? 'Unknown chrome runtime error'));
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
      reject(new Error(CHROME_MESSAGE_ERRORS.TIMEOUT));
    }, timeoutMs);

    chrome.tabs.sendMessage(tabId, message, (response) => {
      const lastError = chrome.runtime.lastError; // 立即捕获到局部变量
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (lastError) {
        reject(new Error(lastError.message ?? 'Unknown chrome runtime error'));
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
      reject(new Error(CHROME_MESSAGE_ERRORS.TIMEOUT));
    }, timeoutMs);

    chrome.runtime.sendMessage(message, () => {
      const lastError = chrome.runtime.lastError; // 立即捕获到局部变量
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (lastError) {
        reject(new Error(lastError.message ?? 'Unknown chrome runtime error'));
        return;
      }

      resolve();
    });
  });
}
