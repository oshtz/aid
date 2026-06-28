import { beforeEach, describe, expect, it, vi } from 'vitest';

type StorageState = Record<string, unknown>;

const makeStorageArea = () => {
  const state: StorageState = {};

  return {
    state,
    get: vi.fn(async (key: string) => ({ [key]: state[key] })),
    set: vi.fn(async (values: StorageState) => {
      Object.assign(state, values);
    }),
    remove: vi.fn(async (key: string) => {
      delete state[key];
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(state)) delete state[key];
    }),
  };
};

const loadStorageManager = async (withSessionStorage: boolean) => {
  const sync = makeStorageArea();
  const local = makeStorageArea();
  const session = withSessionStorage ? makeStorageArea() : undefined;

  vi.doMock('webextension-polyfill', () => ({
    default: {
      runtime: { id: 'aid-test' },
      storage: {
        sync,
        local,
        ...(session ? { session } : {}),
      },
    },
  }));

  const { StorageManager } = await import('./storage');
  return { StorageManager, local, session };
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('StorageManager auth storage', () => {
  it('keeps session-only auth out of local storage without storage.session', async () => {
    const { StorageManager, local } = await loadStorageManager(false);
    const authMap = { openai: { kind: 'api_key' as const, value: 'sk-test' } };

    await StorageManager.saveAuthMap(authMap, true);

    expect(local.set).not.toHaveBeenCalled();
    await expect(StorageManager.loadAuthMap(true)).resolves.toEqual(authMap);
  });
});
