import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { requireChromeExecutablePath } from './browser-locator.js';
import { renderStoreSlides } from './store-screenshot-layout.js';
import { youtubeExample } from './store-youtube-example.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

async function readJson(filename) {
  return JSON.parse(await fs.readFile(path.join(projectRoot, filename), 'utf8'));
}

async function main() {
  const { version } = await readJson('package.json');
  const locales = Object.keys(await readJson('src/config/locales.json'));
  const output = path.resolve(
    process.argv[2] ?? path.join(projectRoot, 'build', 'store-assets', `v${version}`),
  );
  const captures = path.resolve(
    process.argv[3] ?? path.join(projectRoot, 'build', `store-v${version}-raw`),
  );
  const relativeToDist = path.relative(path.join(projectRoot, 'dist'), output);
  if (
    relativeToDist === '' ||
    (!relativeToDist.startsWith('..') && !path.isAbsolute(relativeToDist))
  ) {
    throw new Error('Choose a screenshot output directory outside dist');
  }

  const browser = await puppeteer.launch({
    executablePath: await requireChromeExecutablePath(),
    headless: true,
    pipe: true,
    args: ['--disable-background-networking', '--no-first-run'],
  });
  try {
    for (const locale of locales) {
      const sample = youtubeExample[locale];
      if (!sample) throw new Error(`Missing YouTube example copy for ${locale}`);
      const { options } = await readJson(`src/locales/${locale}.json`);
      const directory = path.join(output, locale);
      await fs.mkdir(directory, { recursive: true });
      await renderStoreSlides(browser, directory, locale, sample, captures, options);
      console.log(`Rendered ${locale}`);
    }
    console.log(`Chrome Web Store screenshots: ${output}`);
  } finally {
    await browser.close();
  }
}

await main();
