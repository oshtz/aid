import { beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

const pageAgentState = vi.hoisted(() => ({
  execute: vi.fn(),
  stop: vi.fn(async () => undefined),
  dispose: vi.fn(),
  config: null as Record<string, unknown> | null,
}));

const browserState = vi.hoisted(() => {
  const activated = new Set<(info: { tabId: number; windowId: number }) => void>();
  const updated = new Set<(tabId: number, change: { url?: string }) => void>();
  const removed = new Set<(tabId: number) => void>();
  return {
    activated,
    updated,
    removed,
    tab: { id: 7, active: true, status: 'complete', url: 'https://example.com/' },
    redirectUrl: '',
  };
});

vi.mock('@page-agent/core', () => ({
  PageAgentCore: class {
    constructor(config: Record<string, unknown>) {
      pageAgentState.config = config;
    }
    execute = pageAgentState.execute;
    stop = pageAgentState.stop;
    dispose = pageAgentState.dispose;
    addEventListener = vi.fn();
  },
  tool: (definition: unknown) => definition,
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'aid-extension',
      getURL: (path: string) => `chrome-extension://aid/${path}`,
      sendMessage: vi.fn(async () => ({
        contexts: [{ url: browserState.tab.url, title: 'Next page', abstract: 'Readable next page' }],
        diagnostics: { content: [{ tabId: 7, contextOk: true }] },
      })),
    },
    tabs: {
      get: vi.fn(async () => ({ ...browserState.tab })),
      query: vi.fn(async () => [{ ...browserState.tab }]),
      update: vi.fn(async (_tabId: number, properties: { url?: string }) => {
        browserState.tab.url = browserState.redirectUrl || properties.url || browserState.tab.url;
        browserState.tab.status = 'complete';
        return { ...browserState.tab };
      }),
      sendMessage: vi.fn(async (_tabId: number, message: { payload?: { command?: { command?: string } } }) => {
        const command = message.payload?.command?.command;
        if (command === 'assess_navigation' || command === 'prepare_navigation') {
          return {
            decision: 'allow',
            action: 'navigate',
            index: 3,
            label: '[3]<a>Next page /> → https://example.com/next',
            reason: 'This link stays on the current website.',
            fingerprint: 'navigate:3:next',
            targetUrl: 'https://example.com/next',
            sameOrigin: true,
          };
        }
        return { success: true };
      }),
      onActivated: {
        addListener: (listener: (info: { tabId: number; windowId: number }) => void) => browserState.activated.add(listener),
        removeListener: (listener: (info: { tabId: number; windowId: number }) => void) => browserState.activated.delete(listener),
      },
      onUpdated: {
        addListener: (listener: (tabId: number, change: { url?: string }) => void) => browserState.updated.add(listener),
        removeListener: (listener: (tabId: number, change: { url?: string }) => void) => browserState.updated.delete(listener),
      },
      onRemoved: {
        addListener: (listener: (tabId: number) => void) => browserState.removed.add(listener),
        removeListener: (listener: (tabId: number) => void) => browserState.removed.delete(listener),
      },
    },
  },
}));

import { AidAgentRun } from './agent-runtime';

const createRun = () => new AidAgentRun({
  tabId: 7,
  initialUrl: 'https://example.com/',
  initialTitle: 'Example page',
  taskMessageId: 'user_1',
  providerId: 'ollama',
  auth: { kind: 'none', host: 'http://localhost:11434' },
  model: 'test-model',
  onActivity: vi.fn(),
  onStep: vi.fn(),
  onApproval: vi.fn(async () => false),
  onInterrupted: vi.fn(),
});

describe('AidAgentRun lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserState.activated.clear();
    browserState.updated.clear();
    browserState.removed.clear();
    browserState.tab = { id: 7, active: true, status: 'complete', url: 'https://example.com/' };
    browserState.redirectUrl = '';
    pageAgentState.config = null;
    pageAgentState.execute.mockResolvedValue({ success: true, data: 'done', history: [] });
  });

  it('stops immediately on navigation and removes all run listeners', async () => {
    let finish: ((value: { success: boolean; data: string; history: never[] }) => void) | undefined;
    pageAgentState.execute.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const run = createRun();
    const execution = run.execute('task');
    await Promise.resolve();

    browserState.updated.forEach((listener) => listener(7, { url: 'https://example.com/next' }));
    finish?.({ success: false, data: '', history: [] });

    await expect(execution).rejects.toThrow('Navigation stopped');
    expect(pageAgentState.stop).toHaveBeenCalledOnce();
    expect(pageAgentState.dispose).toHaveBeenCalledOnce();
    expect(browserState.activated.size + browserState.updated.size + browserState.removed.size).toBe(0);
  });

  it('navigates the controlled tab, reconnects the content controller, and continues', async () => {
    pageAgentState.execute.mockImplementation(async () => {
      const customTools = pageAgentState.config?.customTools as Record<string, {
        execute: (input: { index: number }, context: { signal: AbortSignal }) => Promise<string>;
      }>;
      const navigationTool = customTools.navigate_to_link;
      expect(navigationTool).toBeDefined();
      if (!navigationTool) throw new Error('Navigation tool missing');
      const output = await navigationTool.execute(
        { index: 3 },
        { signal: new AbortController().signal }
      );
      expect(output).toContain('Navigated the current tab');
      return { success: true, data: 'done', history: [] };
    });
    const run = createRun();

    await expect(run.execute('Go to the next page')).resolves.toMatchObject({ success: true });
    expect(browserState.tab.url).toBe('https://example.com/next');
    expect(pageAgentState.stop).not.toHaveBeenCalled();
    expect(browserState.activated.size + browserState.updated.size + browserState.removed.size).toBe(0);
  });

  it('does not read a redirect to an unapproved website', async () => {
    browserState.redirectUrl = 'https://redirected.example/';
    pageAgentState.execute.mockImplementation(async () => {
      const customTools = pageAgentState.config?.customTools as Record<string, {
        execute: (input: { index: number }, context: { signal: AbortSignal }) => Promise<string>;
      }>;
      const navigationTool = customTools.navigate_to_link;
      if (!navigationTool) throw new Error('Navigation tool missing');
      const output = await navigationTool.execute(
        { index: 3 },
        { signal: new AbortController().signal }
      );
      expect(output).toContain('redirected to another website');
      return { success: false, data: output, history: [] };
    });
    const run = createRun();

    await expect(run.execute('Go to the next page')).resolves.toMatchObject({ success: false });
    expect(browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('ignores unrelated updates and cleans up after success or manual stop', async () => {
    const run = createRun();
    const execution = run.execute('task');
    browserState.updated.forEach((listener) => listener(8, { url: 'https://other.example/' }));

    await expect(execution).resolves.toMatchObject({ success: true });
    expect(pageAgentState.stop).not.toHaveBeenCalled();
    expect(browserState.activated.size + browserState.updated.size + browserState.removed.size).toBe(0);

    const stoppedRun = createRun();
    await stoppedRun.stop();
    expect(pageAgentState.dispose).toHaveBeenCalledTimes(2);
  });
});
