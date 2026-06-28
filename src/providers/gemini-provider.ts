import { BaseProvider, type StreamingResponse } from './base-provider';
import type { ChatMessage, ChatDelta, ProviderAuth } from '@/shared/types';
import { getBase64ImageData, getImageAttachments } from './message-content';

type GeminiPart =
  | { text: string }
  | {
      inline_data: {
        mime_type: string;
        data: string;
      };
    };

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiCandidate {
  content: {
    parts: Array<{
      text: string;
    }>;
    role: string;
  };
  finishReason?: string;
  index: number;
}

interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiResponse {
  candidates: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

interface GeminiModel {
  name: string;
  supportedGenerationMethods?: string[];
  supportedActions?: string[];
}

interface GeminiModelsResponse {
  models?: GeminiModel[];
  nextPageToken?: string;
}

export class GeminiProvider extends BaseProvider {
  constructor(auth: ProviderAuth) {
    super(auth, 'https://generativelanguage.googleapis.com/v1beta');
  }

  async sendChat(
    messages: ChatMessage[],
    model: string,
    options: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      signal?: AbortSignal;
    } = {}
  ): Promise<StreamingResponse> {
    const { temperature = 0.7, maxTokens = 4096, stream = true, signal } = options;

    // Convert messages to Gemini format
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Note: Gemini doesn't have a direct system message concept
        // System messages could be prepended to the first user message if needed
        continue;
      } else {
        const images = msg.role === 'user' ? getImageAttachments(msg) : [];
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [
            ...images.map((image): GeminiPart => ({
              inline_data: {
                mime_type: image.mimeType,
                data: getBase64ImageData(image),
              },
            })),
            ...(msg.content.trim() ? [{ text: msg.content }] : []),
          ],
        });
      }
    }

    const request: GeminiRequest = {
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
    };

    const endpoint = stream
      ? `${this.baseUrl}/models/${model}:streamGenerateContent`
      : `${this.baseUrl}/models/${model}:generateContent`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify(request),
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      throw this.handleHttpError(response);
    }

    if (stream) {
      return {
        [Symbol.asyncIterator]: () => this.parseGeminiStream(response),
      };
    } else {
      // Handle non-streaming response
      const data: GeminiResponse = await response.json();
      const content = data.candidates[0]?.content?.parts[0]?.text || '';

      return {
        async *[Symbol.asyncIterator] () {
          yield {
            id: `gemini-${Date.now()}`,
            contentPart: content,
            done: true,
            usage: data.usageMetadata ? {
              promptTokens: data.usageMetadata.promptTokenCount,
              completionTokens: data.usageMetadata.candidatesTokenCount,
              totalTokens: data.usageMetadata.totalTokenCount,
            } : undefined,
          };
        },
      };
    }
  }

  async validateAuth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.createHeaders(),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    const models = new Set<string>();
    let pageToken: string | undefined;

    try {
      for (let page = 0; page < 20; page++) {
        const url = new URL(`${this.baseUrl}/models`);
        url.searchParams.set('pageSize', '1000');
        if (pageToken) {
          url.searchParams.set('pageToken', pageToken);
        }

        const response = await fetch(url.toString(), {
          headers: this.createHeaders(),
        });

        if (!response.ok) {
          return [];
        }

        const data: GeminiModelsResponse = await response.json();
        data.models
          ?.filter((model) => {
            const actions = model.supportedGenerationMethods || model.supportedActions;
            return !actions || actions.includes('generateContent');
          })
          .forEach((model) => {
            const id = model.name.split('/').pop();
            if (id) {
              models.add(id);
            }
          });

        if (!data.nextPageToken) {
          break;
        }

        pageToken = data.nextPageToken;
      }

      return Array.from(models).sort();
    } catch {
      return [];
    }
  }

  private async *parseGeminiStream(response: Response): AsyncGenerator<ChatDelta> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              return;
            }

            try {
              const parsed: GeminiStreamChunk = JSON.parse(data);
              const delta = this.parseGeminiChunk(parsed);
              if (delta) {
                yield delta;
              }
            } catch (error) {
              console.warn('Failed to parse Gemini SSE chunk:', error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseGeminiChunk(chunk: GeminiStreamChunk): ChatDelta | null {
    const candidate = chunk.candidates?.[0];
    if (!candidate) return null;

    const content = candidate.content?.parts?.[0]?.text || '';
    const done = candidate.finishReason !== undefined;

    return {
      id: `gemini-${Date.now()}`,
      contentPart: content,
      done,
      usage: chunk.usageMetadata ? {
        promptTokens: chunk.usageMetadata.promptTokenCount,
        completionTokens: chunk.usageMetadata.candidatesTokenCount,
        totalTokens: chunk.usageMetadata.totalTokenCount,
      } : undefined,
    };
  }

  protected parseStreamChunk(chunk: GeminiStreamChunk): ChatDelta | null {
    // This method is required by BaseProvider but we use parseGeminiChunk instead
    return this.parseGeminiChunk(chunk);
  }

  protected override createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.auth.kind === 'oauth' && this.auth.value) {
      headers['Authorization'] = `Bearer ${this.auth.value}`;
    } else if (this.auth.kind === 'api_key' && this.auth.value) {
      // Gemini also supports API key authentication
      headers['x-goog-api-key'] = this.auth.value;
    }

    return headers;
  }
}
