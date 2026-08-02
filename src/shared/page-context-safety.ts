export const sanitizePageUrl = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    const privatePath = ['/admin', '/dashboard', '/profile', '/account', '/settings', '/private', '/secure']
      .find((path) => url.pathname.toLowerCase().startsWith(path));
    if (privatePath) url.pathname = `${privatePath}/[private]`;
    return url.toString().slice(0, 512);
  } catch {
    return '';
  }
};
