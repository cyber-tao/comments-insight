# E2E Testing for Chrome Extensions

## Overview

The browser suite loads the production `dist/` directory as an unpacked Manifest V3 extension and exercises the service worker, extension pages, sandbox, content script, task protocol, and IndexedDB persistence in a real Chromium-based browser.

The repository provides two Puppeteer scripts:

- `scripts/test-e2e-all.js` is the deterministic, credential-free regression suite used by CI.
- `scripts/test-youtube.js` is an optional live-provider/manual test that can call a configured AI service against a public page.

## Prerequisites

- `bun install`
- Chrome/Chromium/Edge 116 or newer
- `bun run build` before each browser run

Set `PUPPETEER_EXECUTABLE_PATH` or `CHROME_BIN` to select a browser explicitly. The scripts also check common Chrome, Chromium, and Edge locations on Windows, Linux, and macOS before falling back to Puppeteer's downloaded browser.

## Deterministic local suite

Run:

```bash
bun run build
bun run test:e2e
```

The suite starts a local HTTP page containing a fixed comment fixture, creates a temporary browser profile, loads the extension, and verifies:

1. the background service worker starts;
2. Options renders and settings round-trip through `chrome.storage.local`;
3. History renders a Dexie/IndexedDB record and filters it;
4. Logs and Popup render without page errors;
5. the sandbox renders safe static report content while removing scripts, event handlers, external image URLs, and frames;
6. a real `START_EXTRACTION` request creates a `TaskManager` task, dispatches `RUN_EXTRACTION` to the content script, extracts the fixture comments, and persists a readable history record.

The final extraction assertion reads the persisted record through `GET_HISTORY_BY_URL`; it does not use the development-only page hook and does not accept an empty page or an unmodified sandbox document as success.

This suite needs no API key and makes no AI-provider request. It uses a configured crawling rule for `127.0.0.1` so the extraction path is deterministic.

### CI

CI runs the browser suite after the production build:

```bash
xvfb-run -a bun run test:e2e
```

The suite launches in headful mode because extension service workers and extension pages must behave as they do in a normal browser session. Linux runners therefore need Xvfb or another display server.

## Optional live YouTube test

`scripts/test-youtube.js` exercises the unpacked extension against a configurable public page. It uses the unpacked-development content-script hook to start extraction and reports the final outcome through a page console marker. Extracted history is still persisted through the normal background flow.

This test can invoke a real AI provider and is intentionally not part of CI.

### Environment variables

| Variable                           | Description                                                      | Default                                       |
| ---------------------------------- | ---------------------------------------------------------------- | --------------------------------------------- |
| `COMMENTS_INSIGHT_SETTINGS_PATH`   | Local JSON settings file to preload, potentially including a key | none                                          |
| `COMMENTS_INSIGHT_VIDEO_URL`       | Target URL                                                       | `https://www.youtube.com/watch?v=gQySzdR2k74` |
| `COMMENTS_INSIGHT_MAX_COMMENTS`    | Maximum comments to extract                                      | `20`                                          |
| `COMMENTS_INSIGHT_TEST_TIMEOUT_MS` | Overall timeout                                                  | `180000`                                      |
| `PUPPETEER_EXECUTABLE_PATH`        | Explicit Chrome/Chromium/Edge executable                         | auto-detected                                 |
| `CHROME_BIN`                       | Alternative explicit browser executable                          | auto-detected                                 |

Run:

```bash
bun run build
COMMENTS_INSIGHT_SETTINGS_PATH=./secrets/settings.json \
COMMENTS_INSIGHT_VIDEO_URL=https://www.youtube.com/watch?v=... \
bun scripts/test-youtube.js
```

Keep the settings file outside version control. The test sends relevant page data and credentials to the configured AI endpoint and prints extraction diagnostics, including a sample comment, to the local terminal. Do not use sensitive pages or credentials that are not intended for that provider.

The development hook is exposed only when the loaded manifest has no `update_url`; a Web Store installation does not expose it.

## Troubleshooting

- Rebuild before testing; Puppeteer loads files from `dist/`, not directly from `src/`.
- If the service worker is not found, confirm that the browser allows unpacked extensions and that no enterprise policy disables them.
- If launch fails, set `PUPPETEER_EXECUTABLE_PATH` or `CHROME_BIN` to a compatible local browser.
- Inspect page and service-worker console output for task errors. The deterministic suite fails on page errors, failed tasks, missing comments, missing history, or sandbox sanitization regressions.
- Use mocked `chrome.storage`, IndexedDB, and extension APIs for isolated unit tests; reserve browser E2E for cross-context wiring and browser behavior.
