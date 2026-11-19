import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { zipSync } from 'fflate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.resolve(__dirname, '../dist');
const outputFileName = 'extension.zip';
const outputPath = path.resolve(distPath, outputFileName);
const zipCompressionLevel = 9;
const zipModifiedTime = new Date('1980-01-01T00:00:00Z');

// Files that should never ship to the Web Store. Source maps in particular
// would expose internals, and the packaged archive itself must not be nested.
const excludedExtensions = new Set(['.map']);
const excludedFiles = new Set([outputFileName]);
const forbiddenZipPatterns = [
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.env($|\.)/,
  /(^|\/)CHROMEWEBSTORE\.md$/i,
  /(^|\/)README(\.[^/]+)?\.md$/i,
  /(^|\/)\.DS_Store$/,
  /(^|\/)Thumbs\.db$/i,
];
const maxPackageSizeBytes = 50 * 1024 * 1024;

function shouldIncludeFile(relativePath) {
  if (forbiddenZipPatterns.some((pattern) => pattern.test(relativePath))) {
    throw new Error(`Forbidden file detected in build output: ${relativePath}`);
  }
  if (excludedFiles.has(relativePath)) {
    return false;
  }
  const ext = path.extname(relativePath).toLowerCase();
  if (excludedExtensions.has(ext)) {
    return false;
  }
  return true;
}

async function collectZippableFiles(directory, rootDirectory = directory) {
  const files = {};
  const entries = await fs.readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = path.relative(rootDirectory, fullPath).split(path.sep).join('/');

    if (!shouldIncludeFile(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      Object.assign(files, await collectZippableFiles(fullPath, rootDirectory));
      continue;
    }

    if (entry.isFile()) {
      files[relativePath] = new Uint8Array(await fs.readFile(fullPath));
    }
  }

  return files;
}

const files = await collectZippableFiles(distPath);
const packageManifest = JSON.parse(new TextDecoder().decode(files['manifest.json']));
const locales = JSON.parse(
  await fs.readFile(path.resolve(__dirname, '../src/config/locales.json'), 'utf8'),
);
for (const { chromeLocale } of Object.values(locales)) {
  const entry = `_locales/${chromeLocale}/messages.json`;
  if (!files[entry]) throw new Error(`Build is missing ${entry}`);
  const messages = JSON.parse(new TextDecoder().decode(files[entry]));
  for (const field of ['name', 'description']) {
    const key = /^__MSG_(\w+)__$/.exec(packageManifest[field])?.[1];
    if (!key || !messages[key]?.message?.trim()) {
      throw new Error(`${entry} is missing a localized manifest ${field}`);
    }
  }
}

for (const iconPath of Object.values(packageManifest.icons ?? {})) {
  if (typeof iconPath !== 'string' || !files[iconPath]) {
    throw new Error(`Build is missing manifest icon: ${String(iconPath)}`);
  }
}
for (const iconPath of Object.values(packageManifest.action?.default_icon ?? {})) {
  if (typeof iconPath !== 'string' || !files[iconPath]) {
    throw new Error(`Build is missing action default_icon: ${String(iconPath)}`);
  }
}

const archive = zipSync(files, {
  level: zipCompressionLevel,
  mtime: zipModifiedTime,
});

if (archive.byteLength <= 0 || archive.byteLength >= maxPackageSizeBytes) {
  throw new Error(`Unexpected extension archive size: ${archive.byteLength} bytes`);
}

await fs.writeFile(outputPath, archive);
console.log(`Extension packaged: ${archive.byteLength} total bytes`);
console.log(`Output: ${outputPath}`);
