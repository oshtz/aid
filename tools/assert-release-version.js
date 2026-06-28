import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const requireTag = process.argv.includes('--require-tag');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const packageJson = readJson('package.json');

const versions = new Map([
  ['package.json', packageJson.version],
  ['package-lock.json', readJson('package-lock.json').packages?.['']?.version],
  ['manifest.json', readJson('manifest.json').version],
  ['manifest-firefox.json', readJson('manifest-firefox.json').version],
]);

const expectedVersion = packageJson.version;
const mismatches = [...versions].filter(([, version]) => version !== expectedVersion);

if (mismatches.length) {
  console.error(
    `Release version mismatch: ${mismatches
      .map(([file, version]) => `${file}=${version || '<missing>'}`)
      .join(', ')}; expected ${expectedVersion}.`
  );
  process.exit(1);
}

const currentTag = () => {
  if (process.env.RELEASE_TAG) return process.env.RELEASE_TAG;
  if (process.env.GITHUB_REF?.startsWith('refs/tags/')) return process.env.GITHUB_REF.slice('refs/tags/'.length);
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;

  try {
    return execFileSync('git', ['describe', '--tags', '--exact-match'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
};

if (requireTag) {
  const tag = currentTag();
  const expectedTag = `v${expectedVersion}`;

  if (tag !== expectedTag) {
    console.error(`Release tag ${tag || '<none>'} does not match ${expectedTag}.`);
    process.exit(1);
  }
}

console.log(`Release version ${expectedVersion} is aligned.`);
