import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DataDisclosure } from './DataDisclosure';

describe('DataDisclosure', () => {
  it('makes all-websites access the clear recommended choice with a per-site fallback', () => {
    const html = renderToStaticMarkup(
      <DataDisclosure onAccept={vi.fn().mockResolvedValue(true)} />
    );

    expect(html).toContain('Allow on all websites');
    expect(html).toContain('Ask for each website');
    expect(html).toContain('Permission alone does not send page content');
    expect(html).toContain('reads the current page locally');
    expect(html.indexOf('Allow on all websites')).toBeLessThan(html.indexOf('Ask for each website'));
  });
});
