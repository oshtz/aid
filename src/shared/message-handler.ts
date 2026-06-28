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
}

export class MessageHandler {
  static async getActiveTabContextResult(): Promise<ActiveTabContextResult> {
    return this.getTabContextResult({});
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

      if (this.isRecord(response) && typeof response.error === 'string') {
        return { context: null };
      }

      const result: ActiveTabContextResult = {
        context: this.extractFirstTabContext(response),
      };
      const diagnostics = this.extractContextDiagnostics(response as TabContextResponse);
      if (diagnostics) {
        result.diagnostics = diagnostics;
      }
      return result;
    } catch (error) {
      console.warn('Failed to get tab context:', error);
      return { context: null };
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
