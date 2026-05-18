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

function shouldIncludeFile(relativePath) {
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
const archive = zipSync(files, {
  level: zipCompressionLevel,
  mtime: zipModifiedTime,
});

await fs.writeFile(outputPath, archive);
console.log(`Extension packaged: ${archive.byteLength} total bytes`);
console.log(`Output: ${outputPath}`);
