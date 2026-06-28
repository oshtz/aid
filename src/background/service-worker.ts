import browser from 'webextension-polyfill';
import { browserBridge } from '@/shared/bridge';
import { ProviderFactory } from '@/providers/provider-factory';
import { SettingsService } from '@/shared/settings';
import { QuickActions } from '@/shared/quick-actions';
import { addPageContextToLatestUserMessage } from '@/shared/chat-context';
import { toOriginPermissionPattern } from '@/shared/permissions';
import type { StreamingResponse } from '@/providers/base-provider';
import type {
  ExtensionMessage,
  ChatRequest,
  ChatDelta,
  ProviderAuthMap,
  ProviderAuth,
  ExtensionSettings,
  ProviderId,
  TabContext,
  TabContextResponse,
  ContextDiagnosticsContent,
  ContextDiagnosticsTab,
  ContextLookupDiagnostics
} from '@/shared/types';

type BrowserWithScripting = typeof browser & {
  scripting?: {
    executeScript: (details: {
      target: { tabId: number };
      files: string[];
    }) => Promise<unknown>;
  };
};

/**
 * Background service worker for the Aid extension
 * Handles communication between content scripts, side panel, and LLM providers
 */
class BackgroundService {
  private settingsService: SettingsService | null = null;
  private lastActiveTabId: number | undefined = undefined;
  private activeChatControllers: Map<string, AbortController> = new Map();

  constructor() {
    this.initialize();
  }

  private async resolveModelForProvider(providerId: ProviderId): Promise<string> {
    const savedModel = this.settingsService?.getSettings().defaultModels?.[providerId];
    if (savedModel) {
      return savedModel;
    }

    const models = await this.settingsService?.getProviderModels(providerId);
    const discoveredModel = models?.[0];
    if (discoveredModel) {
      return discoveredModel;
    }

    throw new Error(`No model discovered for provider: ${providerId}`);
  }

  private async initialize() {
    try {
      // Initialize settings service
      this.settingsService = await SettingsService.initialize();

      // Set up message listeners
      browser.runtime.onMessage.addListener(this.handleMessage.bind(this));

      // Set up action click handler with compatibility layer
      this.setupActionClickHandler();

      // Set up installation handler
      browser.runtime.onInstalled.addListener(this.handleInstall.bind(this));

      // Set up tab removal handler for chat history cleanup
      browser.tabs.onRemoved.addListener(this.handleTabRemoved.bind(this));
      this.setupTabTracking();
      await this.rememberCurrentActiveTab();
    } catch (error) {
      console.error('Failed to initialize background service:', error);
    }
  }

  /**
   * Set up action click handler with Firefox compatibility
   */
  private setupActionClickHandler() {
    try {
      // Chrome and Firefox MV3 both expose the unified action API.
      if (browser.action && browser.action.onClicked) {
        browser.action.onClicked.addListener(this.handleActionClick.bind(this));
      }
      else {
        console.warn('No action API available');
      }
    } catch (error) {
      console.error('Failed to set up action click handler:', error);
    }
  }

