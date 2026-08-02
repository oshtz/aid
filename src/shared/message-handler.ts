import browser from 'webextension-polyfill';
import type {
  ContextLookupDiagnostics,
  ExtensionMessage,
  TabContext,
  TabContextResponse,
} from './types';

export interface ActiveTabContextResult {
  context: TabContext | null;
  diagnostics?: ContextLookupDiagnostics;
  error?: string;
}

export class MessageHandler {
  static async getActiveTabContextResult(): Promise<ActiveTabContextResult> {
    try {
      const tabs = await browser.tabs.query({ currentWindow: true });
      const activeTab = tabs.find((tab) => tab.active);
      const extensionBaseUrl = browser.runtime.getURL('');
      // ponytail: direct-tab fallback is for the dev/E2E panel; remove it when Playwright can drive real side panels.
      const tab = activeTab?.url?.startsWith(extensionBaseUrl)
        ? [...tabs]
          .filter((candidate) => Boolean(candidate.url && /^https?:\/\//i.test(candidate.url)))
          .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0]
        : activeTab;
      if (tab?.id === undefined) {
        return { context: null, error: 'No active tab found in this window.' };
      }

      return this.getTabContextResult({ tabIds: [tab.id] });
    } catch (error) {
      return { context: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  static async getTabContextForTab(tabId: number): Promise<ActiveTabContextResult> {
    return this.getTabContextResult({ tabIds: [tabId] });
  }

  private static async getTabContextResult(payload: { tabIds?: number[] }): Promise<ActiveTabContextResult> {
    try {
      if (!browser.runtime?.id) {
        throw new Error('Extension context invalidated');
      }

      const message: ExtensionMessage<{ tabIds?: number[] }> = {
        type: 'GET_TAB_CONTEXT',
        payload,
      };
      const response = await browser.runtime.sendMessage(message);

      const result: ActiveTabContextResult = {
        context: this.extractFirstTabContext(response),
      };
      const diagnostics = this.extractContextDiagnostics(response as TabContextResponse);
      if (diagnostics) {
        result.diagnostics = diagnostics;
      }
      if (this.isRecord(response) && typeof response.error === 'string') {
        result.context = null;
        result.error = response.error;
      }
      return result;
    } catch (error) {
      console.warn('Failed to get tab context:', error);
      return { context: null, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private static extractFirstTabContext(value: unknown): TabContext | null {
    if (this.isTabContext(value)) {
      return value;
    }

    if (!this.isRecord(value)) {
      return null;
    }

    for (const key of ['data', 'context']) {
      const context = this.extractFirstTabContext(value[key]);
      if (context) {
        return context;
      }
    }

    const contexts = value.contexts;
    return Array.isArray(contexts)
      ? contexts.find((context): context is TabContext => this.isTabContext(context)) || null
      : null;
  }

  private static extractContextDiagnostics(value: unknown): ContextLookupDiagnostics | undefined {
    if (!this.isRecord(value) || !this.isRecord(value.diagnostics)) {
      return undefined;
    }

    return value.diagnostics as unknown as ContextLookupDiagnostics;
  }

  private static isTabContext(value: unknown): value is TabContext {
    return (
      this.isRecord(value) &&
      typeof value.url === 'string' &&
      typeof value.title === 'string' &&
      typeof value.abstract === 'string'
    );
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
