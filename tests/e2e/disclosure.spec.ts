import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { launchAidExtension, type AidExtensionContext } from './support/extension';
import { createStaticFixtureServer, type RunningServer } from './support/servers';

test.describe('Aid data disclosure', () => {
  let aid: AidExtensionContext;
  let fixtureServer: RunningServer;

  test.beforeEach(async () => {
    fixtureServer = await createStaticFixtureServer(resolve(process.cwd(), 'tests/e2e/fixtures'));
    aid = await launchAidExtension();
  });

  test.afterEach(async () => {
    await aid?.close();
    await fixtureServer?.close();
  });

  test('blocks page reads until the shared disclosure is accepted', async () => {
    const fixturePage = await aid.context.newPage();
    await fixturePage.goto(`${fixtureServer.origin}/research-page.html`);

    const panelPage = await aid.openSidePanelPage();
    await expect(panelPage.getByRole('heading', { name: 'Choose how Aid can use page data' })).toBeVisible();
    await expect(panelPage.locator('.chat-input')).toHaveCount(0);

    await expect(panelPage.getByRole('button', { name: 'Allow on all websites' })).toBeVisible();
    await expect(panelPage.getByRole('button', { name: 'Ask for each website' })).toBeVisible();
    await panelPage.getByRole('button', { name: 'Ask for each website' }).click();
    await expect(panelPage.getByRole('button', { name: /Page context ready/ })).toBeVisible({ timeout: 15_000 });
    await expect(panelPage.locator('.context-inspector-summary')).toContainText('Quarterly Browser Automation Report');

    await panelPage.getByRole('button', { name: 'Open settings' }).click();
    const embeddedSettings = panelPage.frameLocator('iframe[title="Aid settings"]');
    await expect(embeddedSettings.getByRole('heading', { name: 'Providers' })).toBeVisible();
    await embeddedSettings.getByRole('button', { name: 'Back to chat' }).click();
    await expect(panelPage.locator('.chat-input')).toBeVisible();

    const optionsPage = await aid.context.newPage();
    await optionsPage.goto(`chrome-extension://${aid.extensionId}/options/index.html`);
    await expect(optionsPage.getByRole('heading', { name: 'Providers' })).toBeVisible();
    await expect(optionsPage.getByRole('heading', { name: 'Choose how Aid can use page data' })).toHaveCount(0);
  });
});
