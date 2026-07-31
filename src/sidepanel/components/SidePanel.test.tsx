import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSavedConversation } from '@/sidepanel/conversation';
import type { ChatConversation, ChatMessage } from '@/shared/types';

const userMessage: ChatMessage = {
  id: 'user-1',
  role: 'user',
  content: 'Summarize the current release notes and keep the blockers visible.',
  timestamp: 100,
};

const existingConversation: ChatConversation = {
  id: 'conv-1',
  title: 'Manual release title',
  autoTitle: false,
  userTitle: 'Manual release title',
  tags: ['release', 'pinned'],
  messages: [userMessage],
  metadata: {
    provider: 'lmstudio',
    model: 'old-model',
    context: [],
    messageCount: 1,
    tokenUsage: {
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
    },
    lastActivity: 100,
    source: 'sidepanel',
    tags: ['release', 'pinned'],
  },
  createdAt: 100,
  updatedAt: 120,
  isActive: true,
  isPinned: true,
};

describe('buildSavedConversation', () => {
  it('preserves existing user metadata while refreshing live chat fields', () => {
    const assistantMessage: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Blockers are visible.',
      timestamp: 200,
    };

    const saved = buildSavedConversation({
      conversationId: 'conv-1',
      existingConversation,
      messages: [userMessage, assistantMessage],
      agentReceipts: [{
        runId: 'agent-1',
        taskMessageId: userMessage.id,
        pageUrl: 'https://example.com/release',
        pageTitle: 'Release page',
        startedAt: 150,
        completedAt: 180,
        status: 'completed',
        tokenUsage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
        steps: [],
      }],
      pinnedContexts: [{
        id: 'pin-1',
        capturedAt: 140,
        context: {
          title: 'Pinned release page',
          url: 'https://example.com/pinned',
          abstract: 'Pinned release context.',
        },
      }],
      provider: 'openai',
      model: 'gpt-4.1',
      context: [{
        title: 'Release page',
        url: 'https://example.com/release',
        abstract: 'Current release blockers.',
      }],
      now: 300,
    });

    expect(saved.createdAt).toBe(100);
    expect(saved.updatedAt).toBe(300);
    expect(saved.title).toBe('Manual release title');
    expect(saved.userTitle).toBe('Manual release title');
    expect(saved.autoTitle).toBe(false);
    expect(saved.tags).toEqual(['release', 'pinned']);
    expect(saved.isPinned).toBe(true);
    expect(saved.messages).toHaveLength(2);
    expect(saved.agentReceipts).toHaveLength(1);
    expect(saved.metadata.pinnedContexts).toHaveLength(1);
    expect(saved.metadata.provider).toBe('openai');
    expect(saved.metadata.model).toBe('gpt-4.1');
    expect(saved.metadata.messageCount).toBe(2);
    expect(saved.metadata.tags).toEqual(['release', 'pinned']);
  });
});

describe('SidePanel browser lifecycle', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/sidepanel/components/SidePanel.tsx'), 'utf8');

  it('keeps Firefox permission requests inside the original user gesture', () => {
    const grantHandler = source.slice(
      source.indexOf('const requestPageAccessAndRefresh'),
      source.indexOf('const hasSelectedText')
    );
    const agentHandler = source.slice(
      source.indexOf('const handleAgentTask'),
      source.indexOf('const handleSendMessage')
    );

    const beforeGrantRequest = grantHandler.slice(0, grantHandler.indexOf('ensureOriginPermission('));
    expect(beforeGrantRequest.match(/await /g)).toHaveLength(1);
    expect(beforeGrantRequest.trimEnd().endsWith('await')).toBe(true);
    expect(grantHandler).not.toContain('getActiveTabContextResult');
    expect(agentHandler.indexOf('ensureOriginPermissions(')).toBeLessThan(
      agentHandler.indexOf('MessageHandler.getActiveTabContextResult(')
    );
    expect(agentHandler.match(/ensureOriginPermissions\(/g)).toHaveLength(1);
  });

  it('filters broadcast chat events and refreshes context from browser events instead of polling', () => {
    expect(source).toContain('message.requestId !== activeRequestIdRef.current');
    expect(source).toContain('browser.tabs.onActivated.addListener');
    expect(source).not.toContain('setInterval(');
  });
});
