import fs from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const [packageJson, manifest] = await Promise.all([
  fs.readFile(new URL('package.json', root), 'utf8').then(JSON.parse),
  fs.readFile(new URL('src/manifest.json', root), 'utf8').then(JSON.parse),
]);

if (packageJson.version !== manifest.version) {
  throw new Error(
    `Version mismatch: package.json=${packageJson.version}, manifest.json=${manifest.version}`,
  );
}

const requestedTag = process.argv[2];
const releaseTag =
  requestedTag || (process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : undefined);
if (releaseTag && releaseTag !== `v${packageJson.version}`) {
  throw new Error(`Release tag ${releaseTag} does not match v${packageJson.version}`);
}

console.log(`Version check passed: ${packageJson.version}`);
