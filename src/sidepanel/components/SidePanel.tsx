import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { AgentActivity } from '@page-agent/core';
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Command,
  FileText,
  Globe2,
  History,
  ImagePlus,
  KeyRound,
  Languages,
  ListChecks,
  Menu,
  MousePointerClick,
  PanelRightOpen,
  PenLine,
  Pin,
  Plus,
  RefreshCw,
  SendHorizontal,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Wand2,
  X,
  type LucideIcon,
} from 'lucide-react';
import browser from 'webextension-polyfill';
import { QuickActions } from '@/shared/quick-actions';
import { MessageHandler } from '@/shared/message-handler';
import { ProviderFactory } from '@/providers/provider-factory';
import { ChatHistoryManager } from '@/shared/storage';
import { AID_ACCENT_STORAGE_KEY, applyAccentColorToDocument, resolveAccentColor } from '@/shared/accent';
import {
  ensureAllPagePermissions,
  ensureOriginPermission,
  ensureOriginPermissions,
  toOriginPermissionPattern,
} from '@/shared/permissions';
import { buildSavedConversation } from '@/sidepanel/conversation';
import { AidAgentRun, describeAgentActivity } from '@/sidepanel/agent-runtime';
import { sanitizeAgentReceipts } from '@/shared/agent-receipts';
import { hasReadableTabContext } from '@/shared/chat-context';
import {
  MAX_PINNED_CONTEXTS,
  sanitizePinnedContexts,
  upsertPinnedContext,
} from '@/shared/pinned-context';
import { sanitizePageUrl } from '@/shared/page-context-safety';
import {
  getAgentProviderConnection,
  isAgentProviderId,
  type AgentActionAssessment,
} from '@/shared/agent';
import {
  getFriendlyProviderError,
  getProviderModelPresets,
  isLikelyVisionModel,
  pickRecommendedModel,
  providerSupportsImageInput,
} from '@/shared/provider-ux';
import { ChatHistoryPanel } from './ChatHistoryPanel';
import { ContextInspector } from './ContextInspector';
import { MarkdownRenderer } from './MarkdownRenderer';
import { ProviderActivation } from './ProviderActivation';
import { DataDisclosure, type PageAccessChoice } from '@/shared/DataDisclosure';
import {
  DATA_DISCLOSURE_VERSION,
  hasAcceptedDataDisclosure,
} from '@/shared/disclosure';
import type {
  ProviderAuthMap,
  ProviderId,
  PanelMode,
  ExtensionSettings,
  ChatMessage,
  ChatImageAttachment,
  ChatDelta,
  TabContext,
  ChatRequest,
  ChatConversation,
  AgentRunReceipt,
  PinnedPageContext,
  ContextLookupDiagnostics,
  ContextDiagnosticsTab,
  ExtensionMessage,
} from '@/shared/types';

const AID_THEME_STORAGE_KEY = 'aid-theme';
const persistAidThemeForContentScripts = (theme: 'light' | 'dark') => {
  void browser.storage.local
    .set({ [AID_THEME_STORAGE_KEY]: theme })
    .catch((error) => console.warn('Failed to persist Aid theme for page actions:', error));
};

const persistAidAccentForContentScripts = (accentColor: string) => {
  void browser.storage.local
    .set({ [AID_ACCENT_STORAGE_KEY]: accentColor })
    .catch((error) => console.warn('Failed to persist Aid accent for page actions:', error));
};

const isAidThemeName = (value: unknown): value is 'light' | 'dark' => (
  value === 'light' || value === 'dark'
);

const resolveAidTheme = (settingsTheme?: ExtensionSettings['theme']): 'light' | 'dark' => {
  if (isAidThemeName(settingsTheme)) {
    return settingsTheme;
  }

  const storedTheme = localStorage.getItem(AID_THEME_STORAGE_KEY);
  return isAidThemeName(storedTheme) ? storedTheme : 'dark';
};

interface ChatState {
  messages: ChatMessage[];
  isLoading: boolean;
  currentStreamingId?: string;
  error?: string;
}

interface MessageWithStatus extends ChatMessage {
  status?: 'sending' | 'sent' | 'error';
}

type PanelName = 'menu' | 'tools' | 'context' | 'provider';
type QuickActionName = 'summarize' | 'translate' | 'proofread' | 'rewrite' | 'keypoints' | 'makelist';
type ContextStatus = {
  state: 'checking' | 'ready' | 'empty' | 'error';
  message: string;
  detail?: string;
};

const providerOptions: Array<{ id: ProviderId; label: string; detail: string }> = [
  { id: 'openai', label: 'OpenAI', detail: 'Cloud models' },
  { id: 'anthropic', label: 'Anthropic', detail: 'Claude models' },
  { id: 'gemini', label: 'Gemini', detail: 'Google AI' },
  { id: 'openrouter', label: 'OpenRouter', detail: 'Multi-model' },
  { id: 'ollama', label: 'Ollama', detail: 'Local host' },
  { id: 'lmstudio', label: 'LM Studio', detail: 'Local studio' },
];

const quickActions: Array<{
  id: QuickActionName;
  label: string;
  detail: string;
  needsSelection?: boolean;
  icon: LucideIcon;
}> = [
  { id: 'summarize', label: 'Summarize', detail: 'Current page', icon: FileText },
  { id: 'translate', label: 'Translate', detail: 'Selected text', icon: Languages, needsSelection: true },
  { id: 'proofread', label: 'Proofread', detail: 'Selected text', icon: CheckCircle2, needsSelection: true },
  { id: 'rewrite', label: 'Rewrite', detail: 'Selected text', icon: PenLine, needsSelection: true },
  { id: 'keypoints', label: 'Key points', detail: 'Extract ideas', icon: Sparkles },
  { id: 'makelist', label: 'Make list', detail: 'Organize content', icon: ListChecks },
];

const defaultContextStatus: ContextStatus = {
  state: 'checking',
  message: 'Checking page context',
};

const SUPPORTED_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_ATTACHMENTS = 3;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const formatBytes = (bytes: number): string => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getMessageImageAttachments = (message: ChatMessage): ChatImageAttachment[] => (
  message.attachments?.filter((attachment): attachment is ChatImageAttachment => attachment.kind === 'image') || []
);

