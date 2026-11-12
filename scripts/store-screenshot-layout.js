import fs from 'node:fs/promises';
import path from 'node:path';
import { storeScreenshotCopy } from './store-screenshot-copy.js';

const background = new URL('../images/screenshots/assets/store-background.png', import.meta.url);
const icon = new URL('../public/icons/icon-128.png', import.meta.url);
const width = 1280;
const height = 800;

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
  .hero { grid-template-columns: minmax(0, 1fr) 56px minmax(0, 1.25fr); }
  .quote-panel { padding: 26px 28px 29px }
  .quote-panel h2 { font-size: 29px; letter-spacing: -.021em; margin: 5px 0 18px }
  .quotes { display: grid; gap: 12px; padding: 0; margin: 0; list-style: none }
  .quotes li { display: flex; align-items: flex-start; gap: 12px; padding: 13px 15px;
    border: 1px solid #e7e8f2; border-radius: 12px; background: #f7f8fc;
    color: #303950; font-size: 18px; line-height: 1.38 }
  .quote-icon { display: grid; place-items: center; width: 28px; height: 28px; flex: none;
    padding-top: 4px; border-radius: 8px; background: #e7eaff; color: #3f4db2;
    font: 700 27px/1 Georgia, serif }
  .quotes li:nth-child(2) .quote-icon { background: #eee5ff; color: #6a3ec2 }
  .quotes li:nth-child(3) .quote-icon { background: #ddf2f7; color: #127589 }
  .arrow { place-self: center; color: #574cb2; font-size: 34px; line-height: 1 }
  .insight { padding: 29px 34px 33px; border-radius: 22px;
    background: radial-gradient(ellipse at top right, #303272, transparent 62%), #191b40;
    border: 1px solid #3e4275; color: white; box-shadow: 0 25px 58px #28266c45 }
  .insight .sample { color: #c5cbf2 }
  .insight-context { display: flex; justify-content: space-between; gap: 16px; align-items: center }
  .insight-context span:last-child { text-align: right }
  .insight h2 { font-size: 31px; line-height: 1.19; margin: 7px 0 27px; letter-spacing: -.025em }
  .topics { margin: 0; padding: 0; list-style: none; display: grid; gap: 19px }
  .topics li > div { display: flex; gap: 16px; justify-content: space-between; align-items: center;
    font-size: 21px; font-weight: 650; margin-bottom: 7px }
  .topics strong { font-variant-numeric: tabular-nums; font-size: 25px; line-height: 1 }
  .track { display: block; background: #ffffff20; border-radius: 8px; height: 8px }
  .bar { display: block; height: 100%; border-radius: inherit; background: #9da6ff }
  li:nth-child(2) .bar { background: #c7a7ff }
  li:nth-child(3) .bar { background: #83deeb }
  .analysis { grid-template-columns: minmax(0, 1fr) 292px; gap: 23px }
  .analysis .screen { width: fit-content; max-width: 100% }
  .analysis .screen img { max-width: 100%; max-height: 455px; width: auto; height: auto }
  .next-step { background: #eeecff; border: 1px solid #7165bc34; border-radius: 17px;
    padding: 25px 22px; color: #282052; box-shadow: 0 14px 28px #33386d16 }
  .next-step h2 { font-size: 23px; line-height: 1.25; margin: 7px 0 12px }
  .next-step p:last-child { font-size: 20px; line-height: 1.46 }
  .crop { position: relative; overflow: hidden; height: var(--crop-height) }
  .crop img { position: absolute; max-width: none; width: var(--image-width);
    top: var(--offset-top); left: var(--offset-left) }
  .collect { grid-template-columns: minmax(0, 575px) 56px auto; justify-content: center }
  .collect .quote-panel { background: #fffffff5 }
  .popup img { max-width: 360px; max-height: 450px; width: auto; height: auto }
  .verify { justify-items: center }
  .verify > div { width: 890px }
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

function makeQuotes(copy, sample, heading) {
  const comments = sample.comments
    .map((comment) => `<li><span class="quote-icon">“</span>${escapeHtml(comment)}</li>`)
    .join('');
  return `<section class="paper quote-panel">
    <p class="sample">${escapeHtml(copy.example)}</p>
    <h2>${escapeHtml(heading)}</h2>
    <ul class="quotes">${comments}</ul>
  </section>`;
}

function makeHero(copy, sample, counts, countLabel) {
  const total = counts.reduce((sum, count) => sum + count, 0);
  const topics = sample.labels
    .map((label, index) => {
      const count = counts[index];
      return `<li><div>${escapeHtml(label)}<strong>${count}</strong></div>
        <span class="track"><span class="bar" style="width:${(count / total) * 100}%"></span></span></li>`;
    })
    .join('');
  return `${makeQuotes(copy, sample, copy.discussion)}
    <span class="arrow">→</span>
    <section class="insight">
      <p class="sample insight-context"><span>${escapeHtml(sample.title)}</span>
        <span>${escapeHtml(countLabel)}</span></p>
      <h2>${escapeHtml(copy.findings)}</h2>
      <ul class="topics">${topics}</ul>
    </section>`;
}

function makeScreen(source, { scale, left = 0, top = 0, displayHeight }) {
  const dimensions = `--image-width:${width * scale}px;--offset-left:${-left * scale}px;
    --offset-top:${-top * scale}px;--crop-height:${displayHeight}px`;
  return `<figure class="screen crop" style="${dimensions}"><img src="${source}"></figure>`;
}

function makeAnalysis(copy, sample, source) {
  return `<div>
    <div class="caption">${escapeHtml(copy.analysisPanel)}</div>
    <figure class="screen"><img src="${source}"></figure>
    </div>
    <section class="next-step">
      <p class="sample">${escapeHtml(sample.sample)}</p>
      <h2>${escapeHtml(sample.nextHeading)}</h2>
      <p>${escapeHtml(sample.next)}</p>
    </section>`;
}

function makeCollect(copy, sample, popup) {
  return `${makeQuotes(copy, sample, sample.title)}
    <span class="arrow">→</span>
    <div>
      <div class="caption">${escapeHtml(copy.popupPanel)}</div>
      <figure class="screen popup"><img src="${popup}"></figure>
    </div>`;
}

function makeComments(copy, source) {
  return `<div>
    <div class="caption">${escapeHtml(copy.commentsPanel)}</div>
    ${makeScreen(source, { scale: 1.04, left: 426, top: 233, displayHeight: 452 })}
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
    <main class="stage ${slide.layout}">${slide.content}</main>
    </body></html>`;
}

export async function renderStoreSlides(browser, directory, locale, sample, counts, countLabel) {
  const copy = storeScreenshotCopy[locale];
  if (!copy) throw new Error(`Missing store screenshot copy for ${locale}`);
  const source = (name) => imageUrl(path.join(directory, 'source', name), 'jpeg');
  const [backdrop, logo, popup, analysis, dashboard, comments] = await Promise.all([
    imageUrl(background, 'png'),
    imageUrl(icon, 'png'),
    source('01-popup-ready.jpg'),
    source('02-analysis.jpg'),
    source('03-dashboard.jpg'),
    source('04-comments.jpg'),
  ]);
  const slides = [
    ['00-cover.jpg', 'hero', copy.hero, makeHero(copy, sample, counts, countLabel)],
    ['01-analysis.jpg', 'analysis', copy.analysis, makeAnalysis(copy, sample, analysis)],
    ['02-collect.jpg', 'collect', copy.collect, makeCollect(copy, sample, popup)],
    ['03-comments.jpg', 'verify', copy.verify, makeComments(copy, comments)],
    ['04-export.jpg', 'export', copy.export, makeExport(copy, dashboard)],
  ];
  const page = await browser.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    for (const [name, layout, copy, content] of slides) {
      const html = makeSlide(
        locale,
        { layout, copy, content },
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
        if (
          heading.scrollWidth > heading.clientWidth ||
          header.getBoundingClientRect().bottom > stage.getBoundingClientRect().top ||
          stage.scrollHeight > stage.clientHeight
        ) {
          throw new Error(`Store screenshot content does not fit: ${heading.textContent}`);
        }
      });
      await page.screenshot({ path: path.join(directory, name), type: 'jpeg', quality: 94 });
    }
  } finally {
    await page.close();
  }
}
