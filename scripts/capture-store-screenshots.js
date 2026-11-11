import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { requireChromeExecutablePath } from './browser-locator.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const extensionPath = path.join(projectRoot, 'dist');
const viewport = { width: 1280, height: 800, deviceScaleFactor: 1 };
const topicCounts = [22, 16, 10];
const totalComments = topicCounts.reduce((total, count) => total + count, 0);
const sampleModel = 'Demo';

const samples = {
  'en-US': {
    title: 'A weekend bike ride by the river',
    heading: 'What riders said',
    summary:
      'Riders loved the riverside views and asked for clearer signs and more places to rest.',
    topics: 'Topics in the comments',
    sample: 'Sample report',
    labels: ['Riverside views', 'Clearer route signs', 'More rest stops'],
    comments: [
      'The river views made this ride a favorite.',
      'A sign at the fork would make the route easier to follow.',
      'Another bench along the path would be welcome.',
    ],
  },
  'zh-CN': {
    title: '周末沿江骑行',
    heading: '骑友们怎么说',
    summary: '骑友们喜欢沿江的风景，也希望路标更清晰、沿途有更多休息点。',
    topics: '评论中的主要话题',
    sample: '示例报告',
    labels: ['沿江风景', '更清晰的路标', '更多休息点'],
    comments: [
      '江边的风景让我很喜欢这条线路。',
      '岔路口加个指示牌就更好找路了。',
      '沿路多放一张长椅就更好了。',
    ],
  },
  'zh-TW': {
    title: '週末河濱單車行',
    heading: '車友們怎麼說',
    summary: '車友們喜歡河濱景色，也希望路線指標更清楚、沿途能多一些休息點。',
    topics: '留言中的主要話題',
    sample: '範例報告',
    labels: ['河濱景色', '更清楚的路線指標', '更多休息點'],
    comments: [
      '河岸景色讓我很喜歡這條路線。',
      '岔路口如果有指標，找路會更容易。',
      '沿途如果多一張長椅就更好了。',
    ],
  },
  'ja-JP': {
    title: '週末の川沿いサイクリング',
    heading: 'サイクリストの声',
    summary:
      '川沿いの景色が好評でした。分かりやすい案内標識や、休憩できる場所を増やしてほしいという声もありました。',
    topics: 'コメントでよく挙がった話題',
    sample: 'サンプルレポート',
    labels: ['川沿いの景色', '分かりやすい案内標識', '休憩スポットの追加'],
    comments: [
      '川沿いの景色がきれいで、お気に入りのコースになりました。',
      '分岐点に案内標識があると迷わずに済みそうです。',
      '途中にベンチがもう一つあるとうれしいです。',
    ],
  },
  'ko-KR': {
    title: '주말 강변 자전거 나들이',
    heading: '자전거 이용자들의 의견',
    summary:
      '강변 풍경이 좋은 반응을 얻었습니다. 길 안내 표지를 더 알아보기 쉽게 하고 쉼터를 늘려 달라는 의견도 있었습니다.',
    topics: '댓글에서 많이 언급된 주제',
    sample: '예시 보고서',
    labels: ['강변 풍경', '더 알아보기 쉬운 길 안내', '쉼터 추가'],
    comments: [
      '강변 풍경이 좋아서 마음에 드는 코스가 됐어요.',
      '갈림길에 안내 표지가 있으면 길을 찾기 쉬울 것 같아요.',
      '자전거길에 벤치가 하나 더 있으면 좋겠어요.',
    ],
  },
  'fr-FR': {
    title: 'Une balade à vélo au bord de la rivière',
    heading: 'Ce qu’en disent les cyclistes',
    summary:
      'Les cyclistes ont apprécié la vue sur la rivière. Ils souhaitent un itinéraire mieux balisé et davantage d’aires de repos.',
    topics: 'Sujets évoqués dans les commentaires',
    sample: 'Exemple de rapport',
    labels: ['Vue sur la rivière', 'Balisage plus clair', 'Davantage d’aires de repos'],
    comments: [
      'La vue sur la rivière a fait de cette balade l’une de mes préférées.',
      'Un panneau au croisement aiderait à suivre le parcours.',
      'Un banc de plus le long du chemin serait le bienvenu.',
    ],
  },
  'pt-PT': {
    title: 'Um passeio de bicicleta junto ao rio',
    heading: 'O que dizem os ciclistas',
    summary:
      'Os ciclistas gostaram da paisagem ribeirinha e pediram sinalização mais clara e mais locais para descansar.',
    topics: 'Temas nos comentários',
    sample: 'Relatório de exemplo',
    labels: ['Paisagem ribeirinha', 'Sinalização mais clara', 'Mais locais de descanso'],
    comments: [
      'A vista para o rio tornou este percurso um dos meus favoritos.',
      'Uma placa na bifurcação ajudaria a seguir o percurso.',
      'Fazia falta mais um banco ao longo do caminho.',
    ],
  },
  'es-ES': {
    title: 'Un paseo en bicicleta junto al río',
    heading: 'Qué opinan los ciclistas',
    summary:
      'A los ciclistas les gustaron las vistas al río. Pidieron señales más claras y más sitios para descansar.',
    topics: 'Temas de los comentarios',
    sample: 'Informe de ejemplo',
    labels: ['Vistas al río', 'Señales más claras', 'Más zonas de descanso'],
    comments: [
      'Las vistas al río hicieron que este recorrido se convirtiera en uno de mis favoritos.',
      'Una señal en el cruce ayudaría a seguir la ruta.',
      'Se agradecería otro banco junto al camino.',
    ],
  },
};

