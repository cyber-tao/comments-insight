# E2E Testing for Chrome Extensions

## Overview

E2E testing for Chrome extensions requires special considerations due to the
extension architecture (service worker, content scripts, popup, options page).
The extension can only be exercised end-to-end when Chromium is launched with
the built `dist/` directory loaded as an unpacked extension in headful mode.

## Prerequisites

- `bun install` — Puppeteer 24.x is already listed in `devDependencies`.
- `bun run build` — produces `dist/` for the loader to consume.
- Chromium (bundled with Puppeteer) or a local Chrome install.

## Option 1: Puppeteer (used in this repo)

`scripts/test-youtube.js` runs a scripted extraction against a public YouTube
video and asserts the extension writes results to `chrome.storage.local`. It is
the reference implementation for browser-level regression checks.

### Environment variables

| Variable                           | Description                                                         | Default                                       |
| ---------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- |
| `COMMENTS_INSIGHT_SETTINGS_PATH`   | JSON file with settings to preload (API key/model, prompt template) | none                                          |
| `COMMENTS_INSIGHT_VIDEO_URL`       | Target URL to scrape                                                | `https://www.youtube.com/watch?v=gQySzdR2k74` |
| `COMMENTS_INSIGHT_MAX_COMMENTS`    | Number of comments to extract                                       | `20`                                          |
| `COMMENTS_INSIGHT_TEST_TIMEOUT_MS` | Overall test timeout                                                | `180000`                                      |

### Run

```bash
bun run build
COMMENTS_INSIGHT_SETTINGS_PATH=./secrets/settings.json \
COMMENTS_INSIGHT_VIDEO_URL=https://www.youtube.com/watch?v=... \
bun scripts/test-youtube.js
```

The script launches Chromium with `--load-extension=dist`, injects the settings
file, drives the extraction flow, and prints the extracted comments to stdout.

## Option 2: Playwright (alternative)

Playwright also supports headful extension testing:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  use: {
    headless: false,
    launchOptions: {
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    },
  },
});
```

Not adopted in this repo because the Puppeteer script already covers the
critical happy path with fewer moving parts.

## Key Scenarios to Cover

1. **Popup functionality**
   - Settings save/load.
   - Navigation to history page.
   - Extraction button triggers the content script.

2. **Content script injection**
   - Script injects on supported pages.
   - Comment extraction succeeds.
   - Progress updates render correctly.

3. **Background service worker**
   - Message routing between components.
   - History storage (Dexie/IndexedDB) writes and reads.
   - AI service calls (streamed chat completions).

4. **Options page**
   - API configuration round-trip.
   - Crawling config CRUD.

## Notes

- Chrome extensions can only be tested in headful mode; CI runners must
  provide an X server (or Xvfb) if Puppeteer is executed on Linux.
- Service worker state is best asserted by reading `chrome.storage.local`
  through `chrome.tabs.executeScript` from an extension page.
- Prefer mocking `chrome.storage.local` and IndexedDB in unit tests (see
  `tests/setup.ts` for the shared setup); reserve this file for browser-level
  smoke tests.
