import fs from 'fs';
import os from 'os';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(scriptDir, '../dist');

function getChromeExecutablePath() {
  const candidatePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return undefined;
}

const SERVICE_WORKER_RETRIES = 15;
const RETRY_DELAY_MS = 800;
const TASK_POLL_TIMEOUT_MS = 30000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let passedCount = 0;
let failedCount = 0;
const testResults = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function recordPass(suite, name) {
  passedCount++;
  testResults.push({ suite, name, status: 'PASS' });
  console.log(`  ✓ [${suite}] ${name}`);
}

function recordFail(suite, name, error) {
  failedCount++;
  testResults.push({ suite, name, status: 'FAIL', error: error?.message || String(error) });
  console.error(`  ✗ [${suite}] ${name}`);
  console.error(`    Error: ${error?.message || error}`);
}

async function findBackgroundTarget(browser) {
  for (let attempt = 0; attempt < SERVICE_WORKER_RETRIES; attempt++) {
    const targets = await browser.targets();
    const backgroundTarget = targets.find(
      (t) => t.type() === 'service_worker' && t.url().includes('service-worker-loader.js'),
    );
    if (backgroundTarget) {
      return backgroundTarget;
    }
    await delay(RETRY_DELAY_MS);
  }
  return null;
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

async function waitForTask(page, taskId) {
  const deadline = Date.now() + TASK_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await sendExtensionMessage(page, {
      type: 'GET_TASK_STATUS',
      payload: { taskId },
    });
    const task = response?.task;
    if (task?.status === 'completed') {
      return task;
    }
    if (task?.status === 'failed') {
      throw new Error(task.error || 'Extraction task failed');
    }
    await delay(RETRY_DELAY_MS);
  }
  throw new Error(`Task ${taskId} did not complete within ${TASK_POLL_TIMEOUT_MS}ms`);
}

