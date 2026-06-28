import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { configureAidForFakeProvider, launchAidExtension, type AidExtensionContext } from './support/extension';
import { createFakeProviderServer, createStaticFixtureServer, type FakeProviderChatRequest, type FakeProviderServer, type RunningServer } from './support/servers';

const getLatestUserMessageContent = (requestBody: FakeProviderChatRequest): string => {
  const messages = requestBody.messages || [];
  const userMessages = messages.filter((message) => message.role === 'user');
  const latestUserMessage = userMessages.at(-1);
  const content = latestUserMessage?.content;

  if (typeof content !== 'string') {
    throw new Error(`No latest user message in provider request: ${JSON.stringify(requestBody)}`);
  }

  return content;
};

const openPreparedPanel = async (
  aid: AidExtensionContext,
  fixtureServer: RunningServer,
  fixturePath = '/x-timeline.html',
  readySelector = 'article'
): Promise<{ fixturePage: Page; panelPage: Page }> => {
  const fixturePage = await aid.context.newPage();
  await fixturePage.goto(`${fixtureServer.origin}${fixturePath}`);
  await expect(fixturePage.locator(readySelector).first()).toBeVisible();

  const panelPage = await aid.openSidePanelPage();
  await expect(panelPage.locator('.brand-status')).toContainText('Ready', { timeout: 15_000 });
  await expect(panelPage.locator('.chat-input')).toBeEnabled({ timeout: 15_000 });

  return { fixturePage, panelPage };
};

const askAid = async (panelPage: Page, prompt: string) => {
  await panelPage.locator('.chat-input').fill(prompt);
  await panelPage.locator('.send-button').click();
};

const waitForAidResponse = async (
  panelPage: Page,
  expectedText = 'Top posts: Ray Wang, Bybit, monokern.'
) => {
  await expect(panelPage.locator('.assistant-message .markdown-content').last()).toContainText(
    expectedText,
    { timeout: 15_000 }
  );
  await expect(panelPage.locator('.markdown-streaming')).toHaveCount(0);
  await expect(panelPage.locator('.chat-input')).toBeEnabled({ timeout: 15_000 });
};

