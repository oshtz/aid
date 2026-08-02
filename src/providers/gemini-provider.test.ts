import { afterEach, describe, expect, it, vi } from 'vitest';
import { GeminiProvider } from './gemini-provider';
import type { ChatMessage } from '@/shared/types';

const messages: ChatMessage[] = [
  { id: 'system', role: 'system', content: 'Answer with evidence.', timestamp: 1 },
  { id: 'user', role: 'user', content: 'Summarize.', timestamp: 2 },
];

describe('Gemini streaming', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses SSE, system_instruction, one response id, final buffering, and usage', async () => {
    const encoder = new TextEncoder();
    const events = [
      'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}],"role":"model"},"index":0}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"lo"}],"role":"model"},"finishReason":"STOP","index":0}],"usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":2,"totalTokenCount":6}}',
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(events[0]?.slice(0, 17)));
        controller.enqueue(encoder.encode(`${events[0]?.slice(17)}${events[1]}`));
        controller.close();
      },
    }));
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);

    const stream = await new GeminiProvider({ kind: 'api_key', value: 'test-key' })
      .sendChat(messages, 'gemini-test');
    const deltas = [];
    for await (const delta of stream) deltas.push(delta);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(':streamGenerateContent?alt=sse');
    expect(JSON.parse(String(init.body))).toMatchObject({
      system_instruction: { parts: [{ text: 'Answer with evidence.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Summarize.' }] }],
    });
    expect(deltas.map((delta) => delta.contentPart).join('')).toBe('Hello');
    expect(new Set(deltas.map((delta) => delta.id))).toHaveLength(1);
    expect(deltas.at(-1)).toMatchObject({
      done: true,
      usage: { promptTokens: 4, completionTokens: 2, totalTokens: 6 },
    });
  });

  it('passes cancellation to fetch', async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(new GeminiProvider({ kind: 'api_key', value: 'test-key' })
      .sendChat(messages, 'gemini-test', { signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBe(controller.signal);
  });
});