// Start a lightweight local HTTP server with a mock comments page
function startMockHttpServer() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Mock Video Page - Automated Test</title>
  <style>
    .comment-item { padding: 8px; margin: 4px 0; border: 1px solid #ccc; }
    .author { font-weight: bold; color: blue; }
    .content { margin: 4px 0; }
    .time { color: gray; font-size: 12px; }
    .likes { color: green; font-size: 12px; }
  </style>
</head>
<body>
  <h1>Test Video Title</h1>
  <div id="video-info">
    <span class="video-duration">12:34</span>
    <p id="description">This is a mock video description for automated testing.</p>
  </div>
  <div id="comments-container">
    <div class="comment-item" id="c1">
      <span class="author">Alice</span>
      <div class="content">This extension is truly awesome!</div>
      <span class="time">2 hours ago</span>
      <span class="likes">42</span>
    </div>
    <div class="comment-item" id="c2">
      <span class="author">Bob</span>
      <div class="content">I had an issue with scrolling, but the new version works great.</div>
      <span class="time">1 hour ago</span>
      <span class="likes">15</span>
    </div>
    <div class="comment-item" id="c3">
      <span class="author">Charlie</span>
      <div class="content">Can we analyze sentiment for non-English comments too?</div>
      <span class="time">30 mins ago</span>
      <span class="likes">8</span>
    </div>
  </div>
</body>
</html>`;

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

async function runAllAutomatedTests() {
  console.log('\n======================================================');
  console.log('🚀 COMMENTS INSIGHT - FULL AUTOMATED E2E TEST SUITE');
  console.log('======================================================\n');

  const { server, port } = await startMockHttpServer();
  const mockPageUrl = `http://127.0.0.1:${port}/test-comments.html`;
  console.log(`Local test server running at: ${mockPageUrl}`);

  const executablePath = getChromeExecutablePath();
  console.log(`Browser executable: ${executablePath || 'default puppeteer bundle'}`);

  const tempProfileDir = path.join(os.tmpdir(), 'comments-insight-e2e-' + Date.now());

  const browser = await puppeteer.launch({
    headless: false,
    executablePath,
    ignoreDefaultArgs: [
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--enable-automation',
    ],
    args: [
      `--user-data-dir=${tempProfileDir}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });

  try {
    // ----------------------------------------------------
    // Suite 1: Service Worker & Extension Target Discovery
    // ----------------------------------------------------
    console.log('\n📦 [Suite 1] Background Service Worker & Target Discovery');
    const backgroundTarget = await findBackgroundTarget(browser);
    assert(backgroundTarget, 'Failed to locate extension service worker target');
    const bgUrl = backgroundTarget.url();
    const extensionId = new URL(bgUrl).host;
    assert(extensionId && extensionId.length > 5, `Invalid extension ID: ${extensionId}`);
    recordPass('ServiceWorker', `Comments Insight service worker active with ID: ${extensionId}`);

    // ----------------------------------------------------
    // Suite 2 & 3: Options Page & Storage Subsystem
    // ----------------------------------------------------
    console.log('\n🛠️ [Suite 2 & 3] Options Page & Storage Subsystem');
    const optionsPage = await browser.newPage();
    const optionsUrl = `chrome-extension://${extensionId}/src/options/index.html`;

    const optionsErrors = [];
    optionsPage.on('pageerror', (err) => optionsErrors.push(err.message));

    await optionsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded' });
    await delay(1500);

    assert(optionsErrors.length === 0, `Options page had JS errors: ${optionsErrors.join(', ')}`);
    recordPass('OptionsPage', 'Loaded Options page cleanly without console errors');

    const mockRule = {
      id: 'local_test_rule',
      domain: '127.0.0.1',
      siteName: 'Local Test Server',
      lastUpdated: Date.now(),
      container: { selector: '#comments-container', type: 'css' },
      item: { selector: '.comment-item', type: 'css' },
      postContent: { selector: '#description', type: 'css' },
      videoTime: { selector: '.video-duration', type: 'css' },
      fields: [
        { name: 'username', rule: { selector: '.author', type: 'css' } },
        { name: 'content', rule: { selector: '.content', type: 'css' } },
        { name: 'timestamp', rule: { selector: '.time', type: 'css' } },
        { name: 'likes', rule: { selector: '.likes', type: 'css' } },
      ],
    };

    await optionsPage.evaluate((testRule) => {
      return new Promise((resolve, reject) => {
        chrome.storage.local.get('settings', (result) => {
          const currentSettings = result.settings || {};
          const crawlingConfigs = currentSettings.crawlingConfigs || [];
          const updated = {
            ...currentSettings,
            theme: 'dark',
            language: 'zh-CN',
            developerMode: true,
            crawlingConfigs: [...crawlingConfigs.filter((r) => r.domain !== '127.0.0.1'), testRule],
          };
          chrome.storage.local.set({ settings: updated }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(undefined);
          });
        });
      });
    }, mockRule);
    recordPass('Storage', 'Injected custom crawling config into chrome.storage.local');

    // Verify storage readback
    const storedSettings = await optionsPage.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.local.get('settings', (res) => resolve(res.settings));
      });
    });
    assert(storedSettings.theme === 'dark', 'Stored theme setting mismatch');
    assert(storedSettings.language === 'zh-CN', 'Stored language setting mismatch');
    recordPass('Storage', 'Verified persistent settings roundtrip in browser storage');

    // Verify Tab navigation (AI Settings, Crawling Rules, General)
    const optionsHtml = await optionsPage.content();
    assert(
      optionsHtml.includes('Comments Insight') || optionsHtml.includes('options'),
      'Options page title/content missing',
    );
    recordPass('OptionsPage', 'Verified Options page rendered root UI components');

    // Test clicking navigation buttons/tabs if present
    const navButtons = await optionsPage.$$('button, nav button, [role="tab"]');
    assert(navButtons.length > 0, 'No navigation or action buttons found on Options page');
    recordPass('OptionsPage', `Found ${navButtons.length} interactive UI elements on Options page`);

    await optionsPage.close();

    // ----------------------------------------------------
    // Suite 4: History Page & Dexie DB Storage E2E Tests
    // ----------------------------------------------------
    console.log('\n📚 [Suite 4] History Page & IndexedDB Subsystem');
    const historyPage = await browser.newPage();
    const historyUrl = `chrome-extension://${extensionId}/src/history/index.html`;

    const historyErrors = [];
    historyPage.on('pageerror', (err) => historyErrors.push(err.message));

    await historyPage.goto(historyUrl, { waitUntil: 'domcontentloaded' });
    await delay(1000);

    const mockHistoryItem = {
      id: 'hist_test_' + Date.now(),
      url: 'https://www.youtube.com/watch?v=mock_test_123',
      title: 'Automated E2E Test Mock Video',
      platform: 'YouTube',
      videoTime: '10:00',
      postContent: 'Mock video for testing Dexie history indexing and search',
      extractedAt: Date.now(),
      commentsCount: 3,
      comments: [
        {
          id: 'c1',
          username: 'UserAlpha',
          content: 'First test comment in history store',
          timestamp: '10m ago',
          likes: 20,
        },
        {
          id: 'c2',
          username: 'UserBeta',
          content: 'Second test comment with positive sentiment',
          timestamp: '5m ago',
          likes: 5,
        },
        {
          id: 'c3',
          username: 'UserGamma',
          content: 'Third test comment with constructive criticism',
          timestamp: '1m ago',
          likes: 2,
        },
      ],
      analysis: {
        summary: 'Overall very positive feedback on the automated test suite.',
        sentiment: {
          positive: 70,
          neutral: 20,
          negative: 10,
        },
        topics: [
          { name: 'Testing', percentage: 60 },
          { name: 'Performance', percentage: 40 },
        ],
      },
    };

    // Save to IndexedDB (CommentsInsightDatabase -> history & historyMetadata)
    await historyPage.evaluate((item) => {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('CommentsInsightDatabase');
        req.onsuccess = (e) => {
          const db = e.target.result;
          const tx = db.transaction(['history', 'historyMetadata'], 'readwrite');
          tx.objectStore('history').put(item);
          tx.objectStore('historyMetadata').put({
            id: item.id,
            url: item.url,
            title: item.title,
            platform: item.platform,
            videoTime: item.videoTime,
            postContent: item.postContent,
            extractedAt: item.extractedAt,
            commentsCount: item.commentsCount,
            analyzedAt: item.analyzedAt,
            hasAnalysis: Boolean(item.analysis),
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror = (err) => reject(err);
        };
        req.onerror = (err) => reject(err);
      });
    }, mockHistoryItem);

    recordPass(
      'HistoryPage',
      'Inserted mock history record into CommentsInsightDatabase IndexedDB',
    );

    // Reload history page to see updated list
    await historyPage.reload({ waitUntil: 'domcontentloaded' });
    await delay(1500);

    const historyPageContent = await historyPage.content();
    assert(
      historyPageContent.includes('Automated E2E Test Mock Video') ||
        historyPageContent.includes('Mock Video') ||
        historyPageContent.includes('YouTube'),
      'History page did not display saved mock item title',
    );
    recordPass('HistoryPage', 'Verified saved history item is displayed in History UI');

    // Test Search input if present
    const searchInput = await historyPage.$('input[type="text"], input[type="search"]');
    if (searchInput) {
      await searchInput.type('Automated E2E');
      await delay(500);
      recordPass('HistoryPage', 'Verified search filter input interaction');
    }

    assert(historyErrors.length === 0, `History page had JS errors: ${historyErrors.join(', ')}`);
    await historyPage.close();

    // ----------------------------------------------------
    // Suite 5: Logs Page & Filtering E2E Tests
    // ----------------------------------------------------
    console.log('\n📜 [Suite 5] Logs Page & Log Storage Subsystem');
    const logsPage = await browser.newPage();
    const logsUrl = `chrome-extension://${extensionId}/src/logs/index.html`;

    const logsErrors = [];
    logsPage.on('pageerror', (err) => logsErrors.push(err.message));

    await logsPage.goto(logsUrl, { waitUntil: 'domcontentloaded' });
    await delay(1000);

    assert(logsErrors.length === 0, `Logs page had JS errors: ${logsErrors.join(', ')}`);
    recordPass('LogsPage', 'Loaded Logs page cleanly without errors');

    const logsContent = await logsPage.content();
    assert(
      logsContent.includes('log') || logsContent.includes('Log') || logsContent.includes('日志'),
      'Logs page UI structure missing',
    );
    recordPass('LogsPage', 'Verified Logs page structure rendered');

    await logsPage.close();

    // ----------------------------------------------------
    // Suite 6: Popup Page E2E Tests
    // ----------------------------------------------------
    console.log('\n📱 [Suite 6] Popup Page UI & Actions');
    const popupPage = await browser.newPage();
    const popupUrl = `chrome-extension://${extensionId}/src/popup/index.html`;

    const popupErrors = [];
    popupPage.on('pageerror', (err) => popupErrors.push(err.message));

    await popupPage.goto(popupUrl, { waitUntil: 'domcontentloaded' });
    await delay(1000);

    assert(popupErrors.length === 0, `Popup page had JS errors: ${popupErrors.join(', ')}`);
    recordPass('PopupPage', 'Loaded Popup page without errors');

    const popupContent = await popupPage.content();
    assert(
      popupContent.includes('Comments Insight') || popupContent.includes('popup'),
      'Popup page missing header or title',
    );
    recordPass('PopupPage', 'Verified Popup page components');

    await popupPage.close();

    // ----------------------------------------------------
    // Suite 7: Sandbox Dynamic Report Isolation Tests
    // ----------------------------------------------------
    console.log('\n🛡️ [Suite 7] Sandbox Isolation & Dynamic Report Execution');
    const sandboxPage = await browser.newPage();
    const sandboxUrl = `chrome-extension://${extensionId}/src/sandbox/index.html`;

    const sandboxErrors = [];
    sandboxPage.on('pageerror', (err) => sandboxErrors.push(err.message));

    await sandboxPage.goto(sandboxUrl, { waitUntil: 'domcontentloaded' });
    await delay(800);

    await sandboxPage.evaluate(() => {
      window.postMessage(
        {
          type: 'RENDER_REPORT',
          html: `<!doctype html><html><body>
            <div id="test-sandbox-report" onclick="globalThis.reportClicked = true">
              <h3>Sandbox Report Rendered Successfully</h3>
            </div>
            <img id="external-image" src="https://example.com/tracker.png" onerror="globalThis.reportErrored = true">
            <iframe id="external-frame" src="https://example.com"></iframe>
            <script>globalThis.reportScriptExecuted = true;</script>
          </body></html>`,
        },
        '*',
      );
    });
    await sandboxPage.waitForSelector('#test-sandbox-report', { timeout: 5000 });
    const sandboxResult = await sandboxPage.evaluate(() => ({
      text: document.querySelector('#test-sandbox-report')?.textContent?.trim(),
      hasClickHandler: document.querySelector('#test-sandbox-report')?.hasAttribute('onclick'),
      externalImageSource: document.querySelector('#external-image')?.getAttribute('src'),
      hasExternalFrame: Boolean(document.querySelector('#external-frame')),
      scriptExecuted: Boolean(globalThis.reportScriptExecuted),
    }));

    assert(
      sandboxResult.text === 'Sandbox Report Rendered Successfully',
      'Sandbox did not render the requested report content',
    );
    assert(!sandboxResult.hasClickHandler, 'Sandbox retained an inline event handler');
    assert(!sandboxResult.externalImageSource, 'Sandbox retained an external image source');
    assert(!sandboxResult.hasExternalFrame, 'Sandbox retained an external frame');
    assert(!sandboxResult.scriptExecuted, 'Sandbox executed model-provided JavaScript');
    assert(sandboxErrors.length === 0, `Sandbox page had JS errors: ${sandboxErrors.join(', ')}`);
    recordPass('Sandbox', 'Rendered sanitized static report without active external content');

    await sandboxPage.close();

    // ----------------------------------------------------
    // Suite 8: Content Script Injection & Full Extraction Flow
    // ----------------------------------------------------
    console.log('\n🕷️ [Suite 8] Background Task, Content Script & History Flow');
    const contentPage = await browser.newPage();
    const controlPage = await browser.newPage();

    console.log(`  Navigating to mock test page: ${mockPageUrl}`);
    await contentPage.goto(mockPageUrl, { waitUntil: 'domcontentloaded' });
    await controlPage.goto(`chrome-extension://${extensionId}/src/options/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    await delay(2000);
    await contentPage.bringToFront();

    const tabId = await controlPage.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url === targetUrl)?.id;
    }, mockPageUrl);
    assert(typeof tabId === 'number', 'Failed to resolve mock content tab id');

    const startResponse = await sendExtensionMessage(controlPage, {
      type: 'START_EXTRACTION',
      payload: { url: mockPageUrl, tabId, maxComments: 10 },
    });
    assert(startResponse?.taskId, 'Background did not create an extraction task');
    const completedTask = await waitForTask(controlPage, startResponse.taskId);
    assert(completedTask.status === 'completed', 'Extraction task did not complete');

    const historyResponse = await sendExtensionMessage(controlPage, {
      type: 'GET_HISTORY_BY_URL',
      payload: { url: mockPageUrl },
    });
    const historyItem = historyResponse?.item;
    assert(historyItem, 'Completed extraction did not persist history');
    assert(Array.isArray(historyItem.comments), 'Persisted history has no comments array');
    assert(
      historyItem.comments.length >= 3,
      `Expected at least 3 persisted comments, got ${historyItem.comments.length}`,
    );

    const firstComment = historyItem.comments[0];
    assert(
      firstComment.username && firstComment.content,
      'Persisted comment missing username or content',
    );
    recordPass('TaskManager', `Completed background extraction task ${startResponse.taskId}`);
    recordPass(
      'ContentScript',
      `Extracted ${historyItem.comments.length} comments through the real message flow`,
    );
    recordPass('HistoryStore', 'Verified completed extraction was persisted and readable by URL');

    await controlPage.close();
    await contentPage.close();
  } catch (err) {
    console.error('\n❌ Fatal Test Runner Error:', err);
    recordFail('Runner', 'Execution halted prematurely', err);
  } finally {
    try {
      await browser.close();
    } catch {}
    try {
      server.close();
    } catch {}
    try {
      fs.rmSync(tempProfileDir, { recursive: true, force: true });
    } catch {}
  }

  // ----------------------------------------------------
  // Final Results Summary
  // ----------------------------------------------------
  console.log('\n======================================================');
  console.log('📊 AUTOMATED E2E TEST SUMMARY');
  console.log('======================================================');
  console.log(`Total Checks:  ${passedCount + failedCount}`);
  console.log(`Passed:        ${passedCount}`);
  console.log(`Failed:        ${failedCount}`);
  console.log('======================================================\n');

  if (failedCount > 0) {
    process.exitCode = 1;
  }
}

runAllAutomatedTests().catch((error) => {
  console.error('Test runner failed:', error);
  process.exitCode = 1;
});
