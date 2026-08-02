import { describe, expect, it } from 'vitest';
import {
  getAgentProviderConnection,
  isAgentProviderId,
} from './agent';
import { normalizeOpenAICompatibleBaseUrl } from '@/providers/openai-compatible';

describe('agent provider configuration', () => {
  it('limits Agent mode to OpenAI-compatible providers', () => {
    expect(isAgentProviderId('openai')).toBe(true);
    expect(isAgentProviderId('openrouter')).toBe(true);
    expect(isAgentProviderId('ollama')).toBe(true);
    expect(isAgentProviderId('lmstudio')).toBe(true);
    expect(isAgentProviderId('anthropic')).toBe(false);
    expect(isAgentProviderId('gemini')).toBe(false);
  });

  it('normalizes local hosts without duplicating /v1', () => {
    expect(normalizeOpenAICompatibleBaseUrl('localhost:11434', 'unused')).toBe('http://localhost:11434/v1');
    expect(normalizeOpenAICompatibleBaseUrl('http://localhost:1234/v1/', 'unused')).toBe('http://localhost:1234/v1');
  });

  it('uses the saved local host and cloud API key', () => {
    expect(getAgentProviderConnection('ollama', {
      kind: 'none',
      host: 'http://127.0.0.1:9988',
    })).toEqual({ baseURL: 'http://127.0.0.1:9988/v1' });

    expect(getAgentProviderConnection('openrouter', {
      kind: 'api_key',
      value: ' key ',
    })).toEqual({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'key',
    });
  });
});
