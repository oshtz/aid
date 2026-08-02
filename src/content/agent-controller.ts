import browser from 'webextension-polyfill';
import { PageController } from '@page-agent/page-controller';
import type {
  AgentActionAssessment,
  AgentActionResult,
  AgentBrowserState,
  AgentElementAction,
  AgentNavigationAssessment,
  AgentPageControlMessage,
} from '@/shared/agent';
import { ContextCollector } from '@/shared/context-collector';
import {
  assessAgentAction,
  clearSensitiveAgentElementMarks,
  markSensitiveAgentElements,
  sanitizeAgentPageContent,
  findAgentElementDescriptor,
  requiresAgentActionConfirmation,
} from './agent-safety';

interface IndexedAgentElement {
  ref?: HTMLElement;
}

interface PageControllerSelectorMap {
  selectorMap: Map<number, IndexedAgentElement>;
}

const failedAction = (message: string): AgentActionResult => ({ success: false, message });

export class AgentPageController {
  private controller: PageController | null = null;
  private activeRunId = '';
  private initialUrl = '';
  private lastPageContent = '';

  async handleMessage(
    message: AgentPageControlMessage,
    sender: browser.Runtime.MessageSender
  ): Promise<unknown> {
    if (sender.id !== browser.runtime.id) {
      throw new Error('Rejected page-control message from an unknown sender.');
    }

    const { runId, command } = message.payload;
    if (command.command === 'start') {
      await this.start(runId, command.initialUrl);
      return { success: true };
    }

    this.assertActiveRun(runId);

    switch (command.command) {
      case 'get_browser_state':
        return this.getBrowserState();
      case 'get_last_update_time':
        return this.getController().getLastUpdateTime();
      case 'show_mask':
        return this.getController().showMask();
      case 'hide_mask':
        return this.getController().hideMask();
      case 'clean_highlights':
        return this.getController().cleanUpHighlights();
      case 'cleanup':
        this.cleanup();
        return { success: true };
      case 'assess_action':
        return this.assess(command.action, command.args);
      case 'assess_navigation':
        return this.assessNavigation(command.args);
      case 'prepare_navigation':
        return this.prepareNavigation(command.args, command.fingerprint);
      case 'execute_action':
        return this.execute(command.action, command.args, command.fingerprint);
      case 'scroll':
        return this.getController().scroll(
          this.getObjectArg(command.args) as Parameters<PageController['scroll']>[0]
        );
      case 'scroll_horizontally':
        return this.getController().scrollHorizontally(
          this.getObjectArg(command.args) as Parameters<PageController['scrollHorizontally']>[0]
        );
    }
  }

  private async start(runId: string, initialUrl: string): Promise<void> {
    this.cleanup();
    if (window.location.href !== initialUrl) {
      throw new Error('The active page changed before Agent mode started.');
    }

    this.activeRunId = runId;
    this.initialUrl = initialUrl;
    this.controller = new PageController({
      enableMask: true,
      viewportExpansion: 400,
    });
  }

  private assertActiveRun(runId: string): void {
    if (!this.controller || !this.activeRunId || runId !== this.activeRunId) {
      throw new Error('The Agent page controller is no longer active.');
    }
    if (window.location.href !== this.initialUrl) {
      this.cleanup();
      throw new Error('Navigation stopped the current-page Agent run.');
    }
  }

  private async getBrowserState(): Promise<AgentBrowserState> {
    markSensitiveAgentElements();
    const state = await this.getController().getBrowserState();
    const url = ContextCollector.sanitizeUrl(state.url);
    const title = ContextCollector.redactSensitiveText(state.title).slice(0, 300) || 'Untitled Page';
    const header = [
      `Current Page: [${title}](${url || 'Unavailable URL'})`,
      ...state.header.split('\n').slice(1),
    ].join('\n');
    this.lastPageContent = sanitizeAgentPageContent(state.content);

    return {
      ...state,
      url,
      title,
      header,
      content: this.lastPageContent,
      documentUrl: ContextCollector.sanitizeUrl(this.initialUrl),
    };
  }

  private assess(action: AgentElementAction, args: unknown[]): AgentActionAssessment {
    return assessAgentAction(this.lastPageContent, action, this.getIndexArg(args));
  }

