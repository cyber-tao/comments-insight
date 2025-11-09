import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const iconsDir = path.resolve(__dirname, '../public/icons');

// Create icons directory if it doesn't exist
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Create simple placeholder PNG files (1x1 transparent pixel)
// This is a base64 encoded 1x1 transparent PNG
const transparentPNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

const sizes = [16, 48, 128];

sizes.forEach(size => {
  const filename = `icon-${size}.png`;
  const filepath = path.join(iconsDir, filename);
  fs.writeFileSync(filepath, transparentPNG);
  console.log(`Created ${filename}`);
});

console.log('Placeholder icons created successfully!');
console.log('Note: Replace these with actual icons for production.');
