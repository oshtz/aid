import type { BaseProvider } from './base-provider';
import type { ProviderAuth, ProviderConfig, ProviderId } from '@/shared/types';
import { OpenAIProvider } from './openai-provider';
import { AnthropicProvider } from './anthropic-provider';
import { GeminiProvider } from './gemini-provider';
import { OpenRouterProvider } from './openrouter-provider';
import { OllamaProvider } from './ollama-provider';
import { LMStudioProvider } from './lmstudio-provider';

/**
 * Factory for creating provider instances
 */
type ProviderConstructor = new (auth: ProviderAuth) => BaseProvider;

export class ProviderFactory {
  private static providers: Map<ProviderId, ProviderConstructor> = new Map([
    ['openai', OpenAIProvider as ProviderConstructor],
    ['anthropic', AnthropicProvider as ProviderConstructor],
    ['gemini', GeminiProvider as ProviderConstructor],
    ['openrouter', OpenRouterProvider as ProviderConstructor],
    ['ollama', OllamaProvider as ProviderConstructor],
    ['lmstudio', LMStudioProvider as ProviderConstructor],
  ]);

  /**
   * Create a provider instance
   */
  static createProvider(providerId: ProviderId, auth: ProviderAuth): BaseProvider {
    const ProviderClass = this.providers.get(providerId);

    if (!ProviderClass) {
      throw new Error(`Unknown provider: ${providerId}`);
    }

    return new ProviderClass(auth);
  }

  /**
   * Get all available provider IDs
   */
  static getAvailableProviders(): ProviderId[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Validate provider configuration
   */
  static validateProviderConfig(providerId: ProviderId, auth: ProviderAuth): { valid: boolean; error?: string } {
    const config = this.getProviderConfig(providerId);
    if (!config) {
      return { valid: false, error: `Unknown provider: ${providerId}` };
    }

    // Check auth requirements
    if (config.authType === 'api_key' && (!auth.value || auth.value.trim() === '')) {
      return { valid: false, error: `API key required for ${config.name}` };
    }

    if (config.authType === 'oauth' && (!auth.value || auth.value.trim() === '')) {
      return { valid: false, error: `OAuth token required for ${config.name}` };
    }

    // For local providers, validate host if provided
    if (config.authType === 'none' && auth.host) {
      try {
        new URL(auth.host.startsWith('http') ? auth.host : `http://${auth.host}`);
      } catch {
        return { valid: false, error: `Invalid host URL for ${config.name}` };
      }
    }

    return { valid: true };
  }

  /**
   * Get provider configuration
   */
  static getProviderConfig(providerId: ProviderId) {
    const configs: Record<ProviderId, ProviderConfig> = {
      openai: {
        id: 'openai' as const,
        name: 'OpenAI',
        endpoint: 'https://api.openai.com/v1',
        authType: 'api_key' as const,
      },
      anthropic: {
        id: 'anthropic' as const,
        name: 'Anthropic Claude',
        endpoint: 'https://api.anthropic.com/v1',
        authType: 'api_key' as const,
      },
      gemini: {
        id: 'gemini' as const,
        name: 'Google Gemini',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta',
        authType: 'api_key' as const,
      },
      openrouter: {
        id: 'openrouter' as const,
        name: 'OpenRouter',
        endpoint: 'https://openrouter.ai/api/v1',
        authType: 'api_key' as const,
      },
      ollama: {
        id: 'ollama' as const,
        name: 'Ollama',
        endpoint: 'http://localhost:11434/v1',
        authType: 'none' as const,
      },
      lmstudio: {
        id: 'lmstudio' as const,
        name: 'LM Studio',
        endpoint: 'http://localhost:1234/v1',
        authType: 'none' as const,
      },
    };

    return configs[providerId];
  }
}