  private async handleMessage(
    message: ExtensionMessage,
    sender: browser.Runtime.MessageSender
  ): Promise<unknown> {
    try {
      if (sender.tab) {
        this.rememberContextTab(sender.tab);
      }

      if (!this.settingsService) {
        throw new Error('Settings service not initialized');
      }

      switch (message.type) {
        case 'CHAT_REQUEST':
          return await this.handleChatRequest(message.payload as ChatRequest, sender);

        case 'CANCEL_CHAT_REQUEST':
          return await this.handleCancelChatRequest(message.payload as { requestId?: string });

        case 'GET_TAB_CONTEXT':
          return await this.handleGetTabContext(message.payload as { tabIds?: number[] } | undefined);

        case 'UPDATE_SETTINGS':
          return await this.handleUpdateSettings(message.payload as {
            settings?: Partial<ExtensionSettings>;
            authMap?: Partial<ProviderAuthMap>;
          });

        case 'GET_SETTINGS':
          return {
            settings: this.settingsService.getSettings(),
            authMap: this.settingsService.getAuthMap()
          };

        case 'OPEN_SIDE_PANEL_WITH_SELECTION':
          return await this.handleOpenSidePanelWithSelection(
            message.payload as { selection: string; context: TabContext },
            sender
          );

        case 'EXPLAIN_SELECTION':
          return await this.handleExplainSelection(message.payload as { selection: string; context: TabContext }, sender);

        case 'TRANSLATE_SELECTION':
          return await this.handleTranslateSelection(message.payload as { selection: string; context: TabContext }, sender);

        case 'SUMMARIZE_PAGE':
          return await this.handleSummarizePage(message.payload, sender);

        case 'EXTRACT_KEY_POINTS':
          return await this.handleExtractKeyPoints(message.payload, sender);

        case 'MAKE_LIST':
          return await this.handleMakeList(message.payload, sender);

        case 'TEST_PROVIDER':
          return await this.handleTestProvider(message.payload as { providerId: ProviderId; auth: ProviderAuth });

        case 'VALIDATE_HOST':
          return await this.handleValidateHost(message.payload as { host: string });

        case 'GET_PROVIDER_MODELS':
          return await this.handleGetProviderModels(message.payload as { providerId: ProviderId });

        default:
          console.warn('Unknown message type:', message.type);
          return { error: 'Unknown message type' };
      }
    } catch (error) {
      console.error('Error handling message:', error);
      return { error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  private async handleChatRequest(
    request: ChatRequest,
    sender: browser.Runtime.MessageSender
  ) {
    if (!this.settingsService) {
      throw new Error('Settings service not initialized');
    }

    const authMap = this.settingsService.getAuthMap();
    const requestProviderId = request.providerId as ProviderId;
    const config = ProviderFactory.getProviderConfig(requestProviderId);
    const auth = authMap[requestProviderId] || (config?.authType === 'none' ? { kind: 'none' as const } : undefined);

    const providerMessages = addPageContextToLatestUserMessage(request.messages, request.context);
    const abortController = new AbortController();
    this.activeChatControllers.set(request.id, abortController);

    try {
      if (!auth) {
        throw new Error(`No authentication configured for provider: ${request.providerId}`);
      }

      await this.ensureProviderNetworkPermission(requestProviderId, auth);
      const provider = ProviderFactory.createProvider(requestProviderId, auth);
      const response = await provider.sendChat(providerMessages, request.model, {
        signal: abortController.signal,
      });

      const tabId = this.getContentSenderTabId(sender);
      return await this.streamResponse(response, request.id, tabId, abortController.signal);
    } finally {
      this.activeChatControllers.delete(request.id);
    }
  }

  private async handleCancelChatRequest(payload: { requestId?: string }) {
    const requestId = payload.requestId;
    if (!requestId) {
      return { success: false, error: 'No request id provided' };
    }

    const controller = this.activeChatControllers.get(requestId);
    if (!controller) {
      return { success: false, error: 'No active chat request found' };
    }

    controller.abort();
    await this.sendToSidePanel({
      type: 'CHAT_CANCELLED',
      payload: { requestId },
      requestId,
    });

    return { success: true };
  }

  private getContentSenderTabId(sender: browser.Runtime.MessageSender): number | undefined {
    const tab = sender.tab;
    if (tab?.id === undefined) {
      return undefined;
    }

    const extensionBaseUrl = browser.runtime.getURL('');
    if (tab.url?.startsWith(extensionBaseUrl)) {
      return undefined;
    }

    return tab.id;
  }

  private async streamResponse(
    response: StreamingResponse,
    requestId: string,
    tabId?: number,
    signal?: AbortSignal
  ) {
    try {
      // Validate extension context before streaming
      if (!browser.runtime?.id) {
        throw new Error('Extension context invalidated');
      }

      // Iterate through the async stream and send individual ChatDelta chunks
      for await (const delta of response) {
        // Send to side panel with retry
        let sidePanelSent = false;
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            await this.sendToSidePanel({
              type: 'CHAT_DELTA',
              payload: delta,
              requestId,
            });
            sidePanelSent = true;
            break;
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            if (errorMessage.includes('Could not establish connection') && attempt < 1) {
              // Wait before retry
              await new Promise(resolve => setTimeout(resolve, 100));
              continue;
            }
            throw error;
          }
        }

        if (!sidePanelSent) {
          console.warn('Failed to send to side panel after retries');
        }

        // Also send to tab if specified
        if (tabId) {
          try {
            // Validate tab exists before sending
            const tab = await browser.tabs.get(tabId);
            if (tab) {
              await browser.tabs.sendMessage(tabId, {
                type: 'CHAT_DELTA',
                payload: delta,
                requestId,
              } as ExtensionMessage<ChatDelta>);
            }
          } catch (error) {
            // Tab might not have content script or may have been closed, ignore
            console.warn('Failed to send to tab:', error);
          }
        }
      }
    } catch (error) {
      if (signal?.aborted || this.isAbortError(error)) {
        await this.sendToSidePanel({
          type: 'CHAT_CANCELLED',
          payload: { requestId },
          requestId,
        });
        return { success: false, cancelled: true };
      }

      console.error('Error processing stream:', error);
      await this.sendToSidePanel({
        type: 'CHAT_ERROR',
        payload: { error: 'Stream processing failed' },
        requestId,
      });
    }

    return { success: true };
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof DOMException
      ? error.name === 'AbortError'
      : error instanceof Error && error.name === 'AbortError';
  }

  private async handleTabRemoved(tabId: number) {
    try {
      if (this.lastActiveTabId === tabId) {
        this.lastActiveTabId = undefined;
        await this.rememberCurrentActiveTab();
      }
    } catch (error) {
      console.error('Failed to update tracked tab after removal:', error);
    }
  }

  private setupTabTracking() {
    browser.tabs.onActivated.addListener(({ tabId }) => {
      this.lastActiveTabId = tabId;
    });

    browser.tabs.onUpdated.addListener((tabId, _changeInfo, tab) => {
      if (tab.active && this.isContextEligibleTab({ ...tab, id: tabId })) {
        this.lastActiveTabId = tabId;
      }
    });

    browser.windows.onFocusChanged.addListener((windowId) => {
      if (windowId === browser.windows.WINDOW_ID_NONE) {
        return;
      }

      this.rememberCurrentActiveTab(windowId).catch((error) => {
        console.warn('Failed to track focused tab:', error);
      });
    });
  }

  private async rememberCurrentActiveTab(windowId?: number): Promise<void> {
    const query: browser.Tabs.QueryQueryInfoType = windowId !== undefined
      ? { active: true, windowId }
      : { active: true, lastFocusedWindow: true };

    try {
      const tabs = await browser.tabs.query(query);
      const tab = this.pickContextTab(tabs);
      if (tab) {
        this.rememberContextTab(tab);
      }
    } catch (error) {
      console.warn('Failed to remember active tab:', error);
    }
  }

  private rememberContextTab(tab: browser.Tabs.Tab): void {
    if (tab.id !== undefined && this.isContextEligibleTab(tab)) {
      this.lastActiveTabId = tab.id;
    }
  }

  private async handleGetTabContext(payload: { tabIds?: number[] } = {}): Promise<TabContextResponse> {
    const { tabIds } = payload;
    const contexts: TabContext[] = [];
    const diagnostics: ContextLookupDiagnostics = {
      selectedTabIds: [],
      queries: [],
      content: [],
    };
    if (this.lastActiveTabId !== undefined) {
      diagnostics.lastActiveTabId = this.lastActiveTabId;
    }

    const targetTabs = await this.resolveContextTabIds(tabIds, diagnostics);
    diagnostics.selectedTabIds = targetTabs;

    for (const tabId of targetTabs) {
      if (!tabId) continue;

      const contentDiagnostic: ContextDiagnosticsContent = { tabId };
      diagnostics.content.push(contentDiagnostic);

      try {
        const tab = await browser.tabs.get(tabId);
        contentDiagnostic.tab = this.toDiagnosticTab(tab);

        const scriptStatus = await this.ensureContentScript(tabId);
        contentDiagnostic.pingOk = scriptStatus.pingOk;
        contentDiagnostic.injected = scriptStatus.injected;

        if (!scriptStatus.ready) {
          console.warn(`Content script not available for tab ${tabId}`);
          contentDiagnostic.fallback = true;
          if (scriptStatus.error) {
            contentDiagnostic.error = scriptStatus.error;
          }
          contexts.push({
            url: this.sanitizeUrl(tab.url || ''),
            title: tab.title || '',
            abstract: '',
            selection: '',
          });
          continue;
        }

        // Inject content script to extract context
        const results = await browser.tabs.sendMessage(tabId, {
          type: 'GET_TAB_CONTEXT',
          payload: {},
        }) as Partial<TabContext> | undefined;

        contexts.push({
          url: this.sanitizeUrl(results?.url || tab.url || ''),
          title: results?.title || tab.title || '',
          abstract: results?.abstract || '',
          selection: results?.selection || '',
        });
        contentDiagnostic.contextOk = true;
      } catch (error) {
        console.warn(`Failed to get context for tab ${tabId}:`, error);
        contentDiagnostic.error = error instanceof Error ? error.message : String(error);
        // Try to get basic tab info even if content script fails
        try {
          const tab = await browser.tabs.get(tabId);
          contentDiagnostic.tab = this.toDiagnosticTab(tab);
          contentDiagnostic.fallback = true;
          contexts.push({
            url: this.sanitizeUrl(tab.url || ''),
            title: tab.title || '',
            abstract: '',
            selection: '',
          });
        } catch (tabError) {
          console.warn(`Failed to get basic tab info for ${tabId}:`, tabError);
        }
      }
    }

    return { contexts, diagnostics };
  }

  private async resolveContextTabIds(
    tabIds: number[] | undefined,
    diagnostics: ContextLookupDiagnostics
  ): Promise<number[]> {
    if (tabIds?.length) {
      diagnostics.selectedSource = 'explicit-tab-ids';
      return [...new Set(tabIds.filter((tabId) => Number.isInteger(tabId)))];
    }

    const candidates = new Map<number, browser.Tabs.Tab>();

    if (this.lastActiveTabId !== undefined) {
      try {
        const tab = await browser.tabs.get(this.lastActiveTabId);
        if (this.isContextEligibleTab(tab)) {
          candidates.set(this.lastActiveTabId, tab);
        }
      } catch {
        this.lastActiveTabId = undefined;
      }
    }

    const queries: Array<{ source: string; query: Parameters<typeof browser.tabs.query>[0] }> = [
      { source: 'current-window-active', query: { active: true, currentWindow: true } },
      { source: 'last-focused-active', query: { active: true, lastFocusedWindow: true } },
      { source: 'all-active-tabs', query: { active: true } },
      { source: 'current-window-highlighted', query: { highlighted: true, currentWindow: true } },
      { source: 'all-tabs', query: {} },
    ];

    for (const { source, query } of queries) {
      try {
        const tabs = await browser.tabs.query(query);
        diagnostics.queries.push({
          source,
          count: tabs.length,
          tabs: tabs.slice(0, 8).map((tab) => this.toDiagnosticTab(tab)),
        });

        for (const tab of tabs) {
          if (tab.id !== undefined && this.isContextEligibleTab(tab)) {
            candidates.set(tab.id, tab);
          }
        }
      } catch (error) {
        diagnostics.queries.push({
          source,
          count: 0,
          tabs: [],
          error: error instanceof Error ? error.message : String(error),
        });
        console.warn('Failed to resolve active tab:', error);
      }
    }

    try {
      const focusedWindow = await browser.windows.getLastFocused({ populate: true });
      const tabs = focusedWindow.tabs || [];
      diagnostics.queries.push({
        source: 'last-focused-window-populated',
        count: tabs.length,
        tabs: tabs.slice(0, 8).map((tab) => this.toDiagnosticTab(tab)),
      });

      for (const tab of tabs) {
        if (tab.id !== undefined && this.isContextEligibleTab(tab)) {
          candidates.set(tab.id, tab);
        }
      }
    } catch (error) {
      diagnostics.queries.push({
        source: 'last-focused-window-populated',
        count: 0,
        tabs: [],
        error: error instanceof Error ? error.message : String(error),
      });
      console.warn('Failed to resolve focused window tab:', error);
    }

    const tab = this.pickBestContextTab([...candidates.values()]);
    if (tab?.id !== undefined) {
      this.lastActiveTabId = tab.id;
      diagnostics.selectedSource = this.describeSelectedSource(tab);
      return [tab.id];
    }

    return [];
  }

  private pickContextTab(tabs: browser.Tabs.Tab[]): browser.Tabs.Tab | undefined {
    return this.pickBestContextTab(tabs.filter((tab) => this.isContextEligibleTab(tab)));
  }

  private pickBestContextTab(tabs: browser.Tabs.Tab[]): browser.Tabs.Tab | undefined {
    return [...tabs].sort((a, b) => {
      const scoreDelta = this.scoreContextTab(b) - this.scoreContextTab(a);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      return (b.lastAccessed || 0) - (a.lastAccessed || 0);
    })[0];
  }

  private scoreContextTab(tab: browser.Tabs.Tab): number {
    let score = 0;

    if (tab.url && /^https?:\/\//i.test(tab.url)) {
      score += 100;
    }

    if (tab.active) {
      score += 30;
    }

    if (tab.highlighted) {
      score += 10;
    }

    if (tab.id !== undefined && tab.id === this.lastActiveTabId) {
      score += 20;
    }

    return score;
  }

  private describeSelectedSource(tab: browser.Tabs.Tab): string {
    if (tab.id !== undefined && tab.id === this.lastActiveTabId) {
      return 'tracked-active-tab';
    }

    if (tab.active) {
      return 'tabs-query-active';
    }

    return 'tabs-query-recent';
  }

  private isContextEligibleTab(tab: browser.Tabs.Tab): boolean {
    if (tab.id === undefined) {
      return false;
    }

    if (!tab.url) {
      return true;
    }

    return /^https?:\/\//i.test(tab.url);
  }

  private toDiagnosticTab(tab: browser.Tabs.Tab): ContextDiagnosticsTab {
    const result: ContextDiagnosticsTab = {
      active: tab.active,
      highlighted: tab.highlighted,
    };

    if (tab.id !== undefined) result.id = tab.id;
    if (tab.windowId !== undefined) result.windowId = tab.windowId;
    if (tab.url !== undefined) result.url = tab.url;
    if (tab.title !== undefined) result.title = tab.title;
    if (tab.lastAccessed !== undefined) result.lastAccessed = tab.lastAccessed;
    if (tab.status !== undefined) result.status = tab.status;

    return result;
  }

  private async ensureContentScript(tabId: number): Promise<{
    ready: boolean;
    pingOk: boolean;
    injected: boolean;
    error?: string;
  }> {
    if (await this.validateContentScript(tabId)) {
      return { ready: true, pingOk: true, injected: false };
    }

    const scripting = (browser as BrowserWithScripting).scripting;
    if (!scripting?.executeScript) {
      return {
        ready: false,
        pingOk: false,
        injected: false,
        error: 'scripting.executeScript is unavailable',
      };
    }

    try {
      await scripting.executeScript({
        target: { tabId },
        files: ['content/content-script.js'],
      });

      const pingOk = await this.validateContentScript(tabId);
      const result: {
        ready: boolean;
        pingOk: boolean;
        injected: boolean;
        error?: string;
      } = {
        ready: pingOk,
        pingOk,
        injected: true,
      };
      if (!pingOk) {
        result.error = 'content script did not respond after injection';
      }
      return result;
    } catch (error) {
      console.warn(`Failed to inject content script into tab ${tabId}:`, error);
      return {
        ready: false,
        pingOk: false,
        injected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Validate if content script is available in the tab
   */
  private async validateContentScript(tabId: number): Promise<boolean> {
    try {
      // Send a ping message to check if content script is responsive
      await browser.tabs.sendMessage(tabId, {
        type: 'PING',
        payload: {},
      });
      return true;
    } catch {
      return false;
    }
  }

  private async handleUpdateSettings(payload: {
    settings?: Partial<ExtensionSettings>;
    authMap?: Partial<ProviderAuthMap>;
  }) {
    if (!this.settingsService) {
      throw new Error('Settings service not initialized');
    }

    try {
      if (payload.settings) {
        await this.settingsService.updateSettings(payload.settings);
      }

      if (payload.authMap) {
        await this.settingsService.updateAuthMap(payload.authMap);
      }

      await this.sendToSidePanel({
        type: 'SETTINGS_UPDATED',
        payload: {
          settings: this.settingsService.getSettings(),
          authMap: this.settingsService.getAuthMap(),
        },
      });

      return { success: true };
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  }

  private async handleActionClick(tab: browser.Tabs.Tab) {
    try {
      this.rememberContextTab(tab);
      // Ensure this is called from user gesture context
      await browserBridge.openSidePanel(tab.id);
    } catch (error) {
      console.error('Failed to open side panel:', error);

      // If sidebar opening failed, show notification as fallback
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('user input handler')) {
        console.warn('Sidebar can only be opened from user gesture - this should not happen in action click handler');
      }
    }
  }

  private async handleInstall(details: browser.Runtime.OnInstalledDetailsType) {
    if (details.reason === 'install') {
      // Set default panel behavior
      try {
        await browserBridge.setPanelBehavior({ openPanelOnActionClick: true });
      } catch (error) {
        console.warn('Failed to set panel behavior:', error);
      }
    }
  }

  private sanitizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove query parameters and fragments for privacy
      return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
    } catch {
      return url;
    }
  }

  private async handleOpenSidePanelWithSelection(
    payload: { selection: string; context: TabContext },
    sender: browser.Runtime.MessageSender
  ) {
    try {
      // Note: This method should only be called from user gesture context
      // If called programmatically, we'll send the data but may not be able to open sidebar
      let sidebarOpened = false;

      if (sender.tab?.id) {
        try {
          await browserBridge.openSidePanel(sender.tab.id);
          sidebarOpened = true;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes('user input handler')) {
            console.warn('Cannot open sidebar programmatically - requires user gesture');
            // Continue to send data anyway, in case sidebar is already open
          } else {
            throw error;
          }
        }
      }

      // Send selection data to side panel
      await this.sendToSidePanel({
        type: 'OPEN_SIDE_PANEL_WITH_SELECTION',
        payload: { ...payload, sidebarOpened }
      });

      return { success: true, sidebarOpened };
    } catch (error) {
      console.error('Failed to open side panel with selection:', error);
      throw error;
    }
  }

  private async handleExplainSelection(
    payload: { selection: string; context: TabContext },
    sender: browser.Runtime.MessageSender
  ) {
    try {
      const context = {
        ...payload.context,
        selection: payload.selection,
      };
      const result = await QuickActions.explainSelectionWithContext(context);
      const providerId = this.settingsService?.getSettings().defaultProvider || 'openai';
      const chatRequest: ChatRequest = {
        id: `explain_${Date.now()}`,
        providerId,
        model: await this.resolveModelForProvider(providerId as ProviderId),
        messages: result.messages,
        context: result.context
      };

      return await this.handleChatRequest(chatRequest, sender);
    } catch (error) {
      console.error('Failed to explain selection:', error);
      throw error;
    }
  }

  private async handleTranslateSelection(
    payload: { selection: string; context: TabContext },
    sender: browser.Runtime.MessageSender
  ) {
    try {
      const context = {
        ...payload.context,
        selection: payload.selection,
      };
      const result = await QuickActions.translateContentWithContext(context);
      const providerId = this.settingsService?.getSettings().defaultProvider || 'openai';
      const chatRequest: ChatRequest = {
        id: `translate_${Date.now()}`,
        providerId,
        model: await this.resolveModelForProvider(providerId as ProviderId),
        messages: result.messages,
        context: result.context
      };

      return await this.handleChatRequest(chatRequest, sender);
    } catch (error) {
      console.error('Failed to translate selection:', error);
      throw error;
    }
  }

  private async handleSummarizePage(
    _payload: unknown,
    sender: browser.Runtime.MessageSender
  ) {
    try {
      // Get the active tab
      const tabId = (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      // Send message to content script to collect tab context
      const response = await browser.tabs.sendMessage(tabId, {
        type: 'GET_TAB_CONTEXT',
        payload: { includeSelection: false, maxTokens: 3000 }
      });

      if (!response) {
        throw new Error('Failed to get tab context from content script');
      }

      // Use QuickActions with the collected context
      const result = await QuickActions.summarisePageWithContext(response);
      const providerId = this.settingsService?.getSettings().defaultProvider || 'openai';
      const chatRequest: ChatRequest = {
        id: `summarize_${Date.now()}`,
        providerId,
        model: await this.resolveModelForProvider(providerId as ProviderId),
        messages: result.messages,
        context: result.context
      };

      return await this.handleChatRequest(chatRequest, sender);
    } catch (error) {
      console.error('Failed to summarize page:', error);
      throw error;
    }
  }

  private async handleExtractKeyPoints(
    _payload: unknown,
    sender: browser.Runtime.MessageSender
  ) {
    try {
      // Get the active tab
      const tabId = (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      // Send message to content script to collect tab context
      const response = await browser.tabs.sendMessage(tabId, {
        type: 'GET_TAB_CONTEXT',
        payload: { includeSelection: false, maxTokens: 3000 }
      });

      if (!response) {
        throw new Error('Failed to get tab context from content script');
      }

      // Use QuickActions with the collected context
      const result = await QuickActions.extractKeyPointsWithContext(response);
      const providerId = this.settingsService?.getSettings().defaultProvider || 'openai';
      const chatRequest: ChatRequest = {
        id: `extract_key_points_${Date.now()}`,
        providerId,
        model: await this.resolveModelForProvider(providerId as ProviderId),
        messages: result.messages,
        context: result.context
      };

      return await this.handleChatRequest(chatRequest, sender);
    } catch (error) {
      console.error('Failed to extract key points:', error);
      throw error;
    }
  }

  private async handleMakeList(
    _payload: unknown,
    sender: browser.Runtime.MessageSender
  ) {
    try {
      // Get the active tab
      const tabId = (await browser.tabs.query({ active: true, currentWindow: true }))[0]?.id;
      if (!tabId) {
        throw new Error('No active tab found');
      }

      // Send message to content script to collect tab context
      const response = await browser.tabs.sendMessage(tabId, {
        type: 'GET_TAB_CONTEXT',
        payload: { includeSelection: false, maxTokens: 3000 }
      });

      if (!response) {
        throw new Error('Failed to get tab context from content script');
      }

      // Use QuickActions with the collected context
      const result = await QuickActions.makeListWithContext(response);
      const providerId = this.settingsService?.getSettings().defaultProvider || 'openai';
      const chatRequest: ChatRequest = {
        id: `make_list_${Date.now()}`,
        providerId,
        model: await this.resolveModelForProvider(providerId as ProviderId),
        messages: result.messages,
        context: result.context
      };

      return await this.handleChatRequest(chatRequest, sender);
    } catch (error) {
      console.error('Failed to make list:', error);
      throw error;
    }
  }

  private async ensureProviderNetworkPermission(providerId: ProviderId, auth: ProviderAuth): Promise<void> {
    const config = ProviderFactory.getProviderConfig(providerId);
    if (!config || config.authType !== 'none') {
      return;
    }

    const origin = toOriginPermissionPattern(auth.host || config.endpoint);
    if (!origin || !browser.permissions?.contains) {
      return;
    }

    const hasPermission = await browser.permissions.contains({ origins: [origin] });
    if (!hasPermission) {
      throw new Error(`Grant Aid access to ${origin.replace('/*', '')} from provider settings before connecting.`);
    }
  }

  private async handleTestProvider(payload: { providerId: ProviderId; auth: ProviderAuth }) {
    try {
      await this.ensureProviderNetworkPermission(payload.providerId, payload.auth);
      const provider = ProviderFactory.createProvider(payload.providerId, payload.auth);
      const isValid = await provider.validateAuth();
      if (!isValid) {
        return { success: false, error: 'Provider authentication failed' };
      }

      const models = await provider.getModels();
      return { success: true, models };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Provider test failed'
      };
    }
  }

  private async handleValidateHost(payload: { host: string }) {
    try {
      // Basic URL validation
      const url = new URL(payload.host.startsWith('http') ? payload.host : `http://${payload.host}`);
      return {
        valid: true,
        normalized: `${url.protocol}//${url.host}`
      };
    } catch {
      return {
        valid: false,
        error: 'Invalid host format'
      };
    }
  }

  private async handleGetProviderModels(payload: { providerId: ProviderId }) {
    if (!this.settingsService) {
      throw new Error('Settings service not initialized');
    }

    try {
      const config = ProviderFactory.getProviderConfig(payload.providerId);
      const auth = this.settingsService.getAuthMap()[payload.providerId] ||
        (config?.authType === 'none' ? { kind: 'none' as const } : undefined);
      if (auth) {
        await this.ensureProviderNetworkPermission(payload.providerId, auth);
      }

      const models = await this.settingsService.getProviderModels(payload.providerId);
      return { models };
    } catch (error) {
      console.error(`Failed to get models for ${payload.providerId}:`, error);
      return { error: error instanceof Error ? error.message : 'Failed to get models' };
    }
  }

  private async sendToSidePanel(message: ExtensionMessage) {
    try {
      // Validate connection before sending
      if (!browser.runtime?.id) {
        throw new Error('Extension context invalidated');
      }

      // Send message to all extension contexts (side panel will receive it)
      await browser.runtime.sendMessage(message);
    } catch (error) {
      console.warn('Failed to send message to side panel:', error);

      // If connection failed, try to notify user through alternative means
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Could not establish connection') ||
          errorMessage.includes('Extension context invalidated')) {
        console.error('Extension connection lost - may need to reload extension');
      }
    }
  }

}

// Initialize the background service
new BackgroundService();
