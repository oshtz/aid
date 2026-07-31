import browser from 'webextension-polyfill';

const HTTP_SCHEMES = new Set(['http:', 'https:']);

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

export const ensureOriginPermissions = (inputs: string[]): Promise<boolean> => {
  const origins = [...new Set(inputs
    .map(toOriginPermissionPattern)
    .filter((origin): origin is string => origin !== null))];

  if (origins.length === 0 || !browser.permissions?.request) {
    return Promise.resolve(true);
  }

  return browser.permissions.request({ origins });
};

export const ensureOriginPermission = (input: string): Promise<boolean> =>
  ensureOriginPermissions([input]);
