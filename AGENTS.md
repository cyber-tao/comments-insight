# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the extension code. `background/` handles the MV3 service worker with sub-folders for AI helpers (`ai/`), message handlers (`handlers/`), and persistence (`storage/`); `content/` contains extraction logic and page control, with `handlers/` (dom, extraction, config, tools), `strategies/` (AI/configured/config-generator), and `utils/` (chunker, abort helpers) sub-folders, a `prompts.ts` holding the prompts bundled into the content chunk, plus `ContentAIService.ts` as the long-lived AI port bridge. `popup/`, `options/`, `history/`, and `logs/` are the UI entry points; `sandbox/` is the opaque-origin page (`manifest.sandbox.pages`) that sanitizes LLM-generated reports and renders static HTML/CSS without extension privileges or network access. Shared code lives in `components/`, `hooks/`, `types/`, `utils/`, and `styles/`. `config/constants/` groups themed constant modules; `config/default_rules.json` ships default crawling rules. `tests/` mirrors runtime areas and includes `handlers/` and `helpers/`. `docs/` holds contributor docs such as `docs/e2e-testing.md`; `images/` stores screenshots and store assets. `dist/` is generated output and should be treated as build artifacts.

## Build, Test, and Development Commands

Use `bun install` to install dependencies and `bun install --frozen-lockfile` in CI or release validation. `bun run dev` starts the Vite + CRXJS development workflow. `bun run build` performs a TypeScript compile and production build. `bun run package` builds and runs `scripts/package.js` to assemble `dist/extension.zip`. Quality checks: `bun run version:check`, `bun run typecheck`, `bun run format:check`, `bun run lint` (ESLint plus `bun run i18n:check`, which verifies every referenced i18n key exists and all five locale files share the same key set), `bun run test`, `bun run test:coverage`, `bun run audit`, and—after building—`bun run test:e2e`. For manual browser verification, load unpacked `dist/` in Chrome 116+ from `chrome://extensions`.

## Coding Style & Naming Conventions

TypeScript is configured in strict mode. Prettier is the formatting source of truth: 2-space indentation, single quotes, semicolons, trailing commas, and a 100-character line width. ESLint enforces TypeScript, React, React Hooks, and Prettier rules. Use PascalCase for React components and service classes such as `HistorySidebar.tsx` or `TaskManager.ts`, camelCase for hooks and utilities such as `useHistoryData.ts` or `dom-query.ts`, and keep shared type definitions in `src/types/`. Prefer the `@` alias for imports rooted at `src/`.

## Architecture & Runtime Guidance

Background tasks should flow through `TaskManager` and expose user-visible state with `TaskProgress` when work is long-running. AI analysis uses streaming Chat Completions, so progress updates should use `stageMessageKey` and `stageMessageParams` for UI-side i18n rather than raw display strings. History persistence is Dexie-backed IndexedDB with a lightweight `historyMetadata` table for paging and search; avoid reintroducing large history indexes in `chrome.storage`. Message boundaries and persisted storage shapes should be validated with the existing Zod helpers before data enters UI or storage code. Keep `src/utils/error-types.ts` and `src/content/prompts.ts` free of heavy runtime imports — the content-script chunk graph depends on staying small; i18n-facing helpers belong in `src/utils/errors.ts` and `src/utils/prompts.ts`.

### Data storage versioning

User data (Dexie tables, `chrome.storage.local` keys such as `settings`, `task_state`, `token_stats`, encryption salts, and log indexes) must remain readable across upgrades. The current schema version is tracked via `APP_DATA_VERSION.CURRENT` in `src/config/constants/core.ts` and persisted under `STORAGE.APP_DATA_VERSION_KEY`. When introducing a breaking change to a persisted payload:

1. Bump `APP_DATA_VERSION.CURRENT` in `core.ts`.
2. Add a migration step to the map returned by `DataMigrator.buildDefaultMigrations()` in `src/background/storage/DataMigrator.ts`. Each step should be idempotent and handle absent/partial legacy data.
3. Preserve existing `STORAGE.*` key names and Dexie table names/indexes; extend rather than rename.
4. Add a regression test in `tests/storage-compat.test.ts` covering the previous shape.

The migrator runs once on service worker startup (see `src/background/index.ts`) before `TaskManager.initialize()`.

## Testing Guidelines

Vitest runs in a `node` environment with shared setup from `tests/setup.ts` and V8 coverage for `src/**/*.ts` and `src/**/*.tsx`; only barrel-only index modules are excluded, and global coverage thresholds are enforced. Use `@vitest-environment jsdom` for DOM-facing tests and `fake-indexeddb` for IndexedDB storage suites. Name tests `*.test.ts` or `*.test.tsx`. Put reusable fixtures and helpers in `tests/helpers/`, and keep domain-specific suites under folders like `tests/handlers/`. Run `bun run test:coverage` before opening a PR. After `bun run build`, use `bun run test:e2e` for the credential-free local browser flow; see `docs/e2e-testing.md` for the optional live test.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits with optional scopes, for example `feat(history): ...`, `fix: ...`, `style: ...`, and `chore: release v0.4.6`. Keep commit subjects imperative and limited to one change. Pull requests should include a concise summary, linked issue when relevant, screenshots for popup/options/history/logs UI changes, and the validation commands you ran, such as `bun run lint`, `bun run test`, and `bun run build`.

## Release & Versioning

Keep the extension version in `package.json` and `src/manifest.json` synchronized; `bun run version:check` also validates a `vX.Y.Z` release tag when running on a tag ref. Tags trigger `.github/workflows/release.yml`, which verifies coverage and browser E2E, builds the extension, packages `dist/extension.zip`, uses the pinned `crx3` dependency under Node 22 to generate a CRX, and creates the GitHub Release. Do not commit packaged artifacts from `dist/` unless a release task explicitly requires them. Before a Web Store submission, reconcile the external Dashboard with `docs/chrome-web-store-disclosure.md`; repository changes cannot update Dashboard answers.

## Security & Configuration Tips

Do not commit API keys, local model credentials, or packaged release artifacts unless the task explicitly requires it. API keys are encrypted locally, but key material lives in the same extension storage, so this prevents accidental plaintext exposure rather than providing strong local isolation. AI requests send credentials and relevant page/report data directly to the user-selected endpoint; remote endpoints must use HTTPS, with HTTP allowed only for loopback development. Settings exports must omit keys, and an imported endpoint change must not reuse the old key. Logs and exported reports should remain sanitized. Prefer mocked `chrome.storage`, IndexedDB, and extension APIs in tests instead of live credentials; the deterministic E2E suite requires none.
