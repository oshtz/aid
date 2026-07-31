import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({ default: { tabs: { sendMessage: vi.fn() } } }));
import {
  MAX_PINNED_CONTEXTS,
  sanitizePinnedContexts,
  upsertPinnedContext,
} from './pinned-context';
import type { PinnedPageContext, TabContext } from './types';

const page = (url: string, title: string): TabContext => ({ url, title, abstract: `${title} content` });

describe('pinned page contexts', () => {
  it('updates a duplicate sanitized URL in place and rejects a fourth page', () => {
    let pins: PinnedPageContext[] = [];
    pins = upsertPinnedContext(pins, page('https://example.com/a?first=1', 'First'), 1, 'pin_1');
    pins = upsertPinnedContext(pins, page('https://example.com/b', 'Second'), 2, 'pin_2');
    pins = upsertPinnedContext(pins, page('https://example.com/a?second=2#hash', 'First updated'), 3, 'pin_new');

    expect(pins).toHaveLength(2);
    expect(pins[0]).toMatchObject({ id: 'pin_1', capturedAt: 3, context: { title: 'First updated' } });

    pins = upsertPinnedContext(pins, page('https://example.com/c', 'Third'), 4, 'pin_3');
    const fullPins = pins;
    pins = upsertPinnedContext(pins, page('https://example.com/d', 'Fourth'), 5, 'pin_4');
    expect(fullPins).toHaveLength(MAX_PINNED_CONTEXTS);
    expect(pins).toBe(fullPins);
  });

  it('normalizes imported pins, deduplicates URLs, and clips the list to three', () => {
    const pins = sanitizePinnedContexts([
      { id: 'one', capturedAt: 1, context: page('https://user:secret@example.com/a?q=1', 'One') },
      { id: 'one-new', capturedAt: 2, context: page('https://example.com/a?q=2', 'One updated') },
      {
        id: 'two',
        capturedAt: 3,
        context: {
          ...page('https://example.com/b', 'Two'),
          abstract: 'Imported payload sk-import-secret-123456',
        },
      },
      { id: 'three', capturedAt: 4, context: page('https://example.com/c', 'Three') },
      { id: 'four', capturedAt: 5, context: page('https://example.com/d', 'Four') },
      { id: 'invalid', capturedAt: 6, context: page('file:///private/report', 'Private') },
    ]);

    expect(pins).toHaveLength(3);
    expect(pins[0]).toMatchObject({ id: 'one', context: { title: 'One updated', url: 'https://example.com/a' } });
    expect(pins.map((pin) => pin.context.title)).toEqual(['One updated', 'Two', 'Three']);
    expect(JSON.stringify(pins)).not.toContain('sk-import-secret-123456');
  });
});
