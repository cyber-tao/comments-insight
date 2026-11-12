import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { requireChromeExecutablePath } from './browser-locator.js';
import { renderStoreSlides } from './store-screenshot-layout.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const extensionPath = path.join(projectRoot, 'dist');
const viewport = { width: 1280, height: 800, deviceScaleFactor: 1 };
const topicCounts = [22, 16, 10];
const totalComments = topicCounts.reduce((total, count) => total + count, 0);
const sampleModel = 'Demo';
const sourceDomain = 'reviews.example';
const sourceOrigin = `https://${sourceDomain}`;
const sampleRule = {
  id: 'store-screenshot-rule',
  domain: sourceDomain,
  siteName: 'Sample review',
  lastUpdated: Date.now(),
  container: { selector: '#comments', type: 'css' },
  item: { selector: 'li', type: 'css' },
  fields: [
    { name: 'username', rule: { selector: '.author', type: 'css' } },
    { name: 'content', rule: { selector: '.comment', type: 'css' } },
  ],
};

const samples = {
  'en-US': {
    title: 'Wireless headphones review',
    heading: 'What buyers notice',
    summary:
      'Indoor calls get praise. Wind noise outdoors and pressure with glasses are the main trade-offs.',
    topics: 'Topics in the comments',
    sample: 'Sample analysis',
    labels: ['Clear calls indoors', 'Wind noise outdoors', 'Pressure with glasses'],
    comments: [
      'My voice sounded clear on calls from home, even with the fan on.',
      'The mic was fine at my desk but picked up wind on my commute.',
      'With glasses on, the earcups felt tight after about an hour.',
    ],
    alternatives: [
      'My teammates could hear me clearly in the office.',
      'My caller heard every gust while I walked down the street.',
      'The earcups squeezed my glasses after a long meeting.',
    ],
    reply: 'Same here. It was only an issue when I called from outside.',
    quoteHeading: 'In their own words',
    nextHeading: 'What to check next',
    next: 'Try a call outdoors. If you wear glasses, check the fit after an hour of listening.',
  },
  'zh-CN': {
    title: '无线耳机体验评测',
    heading: '这款耳机，大家在意什么',
    summary: '室内通话清晰是常见好评。户外风噪和戴眼镜久戴夹耳，是评论反复提到的取舍。',
    topics: '评论中的主要话题',
    sample: '示例分析',
    labels: ['室内通话清晰', '户外风噪明显', '戴眼镜久戴夹耳'],
    comments: [
      '在家开着风扇打电话，对方还是能听清我说话。',
      '在工位打电话没问题，通勤路上开麦容易收到风声。',
      '我戴眼镜，用了一个小时左右就觉得耳罩有点夹。',
    ],
    alternatives: [
      '办公室通话时收音很清楚，同事都不用让我重复。',
      '过马路时吹了几阵风，对面说风声特别明显。',
      '开了一个长会，耳罩压镜腿的位置有点疼。',
    ],
    reply: '我也遇到了，只有在外面打电话才明显。',
    quoteHeading: '评论原话',
    nextHeading: '值得实际试试',
    next: '先试一通户外电话。戴眼镜的话，可以试试佩戴一小时后的舒适度。',
  },
  'zh-TW': {
    title: '無線耳機使用評測',
    heading: '這款耳機，大家在意什麼',
    summary: '室內通話清楚是常見好評。戶外風聲和戴眼鏡久戴夾耳，是留言反覆提到的取捨。',
    topics: '留言中的主要話題',
    sample: '範例分析',
    labels: ['室內通話清楚', '戶外風聲明顯', '戴眼鏡久戴夾耳'],
    comments: [
      '在家開著電扇講電話，對方還是聽得清楚。',
      '在座位上通話沒問題，通勤時麥克風很容易收到風聲。',
      '我戴眼鏡，用了一小時左右就覺得耳罩有點夾。',
    ],
    alternatives: [
      '在辦公室通話時同事都聽得很清楚。',
      '過馬路時吹了幾陣風，對方說風聲很明顯。',
      '開會開久了，耳罩壓眼鏡鏡腳的位置有點痛。',
    ],
    reply: '我也遇到了，只有在外面講電話才明顯。',
    quoteHeading: '留言原文',
    nextHeading: '值得實際試試',
    next: '先在戶外試打一通電話。戴眼鏡的話，可以試試配戴一小時後的舒適度。',
  },
  'ja-JP': {
    title: 'ワイヤレスヘッドホンのレビュー',
    heading: '購入者が重視したこと',
    summary:
      '室内での通話の明瞭さは好評です。屋外の風切り音と、眼鏡をかけたときの圧迫感もよく挙がりました。',
    topics: 'コメントでよく挙がった話題',
    sample: '分析例',
    labels: ['室内での通話が明瞭', '屋外で風切り音が入る', '眼鏡をかけると圧迫感がある'],
    comments: [
      '家で扇風機をつけたままでも、声がはっきり聞こえると言われました。',
      'デスクでは問題ないけれど、通勤中の通話では風の音が入ります。',
      '眼鏡をかけて1時間ほど使うと、耳のあたりが締め付けられる感じがします。',
    ],
    alternatives: [
      'オフィスの通話では声がよく届きました。',
      '道路を歩いていると風の音が目立ちました。',
      '長い会議の後は眼鏡のつるが押されて痛くなりました。',
    ],
    reply: '私も同じです。屋外で通話したときだけ気になりました。',
    quoteHeading: 'コメントの原文',
    nextHeading: '試しておきたいこと',
    next: '屋外で一度通話してみましょう。眼鏡を使う方は、1時間ほど装着したときの着け心地も確認できます。',
  },
  'ko-KR': {
    title: '무선 헤드폰 사용 후기',
    heading: '구매자가 주목한 점',
    summary:
      '실내 통화는 선명하다는 평이 많았습니다. 야외 바람 소리와 안경 착용 시 압박감도 자주 언급됐습니다.',
    topics: '댓글에서 많이 언급된 주제',
    sample: '분석 예시',
    labels: ['선명한 실내 통화', '야외 통화 중 바람 소리', '안경 착용 시 압박감'],
    comments: [
      '집에서 선풍기를 켜 놓고 통화했는데도 제 말이 잘 들린대요.',
      '자리에서 통화할 때는 괜찮았는데 출근길엔 바람 소리가 들어갔어요.',
      '안경을 쓰고 한 시간쯤 착용하니 귀 쪽이 꽉 눌리는 느낌이었어요.',
    ],
    alternatives: [
      '사무실에서 통화할 때 동료들이 제 말을 잘 들었어요.',
      '길을 걸을 때 상대방이 바람 소리가 크다고 했어요.',
      '회의가 길어지니 안경 다리가 눌려 아팠어요.',
    ],
    reply: '저도 그랬어요. 밖에서 통화할 때만 느껴졌어요.',
    quoteHeading: '댓글 원문',
    nextHeading: '확인해 볼 점',
    next: '야외에서 통화해 보세요. 안경을 쓴다면 한 시간 정도 착용한 후 편안한지도 확인해 보세요.',
  },
  'fr-FR': {
    title: 'Test d’un casque sans fil',
    heading: 'Ce qui compte pour les acheteurs',
    summary:
      'Les appels en intérieur sont appréciés. Le bruit du vent dehors et la pression avec des lunettes reviennent souvent.',
    topics: 'Sujets évoqués dans les commentaires',
    sample: 'Exemple d’analyse',
    labels: ['Appels clairs en intérieur', 'Bruit du vent dehors', 'Pression avec des lunettes'],
    comments: [
      'Même avec le ventilateur allumé à la maison, on entendait bien ma voix.',
      'Au bureau, le micro allait bien, mais il captait le vent sur mon trajet.',
      'Avec mes lunettes, les coussinets serraient au bout d’une heure.',
    ],
    alternatives: [
      'Mes collègues m’entendaient bien au bureau.',
      'Dans la rue, on entendait chaque rafale à l’autre bout du fil.',
      'Après une longue réunion, le casque appuyait sur mes lunettes.',
    ],
    reply: 'Pareil pour moi. Ça ne me gênait que lors des appels en extérieur.',
    quoteHeading: 'Dans leurs propres mots',
    nextHeading: 'À essayer',
    next: 'Passez un appel dehors. Avec des lunettes, vérifiez le confort après une heure d’écoute.',
  },
  'pt-PT': {
    title: 'Análise de auscultadores sem fios',
    heading: 'O que os compradores destacam',
    summary:
      'As chamadas em espaços interiores são elogiadas. O vento no exterior e a pressão com óculos são mencionados com frequência.',
    topics: 'Temas nos comentários',
    sample: 'Análise de exemplo',
    labels: ['Chamadas nítidas em casa', 'Ruído do vento no exterior', 'Pressão ao usar óculos'],
    comments: [
      'Em casa, ouviam bem a minha voz mesmo com a ventoinha ligada.',
      'À secretária funcionava bem, mas o microfone captava o vento no trajeto.',
      'Com os óculos, as almofadas começaram a apertar passado cerca de uma hora.',
    ],
    alternatives: [
      'Os colegas ouviam-me bem no escritório.',
      'Do outro lado ouviam todas as rajadas.',
      'Após uma reunião longa, os auscultadores pressionavam as hastes dos óculos.',
    ],
    reply: 'Aconteceu-me o mesmo. Só notei o problema em chamadas na rua.',
    quoteHeading: 'Nas palavras dos utilizadores',
    nextHeading: 'O que vale a pena testar',
    next: 'Experimente fazer uma chamada na rua. Se usa óculos, verifique o conforto após uma hora.',
  },
  'es-ES': {
    title: 'Reseña de auriculares inalámbricos',
    heading: 'Qué destacan los compradores',
    summary:
      'La claridad de las llamadas en interiores recibe elogios. El viento en la calle y la presión con gafas son las pegas más repetidas.',
    topics: 'Temas en los comentarios',
    sample: 'Análisis de ejemplo',
    labels: [
      'Llamadas claras en interiores',
      'Ruido del viento en la calle',
      'Presión al llevar gafas',
    ],
    comments: [
      'En casa, se me oía con claridad incluso con el ventilador encendido.',
      'En el escritorio, el micro iba bien, pero captaba el viento de camino al trabajo.',
      'Con gafas, las almohadillas empezaron a apretar después de una hora.',
    ],
    alternatives: [
      'Mis compañeros me oían bien en la oficina.',
      'Al otro lado oían cada ráfaga mientras caminaba por la calle.',
      'Después de una reunión larga me apretaban las patillas de las gafas.',
    ],
    reply: 'A mí también me pasó. Solo lo noté al hablar desde la calle.',
    quoteHeading: 'En sus propias palabras',
    nextHeading: 'Qué merece la pena probar',
    next: 'Haz una llamada en la calle. Si llevas gafas, comprueba la comodidad al cabo de una hora.',
  },
};

