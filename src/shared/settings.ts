import type {
  ExtensionSettings,
  ProviderAuthMap,
  ProviderAuth,
  ProviderId,
  ProviderConfig
} from './types';
import { StorageManager } from './storage';
import { ProviderFactory } from '@/providers/provider-factory';
import { normalizeAccentColor } from './accent';

/**
 * Settings service for managing provider configurations and API keys
 */
export class SettingsService {
  private static instance: SettingsService | null = null;
  private settings: ExtensionSettings;
  private authMap: ProviderAuthMap;
  private listeners: Set<(settings: ExtensionSettings, authMap: ProviderAuthMap) => void> = new Set();

  private constructor(settings: ExtensionSettings, authMap: ProviderAuthMap) {
    this.settings = settings;
    this.authMap = authMap;
  }

  /**
   * Initialize the settings service
   */
  static async initialize(): Promise<SettingsService> {
    if (this.instance) {
      return this.instance;
    }

    const settings = await StorageManager.loadSettings();
    const authMap = await StorageManager.loadAuthMap(settings.sessionOnly);

    this.instance = new SettingsService(settings, authMap);
    return this.instance;
  }

  /**
   * Get the singleton instance
   */
  static getInstance(): SettingsService {
    if (!this.instance) {
      throw new Error('SettingsService not initialized. Call initialize() first.');
    }
    return this.instance;
  }

  /**
   * Get current settings
   */
  getSettings(): ExtensionSettings {
    return { ...this.settings };
  }

  /**
   * Get current auth map
   */
  getAuthMap(): ProviderAuthMap {
    return { ...this.authMap };
  }

  /**
   * Update settings
   */
  async updateSettings(newSettings: Partial<ExtensionSettings>): Promise<void> {
    const oldSessionOnly = this.settings.sessionOnly;
    const normalizedSettings = {
      ...newSettings,
      ...(newSettings.accentColor ? { accentColor: normalizeAccentColor(newSettings.accentColor) } : {}),
    };

    this.settings = { ...this.settings, ...normalizedSettings };

    // Handle storage mode migration
    if (newSettings.sessionOnly !== undefined && newSettings.sessionOnly !== oldSessionOnly) {
      await StorageManager.migrateAuthStorage(this.authMap, oldSessionOnly, newSettings.sessionOnly);
    }

    await StorageManager.saveSettings(this.settings);
    this.notifyListeners();
  }

  /**
   * Update provider authentication
   */
  async updateProviderAuth(providerId: ProviderId, auth: ProviderAuth | null): Promise<void> {
    if (auth === null) {
      delete this.authMap[providerId];
    } else {
      this.authMap[providerId] = auth;
    }

    await StorageManager.saveAuthMap(this.authMap, this.settings.sessionOnly);
    this.notifyListeners();
  }

  /**
   * Update multiple provider authentications
   */
  async updateAuthMap(newAuthMap: Partial<ProviderAuthMap>): Promise<void> {
    // Filter out null/undefined values and update
    Object.entries(newAuthMap).forEach(([providerId, auth]) => {
      if (auth === null || auth === undefined) {
        delete this.authMap[providerId];
      } else {
        this.authMap[providerId] = auth;
      }
    });

    await StorageManager.saveAuthMap(this.authMap, this.settings.sessionOnly);
    this.notifyListeners();
  }

  /**
   * Validate provider configuration
   */
  validateProviderConfig(providerId: ProviderId): { valid: boolean; error?: string } {
    const auth = this.authMap[providerId];
    const config = ProviderFactory.getProviderConfig(providerId);

    if (!auth && config?.authType === 'none') {
      return ProviderFactory.validateProviderConfig(providerId, { kind: 'none' });
    }

    if (!auth) {
      return { valid: false, error: 'No authentication configured' };
    }

    return ProviderFactory.validateProviderConfig(providerId, auth);
  }

  /**
   * Test provider connection
   */
  async testProviderConnection(providerId: ProviderId): Promise<{ success: boolean; error?: string }> {
    try {
      const validation = this.validateProviderConfig(providerId);
      if (!validation.valid) {
        return { success: false, error: validation.error || 'Invalid configuration' };
      }

      const auth = this.authMap[providerId];
      if (!auth) {
        return { success: false, error: 'No authentication configured' };
      }

      const provider = ProviderFactory.createProvider(providerId, auth);
      const isValid = await provider.validateAuth();

      if (isValid) {
        return { success: true };
      } else {
        return { success: false, error: 'Authentication failed' };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection test failed'
      };
    }
  }

  /**
   * Get available models for a provider
   */
  async getProviderModels(providerId: ProviderId): Promise<string[]> {
    try {
      const validation = this.validateProviderConfig(providerId);
      if (!validation.valid) {
        return [];
      }

      const config = ProviderFactory.getProviderConfig(providerId);
      const auth = this.authMap[providerId] || (config?.authType === 'none' ? { kind: 'none' as const } : undefined);
      if (!auth) {
        return [];
      }

      const provider = ProviderFactory.createProvider(providerId, auth);
      return await provider.getModels();
    } catch (error) {
      console.error(`Failed to get models for ${providerId}:`, error);
      return [];
    }
  }

