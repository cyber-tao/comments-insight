import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

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

async function injectSettings(backgroundTarget, settings) {
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

  await worker.evaluate((data) => {
    return new Promise((resolve, reject) => {
      console.log('[Worker] Injecting minimal settings:', data.aiModel);
      chrome.storage.local.set({ settings: data }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }
        console.log('[Worker] Minimal settings saved.');
        resolve(undefined);
      });
    });
  }, minimalSettings);
}

function createTestResultPromise(page) {
  return new Promise((resolve, reject) => {
    page.on('console', (message) => {
      const text = message.text();
      console.log('[PAGE CONSOLE]', text);

      if (!text.includes('__TEST_RESULT__:')) {
        return;
      }

      const jsonText = text.replace('__TEST_RESULT__:', '').trim();
      try {
        resolve(JSON.parse(jsonText));
      } catch (error) {
        reject(error);
      }
    });

    page.on('pageerror', (error) => console.error('[PAGE ERROR]', error));
    page.on('requestfailed', (request) => {
      const failure = request.failure();
      console.error('[REQUEST FAILED]', request.url(), failure?.errorText ?? 'unknown');
    });
  });
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

  const browser = await puppeteer.launch({
    headless: false,
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

    if (backgroundTarget) {
      if (settings) {
        await injectSettings(backgroundTarget, settings);
      } else {
        console.log(`${settingsPathEnv} is not set; using existing extension settings.`);
      }
    } else {
      console.warn('Could not find background service worker; using existing extension settings.');
      const targets = await browser.targets();
      console.log(
        'Available targets:',
        targets.map((target) => `${target.type()} - ${target.url()}`).join('\n'),
      );
    }

    const page = await browser.newPage();
    const testResultPromise = createTestResultPromise(page);

    console.log('Navigating to example.com to check injection...');
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await delay(pageWaitShortMs);

    console.log(`Navigating to ${videoUrl}...`);
    await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: pageLoadTimeoutMs });

    console.log('Waiting for content script hook injection...');
    await delay(pageWaitLongMs);
    await page.evaluate((scrollY) => window.scrollBy(0, scrollY), pageScrollY);
    await delay(pageWaitShortMs);

    console.log('Triggering extraction test...');
    await page.evaluate((count) => {
      window.postMessage({ type: 'COMMENTS_INSIGHT_TEST_TRIGGER', maxComments: count }, '*');
    }, maxComments);

    const timeoutPromise = delay(testTimeoutMs).then(() => {
      throw new Error(`Test timed out after ${testTimeoutMs}ms`);
    });
    const result = await Promise.race([testResultPromise, timeoutPromise]);

    if (!result.success) {
      throw new Error(`Extraction failed: ${result.error ?? 'unknown error'}`);
    }

    console.log('Extraction successful.');
    console.log(`Extracted ${result.comments?.length ?? 0} comments.`);
    if (result.comments?.length > 0) {
      console.log('Sample comment:', JSON.stringify(result.comments[0], null, 2));
    }
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
