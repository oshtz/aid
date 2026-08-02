import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import {
  configureAidForFakeProvider,
  launchAidExtension,
  type AidExtensionContext,
} from './support/extension';
import {
  createFakeProviderServer,
  createStaticFixtureServer,
  type FakeProviderServer,
  type RunningServer,
} from './support/servers';

const AGENT_RESULT_TIMEOUT = 15_000;

const openAgentPanel = async (
  aid: AidExtensionContext,
  fixtureServer: RunningServer
): Promise<{ fixturePage: Page; panelPage: Page }> => {
  const fixturePage = await aid.context.newPage();
  await fixturePage.goto(`${fixtureServer.origin}/agent-page.html`);
  await expect(fixturePage.getByRole('heading', { name: 'Agent fixture' })).toBeVisible();

  const panelPage = await aid.openSidePanelPage();
  await expect(panelPage.locator('.chat-input')).toBeEnabled({ timeout: 15_000 });
  await panelPage.getByRole('button', { name: /Agent Beta/ }).click();
  await expect(panelPage.locator('.agent-guidance')).toContainText('Clicks and same-tab navigation run automatically');
  return { fixturePage, panelPage };
};

const startAgentTask = async (panelPage: Page, task: string) => {
  await panelPage.locator('.chat-input').fill(task);
  await panelPage.locator('.send-button').click();
};