const readImageAttachment = (file: File): Promise<ChatImageAttachment> => {
  if (!SUPPORTED_IMAGE_MIME_TYPES.includes(file.type)) {
    throw new Error('Use PNG, JPEG, or WebP images.');
  }

  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`Images must be ${formatBytes(MAX_IMAGE_BYTES)} or smaller.`);
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Could not read image.'));
        return;
      }

      resolve({
        id: `image_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        kind: 'image',
        name: file.name,
        mimeType: file.type,
        size: file.size,
        dataUrl: reader.result,
      });
    };
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(file);
  });
};

const formatContextDiagnostics = (diagnostics?: ContextLookupDiagnostics): string => {
  if (!diagnostics) {
    return 'No tab diagnostics were returned.';
  }

  if (diagnostics.selectedTabIds.length === 0) {
    const summary = diagnostics.queries
      .map((query) => `${query.source}: ${query.count}`)
      .join(', ');

    return summary
      ? `Firefox did not return an eligible http/https tab. Queries: ${summary}.`
      : 'Firefox did not return any tabs for context lookup.';
  }

  const selected = diagnostics.selectedTabIds.join(', ');
  const content = diagnostics.content[0];

  if (content?.permissionRequired) {
    return `Resolved tab ${selected}, but Aid needs permission to read this website.`;
  }

  if (content?.error) {
    return content.permissionRequired === false
      ? `Resolved tab ${selected}, but the browser blocked page context even though site access is granted. This page may be protected.`
      : `Resolved tab ${selected}, but context read failed: ${content.error}`;
  }

  if (content?.fallback) {
    const title = content.tab?.title || content.tab?.url || 'no tab title/url';
    return `Resolved tab ${selected}, but content script was unavailable. Fallback tab: ${title}`;
  }

  return `Resolved tab ${selected} via ${diagnostics.selectedSource || 'tab query'}, but no readable title, URL, or content came back.`;
};

const getContextTabCandidates = (diagnostics?: ContextLookupDiagnostics): ContextDiagnosticsTab[] => {
  if (!diagnostics) {
    return [];
  }

  const candidates = new Map<number, ContextDiagnosticsTab>();

  for (const query of diagnostics.queries) {
    for (const tab of query.tabs) {
      if (tab.id === undefined || !tab.url || !/^https?:\/\//i.test(tab.url)) {
        continue;
      }

      candidates.set(tab.id, tab);
    }
  }

  return [...candidates.values()]
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (b.lastAccessed || 0) - (a.lastAccessed || 0);
    })
    .slice(0, 5);
};

const contextReadFailed = (diagnostics?: ContextLookupDiagnostics): boolean => (
  diagnostics?.content.some((content) => content.fallback || content.error || content.pingOk === false) || false
);

const contextNeedsHostPermission = (diagnostics?: ContextLookupDiagnostics): boolean => (
  diagnostics?.content.some((content) => content.permissionRequired === true) || false
);

const hasUsableTabContext = (
  context: TabContext | null | undefined,
  diagnostics?: ContextLookupDiagnostics
): context is TabContext => {
  if (!context) {
    return false;
  }

  const hasPageContent = Boolean(context.abstract.trim() || context.selection?.trim());
  const hasTabMetadata = Boolean(context.url.trim() || context.title.trim());

  return hasPageContent || (hasTabMetadata && !contextReadFailed(diagnostics));
};

const getContextPermissionOrigin = (diagnostics?: ContextLookupDiagnostics): string | null => {
  const candidateUrls = [
    ...(diagnostics?.content.map((content) => content.tab?.url).filter(Boolean) || []),
    ...getContextTabCandidates(diagnostics).map((tab) => tab.url).filter(Boolean),
  ];

  for (const url of candidateUrls) {
    const origin = toOriginPermissionPattern(url || '');
    if (origin) {
      return origin;
    }
  }

  return null;
};

interface SettingsSnapshot {
  settings?: ExtensionSettings;
  authMap?: ProviderAuthMap;
}

const isProviderConfigured = (providerId: ProviderId, authMap: ProviderAuthMap) => {
  const config = ProviderFactory.getProviderConfig(providerId);
  const auth = authMap[providerId];

  if (!auth && config?.authType === 'none') {
    return ProviderFactory.validateProviderConfig(providerId, { kind: 'none' }).valid;
  }

  if (!auth) return false;

  return ProviderFactory.validateProviderConfig(providerId, auth).valid;
};

const resolveActiveProvider = (
  preferredProvider: ProviderId | undefined,
  authMap: ProviderAuthMap,
  currentProvider?: ProviderId
): ProviderId => {
  if (currentProvider && isProviderConfigured(currentProvider, authMap)) {
    return currentProvider;
  }

  if (preferredProvider && isProviderConfigured(preferredProvider, authMap)) {
    return preferredProvider;
  }

  const firstConfigured = providerOptions.find((provider) => isProviderConfigured(provider.id, authMap));
  return firstConfigured?.id || preferredProvider || currentProvider || 'openai';
};

const buildProviderMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const systemContent: string[] = [];
  const conversation: ChatMessage[] = [];

  for (const message of messages) {
    const status = (message as MessageWithStatus).status;
    const content = message.content.trim();
    const attachments = getMessageImageAttachments(message);

    if ((!content && attachments.length === 0) || status === 'error') {
      continue;
    }

    if (message.role === 'system') {
      systemContent.push(content);
      continue;
    }

    if (message.role === 'assistant' && conversation.length === 0) {
      continue;
    }

    const sanitizedMessage: ChatMessage = {
      id: message.id,
      role: message.role,
      content,
      timestamp: message.timestamp,
      ...(attachments.length > 0 ? { attachments } : {}),
    };

    const previousMessage = conversation[conversation.length - 1];
    if (previousMessage && previousMessage.role === sanitizedMessage.role) {
      previousMessage.content = [previousMessage.content, sanitizedMessage.content].filter(Boolean).join('\n\n');
      if (sanitizedMessage.attachments?.length) {
        previousMessage.attachments = [
          ...(previousMessage.attachments || []),
          ...sanitizedMessage.attachments,
        ];
      }
      continue;
    }

    conversation.push(sanitizedMessage);
  }

  if (systemContent.length === 0) {
    return conversation;
  }

  return [
    {
      id: `system_${Date.now()}`,
      role: 'system',
      content: systemContent.join('\n\n'),
      timestamp: Date.now(),
    },
    ...conversation,
  ];
};

export const SidePanel: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [authMap, setAuthMap] = useState<ProviderAuthMap>({});
  const [extensionSettings, setExtensionSettings] = useState<ExtensionSettings | null>(null);
  const [isAcceptingDisclosure, setIsAcceptingDisclosure] = useState(false);
  const [currentProvider, setCurrentProvider] = useState<ProviderId>('openai');
  const [currentModel, setCurrentModel] = useState<string>('');
  const [defaultModels, setDefaultModels] = useState<Partial<Record<ProviderId, string>>>({});
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chatState, setChatState] = useState<ChatState>({
    messages: [],
    isLoading: false,
  });
  const [inputValue, setInputValue] = useState('');
  const [currentContext, setCurrentContext] = useState<TabContext[]>([]);
  const [contextStatus, setContextStatus] = useState<ContextStatus>(defaultContextStatus);
  const [contextDiagnostics, setContextDiagnostics] = useState<ContextLookupDiagnostics | undefined>();
  const [isRequestingPageAccess, setIsRequestingPageAccess] = useState(false);
  const [contextAttachEnabled, setContextAttachEnabled] = useState(true);
  const [showContextInspector, setShowContextInspector] = useState(false);
  const [isRefreshingContext, setIsRefreshingContext] = useState(false);
  const [pendingImages, setPendingImages] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | undefined>();
  const [panelMode, setPanelMode] = useState<PanelMode>('chat');
  const [activeAgentRunId, setActiveAgentRunId] = useState<string | undefined>();
  const [agentStep, setAgentStep] = useState(0);
  const [agentActivity, setAgentActivity] = useState<AgentActivity | null>(null);
  const [pendingAgentApproval, setPendingAgentApproval] = useState<AgentActionAssessment | null>(null);
  const [showChatHistory, setShowChatHistory] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string | undefined>();
  const [activePanel, setActivePanel] = useState<PanelName | null>(null);
  const [providerConnectionIssue, setProviderConnectionIssue] = useState<ProviderId | null>(null);
  const [agentReceipts, setAgentReceipts] = useState<AgentRunReceipt[]>([]);
  const [pinnedContexts, setPinnedContexts] = useState<PinnedPageContext[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const activeRequestIdRef = useRef<string | undefined>(undefined);
  const agentRunRef = useRef<AidAgentRun | null>(null);
  const agentApprovalResolverRef = useRef<((approved: boolean) => void) | null>(null);
  const agentReceiptsRef = useRef<AgentRunReceipt[]>([]);

  const logoUrl = browser.runtime.getURL('icons/icon-32.png');

  const replaceAgentReceipts = useCallback((receipts: AgentRunReceipt[]) => {
    agentReceiptsRef.current = receipts;
    setAgentReceipts(receipts);
  }, []);

  const recordAgentReceipt = useCallback((receipt: AgentRunReceipt): AgentRunReceipt[] => {
    const nextReceipts = [
      ...agentReceiptsRef.current.filter((current) => current.runId !== receipt.runId),
      receipt,
    ].sort((left, right) => left.startedAt - right.startedAt);
    replaceAgentReceipts(nextReceipts);
    return nextReceipts;
  }, [replaceAgentReceipts]);

  const applyAidTheme = useCallback((nextTheme: 'light' | 'dark') => {
    localStorage.setItem(AID_THEME_STORAGE_KEY, nextTheme);
    document.documentElement.setAttribute('data-theme', nextTheme);
    persistAidThemeForContentScripts(nextTheme);
  }, []);

  const applyAidAccent = useCallback((nextAccent: string) => {
    const normalizedAccent = applyAccentColorToDocument(nextAccent);
    localStorage.setItem(AID_ACCENT_STORAGE_KEY, normalizedAccent);
    persistAidAccentForContentScripts(normalizedAccent);
  }, []);

  useEffect(() => {
    void initializePanel();
    const cleanupMessageListeners = setupMessageListeners();
    applyAidTheme(resolveAidTheme());
    applyAidAccent(resolveAccentColor());

    return cleanupMessageListeners;
    // The panel bootstraps once; listener callbacks intentionally keep the existing mount-time semantics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => {
    agentApprovalResolverRef.current?.(false);
    void agentRunRef.current?.stop();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [chatState.messages]);

  useEffect(() => {
    if (
      currentProvider &&
      !isLoading &&
      defaultModels[currentProvider]?.trim() &&
      hasAcceptedDataDisclosure(extensionSettings || undefined)
    ) {
      loadModelsForProvider(currentProvider, defaultModels[currentProvider]);
    }
    // All state read by loadModelsForProvider is listed here; the helper is intentionally render-local.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authMap, currentProvider, isLoading, defaultModels, extensionSettings]);

  const openPanel = (panel: PanelName) => {
    setActivePanel((current) => (current === panel ? null : panel));
  };

  const closePanel = () => {
    setActivePanel(null);
  };

  const initializePanel = async () => {
    try {
      if (!browser.runtime?.id) {
        throw new Error('Extension context invalidated - please reload the extension');
      }

      let response;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries) {
        try {
          response = await browser.runtime.sendMessage({
            type: 'GET_SETTINGS',
            payload: {},
          });
          break;
        } catch (error) {
          retryCount++;
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (errorMessage.includes('Could not establish connection') && retryCount < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 100 * Math.pow(2, retryCount - 1)));
            continue;
          }
          throw error;
        }
      }

      if (!response) {
        throw new Error('No response received from background script');
      }

      if (response.error) {
        throw new Error(response.error);
      }

      const nextAuthMap = response.authMap || {};
      const nextDefaultProvider = response.settings?.defaultProvider as ProviderId | undefined;
      const nextDefaultModels = response.settings?.defaultModels || {};

      setExtensionSettings(response.settings || null);
      applyAidTheme(resolveAidTheme(response.settings?.theme));
      applyAidAccent(resolveAccentColor(response.settings));
      setAuthMap(nextAuthMap);
      setDefaultModels(nextDefaultModels);
      setCurrentProvider(resolveActiveProvider(nextDefaultProvider, nextAuthMap));

      if (hasAcceptedDataDisclosure(response.settings)) {
        await updateCurrentContext();
      } else {
        setCurrentContext([]);
        setContextStatus({
          state: 'empty',
          message: 'Data disclosure required',
          detail: 'Accept the disclosure before Aid reads the active page.',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize');
    } finally {
      setIsLoading(false);
    }
  };

  const setupMessageListeners = () => {
    const listener = (message: ExtensionMessage) => {
      const isChatEvent = message.type === 'CHAT_DELTA'
        || message.type === 'CHAT_ERROR'
        || message.type === 'CHAT_CANCELLED';
      if (isChatEvent && (!message.requestId || message.requestId !== activeRequestIdRef.current)) {
        return;
      }

      switch (message.type) {
        case 'CHAT_DELTA':
          handleChatDelta(message.payload as ChatDelta);
          break;
        case 'CHAT_ERROR':
          handleChatError({
            ...(message.payload as { error: string }),
            requestId: message.requestId as string,
          });
          break;
        case 'CHAT_CANCELLED':
          handleChatCancelled({ requestId: message.requestId as string });
          break;
        case 'OPEN_SIDE_PANEL_WITH_SELECTION':
          handleSelectionAction(message.payload as { selection: string; context: TabContext });
          break;
        case 'SETTINGS_UPDATED': {
          const snapshot = message.payload as SettingsSnapshot;
          const nextAuthMap = snapshot.authMap || {};
          const nextDefaultProvider = snapshot.settings?.defaultProvider as ProviderId | undefined;
          const nextDefaultModels = snapshot.settings?.defaultModels || {};

          setExtensionSettings(snapshot.settings || null);
          applyAidTheme(resolveAidTheme(snapshot.settings?.theme));
          applyAidAccent(resolveAccentColor(snapshot.settings));
          setAuthMap(nextAuthMap);
          setDefaultModels(nextDefaultModels);
          setCurrentProvider((provider) => {
            if (
              nextDefaultProvider &&
              nextDefaultProvider !== provider &&
              isProviderConfigured(nextDefaultProvider, nextAuthMap)
            ) {
              return nextDefaultProvider;
            }

            return resolveActiveProvider(nextDefaultProvider, nextAuthMap, provider);
          });
          break;
        }
        case 'EXPLAIN_SELECTION':
          handleExplainSelection(message.payload as { selection: string; context: TabContext });
          break;
        case 'TRANSLATE_SELECTION':
          handleTranslateSelection(message.payload as { selection: string; context: TabContext });
          break;
        case 'SUMMARIZE_PAGE':
          handleSummarizePage(message.payload as { context: TabContext });
          break;
      }
    };

    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  };

  const updateCurrentContext = useCallback(async () => {
    try {
      const result = await MessageHandler.getActiveTabContextResult();
      const context = result.context;
      setContextDiagnostics(result.diagnostics);

      if (hasUsableTabContext(context, result.diagnostics)) {
        setCurrentContext([context]);
        setContextStatus({
          state: 'ready',
          message: 'Page context ready',
        });
        return;
      }

      setCurrentContext([]);
      setContextStatus({
        state: result.error ? 'error' : 'empty',
        message: result.error ? 'Page context failed' : 'Page context unavailable',
        detail: result.error || formatContextDiagnostics(result.diagnostics),
      });
    } catch (error) {
      console.warn('Failed to get current context:', error);
      setCurrentContext([]);
      setContextStatus({
        state: 'error',
        message: 'Page context failed',
        detail: error instanceof Error ? error.message : 'Unable to read the active tab.',
      });
      setContextDiagnostics(undefined);
    }
  }, []);

  const acceptDataDisclosure = async (pageAccess: PageAccessChoice): Promise<boolean> => {
    if (!extensionSettings) return false;
    setIsAcceptingDisclosure(true);

    try {
      if (pageAccess === 'all-sites' && !await ensureAllPagePermissions()) {
        return false;
      }

      const nextSettings = {
        ...extensionSettings,
        dataDisclosureVersion: DATA_DISCLOSURE_VERSION,
      };
      const response = await browser.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        payload: { settings: { dataDisclosureVersion: DATA_DISCLOSURE_VERSION } },
      });
      if (response?.error) throw new Error(response.error);

      await updateCurrentContext();
      setExtensionSettings(nextSettings);
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save disclosure choice.');
      return false;
    } finally {
      setIsAcceptingDisclosure(false);
    }
  };

  useEffect(() => {
    if (
      !isLoading &&
      hasAcceptedDataDisclosure(extensionSettings || undefined) &&
      contextStatus.message === 'Data disclosure required'
    ) {
      void updateCurrentContext();
    }
  }, [contextStatus.message, extensionSettings, isLoading, updateCurrentContext]);

  const loadContextForTab = async (tabId: number) => {
    try {
      setContextStatus({
        state: 'checking',
        message: 'Loading selected tab',
      });

      const result = await MessageHandler.getTabContextForTab(tabId);
      const context = result.context;
      setContextDiagnostics(result.diagnostics);

      if (hasUsableTabContext(context, result.diagnostics)) {
        setCurrentContext([context]);
        setContextStatus({
          state: 'ready',
          message: 'Page context ready',
        });
        return;
      }

      setCurrentContext([]);
      setContextStatus({
        state: result.error ? 'error' : 'empty',
        message: result.error ? 'Selected tab failed' : 'Selected tab unavailable',
        detail: result.error || formatContextDiagnostics(result.diagnostics),
      });
    } catch (error) {
      console.warn('Failed to load selected tab context:', error);
      setCurrentContext([]);
      setContextStatus({
        state: 'error',
        message: 'Selected tab failed',
        detail: error instanceof Error ? error.message : 'Unable to read the selected tab.',
      });
    }
  };

  const requestPageAccessAndRefresh = async (pageAccess: PageAccessChoice = 'per-site') => {
    setIsRequestingPageAccess(true);
    try {
      const allowAllSites = pageAccess === 'all-sites';
      setContextStatus({
        state: 'checking',
        message: allowAllSites ? 'Requesting website access' : 'Requesting site access',
      });

      const origin = allowAllSites ? null : getContextPermissionOrigin(contextDiagnostics);
      if (!allowAllSites && !origin) {
        setCurrentContext([]);
        setContextStatus({
          state: 'empty',
          message: 'No grantable page found',
          detail: contextDiagnostics
            ? 'Open an http or https tab, then try again.'
            : 'Refresh page context, then click Grant site access again.',
        });
        return;
      }

      const permissionRequest = allowAllSites
        ? ensureAllPagePermissions()
        : origin
          ? ensureOriginPermission(origin)
          : Promise.resolve(false);
      const granted = await permissionRequest;

      if (!granted) {
        setCurrentContext([]);
        setContextStatus({
          state: 'empty',
          message: 'Page context blocked',
          detail: allowAllSites
            ? 'Aid has not been granted access to normal websites. You can still allow only this site.'
            : `Aid has not been granted access to ${origin?.replace('/*', '') || 'this website'}.`,
        });
        return;
      }

      await updateCurrentContext();
    } catch (error) {
      console.warn('Failed to request page access:', error);
      setCurrentContext([]);
      setContextStatus({
        state: 'error',
        message: 'Site access request failed',
        detail: error instanceof Error ? error.message : 'The browser rejected the permission request.',
      });
    } finally {
      setIsRequestingPageAccess(false);
    }
  };

  useEffect(() => {
    const refresh = () => {
      if (hasAcceptedDataDisclosure(extensionSettings || undefined) && !agentRunRef.current) {
        setCurrentContext([]);
        setContextDiagnostics(undefined);
        void updateCurrentContext();
      }
    };
    const handleUpdated = (
      _tabId: number,
      changeInfo: browser.Tabs.OnUpdatedChangeInfoType,
      tab: browser.Tabs.Tab
    ) => {
      if (tab.active && (changeInfo.status === 'complete' || Boolean(changeInfo.url))) {
        refresh();
      }
    };
    const handleWindowFocus = (windowId: number) => {
      if (windowId !== browser.windows.WINDOW_ID_NONE) {
        refresh();
      }
    };

    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(handleUpdated);
    browser.windows.onFocusChanged.addListener(handleWindowFocus);
    browser.permissions?.onAdded?.addListener(refresh);
    browser.permissions?.onRemoved?.addListener(refresh);

    return () => {
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(handleUpdated);
      browser.windows.onFocusChanged.removeListener(handleWindowFocus);
      browser.permissions?.onAdded?.removeListener(refresh);
      browser.permissions?.onRemoved?.removeListener(refresh);
    };
  }, [updateCurrentContext, extensionSettings]);

  const hasSelectedText = () => {
    return currentContext.length > 0 &&
      currentContext[0]?.selection &&
      currentContext[0].selection.trim().length > 0;
  };

  const loadModelsForProvider = async (providerId: ProviderId, preferredModel?: string) => {
    setLoadingModels(true);
    try {
      const config = ProviderFactory.getProviderConfig(providerId);
      const auth = authMap[providerId] || (config?.authType === 'none'
        ? { kind: 'none' as const, host: config.endpoint }
        : undefined);
      if (!auth) {
        setAvailableModels([]);
        setCurrentModel(preferredModel || '');
        setModelSearch(preferredModel || '');
        if (preferredModel) setProviderConnectionIssue(providerId);
        return;
      }

      const response = await browser.runtime.sendMessage({
        type: 'TEST_PROVIDER',
        payload: { providerId, auth },
      });

      if (response.error || !response.success) {
        console.warn(`Failed to load models for ${providerId}:`, response.error);
        setAvailableModels([]);
        setCurrentModel(preferredModel || '');
        setModelSearch(preferredModel || '');
        if (preferredModel) setProviderConnectionIssue(providerId);
      } else {
        const models = response.models || [];
        const nextModel = preferredModel || pickRecommendedModel(providerId, models) || '';
        setAvailableModels(models);
        setCurrentModel(nextModel);
        setModelSearch(nextModel);
        setProviderConnectionIssue((current) => current === providerId ? null : current);
      }
    } catch (error) {
      console.warn(`Failed to load models for ${providerId}:`, error);
      setAvailableModels([]);
      setCurrentModel(preferredModel || '');
      setModelSearch(preferredModel || '');
      if (preferredModel) setProviderConnectionIssue(providerId);
    } finally {
      setLoadingModels(false);
    }
  };

  const handleProviderChange = async (providerId: ProviderId) => {
    if (!providerSupportsImageInput(providerId, defaultModels[providerId]) && pendingImages.length > 0) {
      setPendingImages([]);
      setAttachmentError('Select a vision-capable model to attach images.');
    }

    setCurrentProvider(providerId);
    setProviderConnectionIssue(null);
    await loadModelsForProvider(providerId, defaultModels[providerId]);
  };

  const handleModelChange = async (model: string) => {
    const nextModel = model.trim();
    if (!nextModel) return;

    setCurrentModel(nextModel);
    setModelSearch(nextModel);
    setDefaultModels(prev => ({
      ...prev,
      [currentProvider]: nextModel,
    }));

    await browser.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      payload: {
        settings: {
          defaultProvider: currentProvider,
          defaultModels: {
            ...defaultModels,
            [currentProvider]: nextModel,
          },
        },
      },
    });
  };

  const handleChatDelta = (delta: ChatDelta) => {
    setChatState((prev) => {
      const messages = [...prev.messages];
      const lastMessage = messages[messages.length - 1] as MessageWithStatus;

      if (lastMessage && lastMessage.id === delta.id && lastMessage.role === 'assistant') {
        lastMessage.content += delta.contentPart;
        lastMessage.status = delta.done ? 'sent' : 'sending';
      } else {
        const newMessage: MessageWithStatus = {
          id: delta.id,
          role: 'assistant',
          content: delta.contentPart,
          timestamp: Date.now(),
          status: delta.done ? 'sent' : 'sending',
        };
        messages.push(newMessage);
      }

      const newState: ChatState = {
        ...prev,
        messages,
        isLoading: !delta.done,
      };

      if (!delta.done) {
        newState.currentStreamingId = delta.id;
      } else {
        delete newState.currentStreamingId;
      }

      return newState;
    });
  };

  const handleChatError = (payload: { error: string; requestId?: string }) => {
    if (payload.requestId && payload.requestId !== activeRequestIdRef.current) {
      return;
    }

    const friendlyError = getFriendlyProviderError(payload.error);

    activeRequestIdRef.current = undefined;
    setActiveRequestId(undefined);
    setChatState((prev) => {
      const messages = [...prev.messages];
      const lastMessage = messages[messages.length - 1] as MessageWithStatus;

      if (lastMessage && lastMessage.role === 'user') {
        lastMessage.status = 'error';
      }

      return {
        ...prev,
        messages,
        isLoading: false,
        error: friendlyError,
      };
    });
  };

  const dismissChatError = () => {
    setChatState((prev) => {
      const nextState = { ...prev };
      delete nextState.error;
      return nextState;
    });
  };

  const handleChatCancelled = (payload: { requestId?: string }) => {
    if (payload.requestId && payload.requestId !== activeRequestIdRef.current) {
      return;
    }

    activeRequestIdRef.current = undefined;
    setActiveRequestId(undefined);
    setChatState((prev) => {
      const nextState: ChatState = {
        ...prev,
        messages: prev.messages.map((message) => {
          const messageWithStatus = message as MessageWithStatus;
          if (messageWithStatus.status !== 'sending') {
            return message;
          }

          return {
            ...message,
            status: 'sent',
          } as MessageWithStatus;
        }),
        isLoading: false,
      };

      delete nextState.currentStreamingId;
      delete nextState.error;
      return nextState;
    });
  };

  const handleSelectionAction = (payload: { selection: string; context: TabContext }) => {
    setCurrentContext([payload.context]);
    setInputValue(`Please help me understand this selected text: "${payload.selection}"`);
    inputRef.current?.focus();
  };

  const handleExplainSelection = async (_payload: { selection: string; context: TabContext }) => {
    try {
      const result = await QuickActions.explainSelection();
      await sendChatRequest(result.messages, result.context);
    } catch (error) {
      console.error('Failed to explain selection:', error);
    }
  };

  const handleTranslateSelection = async (payload: { selection: string; context: TabContext }) => {
    try {
      if (!payload.selection || payload.selection.trim().length === 0) {
        handleChatError({ error: 'Please select text to translate' });
        return;
      }

      const result = await QuickActions.translateContent();
      await sendChatRequest(result.messages, result.context);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to translate selection';
      console.error('Failed to translate selection:', error);
      handleChatError({ error: errorMessage });
    }
  };

  const handleSummarizePage = async (_payload: { context: TabContext }) => {
    try {
      const result = await QuickActions.summarisePage();
      await sendChatRequest(result.messages, result.context);
    } catch (error) {
      console.error('Failed to summarize page:', error);
    }
  };

  const refreshContextForSend = async (): Promise<TabContext[]> => {
    try {
      const result = await MessageHandler.getActiveTabContextResult();
      const context = result.context;
      setContextDiagnostics(result.diagnostics);

      if (hasUsableTabContext(context, result.diagnostics)) {
        const nextContext = [context];
        setCurrentContext(nextContext);
        setContextStatus({
          state: 'ready',
          message: 'Page context ready',
        });
        return nextContext;
      }

      setCurrentContext([]);
      setContextStatus({
        state: result.error ? 'error' : 'empty',
        message: result.error ? 'Page context failed' : 'Page context unavailable',
        detail: result.error || formatContextDiagnostics(result.diagnostics),
      });
      return [];
    } catch (error) {
      console.warn('Failed to refresh context before send:', error);
      return currentContext;
    }
  };

  const sendChatRequest = async (
    messages: ChatMessage[],
    context: TabContext[],
    options: { refreshContext?: boolean; attachContext?: boolean; includePinnedContext?: boolean } = {}
  ) => {
    if (!currentModel.trim()) {
      handleChatError({ error: 'Select or enter a model before sending.' });
      return;
    }

    setChatState((prev) => {
      const userMessages = messages.filter((m) => m.role === 'user').map((m) => ({
        ...m,
        status: 'sending',
      } as MessageWithStatus));

      const nextState: ChatState = {
        ...prev,
        messages: [...prev.messages, ...userMessages],
        isLoading: true,
      };
      delete nextState.error;
      return nextState;
    });

    const providerMessages = buildProviderMessages([...chatState.messages, ...messages]);
    if (!providerMessages.some((message) => message.role === 'user')) {
      handleChatError({ error: 'Add a user message before sending.' });
      return;
    }

    const shouldAttachContext = options.attachContext ?? true;
    const liveRequestContext = shouldAttachContext
      ? options.refreshContext ? await refreshContextForSend() : context.slice(0, 1)
      : [];
    const requestContext = shouldAttachContext ? [
      ...liveRequestContext,
      ...(options.includePinnedContext
        ? pinnedContexts.map((pin): TabContext => ({ ...pin.context, source: 'pinned' }))
        : []),
    ] : [];

    const requestId = `chat_${crypto.randomUUID()}`;
    const request: ChatRequest = {
      id: requestId,
      providerId: currentProvider,
      model: currentModel,
      messages: providerMessages,
      context: requestContext,
    };

    try {
      activeRequestIdRef.current = requestId;
      setActiveRequestId(requestId);
      if (!browser.runtime?.id) {
        throw new Error('Extension context invalidated - please reload the extension');
      }

      let response;
      let retryCount = 0;
      const maxRetries = 2;

      while (retryCount <= maxRetries) {
        try {
          response = await browser.runtime.sendMessage({
            type: 'CHAT_REQUEST',
            payload: request,
          });
          break;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          if (errorMessage.includes('Could not establish connection') && retryCount < maxRetries) {
            retryCount++;
            await new Promise((resolve) => setTimeout(resolve, 200 * Math.pow(2, retryCount - 1)));
            continue;
          }
          throw error;
        }
      }

      if (!response) {
        throw new Error('No response received from background script');
      }

      if (response.error) {
        throw new Error(response.error);
      }

      setChatState((prev) => {
        const messages = [...prev.messages];
        const userMessages = messages.filter((m) => m.role === 'user') as MessageWithStatus[];
        userMessages.forEach((msg) => {
          if (msg.status === 'sending') {
            msg.status = 'sent';
          }
        });
        return { ...prev, messages };
      });
    } catch (error) {
      handleChatError({
        error: error instanceof Error ? error.message : 'Failed to send chat request',
        requestId,
      });
    } finally {
      if (activeRequestIdRef.current === requestId) {
        activeRequestIdRef.current = undefined;
        setActiveRequestId(undefined);
      }
    }
  };

  const autoSaveConversation = useCallback(async (
    receiptsOverride?: AgentRunReceipt[],
    pinnedContextsOverride?: PinnedPageContext[]
  ) => {
    if (chatState.messages.length === 0) return;

    try {
      const conversationId = currentConversationId || `conv_${Date.now()}`;
      const existingConversation = currentConversationId
        ? await ChatHistoryManager.getConversation(currentConversationId)
        : null;
      const conversation = buildSavedConversation({
        conversationId,
        existingConversation,
        messages: chatState.messages,
        agentReceipts: receiptsOverride || agentReceipts,
        pinnedContexts: pinnedContextsOverride ?? pinnedContexts,
        provider: currentProvider,
        model: currentModel,
        context: currentContext,
        now: Date.now(),
      });
      await ChatHistoryManager.saveConversation(conversation);

      if (!currentConversationId) {
        setCurrentConversationId(conversationId);
      }
    } catch (error) {
      console.error('Failed to auto-save conversation:', error);
    }
  }, [chatState.messages, currentConversationId, currentProvider, currentModel, currentContext, agentReceipts, pinnedContexts]);

  useEffect(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    if (chatState.messages.length > 0) {
      autoSaveTimeoutRef.current = setTimeout(autoSaveConversation, 2000);
    }

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
        autoSaveTimeoutRef.current = null;
      }
    };
  }, [chatState.messages, autoSaveConversation]);

  const handleConversationSelect = useCallback(async (conversation: ChatConversation) => {
    try {
      if (chatState.messages.length > 0 && currentConversationId) {
        await autoSaveConversation();
      }

      setChatState({
        messages: conversation.messages,
        isLoading: false,
      });

      setCurrentConversationId(conversation.id);
      setCurrentProvider(conversation.metadata.provider as ProviderId);
      setCurrentModel(conversation.metadata.model);
      setCurrentContext([]);
      setPinnedContexts(sanitizePinnedContexts(conversation.metadata.pinnedContexts));
      replaceAgentReceipts(sanitizeAgentReceipts(conversation.agentReceipts));
      setPendingImages([]);
      setAttachmentError(null);
      setShowChatHistory(false);
      await updateCurrentContext();

      await ChatHistoryManager.updateConversation(conversation.id, {
        isActive: true,
        updatedAt: Date.now(),
      });
    } catch (error) {
      console.error('Failed to load conversation:', error);
    }
  }, [chatState.messages, currentConversationId, autoSaveConversation, replaceAgentReceipts, updateCurrentContext]);

  const requestAgentApproval = (assessment: AgentActionAssessment): Promise<boolean> => {
    agentApprovalResolverRef.current?.(false);
    setPendingAgentApproval(assessment);

    return new Promise((resolve) => {
      agentApprovalResolverRef.current = resolve;
    });
  };

  const resolveAgentApproval = (approved: boolean) => {
    const resolve = agentApprovalResolverRef.current;
    agentApprovalResolverRef.current = null;
    setPendingAgentApproval(null);
    resolve?.(approved);
  };

  const handleAgentTask = async () => {
    const task = inputValue.trim();
    if (!task || chatState.isLoading || !isAgentProviderId(currentProvider)) {
      return;
    }

    const auth = authMap[currentProvider] || { kind: 'none' as const };
    let userMessageQueued = false;
    let run: AidAgentRun | null = null;

    try {
      const connection = getAgentProviderConnection(currentProvider, auth);
      const pagePermissionTarget = getContextPermissionOrigin(contextDiagnostics)
        || currentContext[0]?.url;
      if (!pagePermissionTarget) {
        throw new Error('Refresh page context before starting Agent mode.');
      }

      const access = await ensureOriginPermissions([
        pagePermissionTarget,
        connection.baseURL,
      ]);
      if (!access) {
        throw new Error('Agent mode needs access to the active page and selected provider.');
      }

      const contextResult = await MessageHandler.getActiveTabContextResult();
      if (contextResult.error) {
        throw new Error(contextResult.error);
      }
      const tabId = contextResult.diagnostics?.selectedTabIds[0];
      if (tabId === undefined) {
        throw new Error('Open an http or https page before starting Agent mode.');
      }

      const tab = await browser.tabs.get(tabId);
      if (!tab.url || !/^https?:\/\//i.test(tab.url)) {
        throw new Error('Agent mode only works on http or https pages.');
      }

      await MessageHandler.getTabContextForTab(tabId);

      const userMessage: MessageWithStatus = {
        id: `user_${Date.now()}`,
        role: 'user',
        content: task,
        timestamp: Date.now(),
        status: 'sent',
      };

      setInputValue('');
      setPendingImages([]);
      setAttachmentError(null);
      setAgentStep(0);
      setAgentActivity({ type: 'thinking' });
      setChatState((previous) => {
        const nextState: ChatState = {
          ...previous,
          messages: [...previous.messages, userMessage],
          isLoading: true,
        };
        delete nextState.error;
        return nextState;
      });
      userMessageQueued = true;

      run = new AidAgentRun({
        tabId,
        initialUrl: tab.url,
        initialTitle: tab.title || contextResult.context?.title || 'Untitled page',
        taskMessageId: userMessage.id,
        providerId: currentProvider,
        auth,
        model: currentModel,
        onActivity: setAgentActivity,
        onStep: setAgentStep,
        onApproval: requestAgentApproval,
        onInterrupted: () => resolveAgentApproval(false),
      });
      agentRunRef.current = run;
      setActiveAgentRunId(run.id);

      const result = await run.execute(task);
      if (agentRunRef.current !== run) {
        return;
      }

      const assistantMessage: ChatMessage = {
        id: `assistant_${Date.now()}`,
        role: 'assistant',
        content: result.data || (result.success
          ? 'The task is complete.'
          : 'The agent could not complete the task.'),
        timestamp: Date.now(),
      };
      setChatState((previous) => ({
        ...previous,
        messages: [...previous.messages, assistantMessage],
        isLoading: false,
      }));
      recordAgentReceipt(run.createReceipt(result.success ? 'completed' : 'failed'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Agent mode failed.';
      if (run && agentRunRef.current !== run) return;
      if (run) recordAgentReceipt(run.createReceipt(run.wasInterrupted ? 'stopped' : 'failed'));
      if (userMessageQueued) {
        handleChatError({ error: errorMessage });
      } else {
        setChatState((previous) => ({
          ...previous,
          isLoading: false,
          error: getFriendlyProviderError(errorMessage),
        }));
      }
    } finally {
      agentApprovalResolverRef.current?.(false);
      agentApprovalResolverRef.current = null;
      setPendingAgentApproval(null);
      setAgentActivity(null);
      setActiveAgentRunId(undefined);
      if (!run || agentRunRef.current === run) agentRunRef.current = null;
    }
  };

  const handleNewChat = useCallback(async () => {
    try {
      agentApprovalResolverRef.current?.(false);
      agentApprovalResolverRef.current = null;
      const activeRun = agentRunRef.current;
      agentRunRef.current = null;
      let stoppedReceipts: AgentRunReceipt[] | undefined;
      if (activeRun) {
        await activeRun.stop();
        stoppedReceipts = recordAgentReceipt(activeRun.createReceipt('stopped'));
      }
      setActiveAgentRunId(undefined);
      setPendingAgentApproval(null);
      setAgentActivity(null);

      if (chatState.messages.length > 0 && currentConversationId) {
        await autoSaveConversation(stoppedReceipts);
        await ChatHistoryManager.updateConversation(currentConversationId, {
          isActive: false,
        });
      }

      setChatState({
        messages: [],
        isLoading: false,
      });

      setCurrentConversationId(undefined);
      replaceAgentReceipts([]);
      setPinnedContexts([]);
      setPendingImages([]);
      setAttachmentError(null);
      setShowChatHistory(false);
      closePanel();
    } catch (error) {
      console.error('Failed to start new chat:', error);
    }
  }, [chatState.messages, currentConversationId, autoSaveConversation, recordAgentReceipt, replaceAgentReceipts]);

  const handleImageFilesSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';

    if (!providerSupportsImageInput(currentProvider, currentModel)) {
      setAttachmentError('Select a vision-capable model to attach images.');
      return;
    }

    if (files.length === 0) {
      return;
    }

    const slots = MAX_IMAGE_ATTACHMENTS - pendingImages.length;
    if (slots <= 0) {
      setAttachmentError(`Attach up to ${MAX_IMAGE_ATTACHMENTS} images.`);
      return;
    }

    try {
      const images = await Promise.all(files.slice(0, slots).map(readImageAttachment));
      setPendingImages((current) => [...current, ...images]);
      setAttachmentError(files.length > slots ? `Added ${slots} images. Max ${MAX_IMAGE_ATTACHMENTS}.` : null);
    } catch (error) {
      setAttachmentError(error instanceof Error ? error.message : 'Could not attach image.');
    }
  };

  const handleRemovePendingImage = (id: string) => {
    setPendingImages((current) => current.filter((image) => image.id !== id));
    setAttachmentError(null);
  };

  const handleSendMessage = async () => {
    if (panelMode === 'agent') {
      await handleAgentTask();
      return;
    }

    const content = inputValue.trim();
    if ((!content && pendingImages.length === 0) || chatState.isLoading) return;
    if (pendingImages.length > 0 && !providerSupportsImageInput(currentProvider, currentModel)) {
      setAttachmentError('Select a vision-capable model to attach images.');
      return;
    }

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      content: content || 'Analyze this image.',
      timestamp: Date.now(),
      ...(pendingImages.length > 0 ? { attachments: pendingImages } : {}),
    };

    setInputValue('');
    setPendingImages([]);
    setAttachmentError(null);
    await sendChatRequest([userMessage], currentContext, {
      refreshContext: contextAttachEnabled,
      attachContext: contextAttachEnabled,
      includePinnedContext: true,
    });
  };

  const handleStopGenerating = async () => {
    const agentRun = agentRunRef.current;
    if (agentRun) {
      agentRunRef.current = null;
      resolveAgentApproval(false);
      await agentRun.stop();
      recordAgentReceipt(agentRun.createReceipt('stopped'));
      setActiveAgentRunId(undefined);
      setAgentActivity(null);
      setChatState((previous) => ({ ...previous, isLoading: false }));
      return;
    }

    const requestId = activeRequestId;
    if (!requestId) {
      return;
    }

    handleChatCancelled({ requestId });

    try {
      await browser.runtime.sendMessage({
        type: 'CANCEL_CHAT_REQUEST',
        payload: { requestId },
      });
    } catch (error) {
      console.warn('Failed to cancel active chat request:', error);
    }
  };

  const handleRegenerateLast = async () => {
    if (chatState.isLoading) {
      return;
    }

    const lastUserMessage = [...chatState.messages].reverse().find((message) => message.role === 'user');
    if (!lastUserMessage) {
      return;
    }

    await sendChatRequest([
      {
        ...lastUserMessage,
        id: `user_${Date.now()}`,
        timestamp: Date.now(),
      },
    ], currentContext, {
      refreshContext: contextAttachEnabled,
      attachContext: contextAttachEnabled,
      includePinnedContext: true,
    });
  };

  const handleRefreshContextInspector = async () => {
    setIsRefreshingContext(true);
    try {
      await refreshContextForSend();
      setShowContextInspector(true);
    } finally {
      setIsRefreshingContext(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleQuickAction = async (action: QuickActionName) => {
    try {
      closePanel();

      switch (action) {
        case 'summarize': {
          const [context] = await refreshContextForSend();
          if (!context) {
            throw new Error('No page context available to summarize.');
          }

          const summarizeResult = await QuickActions.summarisePageWithContext(context);
          await sendChatRequest(summarizeResult.messages, summarizeResult.context);
          break;
        }
        case 'translate': {
          const [context] = await refreshContextForSend();
          if (!context) {
            throw new Error('No selected page text available to translate.');
          }

          const translateResult = await QuickActions.translateContentWithContext(context);
          await sendChatRequest(translateResult.messages, translateResult.context);
          break;
        }
        case 'proofread': {
          const [context] = await refreshContextForSend();
          if (!context) {
            throw new Error('No selected page text available to proofread.');
          }

          const proofreadResult = await QuickActions.proofreadContentWithContext(context);
          await sendChatRequest(proofreadResult.messages, proofreadResult.context);
          break;
        }
        case 'rewrite': {
          const [context] = await refreshContextForSend();
          if (!context) {
            throw new Error('No selected page text available to rewrite.');
          }

          const rewriteResult = await QuickActions.rewriteContentWithContext(context);
          await sendChatRequest(rewriteResult.messages, rewriteResult.context);
          break;
        }
        case 'keypoints': {
          const [context] = await refreshContextForSend();
          if (!context) {
            throw new Error('No page context available for key points.');
          }

          const keyPointsResult = await QuickActions.extractKeyPointsWithContext(context);
          await sendChatRequest(keyPointsResult.messages, keyPointsResult.context);
          break;
        }
        case 'makelist': {
          const [context] = await refreshContextForSend();
          if (!context) {
            throw new Error('No page context available to organize.');
          }

          const makeListResult = await QuickActions.makeListWithContext(context);
          await sendChatRequest(makeListResult.messages, makeListResult.context);
          break;
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : `Failed to execute ${action} action`;
      console.error(`Failed to execute ${action} action:`, error);
      handleChatError({ error: errorMessage });
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const openSettings = () => {
    closePanel();
    setShowChatHistory(false);
    void browser.runtime.openOptionsPage();
  };

  const handlePinCurrentPage = async () => {
    const [context] = await refreshContextForSend();
    if (!hasReadableTabContext(context)) return;
    const nextPinnedContexts = upsertPinnedContext(
      pinnedContexts,
      context,
      Date.now(),
      `pin_${crypto.randomUUID()}`
    );
    if (nextPinnedContexts === pinnedContexts) return;
    setPinnedContexts(nextPinnedContexts);
    if (currentConversationId) void autoSaveConversation(undefined, nextPinnedContexts);
  };

  const handleRemovePinnedContext = (id: string) => {
    const nextPinnedContexts = pinnedContexts.filter((pin) => pin.id !== id);
    setPinnedContexts(nextPinnedContexts);
    if (currentConversationId) void autoSaveConversation(undefined, nextPinnedContexts);
  };

  const handleProviderConnected = async (
    providerId: Extract<ProviderId, 'openrouter' | 'ollama'>,
    auth: ProviderAuthMap[string],
    model: string
  ) => {
    setAuthMap((current) => ({ ...current, [providerId]: auth }));
    setDefaultModels((current) => ({ ...current, [providerId]: model }));
    setCurrentProvider(providerId);
    setCurrentModel(model);
    setModelSearch(model);
    setProviderConnectionIssue(null);
    await updateCurrentContext();
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handlePanelModeChange = (mode: PanelMode) => {
    if (chatState.isLoading || mode === panelMode) {
      return;
    }
    setPanelMode(mode);
    if (mode === 'agent') {
      setPendingImages([]);
      setAttachmentError(null);
      setShowContextInspector(false);
    }
  };

  const renderMessageStatus = (message: MessageWithStatus) => {
    if (!message.status || message.role !== 'user') return null;

    return (
      <div className="message-status">
        <span className={`status-dot status-${message.status}`} />
        <span>
          {message.status === 'sending' && 'Sending'}
          {message.status === 'sent' && 'Sent'}
          {message.status === 'error' && 'Failed'}
        </span>
      </div>
    );
  };

  const hasAuth = (() => {
    return isProviderConfigured(currentProvider, authMap);
  })();

  const usableProvider = providerOptions.find(({ id }) => (
    Boolean(defaultModels[id]?.trim()) && isProviderConfigured(id, authMap)
  ));
  const savedProvider = extensionSettings?.defaultProvider as ProviderId | undefined;
  const savedModel = savedProvider ? defaultModels[savedProvider] : undefined;
  const reconnectProvider = providerConnectionIssue || (
    savedProvider && savedModel && !isProviderConfigured(savedProvider, authMap)
      ? savedProvider
      : null
  );
  const reconnectModel = reconnectProvider ? defaultModels[reconnectProvider] : undefined;
  const reconnectAuth = reconnectProvider ? authMap[reconnectProvider] : undefined;
  const reconnectHost = reconnectAuth?.kind === 'none' ? reconnectAuth.host : undefined;
  const needsReconnect = Boolean(reconnectProvider && reconnectModel);

  const currentProviderConfig = ProviderFactory.getProviderConfig(currentProvider);
  const currentPage = currentContext[0];
  const attachedContexts = [
    ...currentContext.slice(0, 1),
    ...pinnedContexts.map((pin): TabContext => ({ ...pin.context, source: 'pinned' })),
  ];
  const currentPageUrl = sanitizePageUrl(currentPage?.url);
  const currentPagePin = currentPageUrl
    ? pinnedContexts.find((pin) => pin.context.url === currentPageUrl)
    : undefined;
  const pinLimitReached = pinnedContexts.length >= MAX_PINNED_CONTEXTS && !currentPagePin;
  const normalizedModelSearch = modelSearch.trim().toLowerCase();
  const filteredModels = normalizedModelSearch
    ? availableModels.filter((model) => model.toLowerCase().includes(normalizedModelSearch))
    : availableModels;
  const visibleModels = filteredModels.slice(0, 60);
  const selectedText = currentPage?.selection?.trim();
  const contextLabel = selectedText
    ? 'Selection attached'
    : pinnedContexts.length > 0
      ? `${attachedContexts.length} ${attachedContexts.length === 1 ? 'page' : 'pages'} attached`
      : currentPage?.title
      ? 'Page context ready'
      : 'No page context';
  const agentProviderSupported = isAgentProviderId(currentProvider);
  const canRegenerate = panelMode === 'chat' && !chatState.isLoading && chatState.messages.some((message) => message.role === 'user');
  const canAttachImages = panelMode === 'chat' && providerSupportsImageInput(currentProvider, currentModel);
  const canSendMessage = Boolean(
    (panelMode === 'agent'
      ? inputValue.trim() && agentProviderSupported
      : inputValue.trim() || (pendingImages.length > 0 && canAttachImages)) &&
    hasAuth &&
    currentModel
  );
  const inputPlaceholder = !hasAuth
    ? 'Connect a provider first'
    : !currentModel
      ? 'Select a model first'
      : panelMode === 'agent'
        ? agentProviderSupported
          ? 'Tell Aid what to do on this page...'
          : 'Agent mode supports OpenAI-compatible providers'
        : 'Ask about this page...';
  const providerModelPresets = getProviderModelPresets(currentProvider);
  const suggestedModel = providerModelPresets[0];
  const shouldShowImageModelWarning = Boolean(
    pendingImages.length > 0 &&
    canAttachImages &&
    currentModel.trim() &&
    !isLikelyVisionModel(currentProvider, currentModel)
  );
  const needsHostPermission = contextNeedsHostPermission(contextDiagnostics);
  const isContextUnavailable = attachedContexts.length === 0 &&
    (contextStatus.state === 'empty' || contextStatus.state === 'error' || isRequestingPageAccess);

  const renderEmptyState = () => {
    if (needsReconnect && reconnectProvider) {
      return (
        <div className="chat-empty activation-empty reconnect-empty">
          <ProviderActivation
            defaultModels={defaultModels}
            reconnectProvider={reconnectProvider}
            savedModel={reconnectModel}
            savedHost={reconnectHost}
            pagePermissionTarget={getContextPermissionOrigin(contextDiagnostics) || currentContext[0]?.url}
            compact
            onConnected={(providerId, auth, model) => void handleProviderConnected(providerId, auth, model)}
            onOpenOptions={openSettings}
          />
        </div>
      );
    }

    if (!usableProvider) {
      return (
        <div className="chat-empty activation-empty">
          <ProviderActivation
            defaultModels={defaultModels}
            pagePermissionTarget={getContextPermissionOrigin(contextDiagnostics) || currentContext[0]?.url}
            onConnected={(providerId, auth, model) => void handleProviderConnected(providerId, auth, model)}
            onOpenOptions={openSettings}
          />
        </div>
      );
    }

    if (!hasAuth) {
      return (
        <div className="chat-empty">
          <div className="empty-mark">
            <KeyRound size={24} />
          </div>
          <h2>Connect a provider</h2>
          <p>{currentProviderConfig?.name || currentProvider} needs credentials before Aid can answer.</p>
          <div className="empty-actions">
            <button className="primary-action" onClick={openSettings}>
              Configure keys
            </button>
            <button className="ghost-action" onClick={() => openPanel('provider')}>
              Change provider
            </button>
          </div>
        </div>
      );
    }

    if (panelMode === 'agent' && !agentProviderSupported) {
      return (
        <div className="chat-empty">
          <div className="empty-mark">
            <MousePointerClick size={24} />
          </div>
          <h2>Choose an agent provider</h2>
          <p>Agent mode supports OpenAI, OpenRouter, Ollama, and LM Studio models with tool calling.</p>
          <div className="empty-actions">
            <button className="primary-action" onClick={() => openPanel('provider')}>
              Change provider
            </button>
            <button className="ghost-action" onClick={() => handlePanelModeChange('chat')}>
              Return to chat
            </button>
          </div>
        </div>
      );
    }

    if (!currentModel.trim()) {
      return (
        <div className="chat-empty">
          <div className="empty-mark">
            <SlidersHorizontal size={24} />
          </div>
          <h2>Select a model</h2>
          <p>{currentProviderConfig?.name || currentProvider} is configured. Discover models or enter a model id.</p>
          <div className="empty-actions">
            {suggestedModel && (
              <button className="primary-action" onClick={() => handleModelChange(suggestedModel)}>
                Use suggested
              </button>
            )}
            <button className={suggestedModel ? 'ghost-action' : 'primary-action'} onClick={() => openPanel('provider')}>
              Choose model
            </button>
            <button className="ghost-action" onClick={() => loadModelsForProvider(currentProvider)}>
              Refresh models
            </button>
          </div>
        </div>
      );
    }

    if (isContextUnavailable) {
      return (
        <div className="chat-empty">
          <div className="empty-mark">
            <Globe2 size={24} />
          </div>
          <h2>Page context unavailable</h2>
          <p>{contextStatus.detail || 'Aid can still answer without page context.'}</p>
          <div className="empty-actions">
            {needsHostPermission ? (
              <>
                <button
                  className="primary-action"
                  onClick={() => void requestPageAccessAndRefresh('all-sites')}
                  disabled={isRequestingPageAccess}
                >
                  {isRequestingPageAccess ? 'Waiting for browser' : 'Allow on all websites'}
                </button>
                <button
                  className="ghost-action"
                  onClick={() => void requestPageAccessAndRefresh('per-site')}
                  disabled={isRequestingPageAccess}
                >
                  Allow this website
                </button>
              </>
            ) : (
              <button className="primary-action" onClick={() => void updateCurrentContext()}>
                Refresh
              </button>
            )}
            <button className="ghost-action" onClick={() => inputRef.current?.focus()}>
              Ask anyway
            </button>
          </div>
        </div>
      );
    }

    if (panelMode === 'agent') {
      return (
        <div className="chat-empty">
          <div className="empty-mark">
            <MousePointerClick size={24} />
          </div>
          <h2>Operate this page</h2>
          <p>Aid can inspect, scroll, type, and click. Links and sensitive fields are blocked; navigation or switching tabs stops the run.</p>
          <div className="prompt-chips">
            <button onClick={() => setInputValue('Open the filters and select the most relevant option')}>
              Adjust a filter
            </button>
            <button onClick={() => setInputValue('Fill the visible form fields using the information I provide')}>
              Fill a form
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="chat-empty">
        <div className="empty-mark">
          <Bot size={24} />
        </div>
        <h2 aria-label="Start with the page in front of you.">
          <span className="empty-heading-line">Start with the page</span>
          <span className="empty-heading-line">in front of you.</span>
        </h2>
        <p>Ask a question, use the current selection, or open tools for a focused writing action.</p>
        <div className="prompt-chips">
          <button onClick={() => handleQuickAction('summarize')}>
            Summarize this page
          </button>
          <button onClick={() => openPanel('context')}>
            View context
          </button>
          <button onClick={() => openPanel('tools')}>
            Open tools
          </button>
        </div>
      </div>
    );
  };

  const renderPanel = () => {
    if (!activePanel) return null;

    if (activePanel === 'menu') {
      return (
        <aside className="floating-panel command-panel" aria-label="Command menu">
          <PanelHeader title="Command" onClose={closePanel} icon={Command} />
          <div className="command-list">
            <button onClick={() => openPanel('tools')}>
              <Wand2 size={18} />
              <span>
                <strong>Writing tools</strong>
                <small>Summarize, rewrite, translate</small>
              </span>
            </button>
            <button onClick={() => openPanel('context')}>
              <ClipboardList size={18} />
              <span>
                <strong>Page context</strong>
                <small>{contextLabel}</small>
              </span>
            </button>
            <button onClick={() => {
              closePanel();
              setShowChatHistory(true);
            }}>
              <History size={18} />
              <span>
                <strong>History</strong>
                <small>Open saved conversations</small>
              </span>
            </button>
            <button onClick={() => openPanel('provider')}>
              <SlidersHorizontal size={18} />
              <span>
                <strong>Provider</strong>
                <small>{currentProviderConfig?.name || currentProvider} / {currentModel || 'No model selected'}</small>
              </span>
            </button>
            <button onClick={openSettings}>
              <Settings size={18} />
              <span>
                <strong>Settings</strong>
                <small>Keys, models, storage, theme</small>
              </span>
            </button>
          </div>
        </aside>
      );
    }

    if (activePanel === 'tools') {
      return (
        <aside className="floating-panel" aria-label="Writing tools">
          <PanelHeader title="Writing tools" onClose={closePanel} icon={Wand2} />
          <div className="tool-grid">
            {quickActions.map((action) => {
              const Icon = action.icon;
              const disabled = chatState.isLoading || (action.needsSelection && !hasSelectedText());

              return (
                <button
                  key={action.id}
                  className="tool-card"
                  onClick={() => handleQuickAction(action.id)}
                  disabled={disabled}
                  title={action.needsSelection && !hasSelectedText() ? 'Select text on the page first' : action.label}
                >
                  <span className="tool-icon"><Icon size={18} /></span>
                  <span>
                    <strong>{action.label}</strong>
                    <small>{action.detail}</small>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      );
    }

    if (activePanel === 'context') {
      return (
        <aside className="floating-panel" aria-label="Current context">
          <PanelHeader title="Context" onClose={closePanel} icon={ClipboardList} />
          <div className="context-panel">
            {currentPage ? (
              <div className="context-card live-context-card">
                <div className="context-card-head">
                  <span className="context-card-badge">Live</span>
                  <button
                    type="button"
                    className="context-card-action"
                    onClick={() => void handlePinCurrentPage()}
                    disabled={pinLimitReached}
                    title={pinLimitReached ? `Remove a pinned page before adding another (max ${MAX_PINNED_CONTEXTS}).` : undefined}
                  >
                    <Pin size={12} />
                    {currentPagePin ? 'Repin page' : 'Pin page'}
                  </button>
                </div>
                <div className="context-card-title">{currentPage.title || 'Untitled page'}</div>
                <div className="context-card-url">{currentPage.url}</div>
                {currentPage.selection && (
                  <blockquote>
                    {currentPage.selection.length > 260 ? `${currentPage.selection.substring(0, 260)}...` : currentPage.selection}
                  </blockquote>
                )}
              </div>
            ) : (
              <div className="panel-empty context-empty" aria-live="polite">
                <Globe2 size={20} />
                <span>{contextStatus.message}</span>
                {contextStatus.detail && <small>{contextStatus.detail}</small>}
                {getContextTabCandidates(contextDiagnostics).length > 0 && (
                  <div className="context-candidates">
                    {getContextTabCandidates(contextDiagnostics).map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        className="context-candidate"
                        onClick={() => tab.id !== undefined && void loadContextForTab(tab.id)}
                      >
                        <strong>{tab.title || 'Untitled tab'}</strong>
                        <small>{tab.url}</small>
                      </button>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  className={needsHostPermission ? 'primary-action context-refresh' : 'secondary-action context-refresh'}
                  onClick={() => void (needsHostPermission
                    ? requestPageAccessAndRefresh('all-sites')
                    : updateCurrentContext())}
                  disabled={isRequestingPageAccess || contextStatus.state === 'checking'}
                >
                  {needsHostPermission ? <KeyRound size={14} /> : <RefreshCw size={14} />}
                  {isRequestingPageAccess ? 'Waiting for browser' : needsHostPermission ? 'Allow on all websites' : 'Refresh'}
                </button>
                {needsHostPermission && (
                  <button
                    type="button"
                    className="secondary-action context-refresh"
                    onClick={() => void requestPageAccessAndRefresh('per-site')}
                    disabled={isRequestingPageAccess || contextStatus.state === 'checking'}
                  >
                    <KeyRound size={14} />
                    Allow this website
                  </button>
                )}
              </div>
            )}
            {pinnedContexts.length > 0 && (
              <div className="pinned-contexts" aria-label="Pinned page snapshots">
                <div className="context-section-head">
                  <strong>Pinned snapshots</strong>
                  <small>{pinnedContexts.length}/{MAX_PINNED_CONTEXTS}</small>
                </div>
                {pinnedContexts.map((pin) => (
                  <div key={pin.id} className="context-card pinned-context-card">
                    <div className="context-card-head">
                      <span className="context-card-badge">Snapshot</span>
                      <button
                        type="button"
                        className="context-card-action"
                        onClick={() => handleRemovePinnedContext(pin.id)}
                      >
                        <X size={12} />
                        Remove pin
                      </button>
                    </div>
                    <div className="context-card-title">{pin.context.title || 'Untitled page'}</div>
                    <div className="context-card-url">{pin.context.url}</div>
                    <small className="context-captured-at">Captured {new Date(pin.capturedAt).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      );
    }

    if (activePanel === 'provider') {
      return (
        <aside className="floating-panel" aria-label="Provider and model">
          <PanelHeader title="Provider" onClose={closePanel} icon={SlidersHorizontal} />
          <div className="provider-panel">
            <div className="field-group">
              <label>Provider</label>
              <select
                value={currentProvider}
                onChange={(e) => handleProviderChange(e.target.value as ProviderId)}
              >
                {providerOptions.map((provider) => {
                  const isReady = isProviderConfigured(provider.id, authMap);

                  return (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}{isReady ? ' - ready' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <div className="field-group">
              <label>Model</label>
              <div className="model-picker">
                <div className="model-search-row">
                  <input
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const model = modelSearch.trim();
                        if (model) {
                          handleModelChange(model);
                        }
                      }
                    }}
                    placeholder={loadingModels ? 'Discovering models' : 'Search or enter model id'}
                    disabled={loadingModels}
                  />
                  <button
                    type="button"
                    onClick={() => loadModelsForProvider(currentProvider, currentModel)}
                    disabled={loadingModels}
                  >
                    {loadingModels ? 'Loading' : 'Refresh'}
                  </button>
                </div>
                <div className="model-count">
                  <span>
                    {loadingModels
                      ? 'Contacting provider'
                      : availableModels.length > 0
                        ? `${filteredModels.length} of ${availableModels.length} models`
                        : 'No models discovered'}
                  </span>
                  {modelSearch.trim() && modelSearch.trim() !== currentModel && (
                    <button type="button" className="model-use-custom" onClick={() => handleModelChange(modelSearch)}>
                      Use typed
                    </button>
                  )}
                </div>
                {providerModelPresets.length > 0 && (
                  <div className="model-presets" aria-label="Suggested models">
                    {providerModelPresets.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className={`model-preset ${model === currentModel ? 'active' : ''}`}
                        onClick={() => handleModelChange(model)}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                )}
                {visibleModels.length > 0 ? (
                  <div className="model-list" role="listbox" aria-label="Discovered models">
                    {visibleModels.map((model) => (
                      <button
                        key={model}
                        type="button"
                        className={`model-option ${model === currentModel ? 'active' : ''}`}
                        onClick={() => handleModelChange(model)}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="model-empty">
                    {availableModels.length === 0
                      ? 'Test or save the provider, then refresh. You can also paste a model id manually.'
                      : 'No matching models. Keep typing to use a custom id.'}
                  </div>
                )}
              </div>
            </div>
            <div className={`provider-health ${hasAuth ? 'ready' : 'needs-key'}`}>
              <span className="status-dot" />
              <div>
                <strong>{hasAuth ? 'Ready' : 'Needs credentials'}</strong>
                <small>{currentProviderConfig?.name || currentProvider}</small>
              </div>
            </div>
            <button className="secondary-action" onClick={openSettings}>
              Open settings
            </button>
          </div>
        </aside>
      );
    }

    return null;
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <img src={logoUrl} alt="" />
        <span>Loading Aid</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-screen error-screen">
        <div className="empty-mark">
          <X size={24} />
        </div>
        <span>{error}</span>
        <button className="primary-action" onClick={initializePanel}>
          Retry
        </button>
      </div>
    );
  }

  if (!hasAcceptedDataDisclosure(extensionSettings || undefined)) {
    return (
      <div className="disclosure-screen">
        <DataDisclosure onAccept={acceptDataDisclosure} isSaving={isAcceptingDisclosure} />
      </div>
    );
  }

  return (
    <div className="aid-shell">
      <div className="ambient-layer" aria-hidden="true" />

      <header className="aid-topbar">
        <div className="brand-lockup">
          <div className="logo-frame">
            <img src={logoUrl} alt="" />
          </div>
          <div>
            <div className="brand-title">Aid</div>
            <div className="brand-status">
              <span className={`status-dot ${hasAuth ? 'ready' : 'needs-key'}`} />
              {hasAuth ? 'Ready' : 'Needs key'}
            </div>
          </div>
        </div>

        <button className="provider-chip" onClick={() => openPanel('provider')} title="Provider and model">
          <span>{currentProviderConfig?.name || currentProvider}</span>
          <ChevronDown size={14} />
        </button>

        <div className="topbar-actions">
          <button
            className={`icon-button ${activePanel === 'menu' ? 'active' : ''}`}
            onClick={() => openPanel('menu')}
            aria-label="Open command menu"
            title="Command menu"
          >
            <Command size={17} />
          </button>
          <button
            className="icon-button"
            onClick={() => setShowChatHistory(true)}
            aria-label="Open chat history"
            title="History"
          >
            <History size={17} />
          </button>
          <button
            className="icon-button"
            onClick={openSettings}
            aria-label="Open settings"
            title="Settings"
          >
            <Settings size={17} />
          </button>
          <button
            className="icon-button primary-icon"
            onClick={handleNewChat}
            aria-label="Start new chat"
            title="New chat"
          >
            <Plus size={18} />
          </button>
        </div>
      </header>

      {activePanel && <button className="panel-scrim" onClick={closePanel} aria-label="Close panel" />}
      {renderPanel()}

      <main className="chat-surface">
        <div ref={chatContainerRef} className="chat-messages">
          {chatState.messages.length === 0 ? (
            renderEmptyState()
          ) : (
            <>
              {needsReconnect && reconnectProvider && (
                <div className="inline-reconnect">
                  <ProviderActivation
                    defaultModels={defaultModels}
                    reconnectProvider={reconnectProvider}
                    savedModel={reconnectModel}
                    savedHost={reconnectHost}
                    pagePermissionTarget={getContextPermissionOrigin(contextDiagnostics) || currentContext[0]?.url}
                    compact
                    onConnected={(providerId, auth, model) => void handleProviderConnected(providerId, auth, model)}
                    onOpenOptions={openSettings}
                  />
                </div>
              )}
              {chatState.messages.map((message) => {
                const messageWithStatus = message as MessageWithStatus;
                const messageReceipts = agentReceipts.filter((receipt) => receipt.taskMessageId === message.id);

                return (
                  <React.Fragment key={message.id}>
                    <article className={`message ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}>
                      <div className="message-meta">
                        <span>{message.role === 'user' ? 'You' : 'Aid'}</span>
                        <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
                      </div>
                      <div className="message-content">
                        <MarkdownRenderer
                          content={message.content}
                          isStreaming={message.role === 'assistant' && messageWithStatus.status === 'sending'}
                        />
                        {getMessageImageAttachments(message).length > 0 && (
                          <div className="message-attachments">
                            {getMessageImageAttachments(message).map((image) => (
                              <img key={image.id} src={image.dataUrl} alt={image.name} />
                            ))}
                          </div>
                        )}
                      </div>
                      {renderMessageStatus(messageWithStatus)}
                    </article>
                    {messageReceipts.map((receipt) => (
                      <details key={receipt.runId} className={`agent-receipt-card status-${receipt.status}`}>
                        <summary>
                          <ShieldCheck size={15} />
                          <span>Agent receipt</span>
                          <strong>{receipt.status}</strong>
                        </summary>
                        <div className="agent-receipt-body">
                          <p><strong>{receipt.pageTitle}</strong><span>{receipt.pageUrl || 'Page URL unavailable'}</span></p>
                          <p>
                            <time>{new Date(receipt.startedAt).toLocaleString()}</time>
                            <span>{receipt.tokenUsage.totalTokens} tokens · {receipt.steps.length} steps</span>
                          </p>
                          {receipt.steps.length > 0 && (
                            <ol>
                              {receipt.steps.map((step, index) => (
                                <li key={`${receipt.runId}_${index}`}>
                                  <strong>{step.tool.replaceAll('_', ' ')}</strong>
                                  <span>{step.targetLabel}</span>
                                  <small>{step.outcome} · {step.approvalState.replaceAll('_', ' ')} · {step.durationMs} ms</small>
                                  {step.failure && <small className="agent-receipt-failure">{step.failure}</small>}
                                </li>
                              ))}
                            </ol>
                          )}
                        </div>
                      </details>
                    ))}
                  </React.Fragment>
                );
              })}
              {chatState.isLoading && panelMode === 'chat' && (
                <article className="message assistant-message">
                  <div className="message-meta">
                    <span>Aid</span>
                  </div>
                  <div className="message-content typing-bubble">
                    <span />
                    <span />
                    <span />
                  </div>
                </article>
              )}
              {activeAgentRunId && (
                <article className="agent-run-card" role="status" aria-live="polite">
                  <span className="agent-run-icon"><MousePointerClick size={16} /></span>
                  <div>
                    <strong>{describeAgentActivity(agentActivity)}</strong>
                    <small>Step {Math.max(agentStep, 1)} of 12 · current page only</small>
                  </div>
                </article>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>
      </main>

      <footer className="composer-zone">
        <div className="mode-switch" aria-label="Aid mode">
          <button
            type="button"
            className={panelMode === 'chat' ? 'active' : ''}
            onClick={() => handlePanelModeChange('chat')}
            disabled={chatState.isLoading}
          >
            <Bot size={13} />
            Chat
          </button>
          <button
            type="button"
            className={panelMode === 'agent' ? 'active' : ''}
            onClick={() => handlePanelModeChange('agent')}
            disabled={chatState.isLoading}
          >
            <MousePointerClick size={13} />
            Agent <span>Beta</span>
          </button>
        </div>
        {panelMode === 'chat' ? (
          <>
            <div className="composer-tools">
              <button onClick={() => openPanel('tools')}>
                <Wand2 size={14} />
                Tools
              </button>
              <button
                onClick={() => openPanel('context')}
                className={`context-tool ${selectedText ? 'is-attached' : ''}`}
              >
                <PanelRightOpen size={14} />
                {contextLabel}
              </button>
              {canRegenerate && (
                <button onClick={() => void handleRegenerateLast()}>
                  <RefreshCw size={14} />
                  Regenerate
                </button>
              )}
            </div>
            <ContextInspector
              contexts={attachedContexts}
              isAttached={contextAttachEnabled}
              isOpen={showContextInspector}
              isRefreshing={isRefreshingContext}
              disabled={chatState.isLoading}
              emptyMessage={contextStatus.detail || contextStatus.message}
              onRefresh={() => void handleRefreshContextInspector()}
              onToggleAttached={setContextAttachEnabled}
              onToggleOpen={() => setShowContextInspector((current) => !current)}
            />
          </>
        ) : (
          <div className="agent-guidance">
            <ShieldCheck size={14} />
            <span>{agentProviderSupported
              ? 'Links and sensitive fields are blocked; consequential actions ask first. Navigation or tab switching stops the run.'
              : 'Use OpenAI, OpenRouter, Ollama, or LM Studio for Agent mode.'}</span>
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="attachment-strip">
            {pendingImages.map((image) => (
              <div key={image.id} className="attachment-chip" title={`${image.name} (${formatBytes(image.size)})`}>
                <img src={image.dataUrl} alt="" />
                <span>{image.name}</span>
                <button type="button" onClick={() => handleRemovePendingImage(image.id)} aria-label={`Remove ${image.name}`}>
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {shouldShowImageModelWarning && (
          <div className="attachment-guidance" role="status">
            Image attached. Use a vision-capable model if this provider rejects it.
          </div>
        )}
        {attachmentError && (
          <div className="attachment-error" role="status">
            {attachmentError}
          </div>
        )}
        {chatState.error && (
          <div className="chat-error-banner" role="alert">
            <span>{chatState.error}</span>
            <button type="button" onClick={dismissChatError} aria-label="Dismiss error">
              <X size={12} />
            </button>
          </div>
        )}
        {pendingAgentApproval && (
          <div className="agent-approval" role="alertdialog" aria-label="Approve agent action">
            <div>
              <strong>Approve {pendingAgentApproval.action}</strong>
              <span>{pendingAgentApproval.label}</span>
              <small>{pendingAgentApproval.reason}</small>
            </div>
            <div className="agent-approval-actions">
              <button type="button" className="ghost-action" onClick={() => resolveAgentApproval(false)}>
                Deny
              </button>
              <button type="button" className="primary-action" onClick={() => resolveAgentApproval(true)}>
                Approve once
              </button>
            </div>
          </div>
        )}
        <div className="composer">
          <button className="composer-icon" onClick={() => openPanel('context')} aria-label="Open context">
            <Menu size={18} />
          </button>
          <button
            className={`composer-icon ${pendingImages.length > 0 ? 'is-attached' : ''}`}
            onClick={() => imageInputRef.current?.click()}
            disabled={panelMode === 'agent' || chatState.isLoading || !hasAuth || !currentModel || !canAttachImages}
            aria-label="Attach image"
            title={canAttachImages ? 'Attach image' : 'Select a vision-capable model to attach images'}
          >
            <ImagePlus size={18} />
          </button>
          <input
            ref={imageInputRef}
            className="image-input"
            type="file"
            accept={SUPPORTED_IMAGE_MIME_TYPES.join(',')}
            multiple
            disabled={!canAttachImages}
            onChange={handleImageFilesSelected}
          />
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={inputPlaceholder}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={chatState.isLoading || !hasAuth || !currentModel || (panelMode === 'agent' && !agentProviderSupported)}
            rows={1}
          />
          <button
            className={`send-button ${chatState.isLoading ? 'stop-button' : ''}`}
            onClick={chatState.isLoading ? handleStopGenerating : handleSendMessage}
            disabled={chatState.isLoading ? !activeRequestId && !activeAgentRunId : !canSendMessage}
            title={chatState.isLoading ? panelMode === 'agent' ? 'Stop agent task' : 'Stop response' : panelMode === 'agent' ? 'Start agent task' : 'Send message'}
            aria-label={chatState.isLoading ? panelMode === 'agent' ? 'Stop agent task' : 'Stop response' : panelMode === 'agent' ? 'Start agent task' : 'Send message'}
          >
            {chatState.isLoading ? <X size={18} /> : <SendHorizontal size={18} />}
          </button>
        </div>
      </footer>

      <ChatHistoryPanel
        isOpen={showChatHistory}
        onClose={() => setShowChatHistory(false)}
        onConversationSelect={handleConversationSelect}
        currentConversationId={currentConversationId}
        onNewChat={handleNewChat}
      />
    </div>
  );
};

interface PanelHeaderProps {
  title: string;
  onClose: () => void;
  icon: LucideIcon;
}

const PanelHeader: React.FC<PanelHeaderProps> = ({ title, onClose, icon: Icon }) => (
  <div className="panel-header">
    <div>
      <span className="panel-icon"><Icon size={16} /></span>
      <h2>{title}</h2>
    </div>
    <button className="icon-button" onClick={onClose} aria-label="Close panel">
      <X size={16} />
    </button>
  </div>
);
