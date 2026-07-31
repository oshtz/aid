import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageAgentState = vi.hoisted(() => ({
  execute: vi.fn(),
  stop: vi.fn(async () => undefined),
  dispose: vi.fn(),
}));

const browserState = vi.hoisted(() => {
  const activated = new Set<(info: { tabId: number; windowId: number }) => void>();
  const updated = new Set<(tabId: number, change: { url?: string }) => void>();
  const removed = new Set<(tabId: number) => void>();
  return { activated, updated, removed };
});

vi.mock('@page-agent/core', () => ({
  PageAgentCore: class {
    execute = pageAgentState.execute;
    stop = pageAgentState.stop;
    dispose = pageAgentState.dispose;
    addEventListener = vi.fn();
  },
}));

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: { getURL: (path: string) => `chrome-extension://aid/${path}` },
    tabs: {
      get: vi.fn(async (tabId: number) => ({ id: tabId, active: tabId === 7, url: 'https://example.com/' })),
      query: vi.fn(async () => [{ id: 7, active: true, url: 'https://example.com/' }]),
      sendMessage: vi.fn(async () => ({ success: true })),
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
  providerId: 'ollama',
  auth: { kind: 'none', host: 'http://localhost:11434' },
  model: 'test-model',
  onActivity: vi.fn(),
  onStep: vi.fn(),
  onApproval: vi.fn(async () => false),
});

describe('AidAgentRun lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserState.activated.clear();
    browserState.updated.clear();
    browserState.removed.clear();
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
