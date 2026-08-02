import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const dirtyFiles = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  encoding: 'utf8',
}).trim();

if (dirtyFiles) {
  console.error('Refusing to package release source from a dirty working tree.');
  process.exit(1);
}

mkdirSync('artifacts', { recursive: true });
const files = [
  `artifacts/aid-chrome-${packageJson.version}.zip`,
  `artifacts/aid-firefox-${packageJson.version}.zip`,
  `artifacts/aid-source-${packageJson.version}.zip`,
];

execFileSync('git', ['archive', '--format=zip', `--output=${files[2]}`, 'HEAD'], {
  stdio: 'inherit',
});

const checksums = files
  .map((file) => `${createHash('sha256').update(readFileSync(file)).digest('hex')}  ${basename(file)}`)
  .join('\n');
writeFileSync(`artifacts/SHA256SUMS-${packageJson.version}.txt`, `${checksums}\n`);
