# E2E Testing for Chrome Extensions

## Overview

The browser suite loads the production `dist/` directory as an unpacked Manifest V3 extension and exercises the service worker, extension pages, sandbox, content script, task protocol, and IndexedDB persistence in a real Chromium-based browser.

The repository provides two Puppeteer scripts:

- `scripts/test-e2e-all.js` is the deterministic, credential-free regression suite used by CI.
- `scripts/test-youtube.js` is an optional live-provider/manual test that can call a configured AI service against a public page.

## Prerequisites

- Node.js 22.12 or later and Bun 1.4.4
- `bun install`
- `bunx puppeteer browsers install chrome` (Chrome for Testing; Chromium or Edge 116+ also work)
- `bun run build` before each browser run

`scripts/browser-locator.js` resolves the browser: it prefers any Chrome for Testing build in the Puppeteer cache, then Chromium and Edge, and only then branded Chrome. Official Chrome builds 137 and newer ignore `--load-extension`, so the extension would silently fail to load there. Set `PUPPETEER_EXECUTABLE_PATH` or `CHROME_BIN` to choose a browser explicitly; both scripts fail with actionable guidance when no usable browser exists.

## Deterministic local suite

Run:

```bash
bun run build
bunx puppeteer browsers install chrome
bun run test:e2e
```

The suite starts a local HTTP page containing a fixed comment fixture, creates a temporary browser profile, loads the extension, and verifies:

1. the background service worker starts;
2. Options renders without CSP-blocked dynamic code and settings round-trip through `chrome.storage.local`;
3. History counts and displays 47 Dexie/IndexedDB records across three pages (20/20/7), opens details with Tab/Enter/Space, keeps deletion independently focusable, and filters the saved records; one-shot message failures exercise load retry and preservation of records and selection after failed deletion or clearing;
4. model-provided Markdown images become alt text, raw HTML and JavaScript links stay inert, and ordinary text links remain user-operated; all HTTP(S) requests from the report page are intercepted and any attempted automatic request fails the test;
5. Logs and Popup render without page errors; a real background diagnostic is persisted through the local writer, and clearing indexed/orphaned logs preserves settings, token usage, and the log-level setting;
6. the sandbox renders safe static report content while removing scripts, event handlers, external image URLs, and frames;
7. a real `START_EXTRACTION` request creates a `TaskManager` task, dispatches `RUN_EXTRACTION` to the content script, extracts the fixture comments, and persists a readable history record;
8. local mock Chat Completions, Responses, and Anthropic Messages servers exercise model discovery, connection testing, and analysis persistence through the production message handlers, including Anthropic model pagination and rejection of incomplete Responses output or malformed Chat Completions data without retries or partial report persistence;
9. the AI settings UI applies all five provider presets, clears credentials and models on endpoint changes, switches protocols, and accepts a manually entered model after fetching the available models.

The final extraction assertion reads the persisted record through `GET_HISTORY_BY_URL`; it does not use a webpage test hook and does not accept an empty page or an unmodified sandbox document as success.

This suite needs no real API key and makes no external AI-provider request. It uses synthetic credentials with loopback mock services and a configured crawling rule for `127.0.0.1` so extraction and analysis are deterministic. The protocol assertions check authentication, output limits, omitted sampling parameters, and Responses' `store: false`.

Set `COMMENTS_INSIGHT_E2E_SCREENSHOT_DIR` to an absolute directory outside version control to capture light/dark Options, History, Logs, and Popup screenshots, plus desktop and mobile AI settings screenshots. Set `COMMENTS_INSIGHT_E2E_HEADLESS=1` to run without visible browser windows.

For browser installation verification, set `PUPPETEER_CACHE_DIR` to a new empty temporary directory before both the browser install and E2E commands. Confirm that the reported browser executable comes from that directory. The browser locator is asynchronous with Puppeteer 25; every caller must await `requireChromeExecutablePath()`.

### CI

CI installs Chrome for Testing and runs the browser suite after the production build:

```bash
bunx puppeteer browsers install chrome
xvfb-run -a bun run test:e2e
```

The suite launches in headful mode because extension service workers and extension pages must behave as they do in a normal browser session. Linux runners therefore need Xvfb or another display server.

## Optional live YouTube test

`scripts/test-youtube.js` exercises the unpacked extension against a configurable public page. An extension control page sends `START_EXTRACTION`, waits for the background task, and reads the persisted result through `GET_HISTORY_BY_URL`, using the same production message flow as the deterministic suite.

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

No webpage-to-content-script test hook is exposed; both browser scripts enter through the validated extension message boundary.

## Troubleshooting

- Rebuild before testing; Puppeteer loads files from `dist/`, not directly from `src/`.
- If the service worker is not found, confirm that the browser allows unpacked extensions and that no enterprise policy disables them.
- If launch fails or the service worker never appears, run `bunx puppeteer browsers install chrome`, or point `PUPPETEER_EXECUTABLE_PATH` / `CHROME_BIN` to Chrome for Testing, Chromium, or Edge rather than branded Chrome 137+. A branded-Chrome or Edge launcher stub can exit immediately when another instance of that browser is already running.
- Inspect page and service-worker console output for task errors. The deterministic suite fails on page errors, failed tasks, missing comments, missing history, or sandbox sanitization regressions.
- Use mocked `chrome.storage`, IndexedDB, and extension APIs for isolated unit tests; reserve browser E2E for cross-context wiring and browser behavior.
