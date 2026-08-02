import type { ProviderAuth } from '@/shared/types';

export const normalizeOpenAICompatibleBaseUrl = (host: string, defaultHost: string): string => {
  const value = (host || defaultHost).trim();
  const url = new URL(/^https?:\/\//i.test(value) ? value : `http://${value}`);

  if (
    url.protocol !== 'http:' ||
    (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') ||
    url.username ||
    url.password
  ) {
    throw new Error('Local providers must use http://localhost or http://127.0.0.1.');
  }

  url.pathname = '/v1';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

export const getLocalProviderBaseUrl = (
  providerId: 'ollama' | 'lmstudio',
  auth: ProviderAuth
): string => normalizeOpenAICompatibleBaseUrl(
  auth.host || '',
  providerId === 'ollama' ? 'localhost:11434' : 'localhost:1234'
);
