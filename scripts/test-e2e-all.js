import fs from 'fs';
import os from 'os';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';
import ts from 'typescript';
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

async function saveAiFixture(page, config) {
  const current = await sendExtensionMessage(page, { type: 'GET_SETTINGS' });
  return sendExtensionMessage(page, {
    type: 'SAVE_SETTINGS',
    payload: {
      settings: { aiModel: config, generateDynamicReport: false },
      expectedAiEndpoint: current.settings.aiModel.apiUrl,
      expectedAiProtocol: current.settings.aiModel.protocol,
    },
  });
}

async function captureThemeScreenshots(page, name) {
  const directory = process.env.COMMENTS_INSIGHT_E2E_SCREENSHOT_DIR;
  if (!directory) return;
  fs.mkdirSync(directory, { recursive: true });
  const { settings } = await sendExtensionMessage(page, { type: 'GET_SETTINGS' });
  try {
    for (const theme of ['light', 'dark']) {
      await sendExtensionMessage(page, {
        type: 'SAVE_SETTINGS',
        payload: { settings: { theme } },
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(
        (mode) =>
          document.documentElement.style.colorScheme === mode &&
          document.querySelector('#root')?.textContent.length > 0,
        {},
        theme,
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(requestAnimationFrame);
        const finiteAnimations = document.getAnimations().filter((animation) => {
          const endTime = animation.effect?.getComputedTiming().endTime;
          return animation.playState === 'running' && Number.isFinite(endTime);
        });
        await Promise.allSettled(finiteAnimations.map((animation) => animation.finished));
        await new Promise(requestAnimationFrame);
      });
      await page.screenshot({ path: path.join(directory, `${name}-${theme}.png`), fullPage: true });
    }
  } finally {
    await sendExtensionMessage(page, {
      type: 'SAVE_SETTINGS',
      payload: { settings: { theme: settings.theme } },
    });
  }
}

async function verifyHistoryErrorFeedback(page, expectedTotal) {
  const { settings } = await sendExtensionMessage(page, { type: 'GET_SETTINGS' });
  const labels = JSON.parse(
    fs.readFileSync(path.resolve(scriptDir, `../src/locales/${settings.language}.json`), 'utf8'),
  );
  const snapshot = () =>
    page.evaluate(() => ({
      rows: [...document.querySelectorAll('button[aria-pressed] h3')].map(
        (entry) => entry.textContent,
      ),
      selected: document.querySelector('button[aria-pressed="true"] h3')?.textContent,
      detail: document.querySelector('a[target="_blank"]')?.textContent,
      id: new URL(location.href).searchParams.get('id'),
    }));
  const clickButton = (text) =>
    page.evaluate((label) => {
      const button = [...document.querySelectorAll('button')].find(
        (entry) => entry.textContent.trim() === label,
      );
      if (!button || button.disabled) throw new Error(`History action unavailable: ${label}`);
      button.click();
    }, text);
  const failNext = (type) =>
    page.evaluate((messageType) => {
      globalThis.__historyE2eFaults.pending.add(messageType);
    }, type);
  const waitForError = (message) =>
    page.waitForFunction(
      (text) =>
        document.querySelector('[role="alert"]')?.textContent.includes(text) &&
        !document.querySelector('[role="dialog"]'),
      {},
      message,
    );
  const confirmOperation = async () => {
    await page.waitForSelector('[role="dialog"]', { visible: true });
    await page.click('[role="dialog"] button:last-child');
  };
  await page.evaluate(() => {
    const original = chrome.runtime.sendMessage;
    const state = { original, pending: new Set(), intercepted: [] };
    globalThis.__historyE2eFaults = state;
    chrome.runtime.sendMessage = function (...args) {
      const message = args[0];
      const isListRead = message?.type === 'GET_HISTORY' && !message.payload?.id;
      const isMutation =
        message?.type === 'DELETE_HISTORY' || message?.type === 'CLEAR_ALL_HISTORY';
      if ((isListRead || isMutation) && state.pending.delete(message.type)) {
        state.intercepted.push(message.type);
        const response = {
          error: {
            code: isListRead ? 'STORAGE_READ_ERROR' : 'STORAGE_WRITE_ERROR',
            message: 'Synthetic history storage failure',
            retryable: true,
          },
        };
        const callback = args.at(-1);
        if (typeof callback === 'function') {
          queueMicrotask(() => callback(response));
          return;
        }
        return Promise.resolve(response);
      }
      return Reflect.apply(original, chrome.runtime, args);
    };
  });
  try {
    const beforeRead = await snapshot();
    assert(
      beforeRead.selected && beforeRead.detail,
      'History error fixture has no selected detail',
    );
    await failNext('GET_HISTORY');
    await page.type('input[aria-label]', 'History resize fixture');
    await page.keyboard.press('Enter');
    await waitForError(labels.history.loadFailed);
    assert(
      JSON.stringify(await snapshot()) === JSON.stringify(beforeRead),
      'Failed list read changed loaded records or selection',
    );
    await clickButton(labels.history.retryLoad);
    await page.waitForFunction(
      () =>
        !document.querySelector('[role="alert"]') &&
        document.querySelector('button[aria-pressed] h3')?.textContent ===
          'History resize fixture 1' &&
        document.querySelector('[aria-busy]')?.getAttribute('aria-busy') === 'false',
    );

    await page.click('input[aria-label]');
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      (title) =>
        document.querySelector('button[aria-pressed] h3')?.textContent === title &&
        document.querySelector('[aria-busy]')?.getAttribute('aria-busy') === 'false',
      {},
      beforeRead.rows[0],
    );
    const beforeMutation = await snapshot();

    await failNext('DELETE_HISTORY');
    await page.evaluate(() => {
      const row = document.querySelector('button[aria-pressed="false"]')?.parentElement;
      const button = row?.querySelector('button[aria-label]');
      if (!button || button.disabled)
        throw new Error('Unselected history record cannot be deleted');
      button.click();
    });
    await page.waitForSelector('[role="dialog"]', { visible: true });
    assert(
      JSON.stringify(await snapshot()) === JSON.stringify(beforeMutation),
      'Delete button also selected another record',
    );
    await confirmOperation();
    await waitForError(labels.history.deleteFailed);
    assert(
      JSON.stringify(await snapshot()) === JSON.stringify(beforeMutation),
      'Failed deletion changed records or selected detail',
    );

    await failNext('CLEAR_ALL_HISTORY');
    await clickButton(labels.history.clearAll);
    await confirmOperation();
    await waitForError(labels.history.clearFailed);
    assert(
      JSON.stringify(await snapshot()) === JSON.stringify(beforeMutation),
      'Failed clear changed records or selected detail',
    );
    const preserved = await sendExtensionMessage(page, {
      type: 'GET_HISTORY',
      payload: { page: 0, pageSize: 20 },
    });
    assert(
      preserved.total === expectedTotal,
      'Failure fixtures changed the persisted history count',
    );
    const intercepted = await page.evaluate(() => globalThis.__historyE2eFaults.intercepted);
    assert(
      JSON.stringify(intercepted) ===
        JSON.stringify(['GET_HISTORY', 'DELETE_HISTORY', 'CLEAR_ALL_HISTORY']),
      'History fault injection did not match the expected UI actions',
    );
  } finally {
    await page.evaluate(() => {
      chrome.runtime.sendMessage = globalThis.__historyE2eFaults.original;
      delete globalThis.__historyE2eFaults;
    });
  }
}

