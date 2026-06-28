import { afterEach, describe, expect, test, vi } from 'vitest';
import { AnthropicProvider } from './anthropic-provider';
import { GeminiProvider } from './gemini-provider';
import { LMStudioProvider } from './lmstudio-provider';
import { OllamaProvider } from './ollama-provider';
import { OpenAIProvider } from './openai-provider';
import { OpenRouterProvider } from './openrouter-provider';
import type { ChatImageAttachment, ChatMessage } from '@/shared/types';

const imageAttachment: ChatImageAttachment = {
  id: 'image-1',
  kind: 'image',
  name: 'chart.png',
  mimeType: 'image/png',
  size: 12,
  dataUrl: 'data:image/png;base64,aW1hZ2U=',
};

const message: ChatMessage = {
  id: 'message-1',
  role: 'user',
  content: 'What is in this image?',
  attachments: [imageAttachment],
  timestamp: 1,
};

const getRequestBody = () => {
  const call = vi.mocked(fetch).mock.calls[0];
  const init = call?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
};

describe('multimodal provider requests', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('sends OpenAI image_url content parts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'openai-test', choices: [{ message: { content: 'ok' } }] }),
    }));

    await new OpenAIProvider({ kind: 'api_key', value: 'sk-test' })
      .sendChat([message], 'gpt-4o', { stream: false });

    expect(getRequestBody().messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: imageAttachment.dataUrl, detail: 'auto' } },
      { type: 'text', text: 'What is in this image?' },
    ]);
  });

  test('sends OpenRouter image_url content parts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'openrouter-test', choices: [{ message: { content: 'ok' } }] }),
    }));

    await new OpenRouterProvider({ kind: 'api_key', value: 'sk-or-test' })
      .sendChat([message], 'openai/gpt-4o-mini', { stream: false });

    expect(getRequestBody().messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: imageAttachment.dataUrl, detail: 'auto' } },
      { type: 'text', text: 'What is in this image?' },
    ]);
  });

  test('sends Anthropic base64 image blocks', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'claude-test', content: [{ text: 'ok' }] }),
    }));

    await new AnthropicProvider({ kind: 'api_key', value: 'sk-ant-test' })
      .sendChat([message], 'claude-sonnet-4-5', { stream: false });

    expect(getRequestBody().messages[0].content).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'aW1hZ2U=',
        },
      },
      { type: 'text', text: 'What is in this image?' },
    ]);
  });

  test('sends Gemini inline image data parts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'ok' }], role: 'model' }, index: 0 }],
      }),
    }));

    await new GeminiProvider({ kind: 'api_key', value: 'gemini-test' })
      .sendChat([message], 'gemini-3.5-flash', { stream: false });

    expect(getRequestBody().contents[0].parts).toEqual([
      {
        inline_data: {
          mime_type: 'image/png',
          data: 'aW1hZ2U=',
        },
      },
      { text: 'What is in this image?' },
    ]);
  });

  test.each([
    ['Ollama', () => new OllamaProvider({ kind: 'none', host: 'http://localhost:11434/v1/' }), 'llama3'],
    ['LM Studio', () => new LMStudioProvider({ kind: 'none', host: 'http://localhost:1234/v1/' }), 'local-model'],
  ])('keeps %s non-vision image messages text-only', async (_name, createProvider, model) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'local-test', choices: [{ message: { content: 'ok' } }] }),
    }));

    await createProvider().sendChat([message], model, { stream: false });

    expect(getRequestBody().messages[0].content).toBe('What is in this image?');
  });

  test.each([
    ['Ollama', () => new OllamaProvider({ kind: 'none', host: 'http://localhost:11434/v1/' }), 'llama3.2-vision'],
    ['LM Studio', () => new LMStudioProvider({ kind: 'none', host: 'http://localhost:1234/v1/' }), 'llava-v1.6'],
  ])('sends %s vision image messages as image_url content parts', async (_name, createProvider, model) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'local-test', choices: [{ message: { content: 'ok' } }] }),
    }));

    await createProvider().sendChat([message], model, { stream: false });

    expect(getRequestBody().messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: imageAttachment.dataUrl, detail: 'auto' } },
      { type: 'text', text: 'What is in this image?' },
    ]);
  });
});
