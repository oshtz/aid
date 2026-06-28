import type { ChatMessage, ChatDelta, ProviderAuth } from '@/shared/types';

export interface StreamingResponse {
  [Symbol.asyncIterator](): AsyncIterator<ChatDelta>;
}

export abstract class BaseProvider {
  protected auth: ProviderAuth;
  protected baseUrl: string;

  constructor(auth: ProviderAuth, baseUrl: string) {
    this.auth = auth;
    this.baseUrl = baseUrl;
  }

  /**
   * Send a chat request and return streaming response
   */
  abstract sendChat(
    messages: ChatMessage[],
    model: string,
    options?: {
      temperature?: number;
      maxTokens?: number;
      stream?: boolean;
      signal?: AbortSignal;
    }
  ): Promise<StreamingResponse>;

  /**
   * Validate the authentication credentials
   */
  abstract validateAuth(): Promise<boolean>;

  /**
   * Get available models for this provider
   */
  abstract getModels(): Promise<string[]>;

  /**
   * Create headers for API requests
   */
  protected createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.auth.kind === 'api_key' && this.auth.value) {
      headers['Authorization'] = `Bearer ${this.auth.value}`;
    }

    return headers;
  }

  /**
   * Handle HTTP errors
   */
  protected handleHttpError(response: Response): Error {
    const status = response.status;
    const statusText = response.statusText;

    switch (status) {
      case 401:
        return new Error('Invalid API key or authentication failed');
      case 403:
        return new Error('Access forbidden - check your permissions');
      case 404:
        return new Error('API endpoint not found - check URL and authentication');
      case 429:
        return new Error('Rate limit exceeded - please try again later');
      case 500:
        return new Error('Provider server error - please try again');
      case 503:
        return new Error('Provider service unavailable - please try again');
      default:
        return new Error(`HTTP ${status}: ${statusText}`);
    }
  }

  /**
   * Parse Server-Sent Events stream
   */
  protected async *parseSSEStream(response: Response): AsyncGenerator<ChatDelta> {
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
              const parsed = JSON.parse(data);
              const delta = this.parseStreamChunk(parsed);
              if (delta) {
                yield delta;
              }
            } catch (error) {
              console.warn('Failed to parse SSE chunk:', error);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Parse a single chunk from the stream
   * Must be implemented by each provider
   */
  protected abstract parseStreamChunk(chunk: unknown): ChatDelta | null;
}
