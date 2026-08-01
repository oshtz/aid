import browser from 'webextension-polyfill';

const HTTP_SCHEMES = new Set(['http:', 'https:']);
export const ALL_PAGE_PERMISSION_ORIGINS = ['https://*/*', 'http://*/*'] as const;

export const toOriginPermissionPattern = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `http://${trimmed}`);
    if (!HTTP_SCHEMES.has(url.protocol) || !url.hostname) {
      return null;
    }

    return `${url.protocol}//${url.hostname}/*`;
  } catch {
    return null;
  }
};

const requestOriginPermissions = async (origins: string[]): Promise<boolean> => {
  if (origins.length === 0 || !browser.permissions?.request) {
    return false;
  }

  const granted = await browser.permissions.request({ origins });
  return granted && browser.permissions.contains
    ? browser.permissions.contains({ origins })
    : granted;
};

export const ensureOriginPermissions = (inputs: string[]): Promise<boolean> => {
  const origins = [...new Set(inputs
    .map(toOriginPermissionPattern)
    .filter((origin): origin is string => origin !== null))];

  return requestOriginPermissions(origins);
};

export const ensureOriginPermission = (input: string): Promise<boolean> =>
  ensureOriginPermissions([input]);

export const ensureAllPagePermissions = (): Promise<boolean> =>
  requestOriginPermissions([...ALL_PAGE_PERMISSION_ORIGINS]);
