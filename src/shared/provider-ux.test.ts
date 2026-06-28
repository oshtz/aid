import { describe, expect, it } from 'vitest';
import {
  getFriendlyProviderError,
  isLikelyVisionModel,
  pickRecommendedModel,
  providerSupportsImageInput,
} from './provider-ux';

describe('provider UX helpers', () => {
  it('picks a stronger discovered default before falling back to the first model', () => {
    expect(pickRecommendedModel('openai', ['text-embedding-3-small', 'gpt-4o-mini'])).toBe('gpt-4o-mini');
    expect(pickRecommendedModel('anthropic', ['claude-haiku-4-5', 'claude-sonnet-4-6'])).toBe('claude-sonnet-4-6');
    expect(pickRecommendedModel('lmstudio', ['local-text', 'llava-v1.6'])).toBe('llava-v1.6');
    expect(pickRecommendedModel('openrouter', ['first-model'])).toBe('first-model');
  });

  it('warns for local image prompts unless the model name is probably vision-capable', () => {
    expect(isLikelyVisionModel('openai', 'gpt-5.4-mini')).toBe(true);
    expect(isLikelyVisionModel('gemini', 'gemini-3.5-flash')).toBe(true);
    expect(isLikelyVisionModel('lmstudio', 'fake-model')).toBe(false);
    expect(isLikelyVisionModel('ollama', 'llama3.2-vision')).toBe(true);
    expect(isLikelyVisionModel('openai', 'text-embedding-3-small')).toBe(false);
  });

  it('requires a vision-capable local model for image input support', () => {
    expect(providerSupportsImageInput('openai')).toBe(true);
    expect(providerSupportsImageInput('openrouter')).toBe(true);
    expect(providerSupportsImageInput('ollama')).toBe(false);
    expect(providerSupportsImageInput('lmstudio')).toBe(false);
    expect(providerSupportsImageInput('ollama', 'llama3.2-vision')).toBe(true);
    expect(providerSupportsImageInput('lmstudio', 'llava-v1.6')).toBe(true);
  });

  it('turns common provider failures into user-actionable copy', () => {
    expect(getFriendlyProviderError('Invalid content type. image_url is only supported by certain models.'))
      .toBe('This model rejected the image. Choose a vision-capable model or remove the image.');
    expect(getFriendlyProviderError('HTTP 429: Rate limit exceeded')).toBe('Provider rate limit hit. Wait a moment or switch providers.');
    expect(getFriendlyProviderError('Unknown thing')).toBe('Unknown thing');
  });
});
