import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContextLookupDiagnostics } from './types';

const queryTabs = vi.hoisted(() => vi.fn());
const sendMessage = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: {
    runtime: {
      id: 'aid-test',
      getURL: () => 'moz-extension://aid-test/',
      sendMessage,
    },
    tabs: {
      query: queryTabs,
    },
  },
}));

import { MessageHandler } from './message-handler';

const diagnostics: ContextLookupDiagnostics = {
  selectedTabIds: [42],
  selectedSource: 'explicit-tab-ids',
  queries: [],
  content: [],
};

describe('MessageHandler', () => {
  afterEach(() => {
    queryTabs.mockReset();
    sendMessage.mockReset();
  });

  it('requests context for this window active tab and preserves response failures', async () => {
    queryTabs.mockResolvedValue([
      { id: 42, url: 'https://example.com', lastAccessed: 10 },
      { id: 99, active: true, url: 'moz-extension://aid-test/sidepanel.html', lastAccessed: 20 },
    ]);
    sendMessage.mockResolvedValue({
      error: 'Settings failed to initialize',
      diagnostics,
    });

    await expect(MessageHandler.getActiveTabContextResult()).resolves.toEqual({
      context: null,
      diagnostics,
      error: 'Settings failed to initialize',
    });
    expect(queryTabs).toHaveBeenCalledWith({ currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith({
      type: 'GET_TAB_CONTEXT',
      payload: { tabIds: [42] },
    });
  });
});
