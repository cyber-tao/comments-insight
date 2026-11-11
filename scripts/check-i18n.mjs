// i18n key consistency checker.
//
// Fails when:
//  1. A t('key') call or an i18n-key-shaped string literal references a key
//     that does not exist in src/locales/en-US.json.
//  2. Locale catalogs disagree on keys or interpolation placeholders.
//  3. Any supported locale lacks Chrome-compatible listing metadata.
//
// Run via `bun run i18n:check`. Keep in sync with the locale file layout in
// src/locales/.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCALE_DIR = join(ROOT, 'src', 'locales');
const SRC_DIR = join(ROOT, 'src');
const BASE_LOCALE = 'en-US';
const KEY_LITERALS = /\.(ts|tsx)$/;
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const localeConfig = readJson(join(SRC_DIR, 'config', 'locales.json'));
const baseLocale = readJson(join(LOCALE_DIR, `${BASE_LOCALE}.json`));
const LOCALES = Object.keys(localeConfig);
const NAMESPACES = Object.keys(baseLocale);
const CHROME_LOCALE_DIR = join(ROOT, 'public', '_locales');

function flattenMessages(obj, prefix = '') {
  const messages = new Map();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nested, message] of flattenMessages(value, path)) {
        messages.set(nested, message);
      }
    } else {
      messages.set(path, value);
    }
  }
  return messages;
}

function interpolationTokens(message) {
  return Array.from(message.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => match[1]).sort();
}

function walk(dir) {
  const entries = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      entries.push(...walk(full));
    } else if (KEY_LITERALS.test(name)) {
      entries.push(full);
    }
  }
  return entries;
}

// Matches `t('ns.key'`, `i18n.t("ns.key"`, `t(`ns.key`` with single/double
// quotes or template literals without interpolation.
const T_CALL_PATTERN = /\bt\(\s*(['"`])((?:[a-zA-Z-]+(?:\.[a-zA-Z0-9_-]+)+))\1/g;
// Matches any quoted literal that starts with a known namespace, catching keys
// referenced indirectly (constants files, key maps).
const KEY_LITERAL_PATTERN = new RegExp(
  `(['"\`])((?:${NAMESPACES.join('|')})\\.[a-zA-Z0-9._-]+)\\1`,
  'g',
);

const errors = [];

// --- Check 1: every referenced key exists in the base locale ---------------
const base = flattenMessages(baseLocale);

for (const filePath of walk(SRC_DIR)) {
  const content = readFileSync(filePath, 'utf8');
  const referenced = new Set();
  for (const match of content.matchAll(T_CALL_PATTERN)) {
    referenced.add(match[2]);
  }
  for (const match of content.matchAll(KEY_LITERAL_PATTERN)) {
    referenced.add(match[2]);
  }
  for (const key of referenced) {
    if (!base.has(key)) {
      errors.push(
        `${filePath.replace(ROOT + '\\', '').replaceAll('\\', '/')}: i18n key "${key}" not found in ${BASE_LOCALE}.json`,
      );
    }
  }
}

// --- Check 2: all locales have complete messages and matching interpolation --
for (const locale of LOCALES) {
  const messages = flattenMessages(
    locale === BASE_LOCALE ? baseLocale : readJson(join(LOCALE_DIR, `${locale}.json`)),
  );
  const missing = [...base.keys()].filter((key) => !messages.has(key)).sort();
  const extra = [...messages.keys()].filter((key) => !base.has(key)).sort();
  for (const key of missing) {
    errors.push(`${locale}.json: missing key "${key}" (present in ${BASE_LOCALE})`);
  }
  for (const key of extra) {
    errors.push(`${locale}.json: leftover key "${key}" (not in ${BASE_LOCALE})`);
  }
  for (const [key, message] of messages) {
    if (typeof message !== 'string' || !message.trim()) {
      errors.push(`${locale}.json: key "${key}" must be a non-empty string`);
      continue;
    }
    const baseMessage = base.get(key);
    if (
      typeof baseMessage === 'string' &&
      JSON.stringify(interpolationTokens(message)) !==
        JSON.stringify(interpolationTokens(baseMessage))
    ) {
      errors.push(`${locale}.json: key "${key}" has different interpolation placeholders`);
    }
  }
}

// --- Check 3: the same locales have valid names and summaries for Chrome ---
const manifest = readJson(join(SRC_DIR, 'manifest.json'));
if (manifest.default_locale !== localeConfig[BASE_LOCALE].chromeLocale) {
  errors.push('manifest.json: default_locale must match the default app locale');
}
const manifestFields = { name: 75, description: 132 };
for (const { chromeLocale } of Object.values(localeConfig)) {
  const messages = readJson(join(CHROME_LOCALE_DIR, chromeLocale, 'messages.json'));
  for (const [field, maxLength] of Object.entries(manifestFields)) {
    const key = /^__MSG_(\w+)__$/.exec(manifest[field])?.[1];
    const message = key && messages[key]?.message;
    if (typeof message !== 'string' || !message.trim() || message.length > maxLength) {
      errors.push(`_locales/${chromeLocale}: manifest ${field} needs 1–${maxLength} characters`);
    }
  }
}

if (errors.length > 0) {
  console.error(`i18n check failed with ${errors.length} issue(s):`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(
  `i18n check passed: ${LOCALES.length} app and Chrome locales, ${base.size} keys consistent.`,
);