const popupCanvasCss = `
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: radial-gradient(ellipse at 22% 12%, #dfeaff, transparent 58%),
      radial-gradient(ellipse at 90% 78%, #ece1ff, transparent 65%), #f5f7fb;
  }
  #root {
    overflow: hidden;
    border-radius: 14px;
    box-shadow: 0 22px 74px #26265633, 0 0 0 1px #39447119;
    zoom: 1.45;
  }
`;

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function countLabel(catalog, count) {
  return catalog.history.commentsWithCount.replace('{{count}}', String(count));
}

function makeReport(locale, sample, catalog) {
  const bars = sample.labels
    .map(
      (label, index) => `<li>
      <div class="row"><span>${escapeHtml(label)}</span><strong>${topicCounts[index]}</strong></div>
      <div class="track"><div class="bar" style="--share:${(topicCounts[index] / totalComments) * 100}%"></div></div>
    </li>`,
    )
    .join('');
  return `<!doctype html>
  <html lang="${locale}"><meta charset="utf-8"><style>
    * { box-sizing: border-box }
    body { margin: 0; color: #18243f; background: #f2f5fb;
      font: 18px/1.5 "Segoe UI", system-ui, sans-serif }
    main { min-height: 100vh; padding: 50px max(6vw, 36px);
      background: radial-gradient(ellipse at top right, #e7ddff, transparent 65%), #f2f5fb }
    .report { max-width: 1060px; margin: 0 auto }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 34px;
      align-items: end; margin-bottom: 30px }
    .eyebrow { color: #475abb; font-weight: 700; font-size: 16px; margin: 0 0 9px }
    h1 { margin: 0 0 12px; font-size: clamp(34px, 4vw, 52px); line-height: 1.2;
      letter-spacing: -.025em }
    header p:last-child { color: #495775; max-width: 720px; margin: 0 }
    .sample-size { align-self: end; white-space: nowrap; padding: 9px 15px;
      background: #e0e7ff; color: #394aa4; border-radius: 8px; font-weight: 650 }
    section { border: 1px solid #dce2ee; background: white; border-radius: 14px; padding: 26px 32px;
      box-shadow: 0 12px 34px #22356d0c }
    h2 { font-size: 24px; margin: 0 0 20px }
    ul { margin: 0; padding: 0; display: grid; gap: 18px; list-style: none }
    .row { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 8px;
      font-weight: 600 }
    .row strong { color: #4d50b3; font-variant-numeric: tabular-nums }
    .track { height: 12px; background: #edf0f9; border-radius: 999px }
    .bar { width: var(--share); height: 100%; background: linear-gradient(90deg, #4e62e8, #8465ed);
      border-radius: inherit }
  </style><body><main><div class="report">
    <header>
      <div>
        <p class="eyebrow">${escapeHtml(sample.sample)}</p>
        <h1>${escapeHtml(sample.heading)}</h1>
        <p>${escapeHtml(sample.summary)}</p>
      </div>
      <div class="sample-size">${escapeHtml(countLabel(catalog, totalComments))}</div>
    </header>
    <section>
      <h2>${escapeHtml(sample.topics)}</h2>
      <ul>${bars}</ul>
    </section>
  </div></main></body></html>`;
}

