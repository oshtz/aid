const requiredByTarget = {
  chrome: [
    'CHROME_WEBSTORE_PUBLISHER_ID',
    'CHROME_WEBSTORE_EXTENSION_ID',
    'CHROME_WEBSTORE_CLIENT_ID',
    'CHROME_WEBSTORE_CLIENT_SECRET',
    'CHROME_WEBSTORE_REFRESH_TOKEN',
  ],
  firefox: ['AMO_JWT_ISSUER', 'AMO_JWT_SECRET'],
};

const targets = process.argv.slice(2);
const requested = targets.length ? targets : Object.keys(requiredByTarget);
const unknown = requested.filter((target) => !requiredByTarget[target]);

if (unknown.length) {
  console.error(`Unknown release secret target(s): ${unknown.join(', ')}`);
  process.exit(1);
}

const missing = [
  ...new Set(
    requested.flatMap((target) =>
      requiredByTarget[target].filter((name) => !String(process.env[name] || '').trim())
    )
  ),
];

if (missing.length) {
  console.error(`Missing release environment variable(s): ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`Release secrets present for: ${requested.join(', ')}`);
