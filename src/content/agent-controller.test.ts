import { beforeEach, describe, expect, it, vi } from 'vitest';

const pageControllerState = vi.hoisted(() => ({
  browserState: {
    url: 'https://example.com/',
    content: '*[1]<button type=submit>Publish report />',
  },
  clickElement: vi.fn(async () => ({ success: true })),
  dispose: vi.fn(),
}));

vi.mock('webextension-polyfill', () => ({
  default: { runtime: { id: 'aid-extension' } },
}));

vi.mock('@page-agent/page-controller', () => ({
  PageController: class {
    getBrowserState = async () => pageControllerState.browserState;
    clickElement = pageControllerState.clickElement;
    dispose = pageControllerState.dispose;
  },
}));

import type { AgentPageControlMessage } from '@/shared/agent';
import { AgentPageController } from './agent-controller';

const initialUrl = 'https://example.com/';
const sender = { id: 'aid-extension' };
const message = (
  runId: string,
  command: AgentPageControlMessage['payload']['command']
): AgentPageControlMessage => ({
  type: 'AGENT_PAGE_CONTROL',
  payload: { runId, command },
});

describe('AgentPageController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pageControllerState.browserState = {
      url: initialUrl,
      content: '*[1]<button type=submit>Publish report />',
    };
    vi.stubGlobal('window', { location: { href: initialUrl } });
    vi.stubGlobal('document', { querySelectorAll: () => [] });
  });

  it('rejects unknown senders and stale run IDs', async () => {
    const controller = new AgentPageController();

    await expect(controller.handleMessage(
      message('run-1', { command: 'start', initialUrl }),
      { id: 'another-extension' }
    )).rejects.toThrow('unknown sender');

    await controller.handleMessage(message('run-1', { command: 'start', initialUrl }), sender);
    await expect(controller.handleMessage(
      message('run-2', { command: 'get_browser_state' }),
      sender
    )).rejects.toThrow('no longer active');
  });

  it('rejects an approved action when its indexed element changes', async () => {
    const controller = new AgentPageController();
    await controller.handleMessage(message('run-1', { command: 'start', initialUrl }), sender);
    await controller.handleMessage(message('run-1', { command: 'get_browser_state' }), sender);
    const assessment = await controller.handleMessage(message('run-1', {
      command: 'assess_action',
      action: 'click',
      args: [1],
    }), sender) as { fingerprint: string };

    pageControllerState.browserState = {
      url: initialUrl,
      content: '*[1]<button type=submit>Delete report />',
    };
    const result = await controller.handleMessage(message('run-1', {
      command: 'execute_action',
      action: 'click',
      args: [1],
      approvedFingerprint: assessment.fingerprint,
    }), sender) as { success: boolean; message: string };

    expect(result.success).toBe(false);
    expect(result.message).toContain('target changed');
    expect(pageControllerState.clickElement).not.toHaveBeenCalled();
  });

  it('cleans up and rejects actions after navigation', async () => {
    const controller = new AgentPageController();
    await controller.handleMessage(message('run-1', { command: 'start', initialUrl }), sender);
    (window.location as { href: string }).href = 'https://example.com/next';

    await expect(controller.handleMessage(message('run-1', {
      command: 'assess_action',
      action: 'click',
      args: [1],
    }), sender)).rejects.toThrow('Navigation stopped');
    expect(pageControllerState.dispose).toHaveBeenCalledOnce();
  });
});
