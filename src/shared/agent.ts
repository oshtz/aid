import type { BrowserState } from '@page-agent/page-controller';
import type { AgentProviderId, ProviderAuth, ProviderId } from './types';
import { getLocalProviderBaseUrl } from '@/providers/openai-compatible';

export const AGENT_PROVIDER_IDS: readonly AgentProviderId[] = [
  'openai',
  'openrouter',
  'ollama',
  'lmstudio',
];

export const isAgentProviderId = (providerId: ProviderId): providerId is AgentProviderId => (
  AGENT_PROVIDER_IDS.includes(providerId as AgentProviderId)
);

export const getAgentProviderConnection = (
  providerId: AgentProviderId,
  auth: ProviderAuth
): { baseURL: string; apiKey?: string } => {
  if (providerId === 'ollama' || providerId === 'lmstudio') {
    return { baseURL: getLocalProviderBaseUrl(providerId, auth) };
  }

  const connection = {
    baseURL: providerId === 'openrouter'
      ? 'https://openrouter.ai/api/v1'
      : 'https://api.openai.com/v1',
  };

  return auth.value ? { ...connection, apiKey: auth.value.trim() } : connection;
};

export type AgentElementAction = 'click' | 'input' | 'select';
export type AgentPageAction = AgentElementAction | 'navigate';
export type AgentActionDecision = 'allow' | 'confirm' | 'block';

export interface AgentActionAssessment {
  decision: AgentActionDecision;
  action: AgentPageAction;
  index: number;
  label: string;
  reason: string;
  fingerprint: string;
}

export interface AgentNavigationAssessment extends AgentActionAssessment {
  action: 'navigate';
  targetUrl: string;
  sameOrigin: boolean;
}

export type AgentPageCommand =
  | { command: 'start'; initialUrl: string }
  | { command: 'get_browser_state' }
  | { command: 'get_last_update_time' }
  | { command: 'show_mask' }
  | { command: 'hide_mask' }
  | { command: 'clean_highlights' }
  | { command: 'cleanup' }
  | { command: 'assess_action'; action: AgentElementAction; args: unknown[] }
  | { command: 'assess_navigation'; args: unknown[] }
  | { command: 'prepare_navigation'; args: unknown[]; fingerprint: string }
  | {
      command: 'execute_action';
      action: AgentElementAction;
      args: unknown[];
      approvedFingerprint?: string;
    }
  | { command: 'scroll'; args: unknown[] }
  | { command: 'scroll_horizontally'; args: unknown[] };

export interface AgentPageControlMessage {
  type: 'AGENT_PAGE_CONTROL';
  payload: {
    runId: string;
    command: AgentPageCommand;
  };
}

export interface AgentActionResult {
  success: boolean;
  message: string;
}

export interface AgentBrowserState extends BrowserState {
  documentUrl: string;
}
