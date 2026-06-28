import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  Cloud,
  Cpu,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  Sun,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import type { ExtensionSettings, ProviderAuth, ProviderAuthMap, ProviderId } from '@/shared/types';
import { ProviderFactory } from '@/providers/provider-factory';
import { getProviderModelPresets, pickRecommendedModel } from '@/shared/provider-ux';
import {
  AID_ACCENT_STORAGE_KEY,
  ACCENT_COLOR_OPTIONS,
  DEFAULT_ACCENT_COLOR,
  applyAccentColorToDocument,
  normalizeAccentColor,
} from '@/shared/accent';
import { ensureOriginPermission } from '@/shared/permissions';

const providers: ProviderId[] = ['openai', 'anthropic', 'gemini', 'openrouter', 'ollama', 'lmstudio'];

const defaultSettings: ExtensionSettings = {
  defaultProvider: 'openai',
  defaultModels: {},
  sessionOnly: true,
  theme: 'auto',
  accentColor: DEFAULT_ACCENT_COLOR,
};

const themeOptions = [
  { value: 'auto' as const, label: 'System', Icon: Monitor },
  { value: 'light' as const, label: 'Light', Icon: Sun },
  { value: 'dark' as const, label: 'Dark', Icon: Moon },
];

export const OptionsPage: React.FC = () => {
  const [settings, setSettings] = useState<ExtensionSettings>(defaultSettings);
  const [authMap, setAuthMap] = useState<ProviderAuthMap>({});
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [testingProvider, setTestingProvider] = useState<ProviderId | null>(null);
  const [loadingModelsProvider, setLoadingModelsProvider] = useState<ProviderId | null>(null);
  const [providerModels, setProviderModels] = useState<Partial<Record<ProviderId, string[]>>>({});
  const [modelQueries, setModelQueries] = useState<Partial<Record<ProviderId, string>>>({});
  const [, setCurrentTheme] = useState<'light' | 'dark'>('dark');

  const loadSettings = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_SETTINGS',
        payload: {},
      });

      if (response.error) {
        throw new Error(response.error);
      }

      const loadedSettings: ExtensionSettings = {
        ...defaultSettings,
        ...(response.settings || {}),
        defaultModels: response.settings?.defaultModels || {},
        accentColor: normalizeAccentColor(response.settings?.accentColor),
      };
      setSettings(loadedSettings);
      setAuthMap(response.authMap || {});
      setModelQueries(loadedSettings.defaultModels || {});
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to load settings',
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
    const savedTheme = (localStorage.getItem('aid-theme') as 'light' | 'dark') || 'dark';
    setCurrentTheme(savedTheme);
    document.documentElement.setAttribute('data-theme', savedTheme);
    applyAccentColorToDocument(defaultSettings.accentColor);
  }, [loadSettings]);

  useEffect(() => {
    const theme =
      settings.theme === 'auto'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : settings.theme;

    setCurrentTheme(theme);
    localStorage.setItem('aid-theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
  }, [settings.theme]);

  useEffect(() => {
    const normalizedAccent = applyAccentColorToDocument(settings.accentColor);
    void chrome.storage.local
      .set({ [AID_ACCENT_STORAGE_KEY]: normalizedAccent })
      .catch((error) => console.warn('Failed to persist Aid accent for page actions:', error));
  }, [settings.accentColor]);

  const persistSettings = async (
    successText?: string,
    nextSettings: ExtensionSettings = settings,
    nextAuthMap: ProviderAuthMap = authMap
  ) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: { settings: nextSettings, authMap: nextAuthMap },
      });

      if (response && response.error) {
        throw new Error(response.error);
      }

      if (successText) {
        setMessage({ type: 'success', text: successText });
        setTimeout(() => setMessage(null), 3000);
      }

      return true;
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to save settings',
      });
      return false;
    }
  };

  const saveSettings = async () => {
    await persistSettings('Settings saved.', {
      ...settings,
      accentColor: normalizeAccentColor(settings.accentColor),
    });
  };

  const updateAccentColor = (accentColor: string) => {
    setSettings(prev => ({
      ...prev,
      accentColor: normalizeAccentColor(accentColor),
    }));
  };

  const isProviderReady = useCallback((providerId: ProviderId) => {
    const config = ProviderFactory.getProviderConfig(providerId);
    const auth = authMap[providerId];

    if (!config) return false;
    if (config.authType === 'none') return true;
    return Boolean(auth?.value);
  }, [authMap]);

  const configuredCount = useMemo(
    () => providers.filter(providerId => isProviderReady(providerId)).length,
    [isProviderReady]
  );

  const defaultProviderConfig = ProviderFactory.getProviderConfig(settings.defaultProvider as ProviderId);

  const updateAuth = (providerId: ProviderId, value: string) => {
    const config = ProviderFactory.getProviderConfig(providerId);
    if (!config) return;

    const trimmedValue = value.trim();
    const nextAuth: ProviderAuth = {
      kind: config.authType,
    };

    if (trimmedValue) {
      nextAuth.value = trimmedValue;
    }

    if (config.endpoint.includes('localhost')) {
      nextAuth.host = config.endpoint;
    }

    setAuthMap(prev => ({
      ...prev,
      [providerId]: nextAuth,
    }));
  };

  const updateHost = (providerId: ProviderId, host: string) => {
    const trimmedHost = host.trim();

    setAuthMap(prev => {
      const nextAuth: ProviderAuth = {
        ...(prev[providerId] || { kind: 'none' }),
        kind: prev[providerId]?.kind || 'none',
      };

      if (trimmedHost) {
        nextAuth.host = trimmedHost;
      } else {
        delete nextAuth.host;
      }

      return {
        ...prev,
        [providerId]: nextAuth,
      };
    });
  };

  const updateSelectedModel = (providerId: ProviderId, model: string) => {
    const trimmedModel = model.trim();
    setModelQueries(prev => ({ ...prev, [providerId]: model }));
    setSettings(prev => {
      const nextDefaultModels = { ...(prev.defaultModels || {}) };

      if (trimmedModel) {
        nextDefaultModels[providerId] = trimmedModel;
      } else {
        delete nextDefaultModels[providerId];
      }

      return {
        ...prev,
        defaultModels: nextDefaultModels,
      };
    });
  };

  const ensureProviderHostPermission = async (
    providerId: ProviderId,
    auth: ProviderAuth | undefined
  ): Promise<boolean> => {
    const config = ProviderFactory.getProviderConfig(providerId);
    if (!config || config.authType !== 'none') {
      return true;
    }

    const granted = await ensureOriginPermission(auth?.host || config.endpoint);
    if (!granted) {
      setMessage({ type: 'error', text: `Grant access to ${config.name}'s host before connecting.` });
    }

    return granted;
  };

  const discoverModels = async (providerId: ProviderId) => {
    const auth = authMap[providerId];
    const config = ProviderFactory.getProviderConfig(providerId);

    if (!config) {
      setMessage({ type: 'error', text: 'Provider configuration not found' });
      return [];
    }

    if (config.authType !== 'none' && (!auth || !auth.value)) {
      setMessage({ type: 'error', text: 'Enter a key or token before discovering models.' });
      return [];
    }

    if (!(await ensureProviderHostPermission(providerId, auth))) {
      return [];
    }

    setLoadingModelsProvider(providerId);

    try {
      const provider = ProviderFactory.createProvider(providerId, auth || { kind: 'none' });
      const models = await provider.getModels();
      setProviderModels(prev => ({ ...prev, [providerId]: models }));

      const recommendedModel = pickRecommendedModel(providerId, models);
      if (recommendedModel && !settings.defaultModels?.[providerId]) {
        updateSelectedModel(providerId, recommendedModel);
      }

      setMessage({
        type: models.length > 0 ? 'success' : 'info',
        text: models.length > 0 ? `${config.name} returned ${models.length} models.` : `${config.name} did not return any models.`,
      });

      return models;
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Model discovery failed',
      });
      return [];
    } finally {
      setLoadingModelsProvider(null);
    }
  };

  const testConnection = async (providerId: ProviderId) => {
    const auth = authMap[providerId];
    const config = ProviderFactory.getProviderConfig(providerId);

    if (!config) {
      setMessage({ type: 'error', text: 'Provider configuration not found' });
      return;
    }

    if (config.authType !== 'none' && (!auth || !auth.value)) {
      setMessage({ type: 'error', text: 'Enter a key or token first.' });
      return;
    }

    if (!(await ensureProviderHostPermission(providerId, auth))) {
      return;
    }

    setTestingProvider(providerId);

    try {
      const provider = ProviderFactory.createProvider(providerId, auth || { kind: 'none' });
      const isValid = await provider.validateAuth();

      if (isValid) {
        let nextSettings = settings;

        try {
          const models = await provider.getModels();
          setProviderModels(prev => ({ ...prev, [providerId]: models }));

          const recommendedModel = pickRecommendedModel(providerId, models);
          if (recommendedModel && !settings.defaultModels?.[providerId]) {
            const nextDefaultModels = {
              ...(settings.defaultModels || {}),
              [providerId]: recommendedModel,
            };
            nextSettings = {
              ...settings,
              defaultModels: nextDefaultModels,
            };
            setSettings(nextSettings);
            setModelQueries(prev => ({ ...prev, [providerId]: recommendedModel }));
          }
        } catch (modelError) {
          console.warn(`Failed to load models for ${providerId}:`, modelError);
        }

        await persistSettings(`${config.name} connection works and was saved.`, nextSettings);
      } else {
        setMessage({ type: 'error', text: `${config.name} connection failed.` });
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Connection test failed',
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const clearProvider = (providerId: ProviderId) => {
    setAuthMap(prev => {
      const nextAuthMap = { ...prev };
      delete nextAuthMap[providerId];
      return nextAuthMap;
    });
    setProviderModels(prev => {
      const nextModels = { ...prev };
      delete nextModels[providerId];
      return nextModels;
    });
    setModelQueries(prev => {
      const nextQueries = { ...prev };
      delete nextQueries[providerId];
      return nextQueries;
    });
    setSettings(prev => {
      const nextDefaultModels = { ...(prev.defaultModels || {}) };
      delete nextDefaultModels[providerId];

      return {
        ...prev,
        defaultModels: nextDefaultModels,
      };
    });
  };

  const handleOAuthFlow = async (providerId: ProviderId) => {
    if (providerId === 'gemini') {
      setMessage({
        type: 'info',
        text: 'Gemini currently uses a Google AI Studio API key or token.',
      });
    }
  };

  const clearAll = () => {
    setAuthMap({});
    setProviderModels({});
    setModelQueries({});
    setSettings(prev => ({ ...prev, defaultModels: {} }));
    setMessage({ type: 'info', text: 'All provider configuration cleared. Save to apply.' });
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <Loader2 className="spin-icon" size={18} />
        <span>Loading settings</span>
      </div>
    );
  }

  const logoUrl = chrome.runtime.getURL('icons/icon-32.png');
  const MessageIcon = message?.type === 'error' ? AlertCircle : message?.type === 'success' ? CheckCircle2 : Wifi;

  return (
    <main className="settings-shell">
      <div className="settings-frame">
        <header className="settings-header">
          <div className="brand-lockup">
            <span className="logo-frame">
              <img src={logoUrl} alt="Aid" />
            </span>
            <span>
              <span className="brand-title">Aid</span>
              <span className="brand-subtitle">Settings</span>
            </span>
          </div>

          <div className="header-actions">
            <button className="btn btn-ghost" type="button" onClick={clearAll}>
              <RotateCcw size={16} />
              Reset
            </button>
            <button className="btn btn-primary" type="button" onClick={saveSettings}>
              <Save size={16} />
              Save
            </button>
          </div>
        </header>

        {message && (
          <div className={`alert alert-${message.type}`} role="status">
            <MessageIcon size={18} />
            <span>{message.text}</span>
            <button className="icon-btn" type="button" onClick={() => setMessage(null)} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        )}

        <div className="settings-layout">
          <aside className="settings-rail">
            <section className="summary-panel">
              <div className="summary-row">
                <span>Default</span>
                <strong>{defaultProviderConfig?.name || settings.defaultProvider}</strong>
              </div>
              <div className="summary-row">
                <span>Providers</span>
                <strong>{configuredCount}/{providers.length}</strong>
              </div>
              <div className="summary-row">
                <span>Storage</span>
                <strong>{settings.sessionOnly ? 'Session' : 'Device'}</strong>
              </div>
            </section>

            <section className="setting-card">
              <div className="setting-heading">
                <ShieldCheck size={17} />
                <span>Storage</span>
              </div>
              <div className="segmented-control stacked">
                <label className={`segment-option ${settings.sessionOnly ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="storageMode"
                    checked={settings.sessionOnly}
                    onChange={() => setSettings(prev => ({ ...prev, sessionOnly: true }))}
                  />
                  <span>Session only</span>
                </label>
                <label className={`segment-option ${!settings.sessionOnly ? 'active' : ''}`}>
                  <input
                    type="radio"
                    name="storageMode"
                    checked={!settings.sessionOnly}
                    onChange={() => setSettings(prev => ({ ...prev, sessionOnly: false }))}
                  />
                  <span>Remember device</span>
                </label>
              </div>
            </section>

            <section className="setting-card">
              <div className="setting-heading">
                <SettingsIcon size={17} />
                <span>Default provider</span>
              </div>
              <select
                className="form-control"
                value={settings.defaultProvider}
                onChange={(event) => setSettings(prev => ({ ...prev, defaultProvider: event.target.value as ProviderId }))}
              >
                {providers.map(providerId => {
                  const config = ProviderFactory.getProviderConfig(providerId);
                  const isReady = isProviderReady(providerId);

                  return (
                    <option key={providerId} value={providerId} disabled={!isReady}>
                      {config?.name || providerId}{!isReady ? ' (needs key)' : ''}
                    </option>
                  );
                })}
              </select>
            </section>

            <section className="setting-card">
              <div className="setting-heading">
                <Monitor size={17} />
                <span>Theme</span>
              </div>
              <div className="segmented-control">
                {themeOptions.map(({ value, label, Icon }) => (
                  <label key={value} className={`segment-option ${settings.theme === value ? 'active' : ''}`}>
                    <input
                      type="radio"
                      name="theme"
                      checked={settings.theme === value}
                      onChange={() => setSettings(prev => ({ ...prev, theme: value }))}
                    />
                    <Icon size={15} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className="setting-card">
              <div className="setting-heading">
                <Palette size={17} />
                <span>Accent</span>
              </div>
              <div className="accent-color-panel">
                <div className="accent-color-picker-row">
                  <input
                    type="color"
                    value={normalizeAccentColor(settings.accentColor)}
                    onChange={(event) => updateAccentColor(event.target.value)}
                    aria-label="Custom accent color"
                  />
                  <input
                    type="text"
                    className="form-control"
                    value={normalizeAccentColor(settings.accentColor)}
                    readOnly
                    aria-label="Current accent color"
                  />
                </div>
                <div className="accent-swatch-grid" aria-label="Accent color presets">
                  {ACCENT_COLOR_OPTIONS.map((option) => {
                    const isSelected = normalizeAccentColor(settings.accentColor) === option.value;

                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={`accent-swatch ${isSelected ? 'active' : ''}`}
                        style={{ '--swatch-color': option.value } as React.CSSProperties}
                        onClick={() => updateAccentColor(option.value)}
                        aria-label={`Use ${option.label} accent`}
                        aria-pressed={isSelected}
                      >
                        <span aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </div>
            </section>

          </aside>

          <section className="providers-section">
            <div className="section-header">
              <div>
                <h1>Providers</h1>
                <p>Keys, hosts, and model defaults.</p>
              </div>
            </div>

            <div className="providers-grid">
              {providers.map(providerId => {
                const config = ProviderFactory.getProviderConfig(providerId);
                if (!config) return null;

                const auth = authMap[providerId];
                const isLocal = config.endpoint.includes('localhost');
                const isReady = isProviderReady(providerId);
                const models = providerModels[providerId] || [];
                const selectedModel = settings.defaultModels?.[providerId] || '';
                const modelQuery = modelQueries[providerId] ?? selectedModel;
                const normalizedModelQuery = modelQuery.trim().toLowerCase();
                const filteredModels = normalizedModelQuery
                  ? models.filter(model => model.toLowerCase().includes(normalizedModelQuery))
                  : models;
                const visibleModels = filteredModels.slice(0, 80);
                const isTesting = testingProvider === providerId;
                const isLoadingModels = loadingModelsProvider === providerId;
                const hasStoredConfig = Boolean(auth || providerModels[providerId] || selectedModel);
                const authLabel = config.authType === 'api_key' ? 'API key' : 'OAuth token';
                const ProviderIcon = isLocal ? Cpu : Cloud;
                const modelPresets = getProviderModelPresets(providerId);

                return (
                  <article key={providerId} className={`provider-card ${isReady ? 'is-ready' : ''}`}>
                    <div className="provider-topline">
                      <div className="provider-title">
                        <span className="provider-icon">
                          <ProviderIcon size={18} />
                        </span>
                        <span>
                          <strong>{config.name}</strong>
                          <small>{isLocal ? 'Local runtime' : 'Cloud endpoint'} / {config.authType === 'none' ? 'No auth' : authLabel}</small>
                        </span>
                      </div>
                      <span className={`provider-ready ${isReady ? 'active' : ''}`}>
                        {isReady ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                        {isReady ? 'Ready' : 'Needs key'}
                      </span>
                    </div>

                    <div className="provider-fields">
                      {config.authType !== 'none' && (
                        <label className="field">
                          <span className="field-label">
                            <KeyRound size={14} />
                            {authLabel}
                          </span>
                          <div className="input-action">
                            <input
                              type="password"
                              className="form-control"
                              placeholder={`${config.name} ${authLabel.toLowerCase()}`}
                              value={auth?.value || ''}
                              onChange={(event) => updateAuth(providerId, event.target.value)}
                            />
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={() => testConnection(providerId)}
                              disabled={isTesting || !auth?.value}
                            >
                              {isTesting ? <Loader2 className="spin-icon" size={15} /> : <Wifi size={15} />}
                              Test
                            </button>
                          </div>
                        </label>
                      )}

                      {config.authType === 'oauth' && (
                        <button className="inline-action" type="button" onClick={() => handleOAuthFlow(providerId)}>
                          <ShieldCheck size={15} />
                          OAuth setup
                        </button>
                      )}

                      {isLocal && (
                        <label className="field">
                          <span className="field-label">
                            <Server size={14} />
                            Host URL
                          </span>
                          <input
                            type="text"
                            className="form-control"
                            placeholder={config.endpoint}
                            value={auth?.host || ''}
                            onChange={(event) => updateHost(providerId, event.target.value)}
                          />
                        </label>
                      )}

                      <div className="field model-field">
                        <span className="field-label">
                          <SettingsIcon size={14} />
                          Model
                        </span>
                        <div className="model-picker">
                          <div className="model-search-row">
                            <div className="model-search-input">
                              <Search size={15} />
                              <input
                                className="form-control"
                                value={modelQuery}
                                placeholder="Search or enter model id"
                                onChange={(event) => {
                                  const nextModel = event.target.value;
                                  setModelQueries(prev => ({ ...prev, [providerId]: nextModel }));
                                }}
                              />
                            </div>
                            <button
                              className="btn btn-ghost"
                              type="button"
                              onClick={() => discoverModels(providerId)}
                              disabled={isLoadingModels || (config.authType !== 'none' && !auth?.value)}
                            >
                              {isLoadingModels ? <Loader2 className="spin-icon" size={15} /> : <RefreshCw size={15} />}
                              Refresh
                            </button>
                          </div>

                          <div className="model-meta-row">
                            <span>
                              {isLoadingModels
                                ? 'Contacting provider'
                                : models.length > 0
                                  ? `${filteredModels.length} of ${models.length} models`
                                  : 'No models discovered'}
                            </span>
                            {modelQuery.trim() && modelQuery.trim() !== selectedModel ? (
                              <button
                                className="model-use-custom"
                                type="button"
                                onClick={() => updateSelectedModel(providerId, modelQuery)}
                              >
                                Use typed
                              </button>
                            ) : selectedModel ? (
                              <strong>{selectedModel}</strong>
                            ) : null}
                          </div>

                          {modelPresets.length > 0 && (
                            <div className="model-preset-row" aria-label={`${config.name} suggested models`}>
                              {modelPresets.map(model => (
                                <button
                                  key={model}
                                  type="button"
                                  className={`model-preset ${model === selectedModel ? 'active' : ''}`}
                                  onClick={() => updateSelectedModel(providerId, model)}
                                >
                                  {model}
                                </button>
                              ))}
                            </div>
                          )}

                          {visibleModels.length > 0 ? (
                            <div className="model-list" role="listbox" aria-label={`${config.name} models`}>
                              {visibleModels.map(model => (
                                <button
                                  key={model}
                                  type="button"
                                  className={`model-option ${model === selectedModel ? 'active' : ''}`}
                                  onClick={() => updateSelectedModel(providerId, model)}
                                >
                                  {model}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="model-empty">
                              {models.length === 0
                                ? 'Refresh after the provider is configured, or paste a model id manually.'
                                : 'No matching models. Use the typed value as a custom model id.'}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {hasStoredConfig && (
                      <div className="provider-actions">
                        <button className="btn btn-danger" type="button" onClick={() => clearProvider(providerId)}>
                          <Trash2 size={15} />
                          Clear
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};