const popupCanvasCss = `
  body {
    min-height: 100vh;
    display: grid;
    place-items: center;
  }
  #root {
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

function makeAnalysis(sample, catalog) {
  const topics = sample.labels.map(
    (label, index) => `- **${label}** · ${countLabel(catalog, topicCounts[index])}`,
  );
  return [
    `# ${sample.heading}`,
    `*${sample.sample} · ${countLabel(catalog, totalComments)}*`,
    sample.summary,
    `## ${sample.topics}\n\n${topics.join('\n')}`,
    `## ${sample.quoteHeading}\n\n> ${sample.comments[1]}`,
    `## ${sample.nextHeading}\n\n${sample.next}`,
  ].join('\n\n');
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
    blockquote { margin: 22px 0 0; padding: 12px 18px; color: #3c4661;
      background: #f2f4fc; border-left: 4px solid #6366d9; border-radius: 0 8px 8px 0 }
    blockquote strong { display: block; margin-bottom: 3px; font-size: 15px }
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
      <blockquote><strong>${escapeHtml(sample.quoteHeading)}</strong>
        ${escapeHtml(sample.comments[1])}</blockquote>
    </section>
  </div></main></body></html>`;
}

function makeHistoryItem(locale, sample, catalog, sourceUrl) {
  const timestamp = Date.now();
  const commentTime = new Date(timestamp - 3600000).toISOString();
  const comments = topicCounts.flatMap((count, topicIndex) =>
    Array.from({ length: count }, (_, index) => ({
      id: `comment-${topicIndex}-${index}`,
      username: `reviewer_${topicIndex + index * topicCounts.length + 1}`,
      content: index % 2 === 0 ? sample.comments[topicIndex] : sample.alternatives[topicIndex],
      likes: Math.max(1, 38 - index * 3 - [1, 0, 2][topicIndex]),
      timestamp: commentTime,
      replies:
        topicIndex === 1 && index === 0
          ? [
              {
                id: 'wind-noise-reply',
                username: 'reviewer_49',
                content: sample.reply,
                likes: 6,
                timestamp: commentTime,
                replies: [],
              },
            ]
          : [],
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
      markdown: makeAnalysis(sample, catalog),
      tokensUsed: 1140,
      generatedAt: timestamp - 2 * 60000,
      dynamicHtml: makeReport(locale, sample, catalog),
    },
  };
}

async function readJson(filename) {
  return JSON.parse(await fs.readFile(path.join(projectRoot, filename), 'utf8'));
}

async function setSampleSettings(control, locale) {
  await control.evaluate(
    async ({ locale, sampleModel, sampleRule }) => {
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_SETTINGS',
        payload: {
          settings: {
            language: locale,
            theme: 'light',
            aiModel: { model: sampleModel },
            crawlingConfigs: [sampleRule],
          },
        },
      });
      if (!response?.success) {
        throw new Error(`Unable to set language: ${JSON.stringify(response)}`);
      }
    },
    { locale, sampleModel, sampleRule },
  );
}

async function seedSample(control, item) {
  await control.evaluate(async (item) => {
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
        const history = transaction.objectStore('history');
        const metadata = transaction.objectStore('historyMetadata');
        history.clear();
        metadata.clear();
        history.put(item);
        metadata.put({
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
  }, item);
}

async function capturePopup(source, popup, origin, item, catalog, filePath) {
  await source.bringToFront();
  await popup.goto(`${origin}/src/popup/index.html`);
  try {
    await popup.waitForFunction(
      (title, action) => {
        const buttons = [...document.querySelectorAll('button')];
        return (
          document.body.innerText.includes(title) &&
          buttons.some((button) => button.innerText.trim() === action && !button.disabled)
        );
      },
      { timeout: 8000, polling: 'mutation' },
      item.title,
      catalog.popup.extractComments,
    );
  } catch (error) {
    const rendered = await popup.evaluate(() => document.body.innerText);
    throw new Error(`Popup did not render the sample ${item.id}:\n${rendered}`, { cause: error });
  }
  await popup.bringToFront();
  await popup.addStyleTag({ content: popupCanvasCss });
  await popup.evaluate(() => document.fonts.ready);
  const root = await popup.waitForSelector('#root');
  const box = await root.boundingBox();
  if (
    !box ||
    box.x < 0 ||
    box.y < 0 ||
    box.x + box.width > viewport.width ||
    box.y + box.height > viewport.height
  ) {
    throw new Error(`Popup does not fit the store screenshot: ${item.id}`);
  }
  await root.screenshot({ path: filePath, type: 'jpeg', quality: 95 });
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
  await report.screenshot({ path: filePath, type: 'jpeg', quality: 95 });
}

async function captureDetail(page, origin, item, sample, catalog, mode, filePath) {
  const params = new URLSearchParams({ id: item.id, tab: mode });
  await page.bringToFront();
  await page.goto(`${origin}/src/history/index.html?${params}`);
  await page.waitForFunction(
    (label) => document.body.innerText.includes(label),
    { timeout: 8000 },
    mode === 'analysis' ? catalog.history.exportMarkdown : catalog.history.exportCsv,
  );
  if (mode === 'comments') {
    const replyLabel = catalog.history.reply.replace('{{count}}', '1');
    await page.$$eval(
      'button',
      (buttons, label) => {
        const reply = buttons.find((button) => button.innerText.trim() === `▶ 💬 ${label}`);
        if (!reply) throw new Error('Unable to expand the sample reply');
        reply.click();
      },
      replyLabel,
    );
  }
  await page.waitForFunction(
    (text) => document.body.innerText.includes(text),
    { timeout: 8000 },
    mode === 'analysis' ? sample.heading : sample.reply,
  );
  await page.evaluate(() => document.fonts.ready);
  const screenshot = { path: filePath, type: 'jpeg', quality: 95 };
  if (mode === 'analysis') {
    const bottom = await page.waitForFunction(
      () => {
        const lastTopic = document.querySelector('.prose ul > li:last-child');
        if (!lastTopic) return false;
        const bottom = Math.ceil(lastTopic.getBoundingClientRect().bottom + 14);
        return bottom < window.innerHeight && bottom;
      },
      { timeout: 8000 },
    );
    // The history page reserves one third of this viewport for its sidebar.
    const x = Math.floor(viewport.width / 3);
    const y = 152;
    screenshot.clip = { x, y, width: viewport.width - x, height: (await bottom.jsonValue()) - y };
    screenshot.captureBeyondViewport = false;
  }
  await page.screenshot(screenshot);
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
      if (request.isNavigationRequest() && request.url().startsWith(`${sourceOrigin}/`)) {
        void request.respond({ contentType: 'text/html; charset=utf-8', body: sourceHtml });
      } else {
        void request.abort();
      }
    });
    const popup = await browser.newPage();
    const report = await browser.newPage();
    await popup.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await report.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);

    for (const locale of locales) {
      const sample = samples[locale];
      if (!sample) throw new Error(`Missing localized screenshot sample for ${locale}`);
      const catalog = await readJson(`src/locales/${locale}.json`);
      const sourceUrl = `${sourceOrigin}/${locale}/headphones-review`;
      const item = makeHistoryItem(locale, sample, catalog, sourceUrl);
      await setSampleSettings(control, locale);

      sourceHtml = `<!doctype html><html lang="${locale}"><meta charset="utf-8">
        <title>${escapeHtml(sample.title)}</title><h1>${escapeHtml(sample.title)}</h1>
        <ul id="comments">${sample.comments
          .map(
            (comment, index) => `<li><b class="author">reviewer_${index + 1}</b>
            <p class="comment">${escapeHtml(comment)}</p></li>`,
          )
          .join('')}</ul>
      </html>`;
      await source.goto(sourceUrl);
      const directory = path.join(output, locale);
      const sourceDirectory = path.join(directory, 'source');
      await fs.mkdir(sourceDirectory, { recursive: true });
      await capturePopup(
        source,
        popup,
        origin,
        item,
        catalog,
        path.join(sourceDirectory, '01-popup-ready.jpg'),
      );
      await seedSample(control, item);
      await captureDetail(
        report,
        origin,
        item,
        sample,
        catalog,
        'analysis',
        path.join(sourceDirectory, '02-analysis.jpg'),
      );
      await captureReport(
        report,
        origin,
        item,
        sample,
        catalog,
        path.join(sourceDirectory, '03-dashboard.jpg'),
      );
      await captureDetail(
        report,
        origin,
        item,
        sample,
        catalog,
        'comments',
        path.join(sourceDirectory, '04-comments.jpg'),
      );
      await renderStoreSlides(
        browser,
        directory,
        locale,
        sample,
        topicCounts,
        countLabel(catalog, totalComments),
      );
      console.log(`Captured ${locale}`);
    }
    console.log(`Chrome Web Store screenshots: ${output}`);
  } finally {
    await browser.close();
  }
}

await main();
