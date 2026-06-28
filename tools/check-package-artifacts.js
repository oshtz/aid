import { existsSync, readFileSync, statSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const expected = [
  `artifacts/aid-chrome-${packageJson.version}.zip`,
  `artifacts/aid-firefox-${packageJson.version}.zip`,
];

const missing = expected.filter((file) => !existsSync(file) || statSync(file).size === 0);

if (missing.length) {
  console.error(`Missing release package artifact(s): ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Release package artifacts present: ${expected.join(', ')}`);
