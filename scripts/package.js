import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const distPath = path.resolve(__dirname, '../dist');
const outputPath = path.resolve(__dirname, '../dist/extension.zip');

// Create a file to stream archive data to
const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', {
  zlib: { level: 9 }, // Maximum compression
});

output.on('close', () => {
  console.log(`Extension packaged: ${archive.pointer()} total bytes`);
  console.log(`Output: ${outputPath}`);
});

archive.on('error', (err) => {
  throw err;
});

// Pipe archive data to the file
archive.pipe(output);

// Append files from dist directory
archive.directory(distPath, false, (entry) => {
  // Exclude the zip file itself
  if (entry.name === 'extension.zip') {
    return false;
  }
  return entry;
});

// Finalize the archive
archive.finalize();
