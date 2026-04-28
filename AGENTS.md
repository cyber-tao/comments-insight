# Repository Guidelines

## Project Structure & Module Organization

`src/` contains the extension code. `background/` handles the MV3 service worker, task orchestration, AI calls, message routing, and storage; `content/` contains extraction logic, page control, AI-assisted config generation, and platform strategies; `popup/`, `options/`, `history/`, and `logs/` are the UI entry points. Shared code lives in `components/`, `hooks/`, `types/`, `utils/`, and `styles/`. `tests/` mirrors runtime areas and includes `handlers/` and `helpers/`. `docs/` holds contributor docs such as `docs/e2e-testing.md`; `images/` stores screenshots and store assets. `dist/` is generated output and should be treated as build artifacts.

## Build, Test, and Development Commands

Use `bun install` to install dependencies and `bun install --frozen-lockfile` in CI or release validation. `bun run dev` starts the Vite + CRXJS development workflow. `bun run build` performs a TypeScript compile and production build. `bun run package` builds and runs `scripts/package.js` to assemble `dist/extension.zip`. Quality checks: `bun run typecheck`, `bun run format:check`, `bun run lint`, `bun run test`, `bun run test:coverage`, and `bun run audit`. For manual browser verification, load unpacked `dist/` from `chrome://extensions`.

## Coding Style & Naming Conventions

TypeScript is configured in strict mode. Prettier is the formatting source of truth: 2-space indentation, single quotes, semicolons, trailing commas, and a 100-character line width. ESLint enforces TypeScript, React, React Hooks, and Prettier rules. Use PascalCase for React components and service classes such as `HistorySidebar.tsx` or `TaskManager.ts`, camelCase for hooks and utilities such as `useHistoryData.ts` or `dom-query.ts`, and keep shared type definitions in `src/types/`. Prefer the `@` alias for imports rooted at `src/`.

## Architecture & Runtime Guidance

Background tasks should flow through `TaskManager` and expose user-visible state with `TaskProgress` when work is long-running. AI analysis uses streaming Chat Completions, so progress updates should use `stageMessageKey` and `stageMessageParams` for UI-side i18n rather than raw display strings. History persistence is Dexie-backed IndexedDB with a lightweight `historyMetadata` table for paging and search; avoid reintroducing large history indexes in `chrome.storage`. Message boundaries and persisted storage shapes should be validated with the existing Zod helpers before data enters UI or storage code.

## Testing Guidelines

Vitest runs in a `node` environment with shared setup from `tests/setup.ts` and V8 coverage for `src/**/*.ts` and `src/**/*.tsx`. Use `@vitest-environment jsdom` for DOM-facing tests and `fake-indexeddb` for IndexedDB storage suites. Name tests `*.test.ts` or `*.test.tsx`. Put reusable fixtures and helpers in `tests/helpers/`, and keep domain-specific suites under folders like `tests/handlers/`. Run `bun run test` before opening a PR; run `bun run test:coverage` when changing extraction, storage, routing, or background services. See `docs/e2e-testing.md` for browser-level testing options.

## Commit & Pull Request Guidelines

Recent history follows Conventional Commits with optional scopes, for example `feat(history): ...`, `fix: ...`, `style: ...`, and `chore: release v0.4.6`. Keep commit subjects imperative and limited to one change. Pull requests should include a concise summary, linked issue when relevant, screenshots for popup/options/history/logs UI changes, and the validation commands you ran, such as `bun run lint`, `bun run test`, and `bun run build`.

## Release & Versioning

Keep the extension version in `package.json` and `src/manifest.json` synchronized. Release tags use the `vX.Y.Z` format and trigger `.github/workflows/release.yml`, which builds the extension, packages `dist/extension.zip`, generates a CRX, and creates the GitHub Release. Do not commit packaged artifacts from `dist/` unless a release task explicitly requires them.

## Security & Configuration Tips

Do not commit API keys, local model credentials, or packaged release artifacts unless the task explicitly requires it. The extension stores some credentials locally with obfuscation, not strong isolation, so treat them as sensitive. Logs should remain sanitized through `Logger` helpers before persistence or display. Prefer mocked `chrome.storage`, IndexedDB, and extension APIs in tests instead of live credentials.
