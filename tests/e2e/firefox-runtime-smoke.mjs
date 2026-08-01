import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import webExt from 'web-ext';
import { firefox } from '@playwright/test';

const EXTENSION_ID = '{2f6b9f52-35ec-44cb-9f1d-4a37d4c7747c}';
const SENTINEL = 'FIREFOX_CONTEXT_SENTINEL_9271';
const ALL_PAGE_PERMISSION_ORIGINS = ['https://*/*', 'http://*/*'];
const fixtureHost = '127.0.0.2';
const sourceDir = path.resolve('dist');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, 'manifest.json'), 'utf8'));
assert.deepEqual(
  manifest.background?.scripts,
  ['background/service-worker.js'],
  'dist must contain the Firefox build before this smoke test runs',
);

function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function connectBidi(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out connecting to Firefox BiDi')), 10_000);
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener('error', (event) => {
      clearTimeout(timer);
      reject(new Error(`Firefox BiDi socket error: ${String(event)}`));
    }, { once: true });
  });

  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) {
      request.reject(new Error(JSON.stringify(message)));
    } else {
      request.resolve(message.result);
    }
  });

  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`Timed out waiting for BiDi command: ${method}`));
    }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });

  return { socket, command };
}

async function findContext(command, predicate) {
  let tree;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    tree = await command('browsingContext.getTree');
    const context = tree.contexts.find(predicate);
    if (context) return context;
    await delay(100);
  }
  throw new Error(`Expected browsing context was not created: ${JSON.stringify(tree)}`);
}

async function readExtensionUuid(profileDir) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const prefs = await fs.readFile(path.join(profileDir, 'prefs.js'), 'utf8');
      const line = prefs.split(/\r?\n/).find((candidate) =>
        candidate.includes('extensions.webextensions.uuids'));
      const match = line?.match(/^user_pref\("extensions\.webextensions\.uuids", (.+)\);$/);
      if (match) {
        const uuids = JSON.parse(JSON.parse(match[1]));
        if (uuids[EXTENSION_ID]) return uuids[EXTENSION_ID];
      }
    } catch {
      // Firefox may still be writing the profile.
    }
    await delay(100);
  }
  throw new Error(`Firefox did not publish a UUID for ${EXTENSION_ID}`);
}

const fixturePort = await getFreePort(fixtureHost);
const bidiPort = await getFreePort();
const fixtureUrl = `http://${fixtureHost}:${fixturePort}/fixture`;
const fixtureHtml = `<!doctype html>
<html>
  <head><title>Aid Firefox Sentinel</title></head>
  <body>
    <main>
      <article>
        <h1>Readable Firefox page</h1>
        <p>${SENTINEL} is embedded in this intentionally substantial paragraph so the
        page-context collector must preserve real readable document content from Firefox,
        not merely tab metadata or viewport dimensions.</p>
      </article>
    </main>
  </body>
</html>`;

const fixtureServer = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(fixtureHtml);
});
await new Promise((resolve, reject) => {
  fixtureServer.once('error', reject);
  fixtureServer.listen(fixturePort, fixtureHost, resolve);
});

