import { BaseProvider, type StreamingResponse } from './base-provider';
import type { ChatMessage, ChatDelta, ProviderAuth } from '@/shared/types';
import { isLikelyVisionModel } from '@/shared/provider-ux';
import { toOpenAIContent, type OpenAIContentPart } from './message-content';

interface LMStudioMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAIContentPart[];
}

interface LMStudioRequest {
  model: string;
  messages: LMStudioMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

interface LMStudioStreamChunk {
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

interface LMStudioModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface LMStudioStats {
  cache_used: number;
  cache_total: number;
  ram_used: number;
  ram_total: number;
  gpu_layers: number;
  gpu_layers_total: number;
  tokens_per_second: number;
  tokens_predicted: number;
  tokens_cached: number;
}

export class LMStudioProvider extends BaseProvider {
  constructor(auth: ProviderAuth) {
    const host = auth.host || 'localhost:1234';
    const baseUrl = (host.startsWith('http') ? host : `http://${host}`).replace(/\/+$/, '');
    super(auth, baseUrl.endsWith('/v1') ? baseUrl : `${baseUrl}/v1`);
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

    const supportsImages = isLikelyVisionModel('lmstudio', model);
    const lmStudioMessages: LMStudioMessage[] = messages.map(msg => ({
      role: msg.role,
      content: supportsImages ? toOpenAIContent(msg) : msg.content,
    }));

    const request: LMStudioRequest = {
      model,
      messages: lmStudioMessages,
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
            id: data.id || `lmstudio-${Date.now()}`,
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
        ?.map((model: LMStudioModel) => model.id)
        .sort();

      return models || [];
    } catch {
      return [];
    }
  }

  /**
   * Get performance stats from LM Studio
   */
  async getStats(): Promise<LMStudioStats | null> {
    try {
      const baseUrl = this.baseUrl.replace(/\/v1$/, '');
      const response = await fetch(`${baseUrl}/stats`, {
        headers: this.createHeaders(),
      });

      if (!response.ok) {
        return null;
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  protected parseStreamChunk(chunk: LMStudioStreamChunk): ChatDelta | null {
    const choice = chunk.choices[0];
    if (!choice) return null;

    const content = choice.delta.content || '';
    const done = choice.finish_reason !== null && choice.finish_reason !== undefined;

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
    return {
      'Content-Type': 'application/json',
    };
    // No authentication required for LM Studio
  }
}
