import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { requireChromeExecutablePath } from './browser-locator.js';
import { youtubeExample, youtubeSource } from './store-youtube-example.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const viewport = { width: 960, height: 760, deviceScaleFactor: 1 };
const historyId = 'store-youtube-showcase';
const motion = [{ name: 'prefers-reduced-motion', value: 'reduce' }];

// The parent and reply are paraphrases from the approved comments screenshots.
// The English and Simplified Chinese originals were preserved in the listing history.
const threads = {
  'en-US': {
    viewer: 'Viewer',
    parent: 'The crash showed what the safety equipment could do.',
    reply: 'I would still rather see the car avoid a crash.',
  },
  'zh-CN': {
    viewer: '观众',
    parent: '这次碰撞反而更能展示安全配置。',
    reply: '我还是希望一开始就没有发生碰撞。',
  },
  'zh-TW': {
    viewer: '觀眾',
    parent: '這次撞擊反而更能看出安全配備的作用。',
    reply: '我還是希望一開始就沒有發生撞擊。',
  },
  'ja-JP': {
    viewer: '視聴者',
    parent: '衝突で安全装備の効果がよく分かりました。',
    reply: 'それでも、最初から衝突しなかった方がよかったと思います。',
  },
  'ko-KR': {
    viewer: '시청자',
    parent: '이번 충돌로 안전 장비가 어떤 역할을 하는지 볼 수 있었어요.',
    reply: '그래도 애초에 충돌이 일어나지 않았으면 더 좋았을 것 같아요.',
  },
  'fr-FR': {
    viewer: 'Internaute',
    parent: 'Le choc a montré à quoi servaient les équipements de sécurité.',
    reply: 'J’aurais quand même préféré que la voiture évite l’accident.',
  },
  'pt-PT': {
    viewer: 'Espectador',
    parent: 'O acidente mostrou a utilidade dos equipamentos de segurança.',
    reply: 'Mesmo assim, teria preferido que o carro evitasse o acidente.',
  },
  'es-ES': {
    viewer: 'Espectador',
    parent: 'El choque mostró para qué servía el equipamiento de seguridad.',
    reply: 'Aun así, habría preferido que el coche evitara el accidente.',
  },
};

async function readJson(filename) {
  return JSON.parse(await fs.readFile(path.resolve(projectRoot, filename), 'utf8'));
}

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function makeReport(locale, sample) {
  const themes = sample.themes.map((theme) => `<li>${escapeHtml(theme)}</li>`).join('');
  return `<!doctype html>
    <html lang="${locale}"><meta charset="utf-8">
    <style>
      * { box-sizing: border-box }
      body { margin: 0; color: #1c1917; background: #f6f2e9; font: 17px/1.55 system-ui, sans-serif }
      main { max-width: 960px; min-height: 100vh; margin: auto; padding: 31px 38px }
      .source { margin: 0 0 9px; color: #0f766e; font-size: 14px; font-weight: 700 }
      h1 { margin: 0; font: 700 clamp(28px, 5vw, 43px)/1.16 Georgia, serif; letter-spacing: -.025em }
      header > p:last-child { max-width: 740px; margin: 14px 0 0; color: #44403c }
      ul { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 0; margin: 22px 0;
        list-style: none }
      li { padding: 13px 16px; border: 1px solid #d9dfd6; border-top: 3px solid #0f766e;
        border-radius: 7px; background: #ffffff; font-weight: 650 }
      section { padding: 15px 19px; border-radius: 7px; border: 1px solid #d9dfd6; background: #fff }
      h2 { margin: 0; font-size: 20px }
      section p { margin: 5px 0 0; color: #44403c }
      aside { margin-top: 15px; padding: 9px 14px; background: #f5e7cb; border-radius: 6px;
        color: #784315; font-size: 15px; font-weight: 600 }
    </style>
    <body><main>
      <header>
        <p class="source">${escapeHtml(sample.videoLabel)} · ${escapeHtml(youtubeSource.credit)}</p>
        <h1>${escapeHtml(sample.title)}</h1>
        <p>${escapeHtml(sample.summary)}</p>
      </header>
      <ul>${themes}</ul>
      <section><h2>${escapeHtml(sample.discussion)}</h2><p>${escapeHtml(sample.discussionNote)}</p></section>
      <aside>${escapeHtml(sample.verification)}</aside>
    </main></body></html>`;
}

