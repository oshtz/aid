import fs from 'node:fs';

const requiredFiles = [
  'manifest.json',
  'background/service-worker.js',
  'content/content-script.js',
  'sidepanel/index.html',
  'options/index.html',
  'icons/icon-16.png',
];

const missing = requiredFiles.filter(file => !fs.existsSync(`dist/${file}`));
if (missing.length > 0) {
  console.error('Missing required build files:', missing);
  process.exit(1);
}

for (const file of ['content/content-script.js']) {
  const content = fs.readFileSync(`dist/${file}`, 'utf8');
  if (/^\s*import\s/m.test(content) || /\bimport\s*\(/.test(content)) {
    console.error(`${file} must be a standalone classic script, but it contains imports.`);
    process.exit(1);
  }
}

const manifest = JSON.parse(fs.readFileSync('dist/manifest.json', 'utf8'));
if (manifest.manifest_version !== 3) {
  console.error('Expected a Manifest V3 build.');
  process.exit(1);
}

const extensionPagesCsp = manifest.content_security_policy?.extension_pages || '';
for (const broadConnectSource of ['http://*:*', 'https://*:*', 'http://*/*', 'https://*/*', '<all_urls>']) {
  if (extensionPagesCsp.includes(broadConnectSource)) {
    console.error(`Manifest CSP must not allow arbitrary provider connections: ${broadConnectSource}`);
    process.exit(1);
  }
}

const requiredHostPermissions = manifest.host_permissions || [];
for (const broadRequiredHost of ['http://*/*', 'https://*/*', '<all_urls>']) {
  if (requiredHostPermissions.includes(broadRequiredHost)) {
    console.error(`Manifest must not require broad page access at install time: ${broadRequiredHost}`);
    process.exit(1);
  }
}

if (Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0) {
  console.error('Manifest must not auto-inject content scripts; page context should use activeTab or optional site access.');
  process.exit(1);
}

const optionalHostPermissions = manifest.optional_host_permissions || [];
for (const optionalHost of ['http://*/*', 'https://*/*']) {
  if (!optionalHostPermissions.includes(optionalHost)) {
    console.error(`Manifest is missing optional page-context host permission: ${optionalHost}`);
    process.exit(1);
  }
}

const webAccessibleResources = (manifest.web_accessible_resources || [])
  .flatMap(entry => entry.resources || []);
if (webAccessibleResources.includes('content/injected.js')) {
  console.error('content/injected.js must not be web accessible; it is not used by the release build.');
  process.exit(1);
}

if (!manifest.background?.service_worker && !manifest.background?.scripts) {
  console.error('Manifest is missing a background entry.');
  process.exit(1);
}

const isFirefoxBuild = Boolean(manifest.browser_specific_settings?.gecko || manifest.sidebar_action);
if (!isFirefoxBuild) {
  if (manifest.background?.scripts) {
    console.error('Chrome builds must use background.service_worker, not background.scripts.');
    process.exit(1);
  }

  if (!manifest.background?.service_worker) {
    console.error('Chrome builds must declare background.service_worker.');
    process.exit(1);
  }
} else {
  if (manifest.background?.service_worker) {
    console.error('Firefox builds must use background.scripts, not background.service_worker.');
    process.exit(1);
  }

  if (!Array.isArray(manifest.background?.scripts) || !manifest.background.scripts.includes('background/service-worker.js')) {
    console.error('Firefox builds must declare background/scripts with background/service-worker.js.');
    process.exit(1);
  }

  if (manifest.background?.type) {
    console.error('Firefox background.scripts builds must not declare background.type.');
    process.exit(1);
  }

  const firefoxJsFiles = [
    'background/service-worker.js',
    'content/content-script.js',
    'sidepanel/index.js',
    'options/index.js',
  ];

  for (const file of firefoxJsFiles) {
    const filePath = `dist/${file}`;
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    if (content.includes('!globalThis.chrome?.runtime?.id')) {
      console.error(`${file} contains a Chrome-only runtime guard in a Firefox build.`);
      process.exit(1);
    }
  }

  const firefoxUiFontFiles = [
    'InstrumentSans-latin.woff2',
    'InstrumentSans-latin-ext.woff2',
    'MomoTrustDisplay-latin.woff2',
    'MomoTrustDisplay-latin-ext.woff2',
    'MomoTrustDisplay-vietnamese.woff2',
  ];

  for (const fontFile of firefoxUiFontFiles) {
    for (const fontDir of ['assets', 'assets/fonts']) {
      const fontPath = `dist/${fontDir}/${fontFile}`;
      if (!fs.existsSync(fontPath)) {
        console.error(`Firefox build is missing UI font asset: ${fontPath}`);
        process.exit(1);
      }
    }
  }

  for (const file of ['sidepanel/index.js', 'options/index.js']) {
    const filePath = `dist/${file}`;
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    for (const fontFile of firefoxUiFontFiles) {
      if (content.includes(`/assets/${fontFile}`) && !fs.existsSync(`dist/assets/${fontFile}`)) {
        console.error(`${file} references /assets/${fontFile}, but that file is missing.`);
        process.exit(1);
      }
    }
  }
}

console.log('Build validation passed.');
