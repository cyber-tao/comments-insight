// i18n key consistency checker.
//
// Fails when:
//  1. A t('key') call or an i18n-key-shaped string literal references a key
//     that does not exist in src/locales/en-US.json.
//  2. Any locale file's key set differs from en-US (missing or leftover keys).
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
const LOCALES = ['en-US', 'zh-CN', 'ja-JP', 'fr-FR', 'es-ES'];
const KEY_LITERALS = /\.(ts|tsx)$/;
// Top-level namespaces defined in the locale files. Key-shaped literals using
// these prefixes are treated as i18n keys even when passed indirectly (e.g.
// constants mapped through stageMessageKey).
const NAMESPACES = [
  'common',
  'popup',
  'options',
  'history',
  'task',
  'logs',
  'errors',
  'notification',
  'export',
];

function flattenKeys(obj, prefix = '') {
  const keys = new Set();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const nested of flattenKeys(value, path)) {
        keys.add(nested);
      }
    } else {
      keys.add(path);
    }
  }
  return keys;
}

function loadLocaleKeys(locale) {
  return flattenKeys(JSON.parse(readFileSync(join(LOCALE_DIR, `${locale}.json`), 'utf8')));
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
const T_CALL_PATTERN = /\bt\(\s*(['"`])((?:[a-zA-Z-]+(?:\.[a-zA-Z0-9-]+)+))\1/g;
// Matches any quoted literal that starts with a known namespace, catching keys
// referenced indirectly (constants files, key maps).
const KEY_LITERAL_PATTERN = new RegExp(
  `(['"\`])((?:${NAMESPACES.join('|')})\\.[a-zA-Z0-9.-]+)\\1`,
  'g',
);

const errors = [];

// --- Check 1: every referenced key exists in the base locale ---------------
const baseKeys = loadLocaleKeys(BASE_LOCALE);

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
    if (!baseKeys.has(key)) {
      errors.push(
        `${filePath.replace(ROOT + '\\', '').replaceAll('\\', '/')}: i18n key "${key}" not found in ${BASE_LOCALE}.json`,
      );
    }
  }
}

// --- Check 2: all locales share the exact same key set ---------------------
const base = loadLocaleKeys(BASE_LOCALE);
for (const locale of LOCALES) {
  if (locale === BASE_LOCALE) continue;
  const keys = loadLocaleKeys(locale);
  const missing = [...base].filter((key) => !keys.has(key)).sort();
  const extra = [...keys].filter((key) => !base.has(key)).sort();
  for (const key of missing) {
    errors.push(`${locale}.json: missing key "${key}" (present in ${BASE_LOCALE})`);
  }
  for (const key of extra) {
    errors.push(`${locale}.json: leftover key "${key}" (not in ${BASE_LOCALE})`);
  }
}

if (errors.length > 0) {
  console.error(`i18n check failed with ${errors.length} issue(s):`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log(`i18n check passed: ${LOCALES.length} locales, ${base.size} keys consistent.`);
