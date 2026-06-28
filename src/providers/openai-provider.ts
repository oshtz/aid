import { BaseProvider, type StreamingResponse } from './base-provider';
import type { ChatMessage, ChatDelta, ProviderAuth } from '@/shared/types';
import { toOpenAIContent, type OpenAIContentPart } from './message-content';

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAIContentPart[];
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIModel {
  id: string;
}

interface OpenAIModelsResponse {
  data?: OpenAIModel[];
}

export class OpenAIProvider extends BaseProvider {
  constructor(auth: ProviderAuth) {
    super(auth, 'https://api.openai.com/v1');
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

    const openaiMessages: OpenAIMessage[] = messages.map(msg => ({
      role: msg.role,
      content: toOpenAIContent(msg),
    }));

    const request: OpenAIRequest = {
      model,
      messages: openaiMessages,
      temperature,
      max_tokens: maxTokens,
      stream,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.createHeaders(),
      body: JSON.stringify(request),
      mode: 'cors',
      credentials: 'omit',
      ...(signal ? { signal } : {}),
    });

    if (!response.ok) {
      throw this.handleHttpError(response);
    }

    if (stream) {
      return {
        [Symbol.asyncIterator]: () => this.parseSSEStream(response),
      };
    } else {
      // Handle non-streaming response
      const data = await response.json();
      const content = data.choices[0]?.message?.content || '';

      return {
        async *[Symbol.asyncIterator] () {
          yield {
            id: data.id,
            contentPart: content,
            done: true,
            usage: data.usage ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
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
        mode: 'cors',
        credentials: 'omit',
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.createHeaders(),
        mode: 'cors',
        credentials: 'omit',
      });

      if (!response.ok) {
        return [];
      }

      const data: OpenAIModelsResponse = await response.json();
      const models = (data.data || [])
        .map((model) => model.id)
        .sort();

      return models;
    } catch {
      return [];
    }
  }

  protected parseStreamChunk(chunk: OpenAIStreamChunk): ChatDelta | null {
    const choice = chunk.choices[0];
    if (!choice) return null;

    const content = choice.delta.content || '';
    const done = choice.finish_reason !== null;

    return {
      id: chunk.id,
      contentPart: content,
      done,
      usage: chunk.usage ? {
        promptTokens: chunk.usage.prompt_tokens,
        completionTokens: chunk.usage.completion_tokens,
        totalTokens: chunk.usage.total_tokens,
      } : undefined,
    };
  }

  protected override createHeaders(): Record<string, string> {
    const headers = super.createHeaders();

    if (this.auth.kind === 'api_key' && this.auth.value) {
      // Clean and validate API key
      let apiKey = this.auth.value.trim();

      // Handle potential concatenated or corrupted keys
      if (apiKey.length > 60) {
        // Look for the first valid OpenAI key pattern (supports both old and new formats)
        const keyMatch = apiKey.match(/sk-[A-Za-z0-9_-]{20,}/);
        if (keyMatch) {
          apiKey = keyMatch[0];
        } else {
          // Fallback: find the first occurrence of sk- and take everything after
          const skIndex = apiKey.indexOf('sk-');
          if (skIndex !== -1) {
            const keyPart = apiKey.substring(skIndex);
            const endMatch = keyPart.match(/^sk-[A-Za-z0-9_-]+/);
            if (endMatch) {
              apiKey = endMatch[0];
            }
          }
        }
      }

      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    return headers;
  }
}
