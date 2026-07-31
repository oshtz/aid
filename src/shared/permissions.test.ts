import { afterEach, describe, expect, it, vi } from 'vitest';

const requestPermission = vi.hoisted(() => vi.fn());
const containsPermission = vi.hoisted(() => vi.fn());

vi.mock('webextension-polyfill', () => ({
  default: {
    permissions: {
      contains: containsPermission,
      request: requestPermission,
    },
  },
}));

import { ensureOriginPermission, ensureOriginPermissions } from './permissions';

describe('origin permissions', () => {
  afterEach(() => {
    requestPermission.mockReset();
    containsPermission.mockReset();
  });

  it('requests permission immediately without a contains preflight', async () => {
    requestPermission.mockResolvedValue(true);

    const result = ensureOriginPermission('https://example.com/page');

    expect(requestPermission).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
    expect(containsPermission).not.toHaveBeenCalled();
    await expect(result).resolves.toBe(true);
  });

  it('batches and deduplicates page and provider origins in one prompt', async () => {
    requestPermission.mockResolvedValue(true);

    await ensureOriginPermissions([
      'https://example.com/one',
      'http://localhost:1234/v1',
      'https://example.com/two',
    ]);

    expect(requestPermission).toHaveBeenCalledOnce();
    expect(requestPermission).toHaveBeenCalledWith({
      origins: ['https://example.com/*', 'http://localhost/*'],
    });
  });
});
