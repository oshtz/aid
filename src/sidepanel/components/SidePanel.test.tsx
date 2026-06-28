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
    expect(saved.metadata.provider).toBe('openai');
    expect(saved.metadata.model).toBe('gpt-4.1');
    expect(saved.metadata.messageCount).toBe(2);
    expect(saved.metadata.tags).toEqual(['release', 'pinned']);
  });
});
