import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { requireChromeExecutablePath } from './browser-locator.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(scriptDirectory, '../dist');
const settingsPathEnv = 'COMMENTS_INSIGHT_SETTINGS_PATH';
const videoUrlEnv = 'COMMENTS_INSIGHT_VIDEO_URL';
const maxCommentsEnv = 'COMMENTS_INSIGHT_MAX_COMMENTS';
const testTimeoutEnv = 'COMMENTS_INSIGHT_TEST_TIMEOUT_MS';
const defaultVideoUrl = 'https://www.youtube.com/watch?v=gQySzdR2k74';
const defaultMaxComments = 20;
const defaultTestTimeoutMs = 180000;
const serviceWorkerRetries = 10;
const serviceWorkerRetryDelayMs = 1000;
const pageWaitShortMs = 2000;
const pageWaitLongMs = 5000;
const pageScrollY = 500;
const pageLoadTimeoutMs = 60000;
const viewportWidth = 1280;
const viewportHeight = 800;

function parsePositiveInteger(value, fallback, name) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return parsed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function assertDirectoryExists(directory) {
  const stats = await fs.stat(directory);
  if (!stats.isDirectory()) {
    throw new Error(`Expected directory: ${directory}`);
  }
}

async function loadSettings(settingsPath) {
  if (!settingsPath) {
    return null;
  }

  const resolvedPath = path.resolve(settingsPath);
  const settingsContent = await fs.readFile(resolvedPath, 'utf-8');
  return JSON.parse(settingsContent);
}

async function findBackgroundTarget(browser) {
  for (let attempt = 0; attempt < serviceWorkerRetries; attempt += 1) {
    const targets = await browser.targets();
    const backgroundTarget = targets.find((target) => target.type() === 'service_worker');
    if (backgroundTarget) {
      return backgroundTarget;
    }
    await delay(serviceWorkerRetryDelayMs);
  }

  return null;
}

async function injectSettings(browser, backgroundTarget, settings) {
  const worker = await backgroundTarget.worker();
  if (!worker) {
    throw new Error('Failed to access extension service worker');
  }

  worker.on('console', (message) => console.log('[WORKER CONSOLE]', message.text()));

  const minimalSettings = {
    ...settings,
    crawlingConfigs: [],
    selectorCache: [],
  };
  const extensionId = new URL(backgroundTarget.url()).host;
  const settingsPage = await browser.newPage();

  try {
    await settingsPage.goto(`chrome-extension://${extensionId}/src/options/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    const response = await sendExtensionMessage(settingsPage, {
      type: 'SAVE_SETTINGS',
      payload: { settings: minimalSettings },
    });
    if (!response?.success) {
      throw new Error('Failed to save test settings');
    }
  } finally {
    await settingsPage.close();
  }
}

async function sendExtensionMessage(page, message) {
  const response = await page.evaluate(
    async (request) => chrome.runtime.sendMessage(request),
    message,
  );
  if (response?.error) {
    const errorMessage =
      typeof response.error === 'string' ? response.error : response.error.message;
    throw new Error(errorMessage || 'Extension message failed');
  }
  return response;
}

async function waitForTask(page, taskId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await sendExtensionMessage(page, {
      type: 'GET_TASK_STATUS',
      payload: { taskId },
    });
    if (response?.task?.status === 'completed') {
      return response.task;
    }
    if (response?.task?.status === 'failed') {
      throw new Error(response.task.error || 'Extraction task failed');
    }
    await delay(serviceWorkerRetryDelayMs);
  }
  throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
}

async function runTest() {
  await assertDirectoryExists(extensionPath);

  const settings = await loadSettings(process.env[settingsPathEnv]);
  const videoUrl = process.env[videoUrlEnv] ?? defaultVideoUrl;
  const maxComments = parsePositiveInteger(
    process.env[maxCommentsEnv],
    defaultMaxComments,
    maxCommentsEnv,
  );
  const testTimeoutMs = parsePositiveInteger(
    process.env[testTimeoutEnv],
    defaultTestTimeoutMs,
    testTimeoutEnv,
  );

  console.log('Starting automated test...');
  console.log('Extension path:', extensionPath);
  console.log('Target URL:', videoUrl);

  const executablePath = requireChromeExecutablePath();
  console.log('Browser executable:', executablePath);

  const browser = await puppeteer.launch({
    headless: false,
    executablePath,
    ignoreDefaultArgs: [
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
    ],
    dumpio: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    defaultViewport: { width: viewportWidth, height: viewportHeight },
  });

  try {
    console.log('Identifying extension background worker...');
    const backgroundTarget = await findBackgroundTarget(browser);
    if (!backgroundTarget) {
      const targets = await browser.targets();
      throw new Error(
        `Could not find background service worker. Available targets:\n${targets
          .map((target) => `${target.type()} - ${target.url()}`)
          .join('\n')}`,
      );
    }

    const extensionId = new URL(backgroundTarget.url()).host;
    if (settings) {
      await injectSettings(browser, backgroundTarget, settings);
    } else {
      console.log(`${settingsPathEnv} is not set; using default extension settings.`);
    }

    const page = await browser.newPage();
    console.log(`Navigating to ${videoUrl}...`);
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: pageLoadTimeoutMs });
    await delay(pageWaitLongMs);
    await page.evaluate((scrollY) => window.scrollBy(0, scrollY), pageScrollY);
    await delay(pageWaitShortMs);

    const controlPage = await browser.newPage();
    await controlPage.goto(`chrome-extension://${extensionId}/src/options/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    const pageUrl = page.url();
    const tabId = await controlPage.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url === targetUrl)?.id;
    }, pageUrl);
    if (typeof tabId !== 'number') {
      throw new Error(`Could not resolve target tab for ${pageUrl}`);
    }

    console.log('Starting extraction through the background task flow...');
    const startResponse = await sendExtensionMessage(controlPage, {
      type: 'START_EXTRACTION',
      payload: { url: pageUrl, tabId, maxComments },
    });
    if (!startResponse?.taskId) {
      throw new Error('Background did not create an extraction task');
    }
    await waitForTask(controlPage, startResponse.taskId, testTimeoutMs);

    const historyResponse = await sendExtensionMessage(controlPage, {
      type: 'GET_HISTORY_BY_URL',
      payload: { url: pageUrl },
    });
    const comments = historyResponse?.item?.comments;
    if (!Array.isArray(comments) || comments.length === 0) {
      throw new Error('Extraction completed without persisted comments');
    }

    console.log('Extraction successful.');
    console.log(`Extracted ${comments.length} comments.`);
    console.log('Sample comment:', JSON.stringify(comments[0], null, 2));
    await controlPage.close();
    await page.close();
  } finally {
    try {
      await browser.close();
    } catch {}
  }
}

runTest().catch((error) => {
  console.error('Unexpected error:', error);
  process.exitCode = 1;
});
