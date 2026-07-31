import { existsSync, readFileSync, statSync } from 'node:fs';
import JSZip from 'jszip';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const expected = [
  { target: 'chrome', file: `artifacts/aid-chrome-${packageJson.version}.zip` },
  { target: 'firefox', file: `artifacts/aid-firefox-${packageJson.version}.zip` },
];

const missing = expected.filter(({ file }) => !existsSync(file) || statSync(file).size === 0);

if (missing.length) {
  console.error(`Missing release package artifact(s): ${missing.map(({ file }) => file).join(', ')}`);
  process.exit(1);
}

for (const { target, file } of expected) {
  const zip = await JSZip.loadAsync(readFileSync(file));
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    throw new Error(`${file} does not contain manifest.json.`);
  }

  const manifest = JSON.parse(await manifestFile.async('string'));
  const isFirefox = Boolean(manifest.browser_specific_settings?.gecko && manifest.background?.scripts);
  if (manifest.version !== packageJson.version || isFirefox !== (target === 'firefox')) {
    throw new Error(`${file} does not contain the expected ${target} ${packageJson.version} manifest.`);
  }
}

console.log(`Release package artifacts validated: ${expected.map(({ file }) => file).join(', ')}`);