function makeRecord(locale, sample) {
  const thread = threads[locale];
  const excerpt = (id, content, likes, replies = []) => ({
    id: `store-youtube-comment-${id}`,
    username: `${thread.viewer} ${id}`,
    content,
    likes,
    timestamp: '',
    replies,
  });
  const comments = [
    excerpt(1, sample.comments[0], 922),
    excerpt(2, thread.parent, 652, [excerpt(5, thread.reply, 28)]),
  ];
  const timestamp = Date.now();
  return {
    id: historyId,
    url: youtubeSource.url,
    title: sample.title,
    platform: 'youtube.com',
    extractedAt: timestamp,
    analyzedAt: timestamp,
    commentsCount: comments.length,
    comments,
    analysis: {
      markdown: [
        `# ${sample.title}`,
        `*${sample.videoLabel} · ${youtubeSource.credit}*`,
        sample.summary,
        sample.themes.map((theme) => `- ${theme}`).join('\n'),
        `**${sample.discussion}**\n\n${sample.discussionNote}`,
        `**${sample.verification}**`,
      ].join('\n\n'),
      generatedAt: timestamp,
      tokensUsed: 0,
      dynamicHtml: makeReport(locale, sample),
    },
  };
}

async function sendMessage(page, message) {
  const result = await page.evaluate((request) => chrome.runtime.sendMessage(request), message);
  if (result?.error || result?.success === false) {
    throw new Error(`${message.type} failed: ${JSON.stringify(result)}`);
  }
  return result;
}

async function setAppearance(control, locale, theme) {
  await sendMessage(control, {
    type: 'SAVE_SETTINGS',
    payload: { settings: { language: locale, theme, developerMode: false } },
  });
}

async function seedRecord(control, record) {
  await sendMessage(control, { type: 'GET_HISTORY' });
  const { id, url, title, platform, extractedAt, analyzedAt, commentsCount } = record;
  const metadata = { id, url, title, platform, extractedAt, analyzedAt, commentsCount };
  await control.evaluate(
    ({ record, metadata }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open('CommentsInsightDatabase');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(['history', 'historyMetadata'], 'readwrite');
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error);
          };
          transaction.objectStore('history').put(record);
          transaction.objectStore('historyMetadata').put({ ...metadata, hasAnalysis: true });
        };
      }),
    { record, metadata },
  );
}

async function waitForUi(page, theme, label) {
  try {
    await page.waitForFunction(
      (theme, label) =>
        document.documentElement.classList.contains('dark') === (theme === 'dark') &&
        [...document.querySelectorAll('button')].some(
          (button) => button.innerText.trim() === label && !button.disabled,
        ),
      { timeout: 8000, polling: 'mutation' },
      theme,
      label,
    );
  } catch (error) {
    const state = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      theme: document.documentElement.className,
      text: document.body.innerText,
    }));
    throw new Error(`Expected "${label}" in ${theme} theme: ${JSON.stringify(state)}`, {
      cause: error,
    });
  }
  await page.evaluate(() => document.fonts.ready);
}

async function capturePopup(source, popup, origin, sample, catalog, theme, directory) {
  await source.bringToFront();
  await popup.goto(`${origin}/src/popup/index.html`);
  await waitForUi(popup, theme, catalog.popup.viewAnalysis);
  await popup.waitForFunction(
    (title) => document.body.innerText.includes(title),
    { timeout: 8000, polling: 'mutation' },
    sample.title,
  );
  await popup.bringToFront();
  await popup.addStyleTag({
    content: 'body { min-height: 100vh; display: grid; place-items: center } #root { zoom: 1.45 }',
  });
  const root = await popup.waitForSelector('#root');
  const box = await root.boundingBox();
  if (!box || box.y < 0 || box.y + box.height > viewport.height) {
    throw new Error(`Popup does not fit in ${theme} theme: ${sample.title}`);
  }
  await root.screenshot({ path: path.join(directory, `01-popup-${theme}.png`) });
}

