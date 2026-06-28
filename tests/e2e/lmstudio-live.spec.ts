import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { configureAidForLMStudio, launchAidExtension, type AidExtensionContext } from './support/extension';
import { createStaticFixtureServer, type RunningServer } from './support/servers';

const liveEnabled = process.env.AID_LIVE_LMSTUDIO === '1';
const contextCheckCode = 'AID-LMSTUDIO-CONTEXT-7319';

interface LMStudioModel {
  id: string;
}

const normalizeLMStudioHost = (host: string): string => {
  const trimmed = host.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3).replace(/\/+$/, '') : trimmed;
};

const resolveLMStudioConfig = async (): Promise<{ host: string; model: string }> => {
  const host = normalizeLMStudioHost(process.env.AID_LMSTUDIO_HOST || 'http://localhost:1234');
  const response = await fetch(`${host}/v1/models`, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    throw new Error(`LM Studio model discovery failed: HTTP ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as { data?: LMStudioModel[] };
  const models = body.data?.map((model) => model.id).filter(Boolean) || [];
  const model = process.env.AID_LMSTUDIO_MODEL ||
    models.find((modelId) => !modelId.toLowerCase().includes('embedding')) ||
    models[0];

  if (!model) {
    throw new Error('LM Studio returned no usable chat models from /v1/models');
  }

  return { host, model };
};

const openPreparedLivePanel = async (
  aid: AidExtensionContext,
  fixtureServer: RunningServer
): Promise<{ fixturePage: Page; panelPage: Page }> => {
  const fixturePage = await aid.context.newPage();
  await fixturePage.goto(`${fixtureServer.origin}/live-lmstudio-page.html`);
  await expect(fixturePage.getByRole('heading', { name: 'Live LM Studio Context Check' })).toBeVisible();
  await expect(fixturePage.getByText(contextCheckCode)).toBeVisible();

  const panelPage = await aid.openSidePanelPage();
  await expect(panelPage.locator('.brand-status')).toContainText('Ready', { timeout: 20_000 });
  await expect(panelPage.locator('.provider-chip')).toContainText('LM Studio');
  await expect(panelPage.locator('.chat-input')).toBeEnabled({ timeout: 20_000 });

  return { fixturePage, panelPage };
};

test.describe('Aid extension live LM Studio E2E', () => {
  test.skip(!liveEnabled, 'Set AID_LIVE_LMSTUDIO=1 to run live LM Studio E2E tests.');
  test.describe.configure({ timeout: 180_000 });

  let fixtureServer: RunningServer;
  let aid: AidExtensionContext;
  let lmStudioConfig: { host: string; model: string };

  test.beforeAll(async () => {
    lmStudioConfig = await resolveLMStudioConfig();
  });

  test.beforeEach(async () => {
    fixtureServer = await createStaticFixtureServer(resolve(process.cwd(), 'tests/e2e/fixtures'));
    aid = await launchAidExtension();
    await configureAidForLMStudio(aid.context, aid.extensionId, lmStudioConfig);
  });

  test.afterEach(async () => {
    await aid?.close();
    await fixtureServer?.close();
  });

  test('streams a real LM Studio answer using current page context', async () => {
    const { panelPage } = await openPreparedLivePanel(aid, fixtureServer);

    await panelPage.locator('.chat-input').fill(
      `Read the current page context and reply with only the exact context check code. The code starts with AID-LMSTUDIO.`
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
