import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { configureAidForOllama, launchAidExtension, type AidExtensionContext } from './support/extension';
import { createStaticFixtureServer, type RunningServer } from './support/servers';

const liveEnabled = process.env.AID_LIVE_OLLAMA === '1';
const contextCheckCode = 'AID-OLLAMA-CONTEXT-2846';

interface OllamaModel {
  name?: string;
  model?: string;
}

const normalizeOllamaHost = (host: string): string => {
  const trimmed = host.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3).replace(/\/+$/, '') : trimmed;
};

const resolveOllamaConfig = async (): Promise<{ host: string; model: string }> => {
  const host = normalizeOllamaHost(process.env.AID_OLLAMA_HOST || 'http://localhost:11434');
  const response = await fetch(`${host}/api/tags`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama model discovery failed: HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as { models?: OllamaModel[] };
  const models = body.models
    ?.map((model) => model.name || model.model)
    .filter((model): model is string => Boolean(model)) || [];
  const model = process.env.AID_OLLAMA_MODEL || models[0];

  if (!model) {
    throw new Error('Ollama returned no usable chat models from /api/tags');
  }

  return { host, model };
};

const openPreparedLivePanel = async (
  aid: AidExtensionContext,
  fixtureServer: RunningServer
): Promise<{ fixturePage: Page; panelPage: Page }> => {
  const fixturePage = await aid.context.newPage();
  await fixturePage.goto(`${fixtureServer.origin}/live-ollama-page.html`);
  await expect(fixturePage.getByRole('heading', { name: 'Live Ollama Context Check' })).toBeVisible();
  await expect(fixturePage.getByText(contextCheckCode)).toBeVisible();

  const panelPage = await aid.openSidePanelPage();
  await expect(panelPage.locator('.brand-status')).toContainText('Ready', { timeout: 20_000 });
  await expect(panelPage.locator('.provider-chip')).toContainText('Ollama');
  await expect(panelPage.locator('.chat-input')).toBeEnabled({ timeout: 20_000 });

  return { fixturePage, panelPage };
};

test.describe('Aid extension live Ollama E2E', () => {
  test.skip(!liveEnabled, 'Set AID_LIVE_OLLAMA=1 to run live Ollama E2E tests.');
  test.describe.configure({ timeout: 180_000 });

  let fixtureServer: RunningServer;
  let aid: AidExtensionContext;
  let ollamaConfig: { host: string; model: string };

  test.beforeAll(async () => {
    ollamaConfig = await resolveOllamaConfig();
  });

  test.beforeEach(async () => {
    fixtureServer = await createStaticFixtureServer(resolve(process.cwd(), 'tests/e2e/fixtures'));
    aid = await launchAidExtension();
    await configureAidForOllama(aid.context, aid.extensionId, ollamaConfig);
  });

  test.afterEach(async () => {
    await aid?.close();
    await fixtureServer?.close();
  });

  test('streams a real Ollama answer using current page context', async () => {
    const { panelPage } = await openPreparedLivePanel(aid, fixtureServer);

    await panelPage.locator('.chat-input').fill(
      'Read the current page context and reply with only the exact context check code. The code starts with AID-OLLAMA.'
    );
    await panelPage.locator('.send-button').click();

    await expect(panelPage.locator('.assistant-message .markdown-content').last()).toContainText(
      contextCheckCode,
      { timeout: 120_000 }
    );
    await expect(panelPage.locator('.markdown-streaming')).toHaveCount(0, { timeout: 30_000 });
    await expect(panelPage.locator('.chat-input')).toBeEnabled({ timeout: 30_000 });
    await expect(panelPage.locator('.message-status').filter({ hasText: 'Failed' })).toHaveCount(0);
  });
});
