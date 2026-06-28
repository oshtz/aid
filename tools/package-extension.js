import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const target = process.argv[2];
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));

if (!['chrome', 'firefox'].includes(target)) {
  console.error('Usage: node tools/package-extension.js <chrome|firefox>');
  process.exit(1);
}

execFileSync(
  'npx',
  [
    'web-ext',
    'build',
    '--source-dir=dist',
    '--artifacts-dir=artifacts',
    `--filename=aid-${target}-${packageJson.version}.zip`,
    '--overwrite-dest',
  ],
  {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);
