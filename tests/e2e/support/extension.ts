import { chromium, type BrowserContext, type LaunchPersistentContextOptions, type Page, type Worker } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface AidExtensionContext {
  context: BrowserContext;
  extensionId: string;
  openSidePanelPage: () => Promise<Page>;
  close: () => Promise<void>;
}

const chromeCandidates = [
  process.env.AID_E2E_CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter((candidate): candidate is string => Boolean(candidate));

const resolveChromeExecutablePath = (): string => {
  const executablePath = chromeCandidates.find((candidate) => existsSync(candidate));
  if (!executablePath) {
    throw new Error('No Chrome or Edge executable found. Set AID_E2E_CHROME_PATH to run extension E2E tests.');
  }

  return executablePath;
};

const getExtensionServiceWorker = async (context: BrowserContext): Promise<Worker> => {
  const existingWorker = context
    .serviceWorkers()
    .find((worker) => worker.url().startsWith('chrome-extension://'));

  if (existingWorker) {
    return existingWorker;
  }

  return context.waitForEvent('serviceworker', {
    predicate: (worker) => worker.url().startsWith('chrome-extension://'),
    timeout: 10_000,
  });
};

export const launchAidExtension = async (): Promise<AidExtensionContext> => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'aid-e2e-'));
  const extensionPath = resolve(process.cwd(), 'dist');
  const commonOptions: LaunchPersistentContextOptions = {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-search-engine-choice-screen',
    ],
  };

  const context = await chromium.launchPersistentContext(userDataDir, {
    ...commonOptions,
    channel: 'chromium',
  }).catch(() => chromium.launchPersistentContext(userDataDir, {
    ...commonOptions,
    executablePath: resolveChromeExecutablePath(),
    ignoreDefaultArgs: ['--disable-extensions'],
  }));

  const serviceWorker = await getExtensionServiceWorker(context);
  const extensionId = new URL(serviceWorker.url()).host;

  return {
    context,
    extensionId,
    openSidePanelPage: async () => {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/sidepanel/index.html`);
      return page;
    },
    close: async () => {
      await context.close();
      rmSync(userDataDir, { recursive: true, force: true });
    },
  };
};

export const configureAidForFakeProvider = async (
  context: BrowserContext,
  extensionId: string,
  providerOrigin: string
) => {
  const setupPage = await context.newPage();
  await setupPage.goto(`chrome-extension://${extensionId}/options/index.html`);

  await setupPage.evaluate(async ({ host }) => {
    const settings = {
      defaultProvider: 'lmstudio',
      defaultModels: { lmstudio: 'llava' },
      sessionOnly: true,
      theme: 'dark',
    };
    const authMap = {
      lmstudio: {
        kind: 'none',
        host,
      },
    };

    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    if (chrome.storage.session) {
      await chrome.storage.session.clear();
    }

    await chrome.storage.sync.set({ settings });
    await chrome.storage.local.set({ 'aid-theme': settings.theme });
    if (chrome.storage.session) {
      await chrome.storage.session.set({ authMap });
    }

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: {
        settings,
        authMap,
      },
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Receiving end does not exist')) {
        throw error;
      }
    });
  }, { host: providerOrigin });

  await setupPage.close();
};

const configureAidForLocalProvider = async (
  context: BrowserContext,
  extensionId: string,
  options: { provider: 'lmstudio' | 'ollama'; host: string; model: string }
) => {
  const setupPage = await context.newPage();
  await setupPage.goto(`chrome-extension://${extensionId}/options/index.html`);

  await setupPage.evaluate(async ({ provider, host, model }) => {
    const settings = {
      defaultProvider: provider,
      defaultModels: { [provider]: model },
      sessionOnly: true,
      theme: 'dark',
      accentColor: '#7c3aed',
    };
    const authMap = {
      [provider]: {
        kind: 'none',
        host,
      },
    };

    await chrome.storage.sync.clear();
    await chrome.storage.local.clear();
    if (chrome.storage.session) {
      await chrome.storage.session.clear();
    }

    await chrome.storage.sync.set({ settings });
    await chrome.storage.local.set({ 'aid-theme': settings.theme });
    if (chrome.storage.session) {
      await chrome.storage.session.set({ authMap });
    }

    await chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: {
        settings,
        authMap,
      },
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Receiving end does not exist')) {
        throw error;
      }
    });
  }, options);

  await setupPage.close();
};

export const configureAidForLMStudio = async (
  context: BrowserContext,
  extensionId: string,
  options: { host: string; model: string }
) => configureAidForLocalProvider(context, extensionId, { provider: 'lmstudio', ...options });

export const configureAidForOllama = async (
  context: BrowserContext,
  extensionId: string,
  options: { host: string; model: string }
) => configureAidForLocalProvider(context, extensionId, { provider: 'ollama', ...options });
