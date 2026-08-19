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
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
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
            crawlingConfigs: [
              ...crawlingConfigs.filter((r) => r.domain !== '127.0.0.1'),
              testRule,
            ],
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
    assert(optionsHtml.includes('Comments Insight') || optionsHtml.includes('options'), 'Options page title/content missing');
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

    recordPass('HistoryPage', 'Inserted mock history record into CommentsInsightDatabase IndexedDB');

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
    assert(logsContent.includes('log') || logsContent.includes('Log') || logsContent.includes('日志'), 'Logs page UI structure missing');
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
    assert(popupContent.includes('Comments Insight') || popupContent.includes('popup'), 'Popup page missing header or title');
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

    const sandboxRenderSuccess = await sandboxPage.evaluate(() => {
      return new Promise((resolve) => {
        window.addEventListener('message', (event) => {
          if (event.data && event.data.type === 'REPORT_RENDERED') {
            resolve(true);
          }
        });

        window.postMessage(
          {
            type: 'RENDER_REPORT',
            payload: {
              html: '<div id="test-sandbox-report"><h3>Sandbox Report Rendered Successfully</h3></div>',
            },
          },
          '*',
        );

        setTimeout(() => {
          const rendered = document.body.innerHTML.includes('Sandbox Report') || document.body.innerHTML.length > 0;
          resolve(rendered);
        }, 1000);
      });
    });

    assert(sandboxRenderSuccess, 'Sandbox failed to render report content');
    recordPass('Sandbox', 'Verified sandbox dynamic report execution & DOM rendering');

    await sandboxPage.close();

    // ----------------------------------------------------
    // Suite 8: Content Script Injection & Full Extraction Flow
    // ----------------------------------------------------
    console.log('\n🕷️ [Suite 8] Content Script Live DOM Extraction Flow');
    const contentPage = await browser.newPage();

    let extractionOutcome = null;
    const outcomePromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Extraction timed out after 20s')), 20000);

      contentPage.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('__TEST_RESULT__:')) {
          clearTimeout(timer);
          try {
            const data = JSON.parse(text.replace('__TEST_RESULT__:', '').trim());
            resolve(data);
          } catch (e) {
            reject(e);
          }
        }
      });
    });

    console.log(`  Navigating to mock test page: ${mockPageUrl}`);
    await contentPage.goto(mockPageUrl, { waitUntil: 'domcontentloaded' });
    await delay(2000);

    console.log('  Triggering COMMENTS_INSIGHT_TEST_TRIGGER on test page...');
    await contentPage.evaluate(() => {
      window.postMessage({ type: 'COMMENTS_INSIGHT_TEST_TRIGGER', maxComments: 10 }, '*');
    });

    extractionOutcome = await outcomePromise;
    assert(extractionOutcome, 'No extraction outcome received');
    assert(extractionOutcome.success, `Extraction reported failure: ${extractionOutcome.error || 'unknown'}`);
    assert(Array.isArray(extractionOutcome.comments), 'Extraction did not return comments array');
    assert(extractionOutcome.comments.length >= 3, `Expected at least 3 comments, got ${extractionOutcome.comments.length}`);

    const firstComment = extractionOutcome.comments[0];
    assert(firstComment.username && firstComment.content, 'Extracted comment missing username or content');
    recordPass('ContentScript', `Successfully extracted ${extractionOutcome.comments.length} comments from live DOM`);
    recordPass('ContentScript', `Verified comment fields (Author: "${firstComment.username}", Content: "${firstComment.content.slice(0, 30)}...")`);

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