async function captureHistory(page, origin, locale, sample, catalog, mode, directory) {
  const config = {
    analysis: { theme: 'dark', label: catalog.history.exportMarkdown, filename: '02-analysis.png' },
    dynamic: { theme: 'light', label: catalog.history.exportHtml, filename: '03-dashboard.png' },
    comments: { theme: 'light', label: catalog.history.exportCsv, filename: '04-comments.png' },
  }[mode];
  const params = new URLSearchParams({ id: historyId, tab: mode, fullscreen: 'true' });
  await page.goto(`${origin}/src/history/index.html?${params}`);
  await waitForUi(page, config.theme, config.label);

  if (mode === 'dynamic') {
    const iframe = await page.waitForSelector('iframe[title]');
    const frame = await iframe.contentFrame();
    await frame.waitForFunction(
      (title) => document.querySelector('#report-root h1')?.textContent === title,
      { timeout: 8000 },
      sample.title,
    );
    await frame.evaluate(() => document.fonts.ready);
  }

  if (mode === 'comments') {
    const replyLabel = catalog.history.reply.replace('{{count}}', '1');
    await page.$$eval(
      'button',
      (buttons, label) => {
        const reply = buttons.find((button) =>
          [...button.querySelectorAll('span')].some((span) => span.textContent === label),
        );
        if (!reply) throw new Error('Unable to locate the approved sample reply');
        reply.click();
      },
      replyLabel,
    );
    await page.waitForFunction(
      (reply) => document.body.innerText.includes(reply),
      { timeout: 8000 },
      threads[locale].reply,
    );
  }

  if (mode === 'analysis') {
    await page.waitForFunction(
      (summary) => document.body.innerText.includes(summary),
      { timeout: 8000 },
      sample.summary,
    );
  }

  await page.screenshot({ path: path.join(directory, config.filename) });
}

async function main() {
  const { version } = await readJson('package.json');
  const output = path.resolve(
    process.argv[2] ?? path.join(projectRoot, 'build', `store-v${version}-raw`),
  );
  const extension = path.resolve(process.argv[3] ?? path.join(projectRoot, 'dist'));
  for (const extensionDir of [extension, path.join(projectRoot, 'dist')]) {
    const relative = path.relative(extensionDir, output);
    if (
      relative === '' ||
      (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
    ) {
      throw new Error('Choose a screenshot output directory outside the extension package');
    }
  }
  const manifest = await readJson(path.join(extension, 'manifest.json'));
  if (manifest.version !== version || !manifest.default_locale) {
    throw new Error(
      'Build the current localized production extension before capturing screenshots',
    );
  }
  const availableLocales = Object.keys(await readJson('src/config/locales.json'));
  const locales = process.argv[4]?.split(',') ?? availableLocales;
  for (const locale of locales) {
    if (!availableLocales.includes(locale) || !youtubeExample[locale] || !threads[locale]) {
      throw new Error(`Missing screenshot content for ${locale}`);
    }
  }

  const browser = await puppeteer.launch({
    executablePath: await requireChromeExecutablePath(),
    headless: true,
    pipe: true,
    enableExtensions: [extension],
    defaultViewport: viewport,
    args: ['--disable-background-networking', '--no-first-run'],
  });
  try {
    const worker = await browser.waitForTarget(
      (target) =>
        target.type() === 'service_worker' && target.url().startsWith('chrome-extension:'),
    );
    const origin = `chrome-extension://${new URL(worker.url()).host}`;
    const control = await browser.newPage();
    await control.goto(`${origin}/src/options/index.html`);
    const source = await browser.newPage();
    await source.setRequestInterception(true);
    let sourceHtml = '';
    source.on('request', (request) => {
      if (request.isNavigationRequest() && request.url() === youtubeSource.url) {
        void request.respond({ contentType: 'text/html; charset=utf-8', body: sourceHtml });
      } else {
        void request.abort();
      }
    });
    const popup = await browser.newPage();
    const history = await browser.newPage();
    await popup.emulateMediaFeatures(motion);
    await history.emulateMediaFeatures(motion);
    for (const locale of locales) {
      const sample = youtubeExample[locale];
      const catalog = await readJson(`src/locales/${locale}.json`);
      const directory = path.join(output, locale);
      await fs.mkdir(directory, { recursive: true });

      sourceHtml = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(sample.title)}</title>`;
      await source.goto(youtubeSource.url);
      await seedRecord(control, makeRecord(locale, sample));

      await setAppearance(control, locale, 'dark');
      await capturePopup(source, popup, origin, sample, catalog, 'dark', directory);
      await captureHistory(history, origin, locale, sample, catalog, 'analysis', directory);

      await setAppearance(control, locale, 'light');
      await capturePopup(source, popup, origin, sample, catalog, 'light', directory);
      await captureHistory(history, origin, locale, sample, catalog, 'comments', directory);
      await captureHistory(history, origin, locale, sample, catalog, 'dynamic', directory);
      console.log(`Captured ${locale}`);
    }
    console.log(`Chrome Web Store UI captures: ${output}`);
  } finally {
    await browser.close();
  }
}

await main();