const selectFixtureText = async (page: Page, testId: string) => {
  await page.evaluate((targetTestId) => {
    const element = document.querySelector(`[data-testid="${targetTestId}"]`);
    if (!element) {
      throw new Error(`No fixture element found for test id: ${targetTestId}`);
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  }, testId);
};

const selectFrameFixtureText = async (page: Page, frameSelector: string, testId: string) => {
  await page.frameLocator(frameSelector).locator(`[data-testid="${testId}"]`).evaluate((element) => {
    const ownerDocument = element.ownerDocument;
    const range = ownerDocument.createRange();
    range.selectNodeContents(element);
    const selection = ownerDocument.defaultView?.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    ownerDocument.dispatchEvent(new Event('selectionchange'));
  });
};

const selectShadowFixtureText = async (page: Page, hostSelector: string, testId: string) => {
  await page.locator(hostSelector).evaluate((host, targetTestId) => {
    const shadowRoot = (host as HTMLElement).shadowRoot;
    const element = shadowRoot?.querySelector(`[data-testid="${targetTestId}"]`);
    if (!element) {
      throw new Error(`No shadow fixture element found for test id: ${targetTestId}`);
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    shadowRoot?.dispatchEvent(new Event('selectionchange'));
    document.dispatchEvent(new Event('selectionchange'));
  }, testId);
};

const clearFixtureSelection = async (page: Page) => {
  await page.evaluate(() => {
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
  });
};

const showSelectionPopover = async (page: Page, testId: string) => {
  await page.evaluate((targetTestId) => {
    const element = document.querySelector(`[data-testid="${targetTestId}"]`);
    if (!element) {
      throw new Error(`No fixture element found for test id: ${targetTestId}`);
    }

    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent('mouseup', {
      bubbles: true,
      clientX: Math.round(rect.left + 24),
      clientY: Math.round(rect.bottom - 8),
    }));
  }, testId);
};

test.describe('Aid extension browser E2E', () => {
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

  test('sends the top three visible timeline posts to the provider and clears the streaming cursor', async () => {
    const { panelPage } = await openPreparedPanel(aid, fixtureServer);

    await askAid(panelPage, 'name the top 3 posts here');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Use this current page context');
    expect(latestUserMessage).toContain('Ray Wang');
    expect(latestUserMessage).toContain('Bybit');
    expect(latestUserMessage).toContain('monokern');
    expect(latestUserMessage).toContain('User request:\n\nname the top 3 posts here');

    await waitForAidResponse(panelPage);
  });

  test('previews provider context and can detach it before a normal prompt', async () => {
    const { panelPage } = await openPreparedPanel(aid, fixtureServer);

    await expect(panelPage.getByText('Attach context')).toBeVisible();
    await panelPage.getByRole('button', { name: 'Review' }).click();
    await expect(panelPage.getByText('Provider prompt context')).toBeVisible();
    await expect(panelPage.locator('.context-inspector-preview')).toContainText('Current page');
    await expect(panelPage.locator('.context-inspector-preview')).toContainText('Ray Wang');

    await panelPage.getByLabel('Attach context').uncheck();
    await expect(panelPage.locator('.context-inspector-summary')).toContainText('Context detached');

    await askAid(panelPage, 'answer only from my words');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toBe('answer only from my words');
    expect(latestUserMessage).not.toContain('Use this current page context');
    expect(latestUserMessage).not.toContain('Ray Wang');
  });

  test('sends attached images as provider image content parts', async () => {
    const { panelPage } = await openPreparedPanel(aid, fixtureServer);
    const pixelPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    );

    await panelPage.locator('.image-input').setInputFiles({
      name: 'pixel.png',
      mimeType: 'image/png',
      buffer: pixelPng,
    });
    await expect(panelPage.locator('.attachment-chip')).toContainText('pixel.png');

    await askAid(panelPage, 'describe this image');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = (providerRequest.messages || [])
      .filter((message) => message.role === 'user')
      .at(-1);
    const content = latestUserMessage?.content;

    expect(Array.isArray(content)).toBe(true);
    expect(content).toEqual([
      {
        type: 'image_url',
        image_url: {
          url: expect.stringMatching(/^data:image\/png;base64,/),
          detail: 'auto',
        },
      },
      expect.objectContaining({
        type: 'text',
        text: expect.stringContaining('User request:\n\ndescribe this image'),
      }),
    ]);
    await expect(panelPage.locator('.user-message .message-attachments img')).toHaveCount(1);
  });

  test('uses the browser scroll position when collecting visible timeline context', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(aid, fixtureServer);

    await fixturePage.evaluate(() => window.scrollTo(0, 850));
    await expect(fixturePage.locator('article').filter({ hasText: 'Post 6 after scrolling' })).toBeVisible();

    await askAid(panelPage, 'name the top 3 posts here after scrolling');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Browser Tools');
    expect(latestUserMessage).toContain('Test Runner');
    expect(latestUserMessage).toContain('Agent Chain');
    expect(latestUserMessage).toContain('User request:\n\nname the top 3 posts here after scrolling');
  });

  test('refreshes page context for each prompt in a multi-turn browser chain', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(aid, fixtureServer);

    await askAid(panelPage, 'name the top 3 posts here');
    const firstRequest = await providerServer.waitForChatRequestAt(0);
    const firstUserMessage = getLatestUserMessageContent(firstRequest);
    expect(firstUserMessage).toContain('Ray Wang');
    expect(firstUserMessage).toContain('monokern');
    await waitForAidResponse(panelPage);

    await fixturePage.bringToFront();
    await fixturePage.evaluate(() => window.scrollTo(0, 850));
    await expect(fixturePage.locator('article').filter({ hasText: 'Post 6 after scrolling' })).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'now name the top 3 visible posts');

    const secondRequest = await providerServer.waitForChatRequestAt(1);
    const secondMessages = secondRequest.messages || [];
    const secondUserMessages = secondMessages.filter((message) => message.role === 'user');
    const secondUserMessage = getLatestUserMessageContent(secondRequest);

    expect(secondUserMessages).toHaveLength(2);
    expect(secondMessages.some((message) => message.role === 'assistant')).toBe(true);
    expect(secondUserMessage).toContain('Browser Tools');
    expect(secondUserMessage).toContain('Test Runner');
    expect(secondUserMessage).toContain('Agent Chain');
    expect(secondUserMessage).not.toContain('Ray Wang');
    expect(secondUserMessage).toContain('User request:\n\nnow name the top 3 visible posts');
  });

  test('uses the most recently active browser page after the side panel is already open', async () => {
    const { panelPage } = await openPreparedPanel(aid, fixtureServer);
    const researchPage = await aid.context.newPage();
    await researchPage.goto(`${fixtureServer.origin}/research-page.html`);
    await expect(researchPage.getByRole('heading', { name: 'Quarterly Browser Automation Report' })).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'what is on this page now?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Quarterly Browser Automation Report');
    expect(latestUserMessage).toContain('multi-step conversations without losing the user intent');
    expect(latestUserMessage).not.toContain('Ray Wang');
  });

  test('attaches selected text from the current page to a normal prompt', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/research-page.html',
      'main'
    );
    await selectFixtureText(fixturePage, 'selectable-insight');

    await panelPage.bringToFront();
    await askAid(panelPage, 'what text is selected here?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Selected text:');
    expect(latestUserMessage).toContain(
      'Selected insight: multi-chain browser prompts must refresh page context before every provider request.'
    );
    expect(latestUserMessage).toContain('User request:\n\nwhat text is selected here?');
  });

  test('attaches selected text from a same-origin iframe to a normal prompt', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/frame-host.html',
      'main'
    );
    await expect(fixturePage.frameLocator('iframe[title="Embedded QA report frame"]').getByText('Embedded frame status')).toBeVisible();
    await selectFrameFixtureText(
      fixturePage,
      'iframe[title="Embedded QA report frame"]',
      'frame-selection-insight'
    );

    await panelPage.bringToFront();
    await askAid(panelPage, 'what text is selected in the embedded frame?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Selected text:');
    expect(latestUserMessage).toContain('Selected frame insight: embedded selections should reach Aid.');
    expect(latestUserMessage).toContain('User request:\n\nwhat text is selected in the embedded frame?');
  });

  test('attaches selected text from an open shadow root to a normal prompt', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/shadow-page.html',
      'main'
    );
    await expect(fixturePage.getByText('Shadow status: Candidate build ready.')).toBeVisible();
    await selectShadowFixtureText(fixturePage, 'qa-status-card', 'shadow-selection-insight');

    await panelPage.bringToFront();
    await askAid(panelPage, 'what text is selected in the web component?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Selected text:');
    expect(latestUserMessage).toContain('Selected shadow insight: open shadow selections should reach Aid.');
    expect(latestUserMessage).toContain('User request:\n\nwhat text is selected in the web component?');
  });

  test('renders the page selection quick-action popover with Aid app styling', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/research-page.html',
      'main'
    );

    await showSelectionPopover(fixturePage, 'selectable-insight');

    const menu = fixturePage.getByRole('menu', { name: 'Aid selection actions' });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('data-aid-theme', 'dark');
    await expect(menu).toContainText('Selection actions');
    await expect(menu).toContainText('Selection ready');
    await expect(menu).toContainText('Open in side panel');
    const askItem = fixturePage.getByRole('menuitem', { name: 'Ask Aid' });
    const explainItem = fixturePage.getByRole('menuitem', { name: 'Explain' });
    await expect(askItem).toBeVisible();
    await expect(explainItem).toBeVisible();
    await expect(fixturePage.getByRole('menuitem', { name: 'Translate' })).toBeVisible();

    const fontCss = await fixturePage.locator('style[data-aid-context-menu-fonts="true"]').evaluate((element) => (
      element.textContent || ''
    ));
    const menuStyles = await menu.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backdropFilter: style.backdropFilter || (style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter,
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
        color: style.color,
        colorScheme: style.colorScheme,
        display: style.display,
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        width: style.width,
      };
    });
    const askStyles = await askItem.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderRadius: style.borderRadius,
        display: style.display,
        gridTemplateColumns: style.gridTemplateColumns,
        minHeight: style.minHeight,
      };
    });
    const askLabelStyles = await askItem.locator('strong').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        fontFamily: style.fontFamily,
      };
    });
    const explainStyles = await explainItem.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
      };
    });
    const askIconStyles = await askItem.locator('span[aria-hidden="true"]').first().evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        borderStyle: style.borderStyle,
        borderRadius: style.borderRadius,
        height: style.height,
        width: style.width,
      };
    });
    const askIconSvgStyles = await askItem.locator('svg').evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        height: style.height,
        width: style.width,
      };
    });

    expect(fontCss).toContain('Aid Instrument Sans');
    expect(fontCss).toContain('Aid Momo Trust Display');
    expect(fontCss).toContain('assets/fonts/InstrumentSans-latin.woff2');
    expect(menuStyles.display).toBe('grid');
    expect(menuStyles.backgroundColor).toBe('rgba(17, 17, 17, 0.94)');
    expect(menuStyles.borderColor).toBe('rgba(255, 255, 255, 0.16)');
    expect(menuStyles.borderRadius).toBe('8px');
    expect(menuStyles.backdropFilter).toContain('blur(20px)');
    expect(menuStyles.boxShadow).toContain('rgba(0, 0, 0');
    expect(menuStyles.color).toBe('rgb(245, 245, 245)');
    expect(menuStyles.colorScheme).toBe('dark');
    expect(menuStyles.fontFamily).toContain('Aid Instrument Sans');
    expect(menuStyles.fontSize).toBe('14px');
    expect(menuStyles.width).toBe('342px');
    expect(askLabelStyles.fontFamily).toContain('Aid Momo Trust Display');
    expect(askStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(askStyles.borderRadius).toBe('8px');
    expect(askStyles.display).toBe('grid');
    expect(askStyles.gridTemplateColumns).toContain('34px');
    expect(askStyles.minHeight).toBe('56px');
    expect(explainStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(explainStyles.borderColor).toBe('rgba(255, 255, 255, 0.09)');
    expect(askIconStyles.borderStyle).toBe('none');
    expect(askIconStyles.borderRadius).toBe('0px');
    expect(askIconStyles.height).toBe('34px');
    expect(askIconStyles.width).toBe('34px');
    expect(askIconSvgStyles.height).toBe('18px');
    expect(askIconSvgStyles.width).toBe('18px');

    await panelPage.evaluate(() => chrome.storage.local.set({ 'aid-theme': 'light' }));
    await showSelectionPopover(fixturePage, 'selectable-insight');
    await expect(menu).toHaveAttribute('data-aid-theme', 'light');

    const lightMenuStyles = await menu.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        color: style.color,
        colorScheme: style.colorScheme,
      };
    });
    const lightAskStyles = await askItem.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
      };
    });

    expect(lightMenuStyles.backgroundColor).toBe('rgba(255, 255, 255, 0.94)');
    expect(lightMenuStyles.borderColor).toBe('rgba(0, 0, 0, 0.18)');
    expect(lightMenuStyles.color).toBe('rgb(10, 10, 10)');
    expect(lightMenuStyles.colorScheme).toBe('light');
    expect(lightAskStyles.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(lightAskStyles.borderColor).toBe('rgba(0, 0, 0, 0.1)');
  });

  test('runs page selection quick-action popover Explain once with selected context', async () => {
    const { fixturePage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/research-page.html',
      'main'
    );

    await showSelectionPopover(fixturePage, 'selectable-insight');
    await fixturePage.getByRole('menuitem', { name: 'Explain' }).click();

    const explainRequest = await providerServer.waitForChatRequestAt(0);
    const explainMessage = getLatestUserMessageContent(explainRequest);
    expect(explainMessage).toContain('Please explain the following content');
    expect(explainMessage).toContain('Selected insight: multi-chain browser prompts must refresh page context before every provider request.');

    await fixturePage.waitForTimeout(500);
    expect(providerServer.chatRequests).toHaveLength(1);
  });

  test('does not reuse stale selected text after the page selection is cleared', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/research-page.html',
      'main'
    );
    await selectFixtureText(fixturePage, 'selectable-insight');
    await clearFixtureSelection(fixturePage);

    await panelPage.bringToFront();
    await askAid(panelPage, 'what can you see after I cleared selection?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).not.toContain('Selected text:');
    expect(latestUserMessage).toContain('Page content:');
    expect(latestUserMessage).toContain('Quarterly Browser Automation Report');
    expect(latestUserMessage).toContain('User request:\n\nwhat can you see after I cleared selection?');
  });

  test('runs selected-text tools from the side panel using the page selection', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/research-page.html',
      'main'
    );
    await selectFixtureText(fixturePage, 'selectable-insight');

    await panelPage.bringToFront();
    await panelPage.getByRole('button', { name: 'Open tools' }).click();
    await panelPage.getByRole('button', { name: 'Translate' }).click();

    const translateRequest = await providerServer.waitForChatRequestAt(0);
    const translateMessage = getLatestUserMessageContent(translateRequest);
    expect(translateMessage).toContain('Please translate the following text');
    expect(translateMessage).toContain('Selected insight: multi-chain browser prompts must refresh page context before every provider request.');
    await waitForAidResponse(panelPage);

    await panelPage.getByRole('button', { name: 'Tools' }).click();
    await panelPage.getByRole('button', { name: 'Proofread' }).click();

    const proofreadRequest = await providerServer.waitForChatRequestAt(1);
    const proofreadMessage = getLatestUserMessageContent(proofreadRequest);
    expect(proofreadMessage).toContain('Please proofread the following text');
    expect(proofreadMessage).toContain('Selected insight: multi-chain browser prompts must refresh page context before every provider request.');
    await waitForAidResponse(panelPage);

    await panelPage.getByRole('button', { name: 'Tools' }).click();
    await panelPage.getByRole('button', { name: 'Rewrite' }).click();

    const rewriteRequest = await providerServer.waitForChatRequestAt(2);
    const rewriteMessage = getLatestUserMessageContent(rewriteRequest);
    expect(rewriteMessage).toContain('Please rewrite the following text in a professional tone');
    expect(rewriteMessage).toContain('Selected insight: multi-chain browser prompts must refresh page context before every provider request.');
  });

  test('runs the summarize page quick action with the current browser page context', async () => {
    const { panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/research-page.html',
      'main'
    );

    await panelPage.getByRole('button', { name: 'Summarize page' }).click();

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Please provide a concise summary of this webpage');
    expect(latestUserMessage).toContain('Quarterly Browser Automation Report');
    expect(latestUserMessage).toContain('Fresh context is required after scrolling, tab switches, and DOM updates.');
  });

  test('uses a tracked browser tab after it navigates to a new page', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(aid, fixtureServer);

    await fixturePage.goto(`${fixtureServer.origin}/research-page.html`);
    await expect(fixturePage.getByRole('heading', { name: 'Quarterly Browser Automation Report' })).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'what page did I navigate to?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Title: Quarterly Browser Automation Report');
    expect(latestUserMessage).toContain('/research-page.html');
    expect(latestUserMessage).not.toContain('Ray Wang');
  });

  test('uses mutated page content after a browser action changes the DOM', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/dynamic-timeline.html',
      'article'
    );

    await fixturePage.getByTestId('refresh-feed').click();
    await expect(fixturePage.locator('article').filter({ hasText: 'Live Browser State' })).toBeVisible();
    await expect(fixturePage.locator('article').filter({ hasText: 'Action Chain Result' })).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'what changed on this page?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Live Browser State');
    expect(latestUserMessage).toContain('DOM Mutation Watch');
    expect(latestUserMessage).toContain('Action Chain Result');
    expect(latestUserMessage).toContain('Updated post three: multi-step browser actions should be reflected in the prompt.');
    expect(latestUserMessage).not.toContain('Initial Alpha');
  });

  test('includes visible dialog, alert, status, and progress UI state after a browser action', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/ui-state-page.html',
      'main'
    );

    await fixturePage.getByTestId('start-deploy').click();
    await expect(fixturePage.getByRole('dialog', { name: 'Confirm deployment' })).toBeVisible();
    await expect(fixturePage.getByRole('alert')).toBeVisible();
    await expect(fixturePage.getByRole('status')).toBeVisible();
    await expect(fixturePage.getByRole('progressbar')).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'what UI state changed after I clicked deploy?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Deployment UI State');
    expect(latestUserMessage).toContain('Visible UI state:');
    expect(latestUserMessage).toContain('Dialog: Confirm deployment');
    expect(latestUserMessage).toContain('message: Deployment started for build 42 with token [redacted].');
    expect(latestUserMessage).toContain('state: modal');
    expect(latestUserMessage).toContain('Alert; message: Release failed: missing approval');
    expect(latestUserMessage).toContain('Status; message: Background sync queued; state: live polite');
    expect(latestUserMessage).toContain('Progress; message: Artifact upload progress; state: progress 65/100');
    expect(latestUserMessage).toContain('User request:\n\nwhat UI state changed after I clicked deploy?');
    expect(latestUserMessage).not.toContain('sk-live-dialog-secret123');
  });

  test('includes live visible form state after browser input actions while redacting secrets', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/form-state.html',
      'form'
    );

    await fixturePage.getByLabel('Project name').fill('Apollo Extension Launch');
    await fixturePage.getByLabel('Release status').selectOption({ label: 'Ready for QA' });
    await fixturePage.getByLabel('Notes').fill('QA needs context capture verified before release.');
    await fixturePage.getByLabel('Include screenshots').check();
    await fixturePage.getByLabel('API token').fill('super-secret-token');

    await panelPage.bringToFront();
    await askAid(panelPage, 'what is currently configured in this form?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Release Console');
    expect(latestUserMessage).toContain('Visible form fields:');
    expect(latestUserMessage).toContain('Project name: Apollo Extension Launch');
    expect(latestUserMessage).toContain('Release status: Ready for QA');
    expect(latestUserMessage).toContain(
      'Release status: Ready for QA; description: Choose Ready for QA unless production approval is complete. Helper token [redacted] should be redacted.'
    );
    expect(latestUserMessage).not.toContain('message: Choose Ready for QA');
    expect(latestUserMessage).toContain('Notes: QA needs context capture verified before release.');
    expect(latestUserMessage).toContain('Include screenshots: checked');
    expect(latestUserMessage).toContain('API token: [redacted]');
    expect(latestUserMessage).not.toContain('sk-live-description-secret123');
    expect(latestUserMessage).not.toContain('super-secret-token');
  });

  test('includes empty visible form fields and placeholder hints before typing', async () => {
    const { panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/empty-form-page.html',
      'form'
    );

    await askAid(panelPage, 'what fields can I fill out here?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Empty Form Workspace');
    expect(latestUserMessage).toContain('Visible form fields:');
    expect(latestUserMessage).toContain('Launch title: [empty]; placeholder: e.g. Apollo rollout');
    expect(latestUserMessage).toContain('Release notes: [empty]; placeholder: Paste [redacted] here');
    expect(latestUserMessage).toContain('Project search: [empty]; placeholder: Search projects');
    expect(latestUserMessage).toContain('User request:\n\nwhat fields can I fill out here?');
    expect(latestUserMessage).not.toContain('sk-live-placeholder-value123');
  });

  test('includes slider and spinbutton values after keyboard input actions', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/range-control-page.html',
      'form'
    );

    await fixturePage.getByRole('slider', { name: 'Confidence threshold' }).press('ArrowRight');
    await fixturePage.getByLabel('Retry count').fill('4');
    await expect(fixturePage.getByRole('slider', { name: 'Confidence threshold' })).toHaveAttribute('aria-valuetext', '65 percent');

    await panelPage.bringToFront();
    await askAid(panelPage, 'what range controls are set here?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Range Control Workspace');
    expect(latestUserMessage).toContain('Visible form fields:');
    expect(latestUserMessage).toContain('Confidence threshold: 65 percent; range: 0-100; step: 5');
    expect(latestUserMessage).toContain('Retry count: 4; range: 1-10; step: 1');
    expect(latestUserMessage).toContain('User request:\n\nwhat range controls are set here?');
  });

  test('keeps live browser state ahead of long page text in provider context', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/long-context-page.html',
      'main'
    );

    await fixturePage.getByTestId('launch-decision').fill('Approved after long review');

    await panelPage.bringToFront();
    await askAid(panelPage, 'what launch decision did I enter?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Long Context Console');
    expect(latestUserMessage).toContain('Visible form fields:');
    expect(latestUserMessage).toContain('Launch decision: Approved after long review');
    expect(latestUserMessage).toContain('Long review paragraph 1');
    expect(latestUserMessage).toContain('User request:\n\nwhat launch decision did I enter?');
    expect(latestUserMessage).not.toContain('final long-text tail');
  });

  test('includes visible form validation state after a submit action', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/form-validation-page.html',
      'form'
    );

    await fixturePage.getByTestId('submit-launch').click();
    await expect(fixturePage.getByText('Project owner is required before launch.')).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'what needs fixing in this form?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Validation Console');
    expect(latestUserMessage).toContain('Visible form fields:');
    expect(latestUserMessage).toContain('Project owner: [empty]; state: invalid, required; message: is required before launch.');
    expect(latestUserMessage).toContain('Focused element: Field: Project owner');
    expect(latestUserMessage).toContain('User request:\n\nwhat needs fixing in this form?');
  });

  test('includes uploaded file input state without exposing local paths', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/file-upload-page.html',
      'form'
    );

    await fixturePage
      .getByTestId('launch-attachment')
      .setInputFiles(resolve(process.cwd(), 'tests/e2e/fixtures/upload-qa-brief.txt'));

    await panelPage.bringToFront();
    await askAid(panelPage, 'what file did I attach?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Attachment Console');
    expect(latestUserMessage).toContain('Visible form fields:');
    expect(latestUserMessage).toContain('Launch attachment: upload-qa-brief.txt (text/plain');
    expect(latestUserMessage).toContain('User request:\n\nwhat file did I attach?');
    expect(latestUserMessage).not.toContain('C:\\');
    expect(latestUserMessage).not.toContain('/tests/e2e/fixtures/');
  });

  test('includes viewport scroll position and focused field edit state in page context', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/viewport-state.html',
      'main'
    );

    await fixturePage.evaluate(() => window.scrollTo(0, 640));
    await fixturePage.getByTestId('project-filter').fill('Visible state launch');
    await fixturePage.getByTestId('project-filter').evaluate((element) => {
      (element as HTMLInputElement).setSelectionRange(8, 13);
    });
    await expect(fixturePage.getByText('Visible after scroll: release readiness controls.')).toBeVisible();
    const scrollY = await fixturePage.evaluate(() => Math.round(window.scrollY));

    await panelPage.bringToFront();
    await askAid(panelPage, 'where am I focused on this page?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Viewport State Console');
    expect(latestUserMessage).toContain('Visible browser state:');
    expect(latestUserMessage).toContain(`scroll: x=0, y=${scrollY}`);
    expect(latestUserMessage).toContain('Focused element: Field: Project filter; value: Visible state launch');
    expect(latestUserMessage).toContain('selection: 8-13; selected text: state');
    expect(latestUserMessage).toContain('User request:\n\nwhere am I focused on this page?');
  });

  test('includes focused rich text editor selection from DOM range state', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/viewport-state.html',
      'main'
    );

    const editor = fixturePage.getByTestId('launch-notes-editor');
    await editor.scrollIntoViewIfNeeded();
    await editor.focus();
    await editor.evaluate((element) => {
      const textNode = element.firstChild;
      const text = textNode?.textContent || '';
      const start = text.indexOf('state');
      if (!textNode || start < 0) {
        throw new Error('Rich editor fixture text was not available');
      }

      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + 'state'.length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await expect(fixturePage.getByText('Visible after rich editor focus: selection range should reach Aid.')).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'what rich text is selected?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Viewport State Console');
    expect(latestUserMessage).toContain('Visible browser state:');
    expect(latestUserMessage).toContain('Focused element: Field: Launch notes; value: Draft launch state includes [redacted]');
    expect(latestUserMessage).toContain('selection: 13-18; selected text: state');
    expect(latestUserMessage).toContain('Visible form fields:');
    expect(latestUserMessage).toContain('Launch notes: Draft launch state includes [redacted]');
    expect(latestUserMessage).toContain('User request:\n\nwhat rich text is selected?');
    expect(latestUserMessage).not.toContain('sk-live-rich-secret123');
  });

  test('includes internally scrolled container state in page context', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/scroll-container-page.html',
      '[data-testid="release-feed"]'
    );

    const feed = fixturePage.getByTestId('release-feed');
    const scrollTop = await feed.evaluate((element) => {
      element.scrollTop = 520;
      return Math.round(element.scrollTop);
    });
    await expect(fixturePage.getByText('Visible feed item proves nested scrolling reached the prompt.')).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'where am I in this feed?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Internal Scroll Workspace');
    expect(latestUserMessage).toContain('Visible scroll containers:');
    expect(latestUserMessage).toContain('Scroll container: Release activity feed');
    expect(latestUserMessage).toContain(`scroll: x=0, y=${scrollTop}`);
    expect(latestUserMessage).toContain('Visible feed item proves nested scrolling reached the prompt.');
    expect(latestUserMessage).toContain('User request:\n\nwhere am I in this feed?');
    expect(latestUserMessage).not.toContain('sk-live-scroll-secret123');
  });

  test('includes visible choice groups and option state after opening a listbox', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/choice-page.html',
      'main'
    );

    await fixturePage.getByTestId('open-region-selector').click();
    await expect(fixturePage.getByRole('listbox', { name: 'Release region selector' })).toBeVisible();
    await fixturePage.getByTestId('open-region-selector').press('ArrowDown');
    await expect(fixturePage.getByRole('option', { name: 'APAC rollout' })).toHaveAttribute('data-active', 'true');

    await panelPage.bringToFront();
    await askAid(panelPage, 'what can I select here?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Choice Overlay Workspace');
    expect(latestUserMessage).toContain('Visible choice groups:');
    expect(latestUserMessage).toContain('Listbox: Release region selector');
    expect(latestUserMessage).toContain('EMEA rollout (selected)');
    expect(latestUserMessage).toContain('APAC rollout (active)');
    expect(latestUserMessage).toContain('LATAM rollout (disabled)');
    expect(latestUserMessage).toContain('Secret [redacted]');
    expect(latestUserMessage).toContain('User request:\n\nwhat can I select here?');
    expect(latestUserMessage).not.toContain('sk-live-choice-secret123');
  });

  test('includes visible tooltip and popover-style overlays after a browser action', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/overlay-page.html',
      'main'
    );

    await fixturePage.getByTestId('show-release-help').click();
    await expect(fixturePage.getByRole('tooltip', { name: 'Release help' })).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'what help is showing?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Overlay Help Workspace');
    expect(latestUserMessage).toContain('Visible UI state:');
    expect(latestUserMessage).toContain('Tooltip: Release help');
    expect(latestUserMessage).toContain('Use the blue deploy button only after QA approval.');
    expect(latestUserMessage).toContain('Tooltip token [redacted] should stay redacted.');
    expect(latestUserMessage).toContain('User request:\n\nwhat help is showing?');
    expect(latestUserMessage).not.toContain('sk-live-tooltip-secret123');
  });

  test('includes expanded region content while excluding still-hidden panels', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/expanded-region-page.html',
      'main'
    );

    await fixturePage.getByTestId('toggle-release-panel').click();
    await expect(fixturePage.getByRole('region', { name: 'Release details' })).toBeVisible();

    await panelPage.bringToFront();
    await askAid(panelPage, 'what did I expand?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Expanded Region Workspace');
    expect(latestUserMessage).toContain('Visible expanded regions:');
    expect(latestUserMessage).toContain('Expanded region: Release details');
    expect(latestUserMessage).toContain('Expanded release summary: QA approval is ready');
    expect(latestUserMessage).toContain('Region token [redacted] should be redacted.');
    expect(latestUserMessage).toContain('User request:\n\nwhat did I expand?');
    expect(latestUserMessage).not.toContain('sk-live-region-secret123');
    expect(latestUserMessage).not.toContain('Collapsed billing panel should stay hidden');
  });

  test('includes visible media labels, captions, and sanitized URLs in page context', async () => {
    const { panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/media-page.html',
      'main'
    );

    await askAid(panelPage, 'what media is visible here?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Launch Media Review Board');
    expect(latestUserMessage).toContain('Visible media:');
    expect(latestUserMessage).toContain('Image: Dashboard screenshot showing launch readiness by region');
    expect(latestUserMessage).toContain('caption: Launch readiness dashboard');
    expect(latestUserMessage).toContain('/media/dashboard.png');
    expect(latestUserMessage).toContain('Video: Product walkthrough video');
    expect(latestUserMessage).toContain('/media/walkthrough-poster.jpg');
    expect(latestUserMessage).toContain('Graphic: Architecture diagram with browser context, provider stream, and side panel');
    expect(latestUserMessage).toContain('User request:\n\nwhat media is visible here?');
    expect(latestUserMessage).not.toContain('secret-value');
    expect(latestUserMessage).not.toContain('signature=do-not-leak');
    expect(latestUserMessage).not.toContain('private-fragment');
  });

  test('includes visible page structure with headings and current navigation state', async () => {
    const { panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/structure-page.html',
      'main'
    );

    await askAid(panelPage, 'where am I on this page?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Launch Structure Workspace');
    expect(latestUserMessage).toContain('Visible page structure:');
    expect(latestUserMessage).toContain('H1: Launch Command Center');
    expect(latestUserMessage).toContain('Navigation: Workspace navigation; current: Release dashboard (page)');
    expect(latestUserMessage).toContain('Section: Release readiness');
    expect(latestUserMessage).toContain('H3: Private token [redacted]');
    expect(latestUserMessage).toContain('User request:\n\nwhere am I on this page?');
    expect(latestUserMessage).not.toContain('sk-live-structure-secret123');
    expect(latestUserMessage).not.toContain('sk-live-nav-secret123');
    expect(latestUserMessage).not.toContain('#private');
  });

  test('includes visible lists with checklist and current item state', async () => {
    const { panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/list-page.html',
      'main'
    );

    await askAid(panelPage, 'what remains on this checklist?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Release Checklist Board');
    expect(latestUserMessage).toContain('Visible lists:');
    expect(latestUserMessage).toContain('List: Release checklist');
    expect(latestUserMessage).toContain('Smoke tests complete (checked)');
    expect(latestUserMessage).toContain('Security review pending (not checked)');
    expect(latestUserMessage).toContain('Private token [redacted] must be redacted');
    expect(latestUserMessage).toContain('Ordered list: Deployment sequence');
    expect(latestUserMessage).toContain('Prepare release notes (current step)');
    expect(latestUserMessage).toContain('User request:\n\nwhat remains on this checklist?');
    expect(latestUserMessage).not.toContain('sk-live-list-secret123');
  });

  test('includes visible same-origin iframe context with sanitized src and redaction', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/frame-host.html',
      'main'
    );
    const reportFrame = fixturePage.frameLocator('iframe[title="Embedded QA report frame"]');
    await expect(reportFrame.getByText('Embedded frame status')).toBeVisible();
    await reportFrame.getByLabel('Frame approval').fill('Embedded approval ready');
    await reportFrame.getByLabel('Frame API token').fill('sk-live-frame-form-secret123');
    await reportFrame.getByLabel('Frame approval').focus();
    await reportFrame.getByLabel('Frame approval').evaluate((element) => {
      (element as HTMLInputElement).setSelectionRange(9, 17);
    });

    await askAid(panelPage, 'what is inside the embedded frame?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Embedded Frame Host');
    expect(latestUserMessage).toContain('Visible frames:');
    expect(latestUserMessage).toContain('Frame: Embedded QA report frame');
    expect(latestUserMessage).toContain(`src: ${fixtureServer.origin}/frame-child.html`);
    expect(latestUserMessage).toContain('content: Embedded QA Report Embedded frame status: Ready for QA.');
    expect(latestUserMessage).toContain('Frame owner: Platform QA');
    expect(latestUserMessage).toContain('Frame token: [redacted]');
    expect(latestUserMessage).toContain('Next action: validate side panel context refresh.');
    expect(latestUserMessage).toContain('List: Embedded release checklist; items: 1. Frame smoke test complete (checked) | 2. Frame security review pending (not checked) | 3. Frame list secret [redacted] (current step)');
    expect(latestUserMessage).toContain('Frame approval: Embedded approval ready | Frame API token: [redacted]');
    expect(latestUserMessage).toContain(`actions: Link: Open embedded checklist; href: ${fixtureServer.origin}/embedded/checklist | Button: Run embedded check; state: pressed`);
    expect(latestUserMessage).toContain('choices: Listbox: Embedded release region; options: Frame EMEA rollout (selected) | Frame APAC rollout (active) | Frame secret [redacted]');
    expect(latestUserMessage).toContain('tables: Table 1: Embedded release table / Columns: Region | Status | Note / Row 1: EMEA | Ready | [redacted] / Row 2: APAC | Waiting | No blocker');
    expect(latestUserMessage).toContain(`media: Image: Embedded architecture diagram; caption: Embedded launch diagram; source: ${fixtureServer.origin}/media/frame-diagram.png | Video: Embedded walkthrough video; poster: ${fixtureServer.origin}/media/frame-walkthrough.jpg`);
    expect(latestUserMessage).toContain('Focused element: Frame: Embedded QA report frame; Field: Frame approval; value: Embedded approval ready');
    expect(latestUserMessage).toContain('selection: 9-17; selected text: approval');
    expect(latestUserMessage).toContain('User request:\n\nwhat is inside the embedded frame?');
    expect(latestUserMessage).not.toContain('secret-frame-token');
    expect(latestUserMessage).not.toContain('sk-live-frame-secret123');
    expect(latestUserMessage).not.toContain('sk-live-frame-form-secret123');
    expect(latestUserMessage).not.toContain('secret-frame-action');
    expect(latestUserMessage).not.toContain('sk-live-frame-choice-secret123');
    expect(latestUserMessage).not.toContain('sk-live-frame-table-secret123');
    expect(latestUserMessage).not.toContain('sk-live-frame-list-secret123');
    expect(latestUserMessage).not.toContain('secret-frame-media');
    expect(latestUserMessage).not.toContain('secret-frame-poster');
    expect(latestUserMessage).not.toContain('#private');
  });

  test('includes visible open shadow DOM content from web components with redaction', async () => {
    const { fixturePage, panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/shadow-page.html',
      'main'
    );
    await expect(fixturePage.getByText('Shadow status: Candidate build ready.')).toBeVisible();
    await fixturePage.getByLabel('Shadow approval').fill('Shadow approval ready');
    await fixturePage.getByLabel('Shadow API token').fill('sk-live-shadow-form-secret123');
    await fixturePage.getByLabel('Shadow approval').focus();
    await fixturePage.getByLabel('Shadow approval').evaluate((element) => {
      (element as HTMLInputElement).setSelectionRange(7, 15);
    });

    await askAid(panelPage, 'what does the web component say?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Shadow DOM Host');
    expect(latestUserMessage).toContain('Visible shadow DOM:');
    expect(latestUserMessage).toContain('Shadow host: QA status web component');
    expect(latestUserMessage).toContain('content: Web Component QA Panel Shadow status: Candidate build ready.');
    expect(latestUserMessage).toContain('Shadow API key [redacted]');
    expect(latestUserMessage).toContain('Next step: run browser context regression.');
    expect(latestUserMessage).toContain('lists: List: Shadow release checklist; items: 1. Shadow smoke test complete (checked) | 2. Shadow security review pending (not checked) | 3. Shadow list secret [redacted] (current step)');
    expect(latestUserMessage).toContain('Shadow approval: Shadow approval ready | Shadow API token: [redacted]');
    expect(latestUserMessage).toContain(`actions: Link: Open shadow checklist; href: ${fixtureServer.origin}/shadow/checklist | Button: Run shadow check; state: collapsed`);
    expect(latestUserMessage).toContain('choices: Listbox: Shadow release region; options: Shadow EMEA rollout (selected) | Shadow APAC rollout (active) | Shadow secret [redacted]');
    expect(latestUserMessage).toContain('tables: Table 1: Shadow release table / Columns: Region | Status | Note / Row 1: EMEA | Ready | [redacted] / Row 2: APAC | Waiting | No blocker');
    expect(latestUserMessage).toContain(`media: Image: Shadow architecture diagram; caption: Shadow launch diagram; source: ${fixtureServer.origin}/media/shadow-diagram.png | Video: Shadow walkthrough video; poster: ${fixtureServer.origin}/media/shadow-walkthrough.jpg`);
    expect(latestUserMessage).toContain('Focused element: Shadow host: QA status web component; Field: Shadow approval; value: Shadow approval ready');
    expect(latestUserMessage).toContain('selection: 7-15; selected text: approval');
    expect(latestUserMessage).toContain('User request:\n\nwhat does the web component say?');
    expect(latestUserMessage).not.toContain('sk-live-shadow-secret123');
    expect(latestUserMessage).not.toContain('sk-live-shadow-form-secret123');
    expect(latestUserMessage).not.toContain('secret-shadow-action');
    expect(latestUserMessage).not.toContain('sk-live-shadow-choice-secret123');
    expect(latestUserMessage).not.toContain('sk-live-shadow-table-secret123');
    expect(latestUserMessage).not.toContain('sk-live-shadow-list-secret123');
    expect(latestUserMessage).not.toContain('secret-shadow-media');
    expect(latestUserMessage).not.toContain('secret-shadow-poster');
  });

  test('includes visible table and grid structure while redacting sensitive cells', async () => {
    const { panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/table-page.html',
      'main'
    );

    await askAid(panelPage, 'summarize the tables here');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Launch Metrics Table');
    expect(latestUserMessage).toContain('Visible tables:');
    expect(latestUserMessage).toContain('Table 1: Launch KPI table');
    expect(latestUserMessage).toContain('Columns: Region | Status | Owner | API token');
    expect(latestUserMessage).toContain('Row 1: EMEA | Ready | Ana | [redacted]');
    expect(latestUserMessage).toContain('Row 2: APAC | Blocked | Bo | [redacted]');
    expect(latestUserMessage).toContain('Table 2: Incident grid');
    expect(latestUserMessage).toContain('Columns: Incident | Severity | SLA');
    expect(latestUserMessage).toContain('Row 1: Auth outage | High | 15m');
    expect(latestUserMessage).toContain('Row 2: Billing delay | Medium | 2h');
    expect(latestUserMessage).toContain('User request:\n\nsummarize the tables here');
    expect(latestUserMessage).not.toContain('sk-live-table-secret123');
    expect(latestUserMessage).not.toContain('sk-live-table-secret456');
  });

  test('includes visible action targets with state and sanitized hrefs in page context', async () => {
    const { panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/action-page.html',
      'main'
    );

    await askAid(panelPage, 'what can I click here?');

    const providerRequest = await providerServer.waitForChatRequestAt(0);
    const latestUserMessage = getLatestUserMessageContent(providerRequest);

    expect(latestUserMessage).toContain('Browser Action Workspace');
    expect(latestUserMessage).toContain('Visible actions:');
    expect(latestUserMessage).toContain('Link: Open launch checklist');
    expect(latestUserMessage).toContain(`href: ${fixtureServer.origin}/launch/checklist`);
    expect(latestUserMessage).toContain('Button: Refresh board; state: collapsed');
    expect(latestUserMessage).toContain('Button: Pin current view; state: pressed');
    expect(latestUserMessage).toContain('Menu item: Export CSV report');
    expect(latestUserMessage).toContain('Tab: QA tab; state: selected');
    expect(latestUserMessage).toContain('Submit button: Deploy now; state: disabled');
    expect(latestUserMessage).toContain('Disclosure: Advanced release options');
    expect(latestUserMessage).toContain('User request:\n\nwhat can I click here?');
    expect(latestUserMessage).not.toContain('secret-action-token');
    expect(latestUserMessage).not.toContain('#owner');
    expect(latestUserMessage).not.toContain('javascript:');
    expect(latestUserMessage).not.toContain('do-not-leak');
  });

  test('runs key-points and make-list quick actions with current page context', async () => {
    const { panelPage } = await openPreparedPanel(
      aid,
      fixtureServer,
      '/research-page.html',
      'main'
    );

    await panelPage.getByRole('button', { name: 'Open tools' }).click();
    await panelPage.getByRole('button', { name: 'Key points' }).click();

    const keyPointsRequest = await providerServer.waitForChatRequestAt(0);
    const keyPointsMessage = getLatestUserMessageContent(keyPointsRequest);
    expect(keyPointsMessage).toContain('Please extract the key points from this webpage');
    expect(keyPointsMessage).toContain('Quarterly Browser Automation Report');
    expect(keyPointsMessage).toContain('Regression tests need to capture the provider payload');
    await waitForAidResponse(panelPage);

    await panelPage.getByRole('button', { name: 'Tools' }).click();
    await panelPage.getByRole('button', { name: 'Make list' }).click();

    const makeListRequest = await providerServer.waitForChatRequestAt(1);
    const makeListMessage = getLatestUserMessageContent(makeListRequest);
    expect(makeListMessage).toContain('Please organize this webpage content into a structured list format');
    expect(makeListMessage).toContain('Quarterly Browser Automation Report');
    expect(makeListMessage).toContain('Fresh context is required after scrolling, tab switches, and DOM updates.');
  });

  test('recovers after a provider failure without leaving the composer stuck', async () => {
    providerServer.queueChatResponse({
      kind: 'error',
      status: 500,
      body: { error: 'Deliberate fake provider failure' },
    });
    const { panelPage } = await openPreparedPanel(aid, fixtureServer);

    await askAid(panelPage, 'force provider failure');
    const failedRequest = await providerServer.waitForChatRequestAt(0);
    expect(getLatestUserMessageContent(failedRequest)).toContain('force provider failure');

    await expect(panelPage.locator('.message-status').last()).toContainText('Failed', { timeout: 15_000 });
    await expect(panelPage.locator('.typing-bubble')).toHaveCount(0);
    await expect(panelPage.locator('.markdown-streaming')).toHaveCount(0);
    await expect(panelPage.locator('.chat-input')).toBeEnabled({ timeout: 15_000 });

    providerServer.queueChatResponse({
      kind: 'stream',
      content: 'Recovered response.',
    });
    await askAid(panelPage, 'try again with page context');

    const recoveredRequest = await providerServer.waitForChatRequestAt(1);
    const recoveredMessages = recoveredRequest.messages || [];
    const recoveredUserMessages = recoveredMessages.filter((message) => message.role === 'user');
    expect(recoveredUserMessages).toHaveLength(1);
    expect(getLatestUserMessageContent(recoveredRequest)).toContain('Ray Wang');
    expect(getLatestUserMessageContent(recoveredRequest)).toContain('try again with page context');
    await waitForAidResponse(panelPage, 'Recovered response.');
  });

  test('shows streaming state while a chunked provider response is still in progress', async () => {
    providerServer.queueChatResponse({
      kind: 'stream',
      chunks: ['Partial streaming response ', 'finished.'],
      chunkDelayMs: 900,
      finishDelayMs: 900,
    });
    const { panelPage } = await openPreparedPanel(aid, fixtureServer);

    await askAid(panelPage, 'stream slowly');
    await providerServer.waitForChatRequestAt(0);

    await expect(panelPage.locator('.assistant-message .markdown-content').last()).toContainText(
      'Partial streaming response',
      { timeout: 15_000 }
    );
    await expect(panelPage.locator('.markdown-streaming')).toHaveCount(1);
    await expect(panelPage.locator('.chat-input')).toBeDisabled();

    await waitForAidResponse(panelPage, 'Partial streaming response finished.');
    await expect(panelPage.locator('.assistant-message .markdown-content').last()).toHaveText(
      'Partial streaming response finished.'
    );
  });

  test('stops an in-progress provider stream and re-enables the composer', async () => {
    providerServer.queueChatResponse({
      kind: 'stream',
      chunks: ['Partial response before stop. ', 'This late chunk should not render.'],
      chunkDelayMs: 3000,
      finishDelayMs: 3000,
    });
    const { panelPage } = await openPreparedPanel(aid, fixtureServer);

    await askAid(panelPage, 'stream until I stop you');
    await providerServer.waitForChatRequestAt(0);

    await expect(panelPage.locator('.assistant-message .markdown-content').last()).toContainText(
      'Partial response before stop.',
      { timeout: 15_000 }
    );
    await expect(panelPage.getByRole('button', { name: 'Stop response' })).toBeEnabled();

    await panelPage.getByRole('button', { name: 'Stop response' }).click();

    await expect(panelPage.locator('.typing-bubble')).toHaveCount(0);
    await expect(panelPage.locator('.markdown-streaming')).toHaveCount(0);
    await expect(panelPage.locator('.chat-input')).toBeEnabled({ timeout: 15_000 });
    await expect(panelPage.getByRole('button', { name: 'Regenerate' })).toBeVisible();
  });
});
