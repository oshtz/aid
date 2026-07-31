import browser from 'webextension-polyfill';
import { PageController } from '@page-agent/page-controller';
import type {
  AgentActionAssessment,
  AgentActionResult,
  AgentBrowserState,
  AgentPageAction,
  AgentPageControlMessage,
} from '@/shared/agent';
import { ContextCollector } from '@/shared/context-collector';
import {
  assessAgentAction,
  clearSensitiveAgentElementMarks,
  markSensitiveAgentElements,
  sanitizeAgentPageContent,
} from './agent-safety';

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
      case 'execute_action':
        return this.execute(command.action, command.args, command.approvedFingerprint);
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

  private assess(action: AgentPageAction, args: unknown[]): AgentActionAssessment {
    return assessAgentAction(this.lastPageContent, action, this.getIndexArg(args));
  }

  private async execute(
    action: AgentPageAction,
    args: unknown[],
    approvedFingerprint?: string
  ): Promise<AgentActionResult> {
    await this.getBrowserState();
    const assessment = this.assess(action, args);
    if (assessment.decision === 'block') {
      return failedAction(`Blocked by Aid: ${assessment.reason}`);
    }
    if (
      assessment.decision === 'confirm' &&
      approvedFingerprint !== assessment.fingerprint
    ) {
      return failedAction('The action was not approved or its target changed.');
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
