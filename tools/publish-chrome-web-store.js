import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const requiredEnv = [
  'CHROME_WEBSTORE_PUBLISHER_ID',
  'CHROME_WEBSTORE_EXTENSION_ID',
  'CHROME_WEBSTORE_CLIENT_ID',
  'CHROME_WEBSTORE_CLIENT_SECRET',
  'CHROME_WEBSTORE_REFRESH_TOKEN',
];

const getEnv = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const parseResponse = async (response) => {
  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || text || response.statusText;
    throw new Error(`Chrome Web Store API failed (${response.status}): ${detail}`);
  }

  return data;
};

const getAccessToken = async () => {
  const body = new URLSearchParams({
    client_id: getEnv('CHROME_WEBSTORE_CLIENT_ID'),
    client_secret: getEnv('CHROME_WEBSTORE_CLIENT_SECRET'),
    refresh_token: getEnv('CHROME_WEBSTORE_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });

  const data = await parseResponse(
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
  );

  if (!data.access_token) {
    throw new Error('Chrome OAuth response did not include an access token.');
  }

  return data.access_token;
};

const uploadPackage = async ({ accessToken, publisherId, extensionId, zip }) =>
  parseResponse(
    await fetch(`https://chromewebstore.googleapis.com/upload/v2/publishers/${publisherId}/items/${extensionId}:upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/zip',
      },
      body: zip,
    })
  );

const publishItem = async ({ accessToken, publisherId, extensionId }) =>
  parseResponse(
    await fetch(`https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    })
  );

try {
  requiredEnv.forEach(getEnv);

  const shouldPublish = process.argv.includes('--publish');
  const publisherId = getEnv('CHROME_WEBSTORE_PUBLISHER_ID');
  const extensionId = getEnv('CHROME_WEBSTORE_EXTENSION_ID');
  const zipPath = resolve(`artifacts/aid-chrome-${packageJson.version}.zip`);
  const zip = readFileSync(zipPath);

  console.log(`Uploading ${zipPath} to Chrome Web Store item ${extensionId}.`);
  const accessToken = await getAccessToken();
  const uploadResult = await uploadPackage({ accessToken, publisherId, extensionId, zip });

  console.log(`Chrome upload state: ${uploadResult.uploadState || uploadResult.itemError?.code || 'accepted'}`);

  if (uploadResult.itemError) {
    throw new Error(`Chrome upload returned item error: ${JSON.stringify(uploadResult.itemError)}`);
  }

  if (!shouldPublish) {
    console.log('Chrome package uploaded. Skipping publish because --publish was not set.');
    process.exit(0);
  }

  const publishResult = await publishItem({ accessToken, publisherId, extensionId });
  console.log(`Chrome publish state: ${publishResult.status?.join(', ') || publishResult.itemId || 'submitted'}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
