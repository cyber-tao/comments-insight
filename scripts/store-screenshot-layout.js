import fs from 'node:fs/promises';
import path from 'node:path';
import { storeScreenshotCopy } from './store-screenshot-copy.js';
import { youtubeSource } from './store-youtube-example.js';

const background = new URL('../images/screenshots/assets/store-background.png', import.meta.url);
const icon = new URL('../public/icons/icon-128.png', import.meta.url);
const width = 1280;
const height = 800;
const platforms = [
  ['youtube', 'YouTube'],
  ['bilibili', 'Bilibili'],
  ['reddit', 'Reddit'],
  ['x', 'X'],
  ['tiktok', 'TikTok'],
  ['xiaohongshu', 'Xiaohongshu'],
];

const styles = `
  * { box-sizing: border-box }
  body {
    margin: 0; width: 1280px; height: 800px; overflow: hidden; color: #19203d;
    font: 22px/1.4 "Segoe UI", "Microsoft YaHei UI", "Microsoft JhengHei UI", Meiryo,
      "Malgun Gothic", sans-serif;
    background: center / cover no-repeat var(--background) #eef1fe;
  }
  .masthead { text-align: center; padding: 42px 48px 0 }
  .brand { display: inline-flex; gap: 10px; align-items: center; font-size: 21px; font-weight: 720 }
  .brand img { width: 36px; height: 36px }
  h1 { font-size: 61px; line-height: 1.16; letter-spacing: -.046em; margin: 17px 0 10px;
    font-weight: 780; white-space: nowrap }
  :lang(zh) h1, :lang(ja) h1, :lang(ko) h1 { letter-spacing: -.024em }
  .subtitle { margin: 0 auto; color: #4b5372; font-size: 24px; max-width: 1080px }
  .stage { position: absolute; inset: 251px 76px 46px; display: grid; align-items: center }
  .stage p, .stage h2, .stage figure { margin: 0 }
  .sample { font-size: 16px; font-weight: 680; color: #565f8c }
  .caption { color: #293357; font-size: 20px; font-weight: 730; margin-bottom: 12px }
  .paper, .screen { background: #fff; border: 1px solid #343e6b24; border-radius: 20px;
    box-shadow: 0 22px 48px #33386d24, 0 4px 10px #38437d0a; overflow: hidden }
  .screen img { display: block }
  .hero { inset-block: 237px 119px; grid-template-columns: minmax(0, 1fr) 52px minmax(0, 1.16fr) }
  .quote-panel { padding: 23px }
  .quote-panel h2 { font-size: 24px; letter-spacing: -.021em; margin: 0 0 14px }
  .case-preview { display: flex; align-items: center; gap: 13px; padding-bottom: 15px;
    margin-bottom: 15px; border-bottom: 1px solid #e6e7f2 }
  .case-preview img { width: 104px; aspect-ratio: 16 / 9; border-radius: 8px; object-fit: cover }
  .case-preview strong { display: block; font-size: 19px; line-height: 1.28 }
  .quote-panel .comment-note { margin-top: 12px; color: #4b5372; font-size: 15px }
  .quotes { display: grid; gap: 9px; padding: 0; margin: 0; list-style: none }
  .quotes li { display: flex; align-items: flex-start; gap: 12px; padding: 13px 15px;
    border: 1px solid #e7e8f2; border-radius: 12px; background: #f7f8fc;
    color: #303950; font-size: 18px; line-height: 1.38 }
  .quote-icon { display: grid; place-items: center; width: 28px; height: 28px; flex: none;
    padding-top: 4px; border-radius: 8px; background: #e7eaff; color: #3f4db2;
    font: 700 27px/1 Georgia, serif }
  .quotes li:nth-child(2) .quote-icon { background: #eee5ff; color: #6a3ec2 }
  .arrow { place-self: center; color: #574cb2; font-size: 34px; line-height: 1 }
  .insight { padding: 24px 29px; border-radius: 22px;
    background: radial-gradient(ellipse at top right, #303272, transparent 62%), #191b40;
    border: 1px solid #3e4275; color: white; box-shadow: 0 25px 58px #28266c45 }
  .insight .sample { color: #c5cbf2 }
  .insight h2 { font-size: 31px; line-height: 1.19; margin: 7px 0 14px; letter-spacing: -.025em }
  .insight .summary { color: #e2e4fa; font-size: 18px; line-height: 1.45 }
  .topics { margin: 17px 0 0; padding: 0; list-style: none; display: grid; gap: 8px }
  .topics li { display: flex; gap: 11px; align-items: center; font-size: 19px; font-weight: 650;
    padding: 6px 12px; border: 1px solid #ffffff18; background: #ffffff0c; border-radius: 9px }
  .topics li::before { content: ''; width: 9px; height: 9px; border-radius: 50%;
    flex: none; background: #aab5ff }
  .topics li:nth-child(2)::before { background: #d5acfc }
  .topics li:nth-child(3)::before { background: #87deeb }
  .insight .verification { margin-top: 14px; color: #c5cbf2; font-size: 16px }
  .platforms { position: absolute; inset: auto 76px 46px; display: flex; gap: 19px;
    align-items: center; justify-content: center; font-size: 18px }
  .platforms > strong { font-size: 17px; color: #3d466c }
  .platforms ul { display: flex; gap: 10px; margin: 0; padding: 0; list-style: none }
  .platforms li { display: flex; align-items: center; gap: 7px; padding: 8px 13px;
    border: 1px solid #38478129; border-radius: 13px; background: #ffffffdb; white-space: nowrap;
    font-weight: 650; color: #273050 }
  .platforms img { display: block; width: 25px; height: 25px; object-fit: contain }
  .analysis { grid-template-columns: minmax(0, 1fr) 292px; gap: 23px }
  .reply-note { background: #eeecff; border: 1px solid #7165bc34; border-radius: 17px;
    padding: 25px 22px; color: #282052; box-shadow: 0 14px 28px #33386d16 }
  .reply-note h2 { font-size: 23px; line-height: 1.25; margin: 7px 0 12px }
  .reply-note p:last-child { font-size: 20px; line-height: 1.46 }
  .crop { position: relative; overflow: hidden; height: var(--crop-height) }
  .crop img { position: absolute; max-width: none; width: var(--image-width);
    top: var(--offset-top); left: 0 }
  .collect { grid-template-columns: minmax(0, 575px) 56px auto; justify-content: center }
  .video img { display: block; width: 100%; height: auto }
  .video figcaption { padding: 15px 19px 17px }
  .video strong { display: block; font-size: 24px; letter-spacing: -.015em; line-height: 1.25 }
  .popup img { max-width: 360px; max-height: 450px; width: auto; height: auto }
  .verify { justify-items: center }
  .verify > div { width: 1024px }
  .export { grid-template-columns: 306px minmax(0, 1fr); gap: 24px }
  .file-list { display: grid; gap: 15px; padding: 0; margin: 0; list-style: none }
  .file-list li { display: flex; gap: 15px; align-items: center; padding: 15px 16px }
  .file-icon { width: 46px; height: 49px; border-radius: 9px; background: #e7eaff; flex: none;
    display: grid; place-items: center; color: #444fba }
  .file-list li:nth-child(2) .file-icon { color: #6942ac; background: #eee5ff }
  .file-list li:nth-child(3) .file-icon { color: #176477; background: #ddf2f7 }
  .file-icon::before { content: ''; width: 16px; height: 21px; border: 2px solid currentColor;
    border-radius: 3px; background: linear-gradient(currentColor, currentColor) center 9px / 8px 2px no-repeat,
      linear-gradient(currentColor, currentColor) center 14px / 8px 2px no-repeat }
  .file-list strong { display: block; font-size: 22px; letter-spacing: -.02em }
  .file-list span:last-child { color: #4b5372; font-size: 17px; line-height: 1.27; display: block }
`;

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });
}

