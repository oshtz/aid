import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ContextInspector } from './ContextInspector';
import type { TabContext } from '@/shared/types';

const context: TabContext = {
  title: 'Launch Review',
  url: 'https://example.com/review',
  selection: 'Selected approval text',
  abstract: 'Visible page status: API token [redacted] is already scrubbed.',
};

describe('ContextInspector', () => {
  it('renders attach state, token estimate, and redacted provider context preview', () => {
    const html = renderToStaticMarkup(
      <ContextInspector
        contexts={[context]}
        isAttached
        isOpen
        onRefresh={vi.fn()}
        onToggleAttached={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(html).toContain('Attach context');
    expect(html).toContain('Selection attached');
    expect(html).toContain('tokens');
    expect(html).toContain('Provider prompt context');
    expect(html).toContain('Redacted preview');
    expect(html).toContain('Title: Launch Review');
    expect(html).toContain('Selected text:');
    expect(html).toContain('Selected approval text');
    expect(html).toContain('[redacted]');
  });

  it('shows prompt-only state when context attachment is disabled', () => {
    const html = renderToStaticMarkup(
      <ContextInspector
        contexts={[context]}
        isAttached={false}
        isOpen={false}
        onRefresh={vi.fn()}
        onToggleAttached={vi.fn()}
        onToggleOpen={vi.fn()}
      />
    );

    expect(html).toContain('Context detached');
    expect(html).toContain('Prompt only');
    expect(html).not.toContain('Provider prompt context');
  });
});
