import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

// Chrome for Testing, Chromium and Edge still honour --load-extension, which
// branded Chrome 137+ ignores. Prefer those builds and only fall back to
// branded Chrome, which may silently refuse to load the unpacked extension.
async function getPuppeteerCacheBrowsers() {
  let pinnedPath;
  try {
    pinnedPath = await puppeteer.executablePath();
  } catch {
    return [];
  }

  // <cache>/chrome/<build>/chrome-win64/chrome.exe -> <cache>/chrome
  const buildsDir = path.dirname(path.dirname(path.dirname(pinnedPath)));
  const executableRelativePath = path.relative(path.dirname(buildsDir), pinnedPath);
  const buildSegmentIndex = executableRelativePath.indexOf(path.sep);
  const executableSuffix =
    buildSegmentIndex === -1 ? '' : executableRelativePath.slice(buildSegmentIndex + 1);

  let builds = [];
  try {
    builds = fs
      .readdirSync(buildsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch {
    return [pinnedPath];
  }

  return [pinnedPath, ...builds.map((build) => path.join(buildsDir, build, executableSuffix))];
}

export async function getChromeExecutablePath() {
  const candidatePaths = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    ...(await getPuppeteerCacheBrowsers()),
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    process.env.CHROME_BIN,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function requireChromeExecutablePath() {
  const executablePath = await getChromeExecutablePath();
  if (!executablePath) {
    throw new Error(
      'No usable browser found. Run "bunx puppeteer browsers install chrome" or set PUPPETEER_EXECUTABLE_PATH to Chrome for Testing, Chromium, or Edge.',
    );
  }
  return executablePath;
}
