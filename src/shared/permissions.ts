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

export const ensureOriginPermission = async (input: string): Promise<boolean> => {
  const origin = toOriginPermissionPattern(input);
  if (!origin || !browser.permissions?.contains || !browser.permissions?.request) {
    return true;
  }

  const hasPermission = await browser.permissions.contains({ origins: [origin] });
  if (hasPermission) {
    return true;
  }

  return browser.permissions.request({ origins: [origin] });
};
