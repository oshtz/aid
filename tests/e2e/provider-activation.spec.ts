import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { launchAidExtension, type AidExtensionContext } from './support/extension';
import {
  createFakeProviderServer,
  createStaticFixtureServer,
  type FakeProviderServer,
  type RunningServer,
} from './support/servers';

const openFreshPanel = async (aid: AidExtensionContext, fixtureServer: RunningServer): Promise<Page> => {
  const fixturePage = await aid.context.newPage();
  await fixturePage.goto(`${fixtureServer.origin}/research-page.html`);
  const panelPage = await aid.openSidePanelPage();
  await panelPage.getByRole('button', { name: 'Ask for each website' }).click();
  await expect(panelPage.locator('[aria-label="Set up Aid"]')).toBeVisible();
  return panelPage;
};

test.describe('Aid first-run provider activation', () => {
  let aid: AidExtensionContext;
  let fixtureServer: RunningServer;
  let providerServer: FakeProviderServer;

  test.beforeEach(async () => {
    fixtureServer = await createStaticFixtureServer(resolve(process.cwd(), 'tests/e2e/fixtures'));
    providerServer = await createFakeProviderServer();
    aid = await launchAidExtension();
  });

  test.afterEach(async () => {
    await aid?.close();
    await providerServer?.close();
    await fixtureServer?.close();
  });

  test('connects Ollama through the fake provider without auto-sending, then answers with page context', async () => {
    const panelPage = await openFreshPanel(aid, fixtureServer);

    await panelPage.getByRole('button', { name: /Ollama Local/ }).click();
    await panelPage.getByLabel('Ollama loopback host').fill(providerServer.origin);
    await panelPage.getByRole('button', { name: 'Test and connect' }).click();

    await expect(panelPage.getByRole('button', { name: 'Summarize this page' })).toBeVisible({ timeout: 15_000 });
    expect(providerServer.chatRequests).toHaveLength(0);
    await panelPage.getByRole('button', { name: 'Summarize this page' }).click();

    const request = await providerServer.waitForChatRequestAt(0);
    expect(JSON.stringify(request)).toContain('Quarterly Browser Automation Report');
    await expect(panelPage.locator('.assistant-message').last()).toContainText('Top posts:', { timeout: 15_000 });
  });

  test('restores a missing OpenRouter session key in place without sending a prompt', async () => {
    let modelRequests = 0;
    let chatRequests = 0;
    await aid.context.route('https://openrouter.ai/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith('/models')) {
        modelRequests += 1;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [{ id: 'openai/gpt-4o-mini' }] }),
        });
        return;
      }
      if (url.pathname.endsWith('/chat/completions')) chatRequests += 1;
      await route.abort();
    });

    const panelPage = await openFreshPanel(aid, fixtureServer);
    await panelPage.getByRole('button', { name: /OpenRouter Cloud/ }).click();
    const keyInput = panelPage.getByLabel('OpenRouter API key');
    await expect(keyInput).toHaveAttribute('type', 'password');
    await keyInput.fill('sk-or-e2e');
    await panelPage.getByRole('button', { name: 'Test and connect' }).click();
    await expect(panelPage.getByRole('button', { name: 'Summarize this page' })).toBeVisible({ timeout: 15_000 });

    await panelPage.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: { authMap: { openrouter: null } },
      });
    });

    await expect(panelPage.locator('[aria-label="Reconnect provider"]')).toContainText('openai/gpt-4o-mini');
    await panelPage.getByLabel('OpenRouter API key').fill('sk-or-e2e-restored');
    await panelPage.getByRole('button', { name: 'Test and connect' }).click();
    await expect(panelPage.getByRole('button', { name: 'Summarize this page' })).toBeVisible({ timeout: 15_000 });

    expect(modelRequests).toBeGreaterThanOrEqual(4);
    expect(chatRequests).toBe(0);
  });
});
