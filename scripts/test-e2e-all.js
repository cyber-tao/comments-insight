import fs from 'fs';
import os from 'os';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import { requireChromeExecutablePath } from './browser-locator.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(scriptDir, '../dist');

const SERVICE_WORKER_RETRIES = 15;
const RETRY_DELAY_MS = 800;
const TASK_POLL_TIMEOUT_MS = 30000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function launchTestBrowser(executablePath, profileDir) {
  return puppeteer.launch({
    headless: process.env.COMMENTS_INSIGHT_E2E_HEADLESS === '1',
    executablePath,
    ignoreDefaultArgs: [
      '--disable-extensions',
      '--disable-component-extensions-with-background-pages',
      '--enable-automation',
    ],
    args: [
      `--user-data-dir=${profileDir}`,
      `--load-extension=${extensionPath}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
}

function listenLocally(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

async function verifyAiRequestPrivacy(page) {
  const received = [];
  const sink = http.createServer((request, response) => {
    received.push(request.url);
    response.writeHead(200).end('{}');
  });
  const sinkUrl = await listenLocally(sink);
  const source = http.createServer((request, response) => {
    request.resume();
    if (request.url.startsWith('/echo/')) {
      response.writeHead(400).end(`Invalid credential ${request.headers.authorization?.slice(7)}`);
      return;
    }
    response.writeHead(request.url.startsWith('/redirect-307/') ? 307 : 308, {
      Location: `${sinkUrl}/unexpected`,
    });
    response.end();
  });

  try {
    const origin = await listenLocally(source);
    const credential = 'ci!synthetic_echo_13';
    for (const status of [307, 308]) {
      const result = await page.evaluate(
        (config) => chrome.runtime.sendMessage({ type: 'TEST_MODEL', payload: { config } }),
        { apiUrl: `${origin}/redirect-${status}`, apiKey: credential, model: 'mock' },
      );
      assert(result?.error?.code === 'AI_ENDPOINT_REDIRECT', `HTTP ${status} was not rejected`);
    }
    const models = await page.evaluate(
      (payload) => chrome.runtime.sendMessage({ type: 'GET_AVAILABLE_MODELS', payload }),
      { apiUrl: `${origin}/redirect-308`, apiKey: credential },
    );
    assert(models?.error?.code === 'AI_ENDPOINT_REDIRECT', 'Model list followed a redirect');
    assert(received.length === 0, 'The second origin received an AI request');

    const echoed = await page.evaluate(
      (config) => chrome.runtime.sendMessage({ type: 'TEST_MODEL', payload: { config } }),
      { apiUrl: `${origin}/echo`, apiKey: credential, model: 'mock' },
    );
    assert(echoed?.success === false, 'The credential echo fixture did not return a failed test');
    assert(!JSON.stringify(echoed).includes(credential), 'Credential reached the test response');
    const logs = await page.evaluate(async () => {
      const stored = await chrome.storage.local.get(null);
      return Object.entries(stored).filter(([key]) => /^(ai_log_|log_)/.test(key));
    });
    assert(!JSON.stringify(logs).includes(credential), 'Credential reached persisted logs');
  } finally {
    source.close();
    sink.close();
  }
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

  const executablePath = requireChromeExecutablePath();
  console.log(`Browser executable: ${executablePath}`);

  const { server, port } = await startMockHttpServer();
  const mockPageUrl = `http://127.0.0.1:${port}/test-comments.html`;
  console.log(`Local test server running at: ${mockPageUrl}`);

  const tempProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'comments-insight-e2e-'));
  const resolvedProfileDir = path.resolve(tempProfileDir);
  const resolvedTempRoot = path.resolve(os.tmpdir());
  assert(
    path.dirname(resolvedProfileDir) === resolvedTempRoot &&
      path.basename(resolvedProfileDir).startsWith('comments-insight-e2e-'),
    'Refusing to use a browser profile outside the isolated E2E temporary directory',
  );

  let browser;
  try {
    browser = await launchTestBrowser(executablePath, tempProfileDir);

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
    await optionsPage.evaluateOnNewDocument(() => {
      globalThis.e2eCspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        globalThis.e2eCspViolations.push({
          directive: event.effectiveDirective,
          blocked: event.blockedURI,
        });
      });
    });

    await optionsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded' });
    await delay(1500);

    assert(optionsErrors.length === 0, `Options page had JS errors: ${optionsErrors.join(', ')}`);
    recordPass('OptionsPage', 'Loaded Options page cleanly without console errors');
    const evalViolations = await optionsPage.evaluate(() =>
      globalThis.e2eCspViolations.filter(
        (event) => event.directive.startsWith('script-src') && event.blocked === 'eval',
      ),
    );
    assert(evalViolations.length === 0, 'Options page attempted CSP-blocked dynamic code');
    recordPass('OptionsPage', 'Validated schemas without a CSP-blocked eval probe');

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
    await optionsPage.waitForSelector('#root h1', { visible: true });
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
    const reportNetworkRequests = [];
    historyPage.on('pageerror', (err) => historyErrors.push(err.message));
    await historyPage.setRequestInterception(true);
    historyPage.on('request', (request) => {
      if (/^https?:/i.test(request.url())) {
        reportNetworkRequests.push(request.url());
        void request.abort().catch(() => undefined);
      } else {
        void request.continue().catch(() => undefined);
      }
    });

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
        markdown: [
          '# E2E Markdown Privacy',
          '![Blocked report image](https://audit.invalid/pixel?data=E2E_SYNTHETIC)',
          '[Explicit external link](https://audit.invalid/manual)',
          '[Unsafe link](javascript:alert%281%29)',
          '<img id="model-raw-image" src="https://audit.invalid/raw">',
          '<script>globalThis.modelMarkdownExecuted = true;</script>',
        ].join('\n\n'),
        tokensUsed: 1,
        generatedAt: Date.now(),
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

    // Select the persisted report, not just its list entry, so the Markdown
    // security assertions exercise the production renderer.
    await historyPage.goto(
      `${historyUrl}?id=${encodeURIComponent(mockHistoryItem.id)}&tab=analysis`,
      {
        waitUntil: 'domcontentloaded',
      },
    );
    await historyPage.waitForFunction(() =>
      document.querySelector('.prose h1')?.textContent?.includes('E2E Markdown Privacy'),
    );

    const historyPageContent = await historyPage.content();
    assert(
      historyPageContent.includes('Automated E2E Test Mock Video') ||
        historyPageContent.includes('Mock Video') ||
        historyPageContent.includes('YouTube'),
      'History page did not display saved mock item title',
    );
    recordPass('HistoryPage', 'Verified saved history item is displayed in History UI');
    const markdownResult = await historyPage.evaluate(() => {
      const report = document.querySelector('.prose');
      const links = Array.from(report?.querySelectorAll('a') || []);
      return {
        text: report?.textContent || '',
        imageCount: report?.querySelectorAll('img').length ?? -1,
        hasRawImage: Boolean(document.querySelector('#model-raw-image')),
        scriptExecuted: Boolean(globalThis.modelMarkdownExecuted),
        explicitLink: links.find((link) => link.textContent === 'Explicit external link')?.href,
        hasUnsafeLink: links.some((link) => /^javascript:/i.test(link.getAttribute('href') || '')),
        csp: chrome.runtime.getManifest().content_security_policy?.extension_pages || '',
      };
    });
    assert(
      markdownResult.text.includes('Blocked report image'),
      'Markdown image alt text is missing',
    );
    assert(markdownResult.imageCount === 0, 'Markdown retained an automatically loaded image');
    assert(!markdownResult.hasRawImage, 'Markdown rendered raw model HTML');
    assert(!markdownResult.scriptExecuted, 'Markdown executed model JavaScript');
    assert(!markdownResult.hasUnsafeLink, 'Markdown retained a JavaScript link');
    assert(
      markdownResult.explicitLink === 'https://audit.invalid/manual',
      'Markdown did not retain the explicit user-operated text link',
    );
    assert(
      markdownResult.csp.includes("img-src 'self' data: blob:"),
      'Extension image CSP is missing',
    );
    assert(
      reportNetworkRequests.length === 0,
      `Report attempted ${reportNetworkRequests.length} unexpected HTTP(S) requests`,
    );
    recordPass(
      'ReportSecurity',
      'Rendered malicious Markdown without images, scripts or automatic network requests',
    );

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
    await logsPage.evaluateOnNewDocument(() => {
      globalThis.resizeObserverErrors = [];
      window.addEventListener('error', (event) => {
        if (event.isTrusted && event.message.includes('ResizeObserver loop')) {
          globalThis.resizeObserverErrors.push(event.message);
        }
      });
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          async writeText(text) {
            globalThis.copiedLogText = text;
          },
        },
      });
    });

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

    const logStartTime = await logsPage.evaluate(() => Date.now());
    await sendExtensionMessage(logsPage, { type: 'GET_SETTINGS' });
    await logsPage.waitForFunction(
      async (minimumTimestamp) => {
        const index = (await chrome.storage.local.get('system_log_index')).system_log_index || [];
        const rows = index.length ? await chrome.storage.local.get(index) : {};
        return Object.values(rows).some(
          (entry) =>
            entry?.message === '[SettingsHandler] Getting settings' &&
            entry.timestamp >= minimumTimestamp,
        );
      },
      { timeout: 5000 },
      logStartTime,
    );
    recordPass(
      'LogStore',
      'Persisted a real background-originated diagnostic through the local writer',
    );

    await logsPage.evaluate(async () => {
      await chrome.storage.local.set({
        log_orphan_e2e: { level: 'INFO', timestamp: 1, message: 'Unindexed system fixture' },
        ai_log_orphan_e2e: {
          type: 'analysis',
          timestamp: 1,
          prompt: 'fixture',
          response: 'fixture',
        },
        log_min_level: 'WARN',
        token_stats: { today: 7, total: 7, lastReset: Date.now() },
      });
    });
    await sendExtensionMessage(logsPage, { type: 'CLEAR_LOGS', payload: { kind: 'all' } });
    const logCleanup = await logsPage.evaluate(async () => {
      const stored = await chrome.storage.local.get(null);
      return {
        remainingLogKeys: Object.keys(stored).filter(
          (key) =>
            key.startsWith('ai_log_') ||
            (key.startsWith('log_') && key !== 'log_min_level') ||
            key === 'system_log_index',
        ),
        hasSettings: typeof stored.settings === 'object' && stored.settings !== null,
        retainedTokenTotal: stored.token_stats?.total,
        retainedLogLevel: stored.log_min_level,
      };
    });
    assert(
      logCleanup.remainingLogKeys.length === 0,
      'Log cleanup retained indexed or orphaned rows',
    );
    assert(logCleanup.hasSettings, 'Log cleanup removed settings');
    assert(logCleanup.retainedTokenTotal === 7, 'Log cleanup removed token usage');
    assert(logCleanup.retainedLogLevel === 'WARN', 'Log cleanup removed the log level');
    recordPass(
      'LogStore',
      'Cleared indexed and orphaned logs without deleting user settings or usage',
    );

    await logsPage.evaluate(async () => {
      const timestamp = Date.now();
      const keys = Array.from({ length: 100 }, (_, index) => `ai_log_layout_${index}`);
      const rows = Object.fromEntries(
        keys.map((key, index) => [
          key,
          {
            type: 'analysis',
            timestamp: timestamp - index,
            prompt: index === 0 ? 'Long sample prompt\n'.repeat(450) : `Sample ${index}`,
            response: index === 0 ? 'Long sample response\n'.repeat(450) : 'Sample response',
          },
        ]),
      );
      await chrome.storage.local.set({ ...rows, ai_log_index: keys });
    });
    await logsPage.setViewport({ width: 630, height: 700 });
    await logsPage.reload({ waitUntil: 'domcontentloaded' });
    await logsPage.waitForFunction(() => document.querySelectorAll('.ai-log').length === 100);
    for (let attempt = 0; attempt < 4; attempt++) {
      await logsPage.click('.ai-log');
      await logsPage.waitForSelector('.log-detail-inline');
      if (attempt === 0) {
        await logsPage.click('.log-actions .btn-secondary');
        const copied = await logsPage.evaluate(() => globalThis.copiedLogText);
        assert(copied?.startsWith('Long sample prompt'), 'Log copy did not preserve the prompt');
      }
      await logsPage.click('.ai-log');
      await logsPage.waitForSelector('.log-detail-inline', { hidden: true });
      await logsPage.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
    const logLayout = await logsPage.evaluate(() => {
      const list = document.querySelector('.log-list');
      list.scrollTop = list.scrollHeight;
      return {
        canScroll: list.scrollTop > 0,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        resizeObserverErrors: globalThis.resizeObserverErrors,
      };
    });
    assert(logLayout.canScroll, 'The 100-row log list could not scroll');
    assert(!logLayout.horizontalOverflow, 'The narrow Logs page had horizontal overflow');
    assert(!logLayout.resizeObserverErrors.length, 'Collapsing a log triggered ResizeObserver');
    await logsPage.type('input[type="search"], .search-input', 'Long sample prompt');
    await logsPage.waitForFunction(() => document.querySelectorAll('.ai-log').length === 1);
    recordPass(
      'LogsPage',
      'Expanded, copied, collapsed, scrolled and filtered 100 logs without a resize error',
    );

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

    await popupPage.waitForSelector('#root h1', { visible: true });
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

    await verifyAiRequestPrivacy(controlPage);
    recordPass('AI Privacy', 'Rejected 307/308 in Chrome and redacted a gateway credential echo');

    await controlPage.close();
    await contentPage.close();

    const localeDefinitions = JSON.parse(
      fs.readFileSync(path.resolve(scriptDir, '../src/config/locales.json'), 'utf8'),
    );
    let settingsPage = await browser.newPage();
    await settingsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded' });
    for (const locale of Object.keys(localeDefinitions)) {
      const saved = await sendExtensionMessage(settingsPage, {
        type: 'SAVE_SETTINGS',
        payload: { settings: { language: locale } },
      });
      assert(saved?.success, `Could not save locale ${locale}`);
      await browser.close();
      browser = await launchTestBrowser(executablePath, tempProfileDir);
      settingsPage = await browser.newPage();
      await settingsPage.goto(optionsUrl, { waitUntil: 'domcontentloaded' });
      const settingsResponse = await sendExtensionMessage(settingsPage, { type: 'GET_SETTINGS' });
      assert(settingsResponse?.settings?.language === locale, `Cold startup failed in ${locale}`);
      const catalog = JSON.parse(
        fs.readFileSync(path.resolve(scriptDir, `../src/locales/${locale}.json`), 'utf8'),
      );
      const title = catalog.common.pageTitle
        .replace('{{pageName}}', catalog.options.title)
        .replace('{{appName}}', catalog.common.appName);
      await settingsPage.waitForFunction(
        (language, expectedTitle) =>
          document.documentElement.lang === language && document.title === expectedTitle,
        { timeout: 5000 },
        locale,
        title,
      );
      recordPass(
        'Localization',
        `Restored settings and displayed localized page title in ${locale}`,
      );
    }
    await settingsPage.close();
  } catch (err) {
    console.error('\n❌ Fatal Test Runner Error:', err);
    recordFail('Runner', 'Execution halted prematurely', err);
  } finally {
    try {
      await browser?.close();
    } catch {}
    try {
      server.close();
    } catch {}
    try {
      fs.rmSync(resolvedProfileDir, { recursive: true, force: true });
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
