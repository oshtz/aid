import { afterEach, describe, expect, test, vi } from 'vitest';
import { LMStudioProvider } from './lmstudio-provider';
import { OllamaProvider } from './ollama-provider';
import type { ChatMessage } from '@/shared/types';

describe('local provider host normalization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('does not append /v1 twice for LM Studio hosts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await new LMStudioProvider({ kind: 'none', host: 'http://localhost:1234/v1/' }).validateAuth();

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:1234/v1/models', expect.any(Object));
  });

  test('does not append /v1 twice for Ollama chat requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'ollama-test',
        choices: [{ message: { content: 'ok' } }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const messages: ChatMessage[] = [{
      id: 'message-1',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    }];

    await new OllamaProvider({ kind: 'none', host: 'http://localhost:11434/v1/' })
      .sendChat(messages, 'llama3', { stream: false });

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/v1/chat/completions');
  });
});
