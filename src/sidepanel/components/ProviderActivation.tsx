import React, { useState } from 'react';
import browser from 'webextension-polyfill';
import { Cloud, Cpu, ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { ensureOriginPermissions } from '@/shared/permissions';
import { resolveActivationModel } from '@/shared/provider-ux';
import { normalizeOpenAICompatibleBaseUrl } from '@/providers/openai-compatible';
import type { ProviderAuth, ProviderId } from '@/shared/types';

type ActivationProviderId = Extract<ProviderId, 'openrouter' | 'ollama'>;

interface ProviderActivationProps {
  defaultModels: Partial<Record<ProviderId, string>>;
  reconnectProvider?: ProviderId | undefined;
  savedModel?: string | undefined;
  savedHost?: string | undefined;
  pagePermissionTarget?: string | undefined;
  compact?: boolean | undefined;
  onConnected: (providerId: ActivationProviderId, auth: ProviderAuth, model: string) => void;
  onOpenOptions: () => void;
}

const OLLAMA_HOST = 'http://localhost:11434/v1';

export const ProviderActivation: React.FC<ProviderActivationProps> = ({
  defaultModels,
  reconnectProvider,
  savedModel,
  savedHost,
  pagePermissionTarget,
  compact = false,
  onConnected,
  onOpenOptions,
}) => {
  const inlineReconnectProvider = reconnectProvider === 'openrouter' || reconnectProvider === 'ollama'
    ? reconnectProvider
    : undefined;
  const [providerId, setProviderId] = useState<ActivationProviderId | null>(inlineReconnectProvider || null);
  const [apiKey, setApiKey] = useState('');
  const [host, setHost] = useState(savedHost || OLLAMA_HOST);
  const [manualModel, setManualModel] = useState('');
  const [models, setModels] = useState<string[]>([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (reconnectProvider && !inlineReconnectProvider) {
    return (
      <section className="provider-activation compact" aria-label="Reconnect provider">
        <h2>Reconnect {reconnectProvider}</h2>
        <p>The saved model <strong>{savedModel || 'Unknown model'}</strong> needs its session credential again.</p>
        <button type="button" className="primary-action" onClick={onOpenOptions}>Open provider settings</button>
      </section>
    );
  }

  const connect = async () => {
    if (!providerId || isConnecting) return;
    setError(null);

    let auth: ProviderAuth;
    let normalizedHost: string | undefined;
    try {
      if (providerId === 'openrouter') {
        if (!apiKey.trim()) throw new Error('Enter an OpenRouter API key.');
        auth = { kind: 'api_key', value: apiKey.trim() };
      } else {
        normalizedHost = normalizeOpenAICompatibleBaseUrl(host, OLLAMA_HOST);
        auth = { kind: 'none', host: normalizedHost };
      }
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Invalid provider settings.');
      return;
    }

    const permissionInputs = [
      ...(pagePermissionTarget ? [pagePermissionTarget] : []),
      ...(normalizedHost ? [normalizedHost] : []),
    ];
    const granted = await ensureOriginPermissions(permissionInputs);
    if (!granted) {
      setError('Aid needs access to the current page and selected local provider.');
      return;
    }

    setIsConnecting(true);
    try {
      const testResponse = await browser.runtime.sendMessage({
        type: 'TEST_PROVIDER',
        payload: { providerId, auth },
      });
      if (testResponse?.error || !testResponse?.success) {
        throw new Error(testResponse?.error || 'Provider connection failed.');
      }

      const discoveredModels = (testResponse.models || []) as string[];
      setModels(discoveredModels);
      const model = resolveActivationModel(providerId, discoveredModels, manualModel, savedModel);
      if (!model) {
        throw new Error('No models were discovered. Enter a model id, then connect again.');
      }

      const saveResponse = await browser.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: {
          settings: {
            defaultProvider: providerId,
            defaultModels: { ...defaultModels, [providerId]: model },
          },
          authMap: { [providerId]: auth },
        },
      });
      if (saveResponse?.error) throw new Error(saveResponse.error);

      setApiKey('');
      onConnected(providerId, auth, model);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : 'Provider connection failed.');
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <section className={`provider-activation ${compact ? 'compact' : ''}`} aria-label={compact ? 'Reconnect provider' : 'Set up Aid'}>
      <div className="activation-heading">
        <span className="empty-mark"><KeyRound size={22} /></span>
        <div>
          <h2>{compact ? 'Reconnect your provider' : 'Connect Aid'}</h2>
          <p>{compact ? `Restore ${savedModel || 'the saved model'} without leaving chat.` : 'Choose a cloud key or a local model. Nothing is sent until you ask.'}</p>
        </div>
      </div>

      {!inlineReconnectProvider && (
        <div className="activation-paths">
          <button type="button" className={providerId === 'openrouter' ? 'active' : ''} onClick={() => setProviderId('openrouter')}>
            <Cloud size={18} />
            <span><strong>OpenRouter</strong><small>Cloud / bring your key</small></span>
          </button>
          <button type="button" className={providerId === 'ollama' ? 'active' : ''} onClick={() => setProviderId('ollama')}>
            <Cpu size={18} />
            <span><strong>Ollama</strong><small>Local / loopback only</small></span>
          </button>
        </div>
      )}

      {providerId && (
        <div className="activation-form">
          {providerId === 'openrouter' ? (
            <label>
              <span>OpenRouter API key</span>
              <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="sk-or-..." />
            </label>
          ) : (
            <label>
              <span>Ollama loopback host</span>
              <input value={host} onChange={(event) => setHost(event.target.value)} placeholder={OLLAMA_HOST} />
            </label>
          )}

          <label>
            <span>Model id <small>optional fallback</small></span>
            <input value={manualModel} onChange={(event) => setManualModel(event.target.value)} placeholder={savedModel || 'Discover automatically or enter a model id'} />
          </label>

          {models.length > 0 && (
            <div className="activation-models" aria-label="Discovered models">
              {models.slice(0, 8).map((model) => (
                <button key={model} type="button" className={manualModel === model ? 'active' : ''} onClick={() => setManualModel(model)}>{model}</button>
              ))}
            </div>
          )}

          {error && <div className="activation-error" role="alert">{error}</div>}

          <div className="activation-actions">
            <a href={providerId === 'openrouter' ? 'https://openrouter.ai/settings/keys' : 'https://ollama.com/download'} target="_blank" rel="noreferrer">
              {providerId === 'openrouter' ? 'Get a key' : 'Install Ollama'} <ExternalLink size={13} />
            </a>
            <button type="button" className="primary-action" onClick={() => void connect()} disabled={isConnecting}>
              {isConnecting ? <><Loader2 className="spin-icon" size={15} /> Connecting</> : 'Test and connect'}
            </button>
          </div>
        </div>
      )}

      {!compact && <button type="button" className="activation-advanced" onClick={onOpenOptions}>Other providers and advanced settings</button>}
    </section>
  );
};