test.describe('Aid same-tab Agent mode', () => {
  let fixtureServer: RunningServer;
  let providerServer: FakeProviderServer;
  let aid: AidExtensionContext;

  test.beforeEach(async () => {
    fixtureServer = await createStaticFixtureServer(resolve(process.cwd(), 'tests/e2e/fixtures'));
    providerServer = await createFakeProviderServer();
    aid = await launchAidExtension();
    await configureAidForFakeProvider(aid.context, aid.extensionId, providerServer.origin);
  });

  test.afterEach(async () => {
    await aid?.close();
    await providerServer?.close();
    await fixtureServer?.close();
  });

  test('runs a safe action autonomously and redacts live field values', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'click_element_by_index',
      targetText: 'Open filters',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'Filters are open.',
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Open the filters');

    const firstRequest = await providerServer.waitForChatRequestAt(0);
    const serializedRequest = JSON.stringify(firstRequest);
    expect(firstRequest.tools).toBeDefined();
    expect(serializedRequest).not.toContain('Do not serialize this value');
    expect(serializedRequest).not.toContain('never-send-this');
    await expect(fixturePage.locator('#status')).toHaveText('Filters opened', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    await expect(panelPage.locator('.assistant-message').last()).toContainText('Filters are open.', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
  });

  test('persists a sanitized Agent receipt and restores it from history', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'click_element_by_index',
      targetText: 'Open filters',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'Filters are open.',
    });
    const { panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Open the filters and save a receipt');
    const receipt = panelPage.locator('.agent-receipt-card').last();
    await expect(receipt).toContainText('completed', { timeout: AGENT_RESULT_TIMEOUT });

    const readStoredConversation = () => panelPage.evaluate(async () => {
      const databases = await indexedDB.databases();
      if (!databases.some((database) => database.name === 'AidExtension')) return null;
      return new Promise<string | null>((resolveStored) => {
        const openRequest = indexedDB.open('AidExtension');
        openRequest.onerror = () => resolveStored(null);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          if (!database.objectStoreNames.contains('conversations')) {
            database.close();
            resolveStored(null);
            return;
          }
          const request = database.transaction('conversations', 'readonly').objectStore('conversations').getAll();
          request.onerror = () => resolveStored(null);
          request.onsuccess = () => {
            database.close();
            const conversation = request.result.find((item) => item.agentReceipts?.length > 0);
            resolveStored(conversation ? JSON.stringify(conversation) : null);
          };
        };
      });
    });
    await expect.poll(readStoredConversation, { timeout: 10_000 }).not.toBeNull();
    const storedConversation = await readStoredConversation();

    expect(storedConversation).not.toContain('never-send-this');
    expect(storedConversation).not.toMatch(/"(?:history|reflection|rawRequest|rawResponse|observation|enteredText)"/);

    await panelPage.reload();
    await expect(panelPage.locator('.chat-input')).toBeEnabled({ timeout: AGENT_RESULT_TIMEOUT });
    await panelPage.getByRole('button', { name: 'Open chat history' }).click();
    const savedConversation = panelPage.locator('.conversation-item').filter({
      hasText: 'Open the filters and save a receipt',
    }).first();
    await expect(savedConversation).toBeVisible({ timeout: AGENT_RESULT_TIMEOUT });
    await savedConversation.click();

    const restoredReceipt = panelPage.locator('.agent-receipt-card').last();
    await expect(restoredReceipt).toContainText('completed');
    await restoredReceipt.locator('summary').click();
    await expect(restoredReceipt).toContainText('Aid Agent Safety Fixture');
    await expect(restoredReceipt).toContainText('click');
    await expect(restoredReceipt).toContainText('not required');
    await expect(restoredReceipt).toContainText(/\d+ tokens/);
  });

  test('runs consequential clicks without approval', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'click_element_by_index',
      targetText: 'Publish report',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'The report was published.',
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Publish the report');
    await expect(fixturePage.locator('#status')).toHaveText('Report published', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    await expect(panelPage.locator('.agent-approval')).toHaveCount(0);
    await expect(panelPage.locator('.assistant-message').last()).toContainText(
      'The report was published.',
      { timeout: AGENT_RESULT_TIMEOUT }
    );
    const receipt = panelPage.locator('.agent-receipt-card').last();
    await receipt.locator('summary').click();
    await expect(receipt).toContainText('not required');
  });

  test('continues without approval after a click navigates the controlled tab', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'click_element_by_index',
      targetText: 'Authorize and continue',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'The destination page is ready.',
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Authorize the action and continue on the destination page');
    await expect(fixturePage).toHaveURL(`${fixtureServer.origin}/research-page.html`, {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    await expect(panelPage.locator('.agent-approval')).toHaveCount(0);
    const secondRequest = await providerServer.waitForChatRequestAt(1);
    expect(JSON.stringify(secondRequest)).toContain('Quarterly Browser Automation Report');
    await expect(panelPage.locator('.assistant-message').last()).toContainText(
      'The destination page is ready.',
      { timeout: AGENT_RESULT_TIMEOUT }
    );
  });

  test('keeps the page unchanged when cross-site navigation is denied', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'navigate_to_link',
      targetText: 'Next website',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'Navigation was denied.',
      success: false,
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);
    const destination = `${fixtureServer.origin.replace('127.0.0.1', 'localhost')}/research-page.html`;
    await fixturePage.evaluate((url) => {
      const link = document.querySelector<HTMLAnchorElement>('#navigation-link');
      if (!link) throw new Error('Navigation fixture link not found');
      link.href = url;
      link.textContent = 'Next website';
    }, destination);

    await startAgentTask(panelPage, 'Open the next website');
    await expect(panelPage.locator('.agent-approval')).toBeVisible({ timeout: AGENT_RESULT_TIMEOUT });
    await panelPage.getByRole('button', { name: 'Deny' }).click();

    await expect(fixturePage).toHaveURL(`${fixtureServer.origin}/agent-page.html`);
    await expect(panelPage.locator('.assistant-message').last()).toContainText('Navigation was denied.', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
  });

  test('navigates two pages deep and refreshes context after every hop', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'navigate_to_link',
      targetText: 'Next page',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'navigate_to_link',
      targetText: 'Deeper page',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'The deep research page is ready.',
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Go two pages deep');

    await expect(panelPage.locator('.agent-approval')).toHaveCount(0);
    await expect(fixturePage).toHaveURL(`${fixtureServer.origin}/research-page.html`, {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    const secondRequest = await providerServer.waitForChatRequestAt(1);
    expect(JSON.stringify(secondRequest)).toContain('Quarterly Browser Automation Report');
    await expect(fixturePage).toHaveURL(`${fixtureServer.origin}/deep-research-page.html`, {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    const thirdRequest = await providerServer.waitForChatRequestAt(2);
    expect(JSON.stringify(thirdRequest)).toContain('Deep Browser Research');
    await expect(panelPage.locator('.assistant-message').last()).toContainText('The deep research page is ready.', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    const receipt = panelPage.locator('.agent-receipt-card').last();
    await receipt.locator('summary').click();
    await expect(receipt).toContainText('navigate');
    await expect(receipt).toContainText('completed');
  });

  test('asks before cross-site navigation and continues after approval', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'navigate_to_link',
      targetText: 'Next website',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'The approved website is open.',
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);
    const destination = `${fixtureServer.origin.replace('127.0.0.1', 'localhost')}/research-page.html`;
    await fixturePage.evaluate((url) => {
      const link = document.querySelector<HTMLAnchorElement>('#navigation-link');
      if (!link) throw new Error('Navigation fixture link not found');
      link.href = url;
      link.textContent = 'Next website';
    }, destination);

    await startAgentTask(panelPage, 'Open the next website');

    await expect(panelPage.locator('.agent-approval')).toContainText('another website', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    await panelPage.getByRole('button', { name: 'Approve once' }).click();
    await expect(fixturePage).toHaveURL(destination, { timeout: AGENT_RESULT_TIMEOUT });
    await expect(panelPage.locator('.assistant-message').last()).toContainText(
      'The approved website is open.',
      { timeout: AGENT_RESULT_TIMEOUT }
    );
  });

  test('keeps sensitive fields unavailable to model actions', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'input_text',
      targetIndex: 9999,
      text: 'should-not-be-entered',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'The sensitive field was blocked.',
      success: false,
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Fill the account password');

    await expect(panelPage.locator('.agent-approval')).toHaveCount(0);
    await expect(fixturePage.locator('input[name="account-password"]')).toHaveValue('never-send-this');
    await expect(panelPage.locator('.assistant-message').last()).toContainText(
      'sensitive field was blocked',
      { timeout: AGENT_RESULT_TIMEOUT }
    );
  });

  test('stops an in-flight model request', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'This should never render.',
      delayMs: 5_000,
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Wait for a slow action');
    await providerServer.waitForChatRequestAt(0);
    const mask = fixturePage.locator('#page-agent-runtime_simulator-mask');
    await expect(mask).toBeVisible();
    const visuals = await mask.evaluate((element) => {
      const style = getComputedStyle(element);
      const cursor = element.lastElementChild;
      const canvas = element.querySelector('canvas');
      const glow = getComputedStyle(element, '::before');
      return {
        accent: style.getPropertyValue('--aid-agent-accent').trim(),
        cursorSize: style.getPropertyValue('--cursor-size').trim(),
        renderedCursorWidth: cursor ? getComputedStyle(cursor).width : '',
        canvasDisplay: canvas ? getComputedStyle(canvas).display : 'none',
        glowBorderWidth: glow.borderTopWidth,
        hasGlow: glow.boxShadow !== 'none',
      };
    });
    expect(visuals).toEqual({
      accent: '#3b82f6',
      cursorSize: '42px',
      renderedCursorWidth: '42px',
      canvasDisplay: 'none',
      glowBorderWidth: '5px',
      hasGlow: true,
    });
    await panelPage.getByRole('button', { name: 'Stop agent task' }).click();

    await expect(panelPage.locator('.agent-run-card')).toHaveCount(0);
    await expect(panelPage.locator('.agent-receipt-card').last()).toContainText('stopped');
    await expect(panelPage.locator('.chat-input')).toBeEnabled();
    await expect(panelPage.getByText('This should never render.')).toHaveCount(0);
  });

  test('keeps an in-flight run alive when the controlled tab navigates', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'The run stayed active.',
      delayMs: 5_000,
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Wait while the page changes');
    await providerServer.waitForChatRequestAt(0);
    await fixturePage.goto(`${fixtureServer.origin}/research-page.html`);

    await expect(panelPage.locator('.assistant-message').last()).toContainText('The run stayed active.', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    await expect(panelPage.locator('.chat-error-banner')).toHaveCount(0);
    await expect(panelPage.locator('.agent-receipt-card').last()).toContainText('completed');
  });

  test('cancels a pending cross-site approval when the run is stopped', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'navigate_to_link',
      targetText: 'Next website',
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);
    const destination = `${fixtureServer.origin.replace('127.0.0.1', 'localhost')}/research-page.html`;
    await fixturePage.evaluate((url) => {
      const link = document.querySelector<HTMLAnchorElement>('#navigation-link');
      if (!link) throw new Error('Navigation fixture link not found');
      link.href = url;
      link.textContent = 'Next website';
    }, destination);

    await startAgentTask(panelPage, 'Open the next website');
    await expect(panelPage.locator('.agent-approval')).toBeVisible({ timeout: AGENT_RESULT_TIMEOUT });
    await panelPage.getByRole('button', { name: 'Stop agent task' }).click();

    const receipt = panelPage.locator('.agent-receipt-card').last();
    await expect(receipt).toContainText('stopped');
    await receipt.locator('summary').click();
    await expect(receipt).toContainText('cancelled');
  });
});
