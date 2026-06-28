import { BaseProvider, type StreamingResponse } from './base-provider';
import type { ChatMessage, ChatDelta, ProviderAuth } from '@/shared/types';
import { isLikelyVisionModel } from '@/shared/provider-ux';
import { toOpenAIContent, type OpenAIContentPart } from './message-content';

interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string | OpenAIContentPart[];
}

interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  options?: {
    temperature?: number;
    num_predict?: number;
  };
  stream?: boolean;
}

interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

interface OpenAICompatibleModel {
  id: string;
}

interface OpenAICompatibleModelsResponse {
  data?: OpenAICompatibleModel[];
}

interface OpenAICompatibleStreamChunk {
  id?: string;
  choices: Array<{
    delta?: {
      content?: string;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model: string;
    format: string;
    family: string;
    families: string[];
    parameter_size: string;
    quantization_level: string;
  };
}

interface OllamaModelsResponse {
  models?: OllamaModel[];
}

export class OllamaProvider extends BaseProvider {
  constructor(auth: ProviderAuth) {
    const host = auth.host || 'localhost:11434';
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

    const supportsImages = isLikelyVisionModel('ollama', model);
    const ollamaMessages: OllamaMessage[] = messages.map(msg => ({
      role: msg.role,
      content: supportsImages ? toOpenAIContent(msg) : msg.content,
    }));

    const request: OllamaRequest = {
      model,
      messages: ollamaMessages,
      options: {
        temperature,
        num_predict: maxTokens,
      },
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
            id: data.id || `ollama-${Date.now()}`,
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
      // Check if Ollama is running by hitting the base URL
      const baseUrl = this.baseUrl.replace(/\/v1$/, '');
      const response = await fetch(`${baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async getModels(): Promise<string[]> {
    try {
      // Try OpenAI-compatible endpoint first
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: this.createHeaders(),
      });

      if (response.ok) {
        const data: OpenAICompatibleModelsResponse = await response.json();
        const models = (data.data || []).map((model) => model.id).sort();
        if (models.length > 0) {
          return models;
        }
      }

      // Fallback to Ollama native API
      const baseUrl = this.baseUrl.replace(/\/v1$/, '');
      const ollamaResponse = await fetch(`${baseUrl}/api/tags`);

      if (ollamaResponse.ok) {
        const data: OllamaModelsResponse = await ollamaResponse.json();
        const models = data.models?.map((model: OllamaModel) => model.name).sort();
        return models || [];
      }

      return [];
    } catch {
      return [];
    }
  }

  protected parseStreamChunk(chunk: OllamaStreamChunk | OpenAICompatibleStreamChunk): ChatDelta | null {
    // Handle OpenAI-compatible format (preferred)
    if (this.isOpenAICompatibleStreamChunk(chunk)) {
      const choice = chunk.choices[0];
      if (!choice) return null;

      const content = choice.delta?.content || '';
      const done = choice.finish_reason !== null;

      return {
        id: chunk.id || `ollama-${Date.now()}`,
        contentPart: content,
        done,
        usage: chunk.usage ? {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        } : undefined,
      };
    }

    // Handle native Ollama format
    const ollamaChunk = chunk as OllamaStreamChunk;
    const content = ollamaChunk.message?.content || '';
    const done = ollamaChunk.done;

    let usage: ChatDelta['usage'] = undefined;
    if (done && ollamaChunk.prompt_eval_count && ollamaChunk.eval_count) {
      usage = {
        promptTokens: ollamaChunk.prompt_eval_count,
        completionTokens: ollamaChunk.eval_count,
        totalTokens: ollamaChunk.prompt_eval_count + ollamaChunk.eval_count,
      };
    }

    return {
      id: `ollama-${Date.now()}`,
      contentPart: content,
      done,
      usage,
    };
  }

  protected override createHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
    };
    // No authentication required for Ollama
  }

  private isOpenAICompatibleStreamChunk(
    chunk: OllamaStreamChunk | OpenAICompatibleStreamChunk
  ): chunk is OpenAICompatibleStreamChunk {
    return Array.isArray((chunk as OpenAICompatibleStreamChunk).choices);
  }
}