function makeHistoryItem(locale, sample, catalog, sourceUrl) {
  const timestamp = Date.now();
  const comments = topicCounts.flatMap((count, topicIndex) =>
    Array.from({ length: count }, (_, index) => ({
      id: `comment-${topicIndex}-${index}`,
      username: `rider_${topicIndex + 1}_${index + 1}`,
      content: sample.comments[topicIndex],
      likes: count - index,
      timestamp: new Date(timestamp - 3600000).toISOString(),
      replies: [],
    })),
  );
  return {
    id: `store-sample-${locale}`,
    url: sourceUrl,
    title: sample.title,
    platform: new URL(sourceUrl).hostname,
    extractedAt: timestamp - 6 * 60000,
    analyzedAt: timestamp - 2 * 60000,
    commentsCount: totalComments,
    comments,
    analysis: {
      markdown: `# ${sample.heading}\n\n${sample.summary}`,
      tokensUsed: 1140,
      generatedAt: timestamp - 2 * 60000,
      dynamicHtml: makeReport(locale, sample, catalog),
    },
  };
}

async function readJson(filename) {
  return JSON.parse(await fs.readFile(path.join(projectRoot, filename), 'utf8'));
}

async function seedSample(control, locale, item) {
  await control.evaluate(
    async ({ locale, item, sampleModel }) => {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        payload: {
          settings: { language: locale, theme: 'light', aiModel: { model: sampleModel } },
        },
      });
      if (!response?.success) {
        throw new Error(`Unable to set language: ${JSON.stringify(response)}`);
      }
      const history = await chrome.runtime.sendMessage({ type: 'GET_HISTORY' });
      if (history?.error) {
        throw new Error('Unable to initialize the screenshot profile history');
      }
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('CommentsInsightDatabase');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction(['history', 'historyMetadata'], 'readwrite');
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
          transaction.objectStore('history').put(item);
          transaction.objectStore('historyMetadata').put({
            id: item.id,
            url: item.url,
            title: item.title,
            platform: item.platform,
            extractedAt: item.extractedAt,
            analyzedAt: item.analyzedAt,
            commentsCount: item.commentsCount,
            hasAnalysis: true,
          });
        };
      });
    },
    { locale, item, sampleModel },
  );
}

async function capturePopup(source, popup, origin, item, catalog, filePath) {
  await source.bringToFront();
  await popup.goto(`${origin}/src/popup/index.html`);
  try {
    await popup.waitForFunction(
      (title, label, state) => {
        const text = document.body.innerText;
        return text.includes(title) && text.includes(label) && text.includes(state);
      },
      { timeout: 8000, polling: 'mutation' },
      item.title,
      catalog.popup.currentPage,
      catalog.popup.analyzed,
    );
  } catch (error) {
    const rendered = await popup.evaluate(() => document.body.innerText);
    throw new Error(`Popup did not render the sample ${item.id}:\n${rendered}`, { cause: error });
  }
  await popup.bringToFront();
  await popup.addStyleTag({ content: popupCanvasCss });
  await popup.evaluate(() => document.fonts.ready);
  const box = await popup.$eval('#root', (element) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  });
  if (
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > viewport.width ||
    box.y + box.height > viewport.height
  ) {
    throw new Error(`Popup does not fit the store screenshot: ${item.id}`);
  }
  await popup.screenshot({ path: filePath, type: 'jpeg', quality: 93 });
}

