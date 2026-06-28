import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarkdownRenderer } from './MarkdownRenderer';

describe('MarkdownRenderer', () => {
  it('decodes HTML entities in rendered prose', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={'A &quot;Frame&quot; project&#39;s platform &amp; docs'} />
    );

    expect(html).toContain('A &quot;Frame&quot; project&#x27;s platform &amp; docs');
    expect(html).not.toContain('&amp;quot;');
    expect(html).not.toContain('&amp;#39;');
  });

  it('preserves HTML entities inside code spans', () => {
    const html = renderToStaticMarkup(
      <MarkdownRenderer content={'Use `&quot;Frame&quot;` literally'} />
    );

    expect(html).toContain('<code class="markdown-inline-code">&amp;quot;Frame&amp;quot;</code>');
  });

  it('only shows the streaming cursor when streaming is explicit', () => {
    const completedHtml = renderToStaticMarkup(
      <MarkdownRenderer content={'Finished response with an unmatched marker ('} />
    );
    const streamingHtml = renderToStaticMarkup(
      <MarkdownRenderer content={'Streaming response'} isStreaming />
    );

    expect(completedHtml).not.toContain('markdown-streaming');
    expect(streamingHtml).toContain('markdown-streaming');
  });
});
