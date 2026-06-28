import { BaseProvider, type StreamingResponse } from './base-provider';
import type { ChatMessage, ChatDelta, ProviderAuth } from '@/shared/types';
import { toOpenAIContent, type OpenAIContentPart } from './message-content';

interface OpenRouterMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAIContentPart[];
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface OpenRouterStreamChunk {
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

interface OpenRouterModel {
  id: string;
  name: string;
  description: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

export class OpenRouterProvider extends BaseProvider {
  constructor(auth: ProviderAuth) {
    super(auth, 'https://openrouter.ai/api/v1');
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

    const openRouterMessages: OpenRouterMessage[] = messages.map(msg => ({
      role: msg.role,
      content: toOpenAIContent(msg),
    }));

    const request: OpenRouterRequest = {
      model,
      messages: openRouterMessages,
      temperature,
      max_tokens: maxTokens,
      stream,
    };

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
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
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json();
      const models = data.data
        ?.map((model: OpenRouterModel) => model.id)
        .sort();

      return models || [];
    } catch {
      return [];
    }
  }

  protected parseStreamChunk(chunk: OpenRouterStreamChunk): ChatDelta | null {
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://aid-extension.com', // Optional referer for OpenRouter
      'X-Title': 'Aid Browser Extension',
    };

    if (this.auth.kind === 'api_key' && this.auth.value) {
      headers['Authorization'] = `Bearer ${this.auth.value}`;
    }

    return headers;
  }
}
