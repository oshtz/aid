import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({
  default: { tabs: { sendMessage: vi.fn() } },
}));

import {
  assessAgentAction,
  MAX_AGENT_PAGE_CONTENT_CHARS,
  markSensitiveAgentElements,
  sanitizeAgentPageContent,
} from './agent-safety';

describe('Agent page safety', () => {
  it('removes live values, secret tokens, and sensitive field lines', () => {
    const content = [
      '[1]<input type=text value="Omer" placeholder="Name">',
      '[2]<input type=password value="hunter2">',
      'API result sk-abcdefghijklmnopqrstuvwxyz1234',
    ].join('\n');

    const sanitized = sanitizeAgentPageContent(content);

    expect(sanitized).toContain('[1]<input type=text placeholder="Name">');
    expect(sanitized).not.toContain('Omer');
    expect(sanitized).not.toContain('hunter2');
    expect(sanitized).not.toContain('sk-abcdefghijklmnopqrstuvwxyz1234');
    expect(sanitized).toContain('[redacted]');
  });

  it('caps dense page observations to the shared 8,000-token envelope', () => {
    expect(sanitizeAgentPageContent('visible '.repeat(10_000))).toHaveLength(
      MAX_AGENT_PAGE_CONTENT_CHARS
    );
  });

  it('allows ordinary controls, confirms consequential actions, and routes links through navigation policy', () => {
    const content = 'Page *[1]<button>Open filters /> Consequential *[2]<button type=submit>Publish /> Blocked controls Account password *[3]<a>Next page />';

    expect(assessAgentAction(content, 'click', 1).decision).toBe('allow');
    expect(assessAgentAction(content, 'click', 2).decision).toBe('confirm');
    expect(assessAgentAction(content, 'click', 3).decision).toBe('block');
    expect(assessAgentAction(content, 'click', 99).decision).toBe('block');
  });

  it('keeps fingerprints stable when the upstream new-element marker clears', () => {
    const first = assessAgentAction('*[3]<button type=submit>Publish report />', 'click', 3);
    const next = assessAgentAction('[3]<button type=submit>Publish report />', 'click', 3);

    expect(first.fingerprint).toBe(next.fingerprint);
  });

  it('marks sensitive controls as non-interactive', () => {
    const attributes = new Map<string, string>([
      ['type', 'password'],
      ['name', 'account-password'],
    ]);
    const element = {
      tagName: 'INPUT',
      getAttribute: (name: string) => attributes.get(name) || null,
      hasAttribute: (name: string) => attributes.has(name),
      matches: () => true,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    } as unknown as HTMLElement;
    const root = {
      querySelectorAll: () => [element],
    } as unknown as ParentNode;

    expect(markSensitiveAgentElements(root)).toEqual([element]);
    expect(attributes.has('data-page-agent-not-interactive')).toBe(true);
    expect(attributes.has('data-aid-agent-marked')).toBe(true);
  });
});
