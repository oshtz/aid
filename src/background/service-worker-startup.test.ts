import { describe, expect, it, vi } from 'vitest';

const browserMocks = vi.hoisted(() => ({
  addActionListener: vi.fn(),
  addInstallListener: vi.fn(),
  addMessageListener: vi.fn(),
}));
const settingsStartup = vi.hoisted(() => {
  let resolve!: (service: unknown) => void;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return {
    initialize: vi.fn(() => promise),
    resolve,
  };
});

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'aid-test',
      getURL: () => 'moz-extension://aid-test/',
      onMessage: { addListener: browserMocks.addMessageListener },
      onInstalled: { addListener: browserMocks.addInstallListener },
    },
    action: {
      onClicked: { addListener: browserMocks.addActionListener },
    },
  },
}));

vi.mock('@/shared/settings', () => ({
  SettingsService: {
    initialize: settingsStartup.initialize,
  },
}));

import './service-worker';

describe('background cold start', () => {
  it('registers wake-up listeners before settings storage resolves', async () => {
    expect(browserMocks.addMessageListener).toHaveBeenCalledOnce();
    expect(browserMocks.addActionListener).toHaveBeenCalledOnce();
    expect(browserMocks.addInstallListener).toHaveBeenCalledOnce();

    const listener = browserMocks.addMessageListener.mock.calls[0]?.[0];
    const response = listener({ type: 'GET_SETTINGS', payload: {} }, {});
    let settled = false;
    void response.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    settingsStartup.resolve({
      getSettings: () => ({ defaultProvider: 'openai' }),
      getAuthMap: () => ({}),
    });
    await expect(response).resolves.toEqual({
      settings: { defaultProvider: 'openai' },
      authMap: {},
    });
  });
});