  /**
   * Get configured providers
   */
  getConfiguredProviders(): ProviderId[] {
    return Object.keys(this.authMap).filter(providerId => {
      const validation = this.validateProviderConfig(providerId as ProviderId);
      return validation.valid;
    }) as ProviderId[];
  }

  /**
   * Get unconfigured providers
   */
  getUnconfiguredProviders(): ProviderId[] {
    const allProviders = ProviderFactory.getAvailableProviders();
    const configured = this.getConfiguredProviders();
    return allProviders.filter(providerId => !configured.includes(providerId));
  }

  /**
   * Check if a provider is configured and valid
   */
  isProviderConfigured(providerId: ProviderId): boolean {
    const validation = this.validateProviderConfig(providerId);
    return validation.valid;
  }

  /**
   * Get the default provider (with fallback logic)
   */
  getDefaultProvider(): ProviderId {
    // Check if the configured default provider is valid
    if (this.isProviderConfigured(this.settings.defaultProvider as ProviderId)) {
      return this.settings.defaultProvider as ProviderId;
    }

    // Fallback to first configured provider
    const configured = this.getConfiguredProviders();
    const firstConfiguredProvider = configured[0];
    if (firstConfiguredProvider) {
      return firstConfiguredProvider;
    }

    // Final fallback to OpenAI
    return 'openai';
  }

  /**
   * Get provider configuration with auth status
   */
  getProviderStatus(providerId: ProviderId): {
    configured: boolean;
    valid: boolean;
    error?: string;
    config: ProviderConfig;
  } {
    const config = ProviderFactory.getProviderConfig(providerId);
    const auth = this.authMap[providerId];
    const validation = auth ? ProviderFactory.validateProviderConfig(providerId, auth) : { valid: false };

    const result: {
      configured: boolean;
      valid: boolean;
      error?: string;
      config: ProviderConfig;
    } = {
      configured: !!auth,
      valid: validation.valid,
      config,
    };

    if (validation.error) {
      result.error = validation.error;
    }

    return result;
  }

  /**
   * Clear all authentication data
   */
  async clearAllAuth(): Promise<void> {
    this.authMap = {};
    await StorageManager.clearAuthMap();
    this.notifyListeners();
  }

  /**
   * Export settings and auth (for backup)
   */
  exportData(): { settings: ExtensionSettings; authMap: ProviderAuthMap } {
    return {
      settings: { ...this.settings },
      authMap: { ...this.authMap },
    };
  }

  /**
   * Import settings and auth (for restore)
   */
  async importData(data: {
    settings?: Partial<ExtensionSettings>;
    authMap?: ProviderAuthMap
  }): Promise<void> {
    if (data.settings) {
      await this.updateSettings(data.settings);
    }

    if (data.authMap) {
      this.authMap = { ...data.authMap };
      await StorageManager.saveAuthMap(this.authMap, this.settings.sessionOnly);
    }

    this.notifyListeners();
  }

  /**
   * Add a listener for settings changes
   */
  addListener(listener: (settings: ExtensionSettings, authMap: ProviderAuthMap) => void): void {
    this.listeners.add(listener);
  }

  /**
   * Remove a listener
   */
  removeListener(listener: (settings: ExtensionSettings, authMap: ProviderAuthMap) => void): void {
    this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of changes
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.getSettings(), this.getAuthMap());
      } catch (error) {
        console.error('Error in settings listener:', error);
      }
    });
  }

  /**
   * Get host configuration for local providers
   */
  getProviderHost(providerId: ProviderId): string | undefined {
    const auth = this.authMap[providerId];
    if (auth?.host) {
      return auth.host;
    }

    // Return default host from config
    const config = ProviderFactory.getProviderConfig(providerId);
    return config?.endpoint;
  }

  /**
   * Update host configuration for local providers
   */
  async updateProviderHost(providerId: ProviderId, host: string): Promise<void> {
    const auth = this.authMap[providerId] || { kind: 'none' };
    const trimmedHost = host.trim();

    if (trimmedHost) {
      auth.host = trimmedHost;
    } else {
      delete auth.host;
    }

    await this.updateProviderAuth(providerId, auth);
  }

  /**
   * Validate and normalize host URL
   */
  validateHost(host: string): { valid: boolean; normalized?: string; error?: string } {
    if (!host.trim()) {
      return { valid: false, error: 'Host cannot be empty' };
    }

    try {
      // Add protocol if missing
      const normalizedHost = host.startsWith('http') ? host : `http://${host}`;
      const url = new URL(normalizedHost);

      // Validate it's a reasonable host
      if (!url.hostname) {
        return { valid: false, error: 'Invalid hostname' };
      }

      return { valid: true, normalized: normalizedHost };
    } catch {
      return { valid: false, error: 'Invalid URL format' };
    }
  }
}
