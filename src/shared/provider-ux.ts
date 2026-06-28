import type { ProviderId } from './types';

export const PROVIDER_MODEL_PRESETS: Record<ProviderId, string[]> = {
  openai: ['gpt-5.4-mini', 'gpt-4o-mini', 'gpt-4.1-mini'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5'],
  gemini: ['gemini-3.5-flash', 'gemini-2.5-flash'],
  openrouter: ['openai/gpt-4o-mini', 'google/gemini-2.5-flash', 'anthropic/claude-sonnet-4-6'],
  ollama: ['llama3.2-vision', 'llava', 'gemma3'],
  lmstudio: ['llama-3.2-11b-vision-instruct', 'llava', 'gemma-3'],
};

const MODEL_PRIORITIES: Record<ProviderId, RegExp[]> = {
  openai: [/gpt-5/i, /gpt-4\.1/i, /gpt-4o/i],
  anthropic: [/sonnet/i, /haiku/i, /opus/i],
  gemini: [/gemini-3\.5-flash/i, /gemini-3/i, /gemini-2\.5-flash/i, /gemini-2\.5-pro/i],
  openrouter: [/gpt-5/i, /gpt-4o/i, /gemini-3/i, /gemini-2\.5/i, /claude.*sonnet/i],
  ollama: [/vision/i, /llava/i, /qwen.*vl/i, /gemma3/i, /gemma-3/i],
  lmstudio: [/vision/i, /llava/i, /qwen.*vl/i, /gemma3/i, /gemma-3/i],
};

const TEXT_ONLY_MODEL_PATTERN = /(?:tts|audio|embedding|moderation|rerank|whisper|transcribe|speech)/i;
const LOCAL_VISION_MODEL_PATTERN = /(?:vision|llava|bakllava|moondream|minicpm.*v|qwen.*vl|gemma-?3)/i;

export const getProviderModelPresets = (providerId: ProviderId): string[] => (
  PROVIDER_MODEL_PRESETS[providerId]
);

export const providerSupportsImageInput = (providerId: ProviderId, model = ''): boolean => (
  providerId === 'ollama' || providerId === 'lmstudio'
    ? isLikelyVisionModel(providerId, model)
    : true
);

export const pickRecommendedModel = (providerId: ProviderId, models: string[]): string | undefined => {
  if (models.length === 0) {
    return undefined;
  }

  const exactPreset = getProviderModelPresets(providerId)
    .find((preset) => models.some((model) => model.toLowerCase() === preset.toLowerCase()));
  if (exactPreset) {
    return models.find((model) => model.toLowerCase() === exactPreset.toLowerCase());
  }

  for (const pattern of MODEL_PRIORITIES[providerId]) {
    const match = models.find((model) => pattern.test(model));
    if (match) {
      return match;
    }
  }

  return models[0];
};

export const isLikelyVisionModel = (providerId: ProviderId, model: string): boolean => {
  const normalizedModel = model.trim();
  if (!normalizedModel || TEXT_ONLY_MODEL_PATTERN.test(normalizedModel)) {
    return false;
  }

  switch (providerId) {
    case 'openai':
      return /(?:gpt-5|gpt-4o|gpt-4\.1|o3|o4)/i.test(normalizedModel);
    case 'anthropic':
      return /(?:claude|sonnet|haiku|opus)/i.test(normalizedModel);
    case 'gemini':
      return /gemini/i.test(normalizedModel);
    case 'openrouter':
      return /(?:gpt-5|gpt-4o|gpt-4\.1|gemini|claude|vision|vl|llava)/i.test(normalizedModel);
    case 'ollama':
    case 'lmstudio':
      return LOCAL_VISION_MODEL_PATTERN.test(normalizedModel);
    default:
      return false;
  }
};

export const getFriendlyProviderError = (error: string): string => {
  const normalized = error.toLowerCase();

  if (normalized.includes('image_url') || normalized.includes('invalid content type') || normalized.includes('vision')) {
    return 'This model rejected the image. Choose a vision-capable model or remove the image.';
  }

  if (normalized.includes('no authentication') || normalized.includes('api key required')) {
    return 'Connect a provider in settings before sending.';
  }

  if (normalized.includes('invalid api key') || normalized.includes('authentication failed') || normalized.includes('401')) {
    return 'Provider authentication failed. Check the saved key, then test the provider again.';
  }

  if (normalized.includes('access forbidden') || normalized.includes('403')) {
    return 'Provider access was denied. Check account access, billing, and model permissions.';
  }

  if (normalized.includes('rate limit') || normalized.includes('429')) {
    return 'Provider rate limit hit. Wait a moment or switch providers.';
  }

  if (normalized.includes('model') && (normalized.includes('not found') || normalized.includes('404'))) {
    return 'The selected model was not found. Refresh models or choose another model.';
  }

  if (normalized.includes('failed to fetch') || normalized.includes('network')) {
    return 'Provider request failed. Check the provider host, browser permission, or network connection.';
  }

  if (normalized.includes('extension context invalidated')) {
    return 'The extension was reloaded. Reopen Aid and try again.';
  }

  return error;
};
