import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { existsSync, readFileSync, statSync } from 'node:fs';
import JSZip from 'jszip';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const extensionPackages = [
  { target: 'chrome', file: `artifacts/aid-chrome-${packageJson.version}.zip` },
  { target: 'firefox', file: `artifacts/aid-firefox-${packageJson.version}.zip` },
];
const sourcePackage = `artifacts/aid-source-${packageJson.version}.zip`;
const checksumFile = `artifacts/SHA256SUMS-${packageJson.version}.txt`;
const expected = [...extensionPackages.map(({ file }) => file), sourcePackage, checksumFile];

const missing = expected.filter((file) => !existsSync(file) || statSync(file).size === 0);

if (missing.length) {
  console.error(`Missing release package artifact(s): ${missing.join(', ')}`);
  process.exit(1);
}

for (const { target, file } of extensionPackages) {
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

const sourceZip = await JSZip.loadAsync(readFileSync(sourcePackage));
const sourcePackageJson = sourceZip.file('package.json');
if (!sourcePackageJson || !sourceZip.file('AMO_SOURCE_README.md')) {
  throw new Error(`${sourcePackage} does not contain the expected review source files.`);
}
if (JSON.parse(await sourcePackageJson.async('string')).version !== packageJson.version) {
  throw new Error(`${sourcePackage} does not contain the expected ${packageJson.version} source.`);
}

const checksums = new Map(
  readFileSync(checksumFile, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^([a-f0-9]{64})  (.+)$/);
      if (!match) throw new Error(`Invalid checksum line: ${line}`);
      return [match[2], match[1]];
    })
);

for (const file of [...extensionPackages.map(({ file }) => file), sourcePackage]) {
  const name = basename(file);
  const actual = createHash('sha256').update(readFileSync(file)).digest('hex');
  if (checksums.get(name) !== actual) throw new Error(`Checksum mismatch for ${name}.`);
}

if (checksums.size !== 3) throw new Error(`${checksumFile} must cover exactly three release ZIPs.`);

console.log(`Release package artifacts validated: ${expected.join(', ')}`);
