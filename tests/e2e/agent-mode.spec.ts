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
  await expect(panelPage.locator('.agent-guidance')).toContainText('Navigation or tab switching stops the run');
  return { fixturePage, panelPage };
};

const startAgentTask = async (panelPage: Page, task: string) => {
  await panelPage.locator('.chat-input').fill(task);
  await panelPage.locator('.send-button').click();
};

test.describe('Aid current-page Agent mode', () => {
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

  test('asks once before a consequential action and executes an approval', async () => {
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
    await expect(panelPage.locator('.agent-approval')).toContainText('Publish report', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    await expect(fixturePage.locator('#status')).toHaveText('Waiting');
    await panelPage.getByRole('button', { name: 'Approve once' }).click();

    await expect(fixturePage.locator('#status')).toHaveText('Report published', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    await expect(panelPage.locator('.assistant-message').last()).toContainText(
      'The report was published.',
      { timeout: AGENT_RESULT_TIMEOUT }
    );
  });

  test('keeps the page unchanged when approval is denied', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'click_element_by_index',
      targetText: 'Publish report',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'Publish was denied.',
      success: false,
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Publish the report');
    await expect(panelPage.locator('.agent-approval')).toBeVisible({ timeout: AGENT_RESULT_TIMEOUT });
    await panelPage.getByRole('button', { name: 'Deny' }).click();

    await expect(fixturePage.locator('#status')).toHaveText('Waiting');
    await expect(panelPage.locator('.assistant-message').last()).toContainText('Publish was denied.', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
  });

  test('blocks navigation and stays on the original document', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'click_element_by_index',
      targetText: 'Next page',
    });
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'Navigation was blocked.',
      success: false,
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);
    const initialUrl = fixturePage.url();

    await startAgentTask(panelPage, 'Go to the next page');

    await expect(panelPage.locator('.agent-approval')).toHaveCount(0);
    await expect(panelPage.locator('.assistant-message').last()).toContainText('Navigation was blocked.', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    expect(fixturePage.url()).toBe(initialUrl);
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
    const { panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Wait for a slow action');
    await providerServer.waitForChatRequestAt(0);
    await panelPage.getByRole('button', { name: 'Stop agent task' }).click();

    await expect(panelPage.locator('.agent-run-card')).toHaveCount(0);
    await expect(panelPage.locator('.chat-input')).toBeEnabled();
    await expect(panelPage.getByText('This should never render.')).toHaveCount(0);
  });

  test('stops an in-flight run when the starting page navigates', async () => {
    providerServer.queueChatResponse({
      kind: 'agent',
      tool: 'done',
      text: 'This late result should never render.',
      delayMs: 5_000,
    });
    const { fixturePage, panelPage } = await openAgentPanel(aid, fixtureServer);

    await startAgentTask(panelPage, 'Wait while the page changes');
    await providerServer.waitForChatRequestAt(0);
    await fixturePage.goto(`${fixtureServer.origin}/research-page.html`);

    await expect(panelPage.locator('.agent-run-card')).toHaveCount(0, { timeout: AGENT_RESULT_TIMEOUT });
    await expect(panelPage.locator('.chat-error-banner')).toContainText('Navigation stopped', {
      timeout: AGENT_RESULT_TIMEOUT,
    });
    await expect(panelPage.getByText('This late result should never render.')).toHaveCount(0);
  });
});
