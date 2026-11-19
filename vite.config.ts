import { build, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx, type CrxPlugin } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';
import path from 'path';

const alias = { '@': path.resolve(__dirname, 'src') };

function bundleContentScript(): CrxPlugin {
  return {
    name: 'comments-insight:bundle-content-script',
    apply: 'build',
    enforce: 'post',
    transformCrxManifest(output) {
      // Skip CRXJS's module loader so Chrome injects the self-contained IIFE on demand.
      delete output.content_scripts;
      return output;
    },
    async renderCrxManifest(output) {
      const bundles = await build({
        root: __dirname,
        configFile: false,
        publicDir: false,
        logLevel: 'warn',
        resolve: { alias },
        build: {
          write: false,
          target: `chrome${manifest.minimum_chrome_version}`,
          lib: {
            entry: 'src/content/index.ts',
            name: 'CommentsInsightContentScript',
            formats: ['iife'],
          },
        },
      });
      if (!Array.isArray(bundles) || bundles.length !== 1) {
        throw new Error('Expected one content script bundle');
      }
      const [chunk] = bundles[0].output;
      if (
        bundles[0].output.length !== 1 ||
        chunk?.type !== 'chunk' ||
        chunk.imports.length ||
        chunk.dynamicImports.length
      ) {
        throw new Error('The content script must bundle into one self-contained JavaScript file');
      }
      this.emitFile({
        type: 'asset',
        fileName: 'content-script.js',
        source: chunk.code,
      });
      delete output.content_scripts;
      return output;
    },
  };
}

export default defineConfig({
  plugins: [react(), crx({ manifest }), bundleContentScript()],
  resolve: { alias },
  build: {
    rollupOptions: {
      input: {
        popup: 'src/popup/index.html',
        options: 'src/options/index.html',
        history: 'src/history/index.html',
        logs: 'src/logs/index.html',
        sandbox: 'src/sandbox/index.html',
      },
    },
  },
});
