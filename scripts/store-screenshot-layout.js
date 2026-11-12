import fs from 'node:fs/promises';
import path from 'node:path';
import { storeScreenshotCopy } from './store-screenshot-copy.js';
import { youtubeSource } from './store-youtube-example.js';

const icon = new URL('../public/icons/icon-128.png', import.meta.url);
const viewport = { width: 1280, height: 800, deviceScaleFactor: 1 };
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
  :root {
    --ink: #1c1917; --quiet: #57534e; --teal: #0f766e;
    --line: #d9d2c7; --card: #fffefa;
    --serif: "Newsreader", "Noto Serif SC", "Songti SC", Georgia, serif;
  }
  body {
    margin: 0; width: 1280px; height: 800px; overflow: hidden;
    background: radial-gradient(ellipse at 100% 100%, #dceae0 0, transparent 56%), #f6f0e5;
    color: var(--ink); font: 20px/1.4 "Inter", "Segoe UI", "Microsoft YaHei UI",
      "Microsoft JhengHei UI", Meiryo, "Malgun Gothic", sans-serif;
  }
  body.ink {
    --ink: #fcf8f2; --quiet: #d3c8bc; --teal: #75d6c8;
    --line: #555049; --card: #282420;
    background: radial-gradient(ellipse at 100% 100%, #213c35 0, transparent 55%), #1c1917;
  }
  .masthead { padding: 33px 66px 0 }
  .brand { display: inline-flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 720 }
  .brand img { width: 40px; height: 40px; border-radius: 10px; box-shadow: 0 2px 5px #21171130 }
  h1 { margin: 14px 0 8px; font: 700 60px/1.13 var(--serif); letter-spacing: -.035em; white-space: nowrap }
  :lang(zh) h1, :lang(ja) h1, :lang(ko) h1 {
    font-family: "Noto Serif CJK SC", "Songti SC", "Microsoft YaHei UI", "Microsoft JhengHei UI",
      Meiryo, "Malgun Gothic", sans-serif; letter-spacing: -.021em
  }
  .subtitle { margin: 0; color: var(--quiet); font-size: 23px; max-width: 1110px }
  .stage { position: absolute; inset: 224px 66px 41px; display: grid; align-items: center }
  .stage p, .stage h2, .stage figure { margin: 0 }
  .paper, .screen {
    background: var(--card); border: 1px solid var(--line); border-radius: 17px;
    overflow: hidden; box-shadow: 0 16px 37px #1c19171f, 0 3px 9px #1c19170c;
  }
  .ink .paper, .ink .screen { box-shadow: 0 20px 45px #100f0c70 }
  .screen { position: relative }
  .screen img { display: block; width: 100%; height: auto }
  .label { color: var(--teal); font-size: 16px; font-weight: 680 }
  .caption { color: var(--quiet); font-size: 18px; font-weight: 650; margin-bottom: 9px }
  .hero { inset-block-end: 116px; grid-template-columns: minmax(0, 1fr) 45px minmax(0, 1.16fr) }
  .quote-panel { padding: 22px 24px }
  .case-preview { border-bottom: 1px solid var(--line); padding-bottom: 15px; margin-bottom: 15px }
  .case-preview strong { display: block; margin-top: 4px; font-size: 23px; line-height: 1.22 }
  .quote-panel h2 { font-size: 24px; margin-bottom: 11px }
  .quotes { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none }
  .quotes li { display: flex; gap: 11px; padding: 11px 12px; border-radius: 9px;
    background: #f5f0e8; color: #34302a; font-size: 18px; line-height: 1.33 }
  .quote-icon { color: #0f766e; font: 700 26px/1.05 Georgia, serif }
  .quote-panel .comment-note { margin-top: 11px; color: var(--quiet); font-size: 14px }
  .arrow { place-self: center; color: var(--teal); font-size: 33px }
  .insight {
    padding: 24px 27px; border: 1px solid #35443b; border-radius: 18px;
    color: #fcf8f2; background: linear-gradient(140deg, #1c1917 28%, #202c25 100%);
    box-shadow: 0 19px 39px #1c191732;
  }
  .insight .label { color: #81d8c9 }
  .insight h2 { margin: 4px 0 10px; font-size: 28px; line-height: 1.2 }
  .insight .summary { color: #e6dfd5; font-size: 18px; line-height: 1.39 }
  .topics { margin: 14px 0 0; padding: 0; list-style: none; display: grid; gap: 7px }
  .topics li { display: flex; gap: 10px; align-items: center; font-size: 17px; font-weight: 650;
    padding: 6px 10px; border: 1px solid #ffffff19; background: #ffffff09; border-radius: 8px }
  .topics li::before { content: ''; width: 8px; height: 8px; border-radius: 50%;
    flex: none; background: #6bd3bf }
  .topics li:nth-child(2)::before { background: #edab66 }
  .insight .verification { margin-top: 11px; color: #b9cbbf; font-size: 15px }
  .platforms { position: absolute; inset: auto 66px 43px; display: flex; gap: 14px;
    align-items: center; font-size: 15px }
  .platforms > strong { color: var(--quiet); font-size: 16px; padding-right: 8px }
  .platforms ul { display: flex; gap: 8px; margin: 0; padding: 0; list-style: none }
  .platforms li { display: flex; align-items: center; gap: 6px; padding: 6px 10px;
    border: 1px solid #d9d2c7; border-radius: 8px; background: #fffefa; white-space: nowrap;
    font-weight: 630; color: #332f2b }
  .platforms img { display: block; width: 21px; height: 21px; object-fit: contain }
  .analysis { grid-template-columns: minmax(0, 760px) 280px; gap: 24px; justify-content: center }
  .analysis .screen { height: 500px; background: #141210 }
  .analysis .screen img { margin-top: -76px }
  .reply-note { padding: 23px 22px; border: 1px solid #4e6254; border-radius: 13px;
    background: #26352d; color: #f9f4eb }
  .reply-note h2 { font-size: 24px; line-height: 1.25; margin: 7px 0 9px }
  .reply-note p:last-child { color: #dedad2; font-size: 20px; line-height: 1.39 }
  .collect { grid-template-columns: repeat(2, minmax(0, 354px)); gap: 38px; justify-content: center }
  .collect::before { content: ''; position: absolute; inset: 1px 35px 0; z-index: -1;
    border: 1px solid #d9d2c7; border-radius: 20px;
    background: linear-gradient(90deg, #eee6d9 0 50%, #272420 50% 100%); }
  .collect .popup { width: fit-content; margin: auto; border-radius: 15px }
  .collect .popup img { width: auto; height: auto; max-width: 354px; max-height: 437px }
  .collect .caption { text-align: center; color: #3e3933; margin-bottom: 10px }
  .collect .dark-theme .caption { color: #f4eee4 }
  .collect .dark-theme .screen { border-color: #4e4943; box-shadow: 0 20px 38px #100d0b63 }
  .verify { justify-items: center }
  .verify > div { width: min(824px, 100%) }
  .verify .screen { height: 494px; background: #faf8f5 }
  .verify .screen img { margin-top: -80px }
  .export { grid-template-columns: 265px minmax(0, 785px); gap: 27px; justify-content: center }
  .export .screen { height: 520px; background: #faf8f5 }
  .file-list { display: grid; gap: 11px; padding: 0; margin: 0; list-style: none }
  .file-list li { display: flex; gap: 13px; align-items: center; padding: 14px }
  .file-icon { width: 40px; height: 43px; border-radius: 7px; background: #304b40; flex: none;
    display: grid; place-items: center; color: #b3e6d4 }
  .file-list li:nth-child(2) .file-icon { color: #f1c399; background: #503829 }
  .file-icon::before { content: ''; width: 15px; height: 19px; border: 2px solid currentColor;
    border-radius: 3px; background: linear-gradient(currentColor, currentColor) center 8px / 7px 2px no-repeat,
      linear-gradient(currentColor, currentColor) center 12px / 7px 2px no-repeat }
  .file-list strong { display: block; font-size: 21px; letter-spacing: -.02em }
  .file-list span:last-child { color: var(--quiet); font-size: 16px; line-height: 1.24; display: block }
`;

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, (character) => {
    const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return entities[character];
  });
}

async function pngUrl(filename) {
  return `data:image/png;base64,${(await fs.readFile(filename)).toString('base64')}`;
}

function makeHero(copy, sample) {
  const comments = [sample.comments[0], sample.comments[2]]
    .map((comment) => `<li><span class="quote-icon">“</span>${escapeHtml(comment)}</li>`)
    .join('');
  const topics = sample.themes.map((theme) => `<li>${escapeHtml(theme)}</li>`).join('');
  return `<section class="paper quote-panel">
    <div class="case-preview"><p class="label">${youtubeSource.credit}</p>
      <strong>${escapeHtml(sample.title)}</strong></div>
    <h2>${escapeHtml(copy.discussion)}</h2>
    <ul class="quotes">${comments}</ul>
    <p class="comment-note">${escapeHtml(sample.commentNote)}</p>
    </section>
    <span class="arrow">→</span>
    <section class="insight">
      <p class="label">${escapeHtml(sample.videoLabel)}</p>
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

function makeScreen(source, className = '') {
  return `<figure class="screen ${className}"><img src="${source}" alt=""></figure>`;
}

function makeAnalysis(copy, sample, source) {
  return `<div><div class="caption">${escapeHtml(copy.analysisPanel)}</div>
    ${makeScreen(source)}</div>
    <section class="reply-note">
      <p class="label">${escapeHtml(sample.videoLabel)}</p>
      <h2>${escapeHtml(sample.discussion)}</h2>
      <p>${escapeHtml(sample.discussionNote)}</p>
    </section>`;
}

function makeCollect(light, dark, options) {
  return `<div><div class="caption">${escapeHtml(options.themeLight)}</div>
    ${makeScreen(light, 'popup')}</div>
    <div class="dark-theme"><div class="caption">${escapeHtml(options.themeDark)}</div>
    ${makeScreen(dark, 'popup')}</div>`;
}

function makeComments(copy, source) {
  return `<div><div class="caption">${escapeHtml(copy.commentsPanel)}</div>
    ${makeScreen(source)}</div>`;
}

function makeExport(copy, source) {
  const formats = copy.exports
    .map(
      ({ type, label }) => `<li class="paper"><span class="file-icon"></span>
      <div><strong>${escapeHtml(type)}</strong><span>${escapeHtml(label)}</span></div></li>`,
    )
    .join('');
  return `<ul class="file-list">${formats}</ul>${makeScreen(source)}`;
}

function makeSlide(locale, slide, logo) {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><style>
    ${styles}
    </style></head><body class="${slide.palette}">
    <header class="masthead">
      <div class="brand"><img src="${logo}" alt="">Comments Insight</div>
      <h1>${escapeHtml(slide.copy.title)}</h1>
      <p class="subtitle">${escapeHtml(slide.copy.description)}</p>
    </header>
    <main class="stage ${slide.layout}">${slide.content}</main>${slide.footer ?? ''}
    </body></html>`;
}

export async function renderStoreSlides(browser, directory, locale, sample, captures, options) {
  const copy = storeScreenshotCopy[locale];
  if (!copy) throw new Error(`Missing store screenshot copy for ${locale}`);
  const screenshot = (name) => pngUrl(path.join(captures, locale, `${name}.png`));
  const [logo, light, dark, analysis, dashboard, comments, marks] = await Promise.all([
    pngUrl(icon),
    screenshot('01-popup-light'),
    screenshot('01-popup-dark'),
    screenshot('02-analysis'),
    screenshot('03-dashboard'),
    screenshot('04-comments'),
    Promise.all(
      platforms.map(([id]) =>
        pngUrl(new URL(`../images/screenshots/assets/platforms/${id}.png`, import.meta.url)),
      ),
    ),
  ]);
  const slides = [
    [
      '00-cover.jpg',
      'hero',
      'paper-theme',
      copy.hero,
      makeHero(copy, sample),
      makePlatforms(sample, marks, locale),
    ],
    ['01-analysis.jpg', 'analysis', 'ink', copy.analysis, makeAnalysis(copy, sample, analysis)],
    ['02-collect.jpg', 'collect', 'paper-theme', copy.collect, makeCollect(light, dark, options)],
    ['03-comments.jpg', 'verify', 'paper-theme', copy.verify, makeComments(copy, comments)],
    ['04-export.jpg', 'export', 'ink', copy.export, makeExport(copy, dashboard)],
  ];
  const page = await browser.newPage();
  try {
    await page.setViewport(viewport);
    for (const [name, layout, palette, copy, content, footer] of slides) {
      await page.setContent(makeSlide(locale, { layout, palette, copy, content, footer }, logo), {
        waitUntil: 'load',
      });
      await page.evaluate(async () => {
        await document.fonts.ready;
        const heading = document.querySelector('h1');
        for (let size = 60; heading.scrollWidth > heading.clientWidth && size > 39; size--) {
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
          image: [...document.images].some((img) => img.naturalWidth === 0),
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
