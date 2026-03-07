# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the extension code. `background/` handles the service worker, task orchestration, and storage; `content/` contains extraction logic; `popup/`, `options/`, `history/`, and `logs/` are the UI entry points. Shared code lives in `components/`, `hooks/`, `types/`, `utils/`, and `styles/`. `tests/` mirrors runtime areas and includes `handlers/` and `helpers/`. `docs/` holds contributor docs such as `docs/e2e-testing.md`; `images/` stores screenshots and store assets. `dist/` is generated output and should be treated as build artifacts.

## Build, Test, and Development Commands
Use `npm install` to install dependencies. `npm run dev` starts the Vite + CRXJS development workflow. `npm run build` performs a TypeScript compile and production build. `npm run package` builds and runs `scripts/package.js` to assemble a release artifact. Quality checks: `npm run typecheck`, `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run test`, and `npm run test:coverage`. For manual browser verification, load unpacked `dist/` from `chrome://extensions`.

## Coding Style & Naming Conventions
TypeScript is configured in strict mode. Prettier is the formatting source of truth: 2-space indentation, single quotes, semicolons, trailing commas, and a 100-character line width. ESLint enforces TypeScript, React, React Hooks, and Prettier rules. Use PascalCase for React components and service classes such as `HistorySidebar.tsx` or `TaskManager.ts`, camelCase for hooks and utilities such as `useHistoryData.ts` or `dom-query.ts`, and keep shared type definitions in `src/types/`. Prefer the `@` alias for imports rooted at `src/`.

## Testing Guidelines
Vitest runs in a `node` environment with shared setup from `tests/setup.ts` and V8 coverage for `src/**/*.ts` and `src/**/*.tsx`. Name tests `*.test.ts` or `*.test.tsx`. Put reusable fixtures and helpers in `tests/helpers/`, and keep domain-specific suites under folders like `tests/handlers/`. Run `npm run test` before opening a PR; run `npm run test:coverage` when changing extraction, storage, routing, or background services. See `docs/e2e-testing.md` for browser-level testing options.

## Commit & Pull Request Guidelines
Recent history follows Conventional Commits with optional scopes, for example `feat(history): ...`, `fix: ...`, `style: ...`, and `chore: release v0.4.6`. Keep commit subjects imperative and limited to one change. Pull requests should include a concise summary, linked issue when relevant, screenshots for popup/options/history/logs UI changes, and the validation commands you ran, such as `npm run lint`, `npm run test`, and `npm run build`.

## Security & Configuration Tips
Do not commit API keys, local model credentials, or packaged release artifacts unless the task explicitly requires it. The extension stores some credentials locally with obfuscation, not strong isolation, so treat them as sensitive. Prefer mocked `chrome.storage` and extension APIs in tests instead of live credentials.
