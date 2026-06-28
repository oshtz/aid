// Core types for the Aid browser extension

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: ChatAttachment[];
  timestamp: number;
}

export interface ChatImageAttachment {
  id: string;
  kind: 'image';
  name: string;
  mimeType: string;
  size: number;
  dataUrl: string;
}

export type ChatAttachment = ChatImageAttachment;

export interface ChatRequest {
  id: string;
  providerId: string;
  model: string;
  messages: ChatMessage[];
  context: TabContext[];
}

export interface ChatDelta {
  id: string;
  contentPart: string;
  done: boolean;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  } | undefined;
}

export interface TabContext {
  url: string;
  title: string;
  abstract: string;
  selection?: string;
}

export interface ContextDiagnosticsTab {
  id?: number;
  windowId?: number;
  active?: boolean;
  highlighted?: boolean;
  url?: string;
  title?: string;
  lastAccessed?: number;
  status?: string;
}

export interface ContextDiagnosticsQuery {
  source: string;
  count: number;
  tabs: ContextDiagnosticsTab[];
  error?: string;
}

export interface ContextDiagnosticsContent {
  tabId: number;
  tab?: ContextDiagnosticsTab;
  pingOk?: boolean;
  injected?: boolean;
  fallback?: boolean;
  contextOk?: boolean;
  error?: string;
}

export interface ContextLookupDiagnostics {
  selectedTabIds: number[];
  selectedSource?: string;
  lastActiveTabId?: number;
  queries: ContextDiagnosticsQuery[];
  content: ContextDiagnosticsContent[];
}

export interface TabContextResponse {
  contexts: TabContext[];
  diagnostics?: ContextLookupDiagnostics;
}

export interface ProviderAuth {
  kind: 'api_key' | 'oauth' | 'none';
  value?: string; // encrypted when persisted
  host?: string; // for local providers
}

export interface ProviderAuthMap {
  [providerId: string]: ProviderAuth;
}

export interface ExtensionSettings {
  defaultProvider: string;
  defaultModels?: Partial<Record<ProviderId, string>>;
  sessionOnly: boolean;
  theme: 'light' | 'dark' | 'auto';
  accentColor: string;
}

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'ollama' | 'lmstudio';

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  endpoint: string;
  authType: 'api_key' | 'oauth' | 'none';
}

// Message types for communication between components
export type MessageType =
  | 'PING'
  | 'CHAT_REQUEST'
  | 'CHAT_DELTA'
  | 'CHAT_ERROR'
  | 'CHAT_CANCELLED'
  | 'CANCEL_CHAT_REQUEST'
  | 'GET_TAB_CONTEXT'
  | 'UPDATE_SETTINGS'
  | 'GET_SETTINGS'
  | 'SETTINGS_UPDATED'
  | 'TEST_PROVIDER'
  | 'VALIDATE_HOST'
  | 'GET_PROVIDER_MODELS'
  | 'ASK_AID_SELECTION'
  | 'EXPLAIN_SELECTION'
  | 'TRANSLATE_SELECTION'
  | 'SUMMARIZE_PAGE'
  | 'EXTRACT_KEY_POINTS'
  | 'MAKE_LIST'
  | 'OPEN_SIDE_PANEL_WITH_SELECTION';

export interface ExtensionMessage<T = unknown> {
  type: MessageType;
  payload: T;
  requestId?: string;
}

// Enhanced Chat History System Types

/**
 * Token usage tracking for conversations
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
}

/**
 * Metadata for chat conversations
 */
export interface ConversationMetadata {
  provider: string;
  model: string;
  context: TabContext[];
  messageCount: number;
  tokenUsage: TokenUsage;
  lastActivity: number;
  source: 'sidepanel' | 'quick_action' | 'context_menu';
  tags?: string[];
}

/**
 * Enhanced chat conversation interface
 */
export interface ChatConversation {
  id: string;
  title: string;
  autoTitle: boolean;
  userTitle?: string;
  tags: string[];
  messages: ChatMessage[];
  metadata: ConversationMetadata;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
  isPinned: boolean;
}

/**
 * Time-based grouping for chat history
 */
export interface ChatHistoryGroup {
  period: 'today' | 'yesterday' | 'this_week' | 'last_week' | 'this_month' | 'older';
  label: string;
  conversations: ChatConversation[];
  count: number;
}

/**
 * Search and filtering interface
 */
export interface ChatHistoryFilter {
  query?: string;
  provider?: string;
  model?: string;
  tags?: string[];
  dateRange?: {
    start: number;
    end: number;
  };
  isPinned?: boolean;
  minMessages?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'messageCount' | 'title';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Export/Import functionality
 */
export interface ChatHistoryExport {
  version: string;
  exportedAt: number;
  conversations: ChatConversation[];
  metadata: {
    totalConversations: number;
    totalMessages: number;
    dateRange: {
      start: number;
      end: number;
    };
    providers: string[];
    models: string[];
  };
}

export interface StorageUsage {
  settings: number;
  authMap: number;
  chatHistory: number;
  conversations?: number;
  totalSize?: number;
}

// Provider status types
export interface ProviderStatus {
  configured: boolean;
  valid: boolean;
  error?: string;
  config: ProviderConfig;
}

export interface ProviderTestResult {
  success: boolean;
  error?: string;
  models?: string[];
}

// Host validation types
export interface HostValidationResult {
  valid: boolean;
  normalized?: string;
  error?: string;
}

// Settings export/import types
export interface SettingsExport {
  settings: ExtensionSettings;
  authMap: ProviderAuthMap;
  version: string;
  timestamp: number;
}