async function verifyAiProtocols(page, comments) {
  const requests = [];
  const report = '# Protocol report\n\nComplete analysis: 评论正常。';
  const credential = 'synthetic-protocol-key';
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname.endsWith('/models')) {
      if (url.pathname.includes('unauthorized')) {
        response.writeHead(401, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'Invalid ' + credential } }));
        return;
      }
      const paginated = url.pathname.includes('anthropic-messages');
      const next = url.searchParams.has('after_id');
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          data: [{ id: next ? 'second-model' : 'mock-model' }],
          has_more: paginated && !next,
          last_id: next ? 'second-model' : 'mock-model',
        }),
      );
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests.push({ path: url.pathname, headers: request.headers, payload });
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const emit = (event) => {
      if (event.type) response.write('event: ' + event.type + '\r\n');
      response.write('data: ' + JSON.stringify(event) + '\r\n\r\n');
    };
    if (url.pathname.endsWith('/chat/completions')) {
      emit({ choices: [{ delta: { content: report }, finish_reason: null }] });
      if (url.pathname.includes('malformed')) response.write('data: {broken-json}\r\n\r\n');
      emit({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 12 } });
      response.write('data: [DONE]\r\n\r\n');
    } else if (url.pathname.endsWith('/responses')) {
      emit({
        type: 'response.output_text.delta',
        output_index: 0,
        content_index: 0,
        delta: report,
      });
      const incomplete = url.pathname.includes('incomplete');
      emit({
        type: incomplete ? 'response.incomplete' : 'response.completed',
        response: {
          status: incomplete ? 'incomplete' : 'completed',
          incomplete_details: incomplete ? { reason: 'max_output_tokens' } : null,
          output: [{ type: 'message', content: [{ type: 'output_text', text: report }] }],
          usage: { input_tokens: 9, output_tokens: 3, total_tokens: 12 },
        },
      });
    } else if (url.pathname.endsWith('/messages')) {
      emit({
        type: 'message_start',
        message: { content: [], usage: { input_tokens: 9, output_tokens: 0 } },
      });
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: report } });
      emit({ type: 'content_block_stop', index: 0 });
      emit({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 3 },
      });
      emit({ type: 'message_stop' });
    }
    response.end();
  });
  const origin = await listenLocally(server);
  try {
    for (const protocol of ['openai-chat-completions', 'openai-responses', 'anthropic-messages']) {
      const config = {
        protocol,
        apiUrl: origin + '/' + protocol + '/v1',
        apiKey: credential,
        model: 'mock-model',
        contextWindowSize: 32768,
        maxOutputTokens: 1024,
      };
      const models = await sendExtensionMessage(page, {
        type: 'GET_AVAILABLE_MODELS',
        payload: config,
      });
      assert(models.models.includes('mock-model'), protocol + ' did not discover models');
      if (protocol === 'anthropic-messages') {
        assert(models.models.includes('second-model'), 'Anthropic model pagination was incomplete');
      }
      const connection = await sendExtensionMessage(page, {
        type: 'TEST_MODEL',
        payload: { config },
      });
      assert(connection.success, protocol + ' connection test failed');
      await saveAiFixture(page, config);
      const url = 'https://protocol.e2e.invalid/' + protocol;
      const started = await sendExtensionMessage(page, {
        type: 'START_ANALYSIS',
        payload: { comments, metadata: { url, title: 'Protocol fixture' } },
      });
      const task = await waitForTask(page, started.taskId);
      const saved = await sendExtensionMessage(page, {
        type: 'GET_HISTORY_BY_URL',
        payload: { url },
      });
      assert(
        saved.item?.analysis?.markdown === report,
        protocol + ' saved missing or duplicate text',
      );
      assert(saved.item.analysis.tokensUsed === 12, protocol + ' recorded incorrect usage');
      assert(task.tokensUsed === 12, protocol + ' task usage did not match the report');
      recordPass('AI Protocols', protocol + ' models, connection test and persisted analysis');
    }
    for (const { path: requestPath, headers, payload } of requests) {
      for (const field of ['temperature', 'top_p', 'top_k']) {
        assert(!(field in payload), 'Sampling parameter was sent: ' + field);
      }
      assert(payload.stream === true, 'Protocol request did not enable streaming');
      if (requestPath.endsWith('/messages')) {
        assert(headers['x-api-key'] === credential, 'Anthropic API key header is missing');
        assert(headers['anthropic-version'] === '2023-06-01', 'Anthropic version changed');
        assert(
          headers['anthropic-dangerous-direct-browser-access'] === 'true',
          'Missing browser header',
        );
        assert(payload.max_tokens === 1024, 'Anthropic output limit was not forwarded');
      } else {
        assert(
          headers.authorization === 'Bearer ' + credential,
          'Bearer authentication is missing',
        );
        if (requestPath.endsWith('/responses')) {
          assert(payload.store === false, 'Responses request enabled remote response storage');
          assert(payload.max_output_tokens === 1024, 'Responses output limit was not forwarded');
          assert(!('messages' in payload), 'Responses request used Chat Completions messages');
        }
      }
    }
    const current = await sendExtensionMessage(page, { type: 'GET_SETTINGS' });
    for (const [protocol, failure] of [
      ['openai-responses', 'incomplete'],
      ['openai-chat-completions', 'malformed'],
    ]) {
      await saveAiFixture(page, {
        ...current.settings.aiModel,
        protocol,
        apiUrl: origin + '/' + failure + '/v1',
        apiKey: credential,
      });
      const failedUrl = 'https://protocol.e2e.invalid/' + failure;
      const requestCount = requests.length;
      const started = await sendExtensionMessage(page, {
        type: 'START_ANALYSIS',
        payload: { comments, metadata: { url: failedUrl } },
      });
      let failed = false;
      try {
        await waitForTask(page, started.taskId);
      } catch (error) {
        if (error.message.includes('did not complete within')) throw error;
        failed = true;
      }
      assert(failed, failure + ' output was marked as successful');
      const failedHistory = await sendExtensionMessage(page, {
        type: 'GET_HISTORY_BY_URL',
        payload: { url: failedUrl },
      });
      assert(!failedHistory.item, failure + ' output was persisted as a report');
      assert(requests.length === requestCount + 1, failure + ' output was retried');
      recordPass('AI Protocols', failure + ' analysis failed without retry or partial persistence');
    }
    const modelsFailure = await page.evaluate(
      (payload) => chrome.runtime.sendMessage({ type: 'GET_AVAILABLE_MODELS', payload }),
      { apiUrl: origin + '/unauthorized/v1', apiKey: credential, protocol: 'openai-responses' },
    );
    assert(
      modelsFailure.error?.code === 'MISSING_API_KEY',
      'Model discovery hid an authentication failure',
    );
    assert(
      !JSON.stringify(modelsFailure).includes(credential),
      'Model discovery exposed a credential',
    );
    recordPass(
      'AI Protocols',
      'Model discovery reports authentication failures without exposing keys',
    );
    await verifyAiSettingsUi(page, origin, requests);
  } finally {
    server.close();
  }
}

