import { describe, expect, it } from 'vitest';
import {
  addPageContextToLatestUserMessage,
  estimateContextTokens,
  formatPageContextForPrompt,
  getContextPreviewLabel,
  hasReadableTabContext,
} from './chat-context';
import type { ChatMessage, TabContext } from './types';

const makeMessage = (
  role: ChatMessage['role'],
  content: string,
  id = `${role}-1`
): ChatMessage => ({
  id,
  role,
  content,
  timestamp: 1,
});

const pageContext: TabContext = {
  title: 'HyperFrames / X',
  url: 'https://x.com/HyperFrames_',
  abstract: 'HyperFrames builds interactive Frames for Farcaster and decentralized social feeds.',
};

describe('chat context prompt helpers', () => {
  it('treats title, URL, abstract, or selection as readable page context', () => {
    expect(hasReadableTabContext({ title: '', url: '', abstract: '' })).toBe(false);
    expect(hasReadableTabContext({ title: 'A page', url: '', abstract: '' })).toBe(true);
    expect(hasReadableTabContext({ title: '', url: '', abstract: '', selection: 'selected text' })).toBe(true);
  });

  it('formats readable page context for a provider prompt', () => {
    expect(formatPageContextForPrompt([pageContext])).toContain('Current page');
    expect(formatPageContextForPrompt([pageContext])).toContain('Title: HyperFrames / X');
    expect(formatPageContextForPrompt([pageContext])).toContain('Page content:');
    expect(formatPageContextForPrompt([pageContext])).toContain('HyperFrames builds interactive Frames');
  });

  it('keeps page content when selected text is also present', () => {
    const contextWithSelection: TabContext = {
      ...pageContext,
      selection: 'selected input text',
    };

    const result = formatPageContextForPrompt([contextWithSelection]);

    expect(result).toContain('Selected text:');
    expect(result).toContain('selected input text');
    expect(result).toContain('Page content:');
    expect(result).toContain('HyperFrames builds interactive Frames');
  });

  it('derives preview labels and token estimates from readable context', () => {
    expect(getContextPreviewLabel([])).toBe('No page context');
    expect(getContextPreviewLabel([pageContext])).toBe('HyperFrames / X');
    expect(getContextPreviewLabel([{ ...pageContext, selection: 'selected input text' }])).toBe('Selection attached');
    expect(estimateContextTokens([pageContext])).toBeGreaterThan(0);
  });

  it('merges page context into the latest user message', () => {
    const messages = [
      makeMessage('user', 'hello', 'user-1'),
      makeMessage('assistant', 'Hi', 'assistant-1'),
      makeMessage('user', 'whats on this page', 'user-2'),
    ];

    const result = addPageContextToLatestUserMessage(messages, [pageContext]);

    expect(result).not.toBe(messages);
    expect(result[0]?.content).toBe('hello');
    expect(result[2]?.content).toContain('Use this current page context');
    expect(result[2]?.content).toContain('Title: HyperFrames / X');
    expect(result[2]?.content).toContain('User request:\n\nwhats on this page');
  });

  it('does not duplicate context that quick actions already embedded', () => {
    const messages = [
      makeMessage('user', '**Context from current page:**\n**Page Title:** HyperFrames\n\nSummarize this.'),
    ];

    expect(addPageContextToLatestUserMessage(messages, [pageContext])).toBe(messages);
  });

  it('injects context when the user naturally asks for current page context', () => {
    const messages = [
      makeMessage('user', 'Please use the current page context to answer this.'),
    ];

    const result = addPageContextToLatestUserMessage(messages, [pageContext]);

    expect(result).not.toBe(messages);
    expect(result[0]?.content).toContain('Title: HyperFrames / X');
    expect(result[0]?.content).toContain('User request:\n\nPlease use the current page context to answer this.');
  });

  it('still injects context when only an older message had page context', () => {
    const messages = [
      makeMessage('user', '**Context from current page:**\n**Page Title:** Old page\n\nSummarize this.', 'user-1'),
      makeMessage('assistant', 'Summary', 'assistant-1'),
      makeMessage('user', 'whats on this page now', 'user-2'),
    ];

    const result = addPageContextToLatestUserMessage(messages, [pageContext]);

    expect(result[0]).toBe(messages[0]);
    expect(result[2]?.content).toContain('Title: HyperFrames / X');
    expect(result[2]?.content).toContain('User request:\n\nwhats on this page now');
  });
});