let runner;
let bidi;
try {
  runner = await webExt.cmd.run({
    sourceDir,
    firefox: firefox.executablePath(),
    noInput: true,
    noReload: true,
    pref: { 'extensions.webextOptionalPermissionPrompts': false },
    startUrl: [fixtureUrl],
    args: ['--headless', `--remote-debugging-port=${bidiPort}`],
  }, { shouldExitProgram: false });

  bidi = await connectBidi(bidiPort);
  const session = await bidi.command('session.new', { capabilities: {} });
  const fixtureContext = await findContext(
    bidi.command,
    (context) => context.url === fixtureUrl,
  );

  const uuid = await readExtensionUuid(session.capabilities['moz:profile']);
  const sidepanelUrl = `moz-extension://${uuid}/sidepanel.html`;
  const { context: sidepanelContext } = await bidi.command('browsingContext.create', {
    type: 'tab',
    background: true,
  });
  const navigation = await bidi.command('browsingContext.navigate', {
    context: sidepanelContext,
    url: sidepanelUrl,
    wait: 'complete',
  });
  assert.equal(navigation.url, sidepanelUrl);

  const evaluate = async (expression) => {
    const response = await bidi.command('script.evaluate', {
      expression,
      target: { context: sidepanelContext },
      awaitPromise: true,
      resultOwnership: 'none',
      serializationOptions: { maxObjectDepth: 2, maxDomDepth: 0 },
    });
    if (response.exceptionDetails) {
      throw new Error(`Sidepanel evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
    }
    return response.result?.value;
  };

  const hadAllPagePermissions = await evaluate(
    `(async () => browser.permissions.contains({ origins: ${JSON.stringify(ALL_PAGE_PERMISSION_ORIGINS)} }))()`,
  );
  assert.equal(hadAllPagePermissions, false, 'Fresh Firefox profile unexpectedly had all-sites access');

  let disclosureButtonFocused = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    disclosureButtonFocused = Boolean(await evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find((candidate) => candidate.textContent?.includes('Allow on all websites'));
      button?.focus();
      return button !== undefined && document.activeElement === button;
    })()`));
    if (disclosureButtonFocused) break;
    await delay(100);
  }
  assert.equal(disclosureButtonFocused, true, 'Firefox all-sites disclosure button was not ready');

  await bidi.command('input.performActions', {
    context: sidepanelContext,
    actions: [{
      type: 'key',
      id: 'keyboard',
      actions: [
        { type: 'keyDown', value: '\uE007' },
        { type: 'keyUp', value: '\uE007' },
      ],
    }],
  });
  await bidi.command('input.releaseActions', { context: sidepanelContext });

  let permissionState;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    permissionState = JSON.parse(await evaluate(
      `(async () => JSON.stringify({` +
        `contains: await browser.permissions.contains({ origins: ${JSON.stringify(ALL_PAGE_PERMISSION_ORIGINS)} }),` +
        `all: await browser.permissions.getAll(),` +
        `settings: await browser.runtime.sendMessage({ type: 'GET_SETTINGS', payload: {} })` +
      `}))()`,
    ));
    if (permissionState.contains && permissionState.settings?.settings?.dataDisclosureVersion === 1) break;
    await delay(100);
  }
  assert.equal(permissionState?.contains, true, 'Firefox did not grant all-sites access');
  assert.deepEqual(
    permissionState.all.origins.filter((origin) => ALL_PAGE_PERMISSION_ORIGINS.includes(origin)),
    ALL_PAGE_PERMISSION_ORIGINS,
    'Firefox did not retain the raw wildcard origins',
  );
  assert.equal(
    permissionState.settings?.settings?.dataDisclosureVersion,
    1,
    'Disclosure did not finish after Firefox granted all-sites access',
  );

  await bidi.command('browsingContext.activate', { context: fixtureContext.context });

  const activeTabs = JSON.parse(await evaluate(
    '(async () => JSON.stringify(await browser.tabs.query({ active: true, currentWindow: true })))()',
  ));
  const fixtureTab = activeTabs.find((tab) => tab.url === fixtureUrl);
  assert.ok(fixtureTab?.id, 'Firefox fixture tab was not active');

  const contextResponse = JSON.parse(await evaluate(
    `(async () => JSON.stringify(await browser.runtime.sendMessage({` +
      `type: 'GET_TAB_CONTEXT', payload: { tabIds: [${fixtureTab.id}] }` +
    `})))()`,
  ));
  assert.equal(contextResponse.contexts?.[0]?.url, fixtureUrl);
  assert.match(contextResponse.contexts?.[0]?.abstract ?? '', new RegExp(SENTINEL));
  assert.equal(contextResponse.diagnostics?.content?.[0]?.contextOk, true);

  let bodyText = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    bodyText = String(await evaluate('document.body.innerText'));
    if (/Page context ready/.test(bodyText)) break;
    await delay(100);
  }
  assert.match(bodyText, /Page context ready/);
  assert.doesNotMatch(bodyText, /No readable page context is available/);

  console.log(`Firefox ${session.capabilities.browserVersion}: all-sites permission and page-context smoke passed`);
} finally {
  try {
    bidi?.socket.close();
  } catch {}

  try {
    const process = runner?.extensionRunners?.[0]?.runningInfo?.firefox;
    const closed = process && process.exitCode === null
      ? once(process, 'close').catch(() => undefined)
      : Promise.resolve();
    await runner?.exit();
    await Promise.race([closed, delay(5_000)]);
  } catch {}

  await new Promise((resolve) => fixtureServer.close(resolve));
}