  private assessNavigation(args: unknown[]): AgentNavigationAssessment {
    const index = this.getIndexArg(args);
    const label = findAgentElementDescriptor(this.lastPageContent, index) || `Element ${index}`;
    const element = (this.getController() as unknown as PageControllerSelectorMap).selectorMap.get(index)?.ref;
    const link = element?.closest?.('a[href], area[href]') as HTMLAnchorElement | HTMLAreaElement | null;
    const blocked = (reason: string): AgentNavigationAssessment => ({
      decision: 'block',
      action: 'navigate',
      index,
      label,
      reason,
      fingerprint: `navigate:${index}:${label}`,
      targetUrl: '',
      sameOrigin: false,
    });

    if (!link) return blocked('The indexed element is not a navigable link.');
    if (link.hasAttribute('download')) return blocked('Aid does not start downloads.');
    if (link.target.toLowerCase() === '_blank') return blocked('Aid does not open or switch tabs during a run.');

    let target: URL;
    try {
      target = new URL(link.href, window.location.href);
    } catch {
      return blocked('The link destination is invalid.');
    }
    if (!['http:', 'https:'].includes(target.protocol)) {
      return blocked('Aid only navigates to http or https pages.');
    }
    if (target.username || target.password) {
      return blocked('Aid does not navigate to URLs containing credentials.');
    }
    if (target.href === window.location.href) {
      return blocked('The link points to the current page.');
    }

    const sameOrigin = target.origin === new URL(window.location.href).origin;
    const consequential = requiresAgentActionConfirmation(label);
    const safeTarget = ContextCollector.sanitizeUrl(target.href) || target.origin;
    return {
      decision: sameOrigin && !consequential ? 'allow' : 'confirm',
      action: 'navigate',
      index,
      label: `${label} → ${safeTarget}`,
      reason: consequential
        ? 'This navigation may cause an external or irreversible change.'
        : sameOrigin
          ? 'This link stays on the current website.'
          : 'This link opens another website and may share its readable page context with the selected provider.',
      fingerprint: `navigate:${index}:${label}:${target.href}`,
      targetUrl: target.href,
      sameOrigin,
    };
  }

  private async prepareNavigation(
    args: unknown[],
    fingerprint: string
  ): Promise<AgentNavigationAssessment> {
    await this.getBrowserState();
    const assessment = this.assessNavigation(args);
    if (assessment.fingerprint === fingerprint) return assessment;
    return {
      ...assessment,
      decision: 'block',
      reason: 'The page changed and the link destination is no longer the approved target.',
      targetUrl: '',
    };
  }

  private async execute(
    action: AgentElementAction,
    args: unknown[],
    fingerprint: string
  ): Promise<AgentActionResult> {
    await this.getBrowserState();
    const assessment = this.assess(action, args);
    if (assessment.decision === 'block') {
      return failedAction(`Blocked by Aid: ${assessment.reason}`);
    }
    if (fingerprint !== assessment.fingerprint) {
      return failedAction('The action target changed before it could run.');
    }

    const controller = this.getController();
    switch (action) {
      case 'click':
        return controller.clickElement(this.getIndexArg(args));
      case 'input':
        return controller.inputText(this.getIndexArg(args), this.getStringArg(args, 1));
      case 'select':
        return controller.selectOption(this.getIndexArg(args), this.getStringArg(args, 1));
    }
  }

  private getController(): PageController {
    if (!this.controller) {
      throw new Error('The Agent page controller is not active.');
    }
    return this.controller;
  }

  private getIndexArg(args: unknown[]): number {
    const index = args[0];
    if (!Number.isInteger(index) || Number(index) < 0) {
      throw new Error('Invalid page element index.');
    }
    return Number(index);
  }

  private getStringArg(args: unknown[], index: number): string {
    const value = args[index];
    if (typeof value !== 'string') {
      throw new Error('Invalid page action text.');
    }
    return value;
  }

  private getObjectArg(args: unknown[]): Record<string, unknown> {
    const value = args[0];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('Invalid scroll options.');
    }
    return value as Record<string, unknown>;
  }

  cleanup(): void {
    this.controller?.dispose();
    this.controller = null;
    this.activeRunId = '';
    this.initialUrl = '';
    this.lastPageContent = '';
    clearSensitiveAgentElementMarks();
  }
}
