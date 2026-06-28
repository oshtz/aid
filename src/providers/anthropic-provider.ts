import { BaseProvider, type StreamingResponse } from './base-provider';
import type { ChatMessage, ChatDelta, ProviderAuth } from '@/shared/types';
import { getBase64ImageData, getImageAttachments } from './message-content';

type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: string;
        data: string;
      };
    };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  temperature?: number;
  stream?: boolean;
  system?: string;
}

interface AnthropicStreamChunk {
  type: 'message_start' | 'content_block_start' | 'content_block_delta' | 'content_block_stop' | 'message_delta' | 'message_stop';
  message?: {
    id: string;
    type: string;
    role: string;
    content: unknown[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
      input_tokens: number;
      output_tokens: number;
    };
  };
  content_block?: {
    type: string;
    text: string;
  };
  delta?: {
    type: string;
    text?: string;
    stop_reason?: string;
  };
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicModel {
  id: string;
  display_name?: string;
  type?: string;
  created_at?: string;
}

interface AnthropicModelsResponse {
  data?: AnthropicModel[];
  has_more?: boolean;
  last_id?: string;
}

export class AnthropicProvider extends BaseProvider {
  constructor(auth: ProviderAuth) {
    super(auth, 'https://api.anthropic.com/v1');
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

    // Extract system message if present
    let systemMessage = '';
    const anthropicMessages: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemMessage = msg.content;
      } else if (msg.role === 'user' || msg.role === 'assistant') {
        const images = msg.role === 'user' ? getImageAttachments(msg) : [];
        anthropicMessages.push({
          role: msg.role,
          content: images.length > 0
            ? [
                ...images.map((image): AnthropicContentBlock => ({
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: image.mimeType,
                    data: getBase64ImageData(image),
                  },
                })),
                ...(msg.content.trim() ? [{ type: 'text' as const, text: msg.content }] : []),
              ]
            : msg.content,
        });
      }
    }

    const request: AnthropicRequest = {
      model,
      messages: anthropicMessages,
      max_tokens: maxTokens,
      temperature,
      stream,
    };

    if (systemMessage) {
      request.system = systemMessage;
    }

    const response = await fetch(`${this.baseUrl}/messages`, {
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
      const content = data.content[0]?.text || '';

      return {
        async *[Symbol.asyncIterator] () {
          yield {
            id: data.id,
            contentPart: content,
            done: true,
            usage: data.usage ? {
              promptTokens: data.usage.input_tokens,
              completionTokens: data.usage.output_tokens,
              totalTokens: data.usage.input_tokens + data.usage.output_tokens,
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
    let afterId: string | undefined;

    try {
      for (let page = 0; page < 20; page++) {
        const url = new URL(`${this.baseUrl}/models`);
        url.searchParams.set('limit', '1000');
        if (afterId) {
          url.searchParams.set('after_id', afterId);
        }

        const response = await fetch(url.toString(), {
          headers: this.createHeaders(),
        });

        if (!response.ok) {
          return [];
        }

        const data: AnthropicModelsResponse = await response.json();
        data.data?.forEach((model) => {
          if (model.id) {
            models.add(model.id);
          }
        });

        if (!data.has_more || !data.last_id) {
          break;
        }

        afterId = data.last_id;
      }

      return Array.from(models).sort();
    } catch {
      return [];
    }
  }

  protected parseStreamChunk(chunk: AnthropicStreamChunk): ChatDelta | null {
    let messageId = '';
    let content = '';
    let done = false;
    let usage: ChatDelta['usage'] = undefined;

    switch (chunk.type) {
      case 'message_start':
        if (chunk.message) {
          messageId = chunk.message.id;
          if (chunk.message.usage) {
            usage = {
              promptTokens: chunk.message.usage.input_tokens,
              completionTokens: chunk.message.usage.output_tokens,
              totalTokens: chunk.message.usage.input_tokens + chunk.message.usage.output_tokens,
            };
          }
        }
        break;

      case 'content_block_delta':
        if (chunk.delta?.text) {
          content = chunk.delta.text;
        }
        break;

      case 'message_delta':
        if (chunk.delta?.stop_reason) {
          done = true;
        }
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.input_tokens,
            completionTokens: chunk.usage.output_tokens,
            totalTokens: chunk.usage.input_tokens + chunk.usage.output_tokens,
          };
        }
        break;

      case 'message_stop':
        done = true;
        break;

      default:
        return null;
    }

    // Only return a delta if we have content or it's the final message
    if (content || done) {
      return {
        id: messageId,
        contentPart: content,
        done,
        usage,
      };
    }

    return null;
  }

  protected override createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };

    if (this.auth.kind === 'api_key' && this.auth.value) {
      headers['x-api-key'] = this.auth.value;
    }

    return headers;
  }
}