async function imageUrl(filename, type) {
  const bytes = await fs.readFile(filename);
  return `data:image/${type};base64,${bytes.toString('base64')}`;
}

function makeHero(copy, sample, video) {
  const comments = [sample.comments[0], sample.comments[2]]
    .map((comment) => `<li><span class="quote-icon">“</span>${escapeHtml(comment)}</li>`)
    .join('');
  const topics = sample.themes.map((theme) => `<li>${escapeHtml(theme)}</li>`).join('');
  return `<section class="paper quote-panel">
    <div class="case-preview">
      <img src="${video}" alt="">
      <div><p class="sample">${youtubeSource.credit}</p><strong>${escapeHtml(sample.title)}</strong></div>
    </div>
    <h2>${escapeHtml(copy.discussion)}</h2>
    <ul class="quotes">${comments}</ul>
    <p class="comment-note">${escapeHtml(sample.commentNote)}</p>
    </section>
    <span class="arrow">→</span>
    <section class="insight">
      <p class="sample">${escapeHtml(sample.videoLabel)}</p>
      <h2>${escapeHtml(copy.findings)}</h2>
      <p class="summary">${escapeHtml(sample.summary)}</p>
      <ul class="topics">${topics}</ul>
      <p class="verification">${escapeHtml(sample.verification)}</p>
    </section>`;
}

function makePlatforms(sample, images, locale) {
  const chineseNames = {
    'zh-CN': { bilibili: '哔哩哔哩', xiaohongshu: '小红书' },
    'zh-TW': { bilibili: '嗶哩嗶哩', xiaohongshu: '小紅書' },
  };
  const items = platforms.map(([id, name], index) => {
    const label = chineseNames[locale]?.[id] ?? name;
    return `<li><img src="${images[index]}" alt="">${escapeHtml(label)}</li>`;
  });
  return `<footer class="platforms"><strong>${escapeHtml(sample.platformsLabel)}</strong>
    <ul>${items.join('')}</ul></footer>`;
}

function makeScreen(source, { scale, top = 0, displayHeight }) {
  const dimensions = `--image-width:${width * scale}px;
    --offset-top:${-top * scale}px;--crop-height:${displayHeight}px`;
  return `<figure class="screen crop" style="${dimensions}"><img src="${source}"></figure>`;
}

