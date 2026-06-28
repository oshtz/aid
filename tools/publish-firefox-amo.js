import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const getEnv = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const getArgValue = (name, fallback) => {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);

  const index = process.argv.indexOf(name);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];

  return fallback;
};

const appendOptionalFileArg = (args, flag, value) => {
  if (!value) return;

  const file = resolve(value);
  if (!existsSync(file)) throw new Error(`Missing ${flag} file: ${value}`);
  args.push(flag, file);
};

try {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'));

  if (manifest.version !== packageJson.version) {
    throw new Error(`Firefox dist version ${manifest.version} does not match package.json ${packageJson.version}.`);
  }

  const channel = getArgValue('--channel', process.env.FIREFOX_AMO_CHANNEL || 'listed');
  const approvalTimeout = getArgValue(
    '--approval-timeout',
    process.env.FIREFOX_AMO_APPROVAL_TIMEOUT_MS || '0'
  );
  const metadata = getArgValue('--amo-metadata', process.env.FIREFOX_AMO_METADATA || '');
  const sourceCode = getArgValue('--upload-source-code', process.env.FIREFOX_AMO_SOURCE_CODE || '');

  if (!['listed', 'unlisted'].includes(channel)) {
    throw new Error(`Invalid Firefox AMO channel: ${channel}`);
  }

  mkdirSync('artifacts/firefox-signed', { recursive: true });

  const args = [
    'web-ext',
    'sign',
    '--source-dir',
    'dist',
    '--artifacts-dir',
    'artifacts/firefox-signed',
    '--channel',
    channel,
    '--api-key',
    getEnv('AMO_JWT_ISSUER'),
    '--api-secret',
    getEnv('AMO_JWT_SECRET'),
    '--approval-timeout',
    approvalTimeout,
    '--no-input',
  ];

  appendOptionalFileArg(args, '--amo-metadata', metadata);
  appendOptionalFileArg(args, '--upload-source-code', sourceCode);

  console.log(`Submitting Aid ${packageJson.version} to AMO (${channel}, approval timeout ${approvalTimeout} ms).`);
  execFileSync('npx', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