async function verifyAiSettingsUi(page, origin, requests) {
  const uiErrors = [];
  const onPageError = (error) => uiErrors.push(error.message);
  page.on('pageerror', onPageError);
  const waitForSaved = async (expected) => {
    try {
      await page.waitForFunction(
        async (values) => {
          const result = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
          return Object.entries(values).every(
            ([key, value]) => result.settings.aiModel[key] === value,
          );
        },
        { timeout: 10000, polling: 100 },
        expected,
      );
    } catch (error) {
      const actual = await page.evaluate(async () => {
        const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
        const { apiKey, ...model } = response.settings.aiModel;
        return {
          ...model,
          hasApiKey: Boolean(apiKey),
          alerts: [...document.querySelectorAll('[role="alert"]')].map((item) => item.textContent),
        };
      });
      throw new Error(
        'AI settings did not persist ' +
          JSON.stringify(expected) +
          '; actual: ' +
          JSON.stringify(actual),
        { cause: error },
      );
    }
  };
  try {
    await page.bringToFront();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#ai-provider-preset', { visible: true });
    assert(
      new URL(page.url()).protocol === 'chrome-extension:',
      'AI settings loaded outside the extension',
    );
    assert((await page.title()).length > 0, 'AI settings page has no title');
    const choices = await page.$$eval('#ai-provider-preset option', (options) =>
      options.map((option) => option.value),
    );
    assert(choices.length === 6, 'Expected five provider presets plus Custom');
    const requestCount = requests.length;
    for (const [provider, apiUrl, protocol] of [
      ['openai', 'https://api.openai.com/v1', 'openai-responses'],
      ['anthropic', 'https://api.anthropic.com/v1', 'anthropic-messages'],
      [
        'gemini',
        'https://generativelanguage.googleapis.com/v1beta/openai',
        'openai-chat-completions',
      ],
      ['deepseek', 'https://api.deepseek.com', 'openai-chat-completions'],
      ['openrouter', 'https://openrouter.ai/api/v1', 'openai-chat-completions'],
    ]) {
      await page.select('#ai-provider-preset', provider);
      await waitForSaved({ apiUrl, protocol, apiKey: '', model: '' });
      assert(
        await page.$eval('#ai-protocol', (input, expected) => input.value === expected, protocol),
        'Preset protocol was not rendered',
      );
    }
    assert(requests.length === requestCount, 'Choosing a preset invoked an AI request');
    await page.select('#ai-provider-preset', 'custom');
    assert(
      await page.$eval('#ai-api-url', (input) => input.value === 'https://openrouter.ai/api/v1'),
      'Choosing Custom discarded the current address',
    );
    const localUrl = origin + '/openai-chat-completions/v1';
    await page.click('#ai-api-url', { clickCount: 3 });
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.type('#ai-api-url', localUrl);
    await waitForSaved({ apiUrl: localUrl });
    await page.click('#ai-fetch-models');
    await page.waitForSelector('#ai-model[role="combobox"]');
    await page.type('#ai-model', 'manual-model');
    await page.keyboard.press('Enter');
    await waitForSaved({ model: 'manual-model' });
    await page.select('#ai-protocol', 'openai-responses');
    await waitForSaved({ protocol: 'openai-responses', model: 'manual-model' });
    assert(
      !(await page.$eval('#root', (root) => /Temperature|Top P|温度/.test(root.innerText))),
      'Removed sampling controls are still displayed',
    );
    const screenshotDir = process.env.COMMENTS_INSIGHT_E2E_SCREENSHOT_DIR;
    if (screenshotDir) {
      await page.select('#ai-provider-preset', 'openai');
      await waitForSaved({ apiUrl: 'https://api.openai.com/v1', protocol: 'openai-responses' });
      await page.waitForSelector('[role="alert"]', { hidden: true, timeout: 10000 });
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.setViewport({ width: 1280, height: 1000 });
      await page.$eval('#ai-provider-preset', (element) =>
        element.closest('section').scrollIntoView({ block: 'start' }),
      );
      await page.screenshot({ path: path.join(screenshotDir, 'ai-settings-desktop.png') });
      await page.setViewport({ width: 390, height: 844 });
      await page.$eval('#ai-provider-preset', (element) =>
        element.closest('section').scrollIntoView({ block: 'start' }),
      );
      await page.screenshot({ path: path.join(screenshotDir, 'ai-settings-mobile.png') });
    }
    assert(uiErrors.length === 0, 'AI settings page errors: ' + uiErrors.join(', '));
    recordPass('AI Settings', 'Five presets, protocol switching and custom model entry in Chrome');
  } finally {
    page.off('pageerror', onPageError);
    await page.setViewport({ width: 1280, height: 800 });
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

function containsDynamicImport(node) {
  return (
    (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ||
    ts.forEachChild(node, containsDynamicImport)
  );
}

function verifyContentScriptBundle() {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
  const scripts = manifest.content_scripts?.flatMap((entry) => entry.js ?? []) ?? [];
  assert(scripts.length === 1, 'The built manifest must inject one self-contained content script');

  const [script] = scripts;
  const publicResources =
    manifest.web_accessible_resources?.flatMap((entry) => entry.resources) ?? [];
  const scriptIsPublic = publicResources.some((resource) => {
    const pattern = resource.replace(/^\/+/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${pattern.replaceAll('*', '.*')}$`).test(script);
  });
  assert(!scriptIsPublic, `The manifest exposes the content script ${script} to web pages`);

  const code = fs.readFileSync(path.join(extensionPath, script), 'utf8');
  const source = ts.createSourceFile(script, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
  assert(
    !ts.isExternalModule(source) && !containsDynamicImport(source),
    `The manifest content script ${script} loads modules instead of being self-contained`,
  );
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
  const nonce = 'Y29tbWVudHMtaW5zaWdodC1lMmU=';
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Mock Video Page - Automated Test</title>
  <style nonce="${nonce}">
    .comment-item { display: block; padding: 8px; margin: 4px 0; border: 1px solid #ccc; }
    .author { font-weight: bold; color: blue; }
    .content { margin: 4px 0; }
    .time { color: gray; font-size: 12px; }
    .likes { color: green; font-size: 12px; }
    .legacy-replies { display: none; }
  </style>
</head>
<body>
  <h1>Test Video Title</h1>
  <div id="video-info">
    <span class="video-duration">12:34</span>
    <p id="description">This is a mock video description for automated testing.</p>
  </div>
  <div id="comments-container">
    <ytd-comment-thread-renderer class="comment-item" id="c1">
      <span class="author">Alice</span>
      <div class="content">This extension is truly awesome!</div>
      <span class="time">2 hours ago</span>
      <span class="likes">42</span>
      <div id="replies">
        <div id="expander" class="legacy-replies">
          <div id="more-replies"><button type="button">1 reply</button></div>
        </div>
        <div id="collapsed-threads">
          <ytd-button-renderer id="more-replies-sub-thread">
            <yt-button-shape><button type="button">1 reply</button></yt-button-shape>
          </ytd-button-renderer>
        </div>
      </div>
    </ytd-comment-thread-renderer>
    <ytd-comment-thread-renderer class="comment-item" id="c2">
      <span class="author">Bob</span>
      <div class="content">I had an issue with scrolling, but the new version works great.</div>
      <span class="time">1 hour ago</span>
      <span class="likes">15</span>
    </ytd-comment-thread-renderer>
    <ytd-comment-thread-renderer class="comment-item" id="c3">
      <span class="author">Charlie</span>
      <div class="content">Can we analyze sentiment for non-English comments too?</div>
      <span class="time">30 mins ago</span>
      <span class="likes">8</span>
    </ytd-comment-thread-renderer>
  </div>
  <script nonce="${nonce}">
    const replies = document.querySelector('#c1 #replies');
    const legacyButton = replies.querySelector('#more-replies button');
    legacyButton.addEventListener('click', () => { legacyButton.dataset.clicked = 'true'; });
    replies.querySelector('#more-replies-sub-thread button').addEventListener('click', () => {
      setTimeout(() => {
        replies.insertAdjacentHTML('beforeend', '<div id="expanded-threads"><yt-sub-thread>' +
          '<ytd-comment-thread-renderer><ytd-comment-view-model>' +
          '<a id="author-text"><span>Deborah</span></a>' +
          '<div id="content-text">This is a reply loaded after expansion.</div>' +
          '</ytd-comment-view-model></ytd-comment-thread-renderer></yt-sub-thread></div>');
      }, 250);
    }, { once: true });
  </script>
</body>
</html>`;

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'`,
      });
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

  const executablePath = await requireChromeExecutablePath();
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
    verifyContentScriptBundle();
    recordPass('ContentScriptBundle', 'Verified the manifest injects a standalone script');
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

    const bundledRules = JSON.parse(
      fs.readFileSync(path.resolve(scriptDir, '../src/config/default_rules.json'), 'utf8'),
    );
    const youtubeRule = bundledRules.find((rule) => rule.domain === 'youtube.com');
    assert(youtubeRule?.replies?.expandBtn, 'The bundled YouTube reply expansion rule is missing');
    const mockRule = {
      id: 'local_test_rule',
      domain: '127.0.0.1',
      siteName: 'Local Test Server',
      lastUpdated: Date.now(),
      container: { selector: '#comments-container', type: 'css' },
      item: youtubeRule.item,
      postContent: { selector: '#description', type: 'css' },
      videoTime: { selector: '.video-duration', type: 'css' },
      fields: [
        { name: 'username', rule: { selector: '.author', type: 'css' } },
        { name: 'content', rule: { selector: '.content', type: 'css' } },
        { name: 'timestamp', rule: { selector: '.time', type: 'css' } },
        { name: 'likes', rule: { selector: '.likes', type: 'css' } },
      ],
      replies: youtubeRule.replies,
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

    await captureThemeScreenshots(optionsPage, 'options');
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
    await historyPage.evaluateOnNewDocument(() => {
      globalThis.resizeObserverErrors = [];
      window.addEventListener('error', (event) => {
        if (event.isTrusted && event.message.includes('ResizeObserver loop')) {
          globalThis.resizeObserverErrors.push(event.message);
        }
      });
    });
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
          const historyFixtureCount = 47;
          for (let index = 1; index < historyFixtureCount; index += 1) {
            const fixture = {
              id: `${item.id}_${index}`,
              url: `https://fixture.invalid/history/${index}`,
              title: `History resize fixture ${index}`,
              platform:
                index % 2 ? 'Fixture platform with a deliberately wrapping label' : 'YouTube',
              extractedAt: item.extractedAt - index,
              commentsCount: 0,
            };
            tx.objectStore('history').put({ ...fixture, comments: [] });
            tx.objectStore('historyMetadata').put({ ...fixture, hasAnalysis: false });
          }
          tx.oncomplete = () => resolve(true);
          tx.onerror = (err) => reject(err);
        };
        req.onerror = (err) => reject(err);
      });
    }, mockHistoryItem);

    recordPass(
      'HistoryPage',
      'Inserted 47 mock history records into CommentsInsightDatabase IndexedDB',
    );

    await historyPage.reload({ waitUntil: 'domcontentloaded' });
    await historyPage.waitForFunction(
      (title) => document.querySelector('h3')?.textContent === title,
      {},
      mockHistoryItem.title,
    );
    for (const [pageIndex, pageCount] of [20, 20, 7].entries()) {
      const result = await sendExtensionMessage(historyPage, {
        type: 'GET_HISTORY',
        payload: { page: pageIndex, pageSize: 20 },
      });
      assert(result.total === 47 && result.totalPages === 3, 'History total was limited to a page');
      assert(result.entries.length === pageCount, 'Unexpected history page size');
      if (pageIndex > 0) {
        await historyPage.evaluate(() => {
          const next = [...document.querySelectorAll('button')].find((button) =>
            button.textContent.trim().endsWith('→'),
          );
          if (!next || next.disabled) throw new Error('Next history page is unavailable');
          next.click();
        });
        await historyPage.waitForFunction(
          (title) => document.querySelector('h3')?.textContent === title,
          {},
          `History resize fixture ${pageIndex * 20}`,
        );
      }
      assert(
        (await historyPage.$$('button[aria-pressed]')).length === pageCount,
        'History UI page mismatch',
      );
    }
    recordPass('HistoryPage', 'Browsed all 47 records across three correctly counted pages');
    await historyPage.reload({ waitUntil: 'domcontentloaded' });
    await historyPage.waitForSelector('button[aria-pressed]');
    const firstHistoryButton = await historyPage.$('button[aria-pressed]');
    await firstHistoryButton.focus();
    await historyPage.keyboard.press('Enter');
    await historyPage.waitForFunction(
      () =>
        document.querySelector('button[aria-pressed="true"] h3')?.textContent ===
        'Automated E2E Test Mock Video',
    );
    await firstHistoryButton.focus();
    await historyPage.keyboard.press('Tab');
    assert(
      await historyPage.evaluate(() => document.activeElement?.hasAttribute('aria-label')),
      'Delete button was not independently focusable',
    );
    await historyPage.keyboard.press('Tab');
    assert(
      await historyPage.evaluate(() => document.activeElement?.hasAttribute('aria-pressed')),
      'Next history row was not keyboard reachable',
    );
    await historyPage.keyboard.press('Space');
    await historyPage.waitForFunction(
      () =>
        document.querySelector('button[aria-pressed="true"] h3')?.textContent ===
        'History resize fixture 1',
    );
    recordPass(
      'HistoryPage',
      'Selected history with Tab, Enter and Space independently of deletion',
    );
    const initialViewport = historyPage.viewport();
    const historyViewports = [
      [1280, 800],
      [640, 480],
      [386, 740],
      [1000, 260],
      [800, 560],
      [1920, 1080],
    ];
    for (const [width, height] of historyViewports) {
      await historyPage.setViewport({ width, height });
      const scrolled = await historyPage.evaluate(async () => {
        const nextFrame = () => new Promise(requestAnimationFrame);
        await nextFrame();
        let scroller = document.querySelector('h3')?.parentElement;
        while (scroller && getComputedStyle(scroller).overflowY !== 'auto') {
          scroller = scroller.parentElement;
        }
        if (!scroller) return false;
        scroller.scrollTop = scroller.scrollHeight;
        await nextFrame();
        const moved = scroller.scrollTop > 0;
        scroller.scrollTop = 0;
        await nextFrame();
        return moved;
      });
      assert(scrolled, `History sidebar did not scroll at ${width}×${height}`);
    }
    await historyPage.setViewport(initialViewport);
    const historyResizeErrors = await historyPage.evaluate(() => globalThis.resizeObserverErrors);
    assert(historyResizeErrors.length === 0, historyResizeErrors.join(', '));
    recordPass(
      'HistoryPage',
      'Scrolled a full page of history while resizing without observer errors',
    );

    await verifyHistoryErrorFeedback(historyPage, 47);
    recordPass(
      'HistoryPage',
      'Retried a failed list read and preserved records and selection after delete and clear failures',
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
    await captureThemeScreenshots(historyPage, 'history');
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

    await captureThemeScreenshots(logsPage, 'logs');
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

    await captureThemeScreenshots(popupPage, 'popup');
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
    const contentErrors = [];
    contentPage.on('pageerror', (error) => contentErrors.push(error.message));

    const initialPageUrl = `${mockPageUrl}?before-navigation`;
    console.log(`  Navigating to mock test page: ${initialPageUrl}`);
    await contentPage.goto(initialPageUrl, { waitUntil: 'domcontentloaded' });
    await controlPage.goto(`chrome-extension://${extensionId}/src/options/index.html`, {
      waitUntil: 'domcontentloaded',
    });
    await contentPage.bringToFront();

    const tabId = await controlPage.evaluate(async (targetUrl) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url === targetUrl)?.id;
    }, initialPageUrl);
    assert(typeof tabId === 'number', 'Failed to resolve mock content tab id');
    await controlPage.waitForFunction(
      async (sourceTabId) => {
        try {
          const response = await chrome.tabs.sendMessage(sourceTabId, { type: 'PING' });
          return response?.status === 'ok';
        } catch {
          return false;
        }
      },
      { timeout: 5000 },
      tabId,
    );
    await contentPage.evaluate((url) => history.pushState(null, '', url), mockPageUrl);

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
      historyItem.comments.length === 3,
      `Expected 3 persisted top-level comments, got ${historyItem.comments.length}`,
    );

    const firstComment = historyItem.comments[0];
    assert(
      firstComment.username && firstComment.content,
      'Persisted comment missing username or content',
    );
    const alice = historyItem.comments.find((comment) => comment.username === 'Alice');
    assert(
      alice?.replies?.some(
        (reply) =>
          reply.username === 'Deborah' &&
          reply.content === 'This is a reply loaded after expansion.',
      ),
      'The bundled YouTube rule did not expand and persist the reply under its parent',
    );
    const legacyButtonClicked = await contentPage.$eval('#more-replies button', (button) =>
      button.hasAttribute('data-clicked'),
    );
    assert(!legacyButtonClicked, 'Extraction clicked the hidden legacy reply control');
    assert(contentErrors.length === 0, `Content page had JS errors: ${contentErrors.join(', ')}`);
    recordPass('TaskManager', `Completed background extraction task ${startResponse.taskId}`);
    recordPass(
      'ContentScript',
      `Extracted ${historyItem.comments.length} comments on a strict-CSP page after same-document navigation`,
    );
    recordPass('ContentScript', 'Expanded and persisted a reply using the bundled YouTube rules');
    recordPass('HistoryStore', 'Verified completed extraction was persisted and readable by URL');

    await verifyAiProtocols(controlPage, historyItem.comments);

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
