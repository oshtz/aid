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

import {
  ALL_PAGE_PERMISSION_ORIGINS,
  ensureAllPagePermissions,
  ensureOriginPermission,
  ensureOriginPermissions,
} from './permissions';

describe('origin permissions', () => {
  afterEach(() => {
    requestPermission.mockReset();
    containsPermission.mockReset();
    vi.unstubAllGlobals();
  });

  it('requests permission immediately without a contains preflight', async () => {
    requestPermission.mockResolvedValue(true);
    containsPermission.mockResolvedValue(true);

    const result = ensureOriginPermission('https://example.com/page');

    expect(requestPermission).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
    expect(containsPermission).not.toHaveBeenCalled();
    await expect(result).resolves.toBe(true);
    expect(containsPermission).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
  });

  it('batches and deduplicates page and provider origins in one prompt', async () => {
    requestPermission.mockResolvedValue(true);
    containsPermission.mockResolvedValue(true);

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

  it('requests normal webpage access once without a preflight', async () => {
    requestPermission.mockResolvedValue(true);
    containsPermission.mockResolvedValue(true);
    vi.stubGlobal('URL', class {
      constructor() {
        throw new TypeError('Wildcard URLs are invalid in Firefox');
      }
    });

    const result = ensureAllPagePermissions();

    expect(requestPermission).toHaveBeenCalledWith({
      origins: [...ALL_PAGE_PERMISSION_ORIGINS],
    });
    expect(containsPermission).not.toHaveBeenCalled();
    await expect(result).resolves.toBe(true);
    expect(containsPermission).toHaveBeenCalledWith({
      origins: [...ALL_PAGE_PERMISSION_ORIGINS],
    });
  });

  it('reports a grant that the browser did not retain', async () => {
    requestPermission.mockResolvedValue(true);
    containsPermission.mockResolvedValue(false);

    await expect(ensureAllPagePermissions()).resolves.toBe(false);
  });
});