function makeAnalysis(copy, sample, source) {
  return `<div>
    <div class="caption">${escapeHtml(copy.analysisPanel)}</div>
    ${makeScreen(source, { scale: 0.635, top: 187, displayHeight: 375 })}
    </div>
    <section class="reply-note">
      <p class="sample">${escapeHtml(sample.videoLabel)}</p>
      <h2>${escapeHtml(sample.discussion)}</h2>
      <p>${escapeHtml(sample.discussionNote)}</p>
    </section>`;
}

function makeCollect(copy, sample, popup, video) {
  return `<figure class="paper video"><img src="${video}" alt="">
    <figcaption><p class="sample">${escapeHtml(sample.sourceLabel)} · ${youtubeSource.credit}</p>
      <strong>${escapeHtml(sample.title)}</strong></figcaption></figure>
    <span class="arrow">→</span>
    <div>
      <div class="caption">${escapeHtml(copy.popupPanel)}</div>
      <figure class="screen popup"><img src="${popup}"></figure>
    </div>`;
}

function makeComments(copy, source) {
  return `<div>
    <div class="caption">${escapeHtml(copy.commentsPanel)}</div>
    ${makeScreen(source, { scale: 0.8, top: 190, displayHeight: 444 })}
    </div>`;
}

function makeExport(copy, source) {
  const formats = copy.exports
    .map(
      ({ type, label }) => `<li class="paper"><span class="file-icon"></span>
      <div><strong>${escapeHtml(type)}</strong><span>${escapeHtml(label)}</span></div></li>`,
    )
    .join('');
  return `<ul class="file-list">${formats}</ul>
    ${makeScreen(source, { scale: 0.625, displayHeight: 430 })}`;
}

function makeSlide(locale, slide, images) {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
    :root { --background: url('${images.background}') }
    ${styles}
    </style></head><body>
    <header class="masthead">
      <div class="brand"><img src="${images.icon}">Comments Insight</div>
      <h1>${escapeHtml(slide.copy.title)}</h1>
      <p class="subtitle">${escapeHtml(slide.copy.description)}</p>
    </header>
    <main class="stage ${slide.layout}">${slide.content}</main>${slide.footer ?? ''}
    </body></html>`;
}

export async function renderStoreSlides(browser, directory, locale, sample, archive) {
  const copy = storeScreenshotCopy[locale];
  if (!copy) throw new Error(`Missing store screenshot copy for ${locale}`);
  const screenshot = (name) => imageUrl(path.join(archive, 'screenshots', locale, name), 'jpeg');
  const [backdrop, logo, popup, analysis, dashboard, comments, video, marks] = await Promise.all([
    imageUrl(background, 'png'),
    imageUrl(icon, 'png'),
    imageUrl(path.join(archive, 'source', 'approved-popup', `${locale}.png`), 'png'),
    screenshot('02-analysis.jpg'),
    screenshot('03-dashboard.jpg'),
    screenshot('04-comments.jpg'),
    imageUrl(path.join(archive, 'source', 'video-frame.jpg'), 'jpeg'),
    Promise.all(
      platforms.map(([id]) =>
        imageUrl(
          new URL(`../images/screenshots/assets/platforms/${id}.png`, import.meta.url),
          'png',
        ),
      ),
    ),
  ]);
  const slides = [
    [
      '00-cover.jpg',
      'hero',
      copy.hero,
      makeHero(copy, sample, video),
      makePlatforms(sample, marks, locale),
    ],
    ['01-analysis.jpg', 'analysis', copy.analysis, makeAnalysis(copy, sample, analysis)],
    ['02-collect.jpg', 'collect', copy.collect, makeCollect(copy, sample, popup, video)],
    ['03-comments.jpg', 'verify', copy.verify, makeComments(copy, comments)],
    ['04-export.jpg', 'export', copy.export, makeExport(copy, dashboard)],
  ];
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    for (const [name, layout, copy, content, footer] of slides) {
      const html = makeSlide(
        locale,
        { layout, copy, content, footer },
        { background: backdrop, icon: logo },
      );
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const heading = document.querySelector('h1');
        for (let size = 61; heading.scrollWidth > heading.clientWidth && size > 40; size--) {
          heading.style.fontSize = `${size - 1}px`;
        }
        const header = document.querySelector('.masthead');
        const stage = document.querySelector('.stage');
        const footer = document.querySelector('.platforms');
        const overflow = {
          title: heading.scrollWidth > heading.clientWidth,
          header: header.getBoundingClientRect().bottom > stage.getBoundingClientRect().top,
          content: stage.scrollHeight > stage.clientHeight,
          platforms: footer && footer.scrollWidth > footer.clientWidth,
        };
        for (const [region, clipped] of Object.entries(overflow)) {
          if (clipped)
            throw new Error(`Store screenshot ${region} does not fit: ${heading.textContent}`);
        }
      });
      await page.screenshot({ path: path.join(directory, name), type: 'jpeg', quality: 94 });
    }
  } finally {
    await page.close();
  }
}