async function captureReport(report, origin, item, sample, catalog, filePath) {
  const params = new URLSearchParams({ id: item.id, tab: 'dynamic', fullscreen: 'true' });
  await report.bringToFront();
  await report.goto(`${origin}/src/history/index.html?${params}`);
  await report.waitForFunction(
    (label) => document.body.innerText.includes(label),
    { timeout: 8000 },
    catalog.history.exportHtml,
  );
  const iframe = await report.waitForSelector('iframe[title]', { timeout: 8000 });
  const frame = await iframe.contentFrame();
  await frame.waitForFunction(
    (heading) => document.querySelector('#report-root h1')?.textContent === heading,
    { timeout: 8000 },
    sample.heading,
  );
  await frame.evaluate(() => document.fonts.ready);
  await report.screenshot({ path: filePath, type: 'jpeg', quality: 93 });
}

async function main() {
  const manifest = await readJson('dist/manifest.json');
  const project = await readJson('package.json');
  const locales = Object.keys(await readJson('src/config/locales.json'));
  if (manifest.version !== project.version || !manifest.default_locale) {
    throw new Error(
      'Build the current localized production extension before capturing screenshots',
    );
  }
  const output = path.resolve(
    process.argv[2] ?? path.join(projectRoot, 'build', 'store-assets', `v${manifest.version}`),
  );
  const relativeToDist = path.relative(extensionPath, output);
  if (
    relativeToDist === '' ||
    (!relativeToDist.startsWith('..') && !path.isAbsolute(relativeToDist))
  ) {
    throw new Error(
      'Choose a screenshot output directory outside dist so it stays out of the package',
    );
  }

  const browser = await puppeteer.launch({
    executablePath: requireChromeExecutablePath(),
    headless: true,
    pipe: true,
    enableExtensions: [extensionPath],
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
      if (request.isNavigationRequest() && request.url().startsWith('https://riverside.example/')) {
        void request.respond({ contentType: 'text/html; charset=utf-8', body: sourceHtml });
      } else {
        void request.abort();
      }
    });
    const popup = await browser.newPage();
    const report = await browser.newPage();

    for (const locale of locales) {
      const sample = samples[locale];
      if (!sample) throw new Error(`Missing localized screenshot sample for ${locale}`);
      const catalog = await readJson(`src/locales/${locale}.json`);
      const sourceUrl = `https://riverside.example/${locale}/cycle-route`;
      const item = makeHistoryItem(locale, sample, catalog, sourceUrl);
      await seedSample(control, locale, item);

      sourceHtml = `<!doctype html><html lang="${locale}"><meta charset="utf-8">
        <title>${escapeHtml(sample.title)}</title><h1>${escapeHtml(sample.title)}</h1>
        <ul>${sample.comments.map((comment) => `<li>${escapeHtml(comment)}</li>`).join('')}</ul>
      </html>`;
      await source.goto(sourceUrl);
      const directory = path.join(output, locale);
      await fs.mkdir(directory, { recursive: true });
      await capturePopup(
        source,
        popup,
        origin,
        item,
        catalog,
        path.join(directory, '01-popup.jpg'),
      );
      await captureReport(
        report,
        origin,
        item,
        sample,
        catalog,
        path.join(directory, '02-report.jpg'),
      );
      console.log(`Captured ${locale}`);
    }
    console.log(`Chrome Web Store screenshots: ${output}`);
  } finally {
    await browser.close();
  }
}

await main();
