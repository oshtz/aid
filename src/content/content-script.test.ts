import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('content script startup', () => {
  it('does not register page listeners twice when context refreshes race', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/content/content-script.ts'), 'utf8');

    expect(source).toContain('if (!aidWindow.aidContentScript)');
    expect(source.match(/new ContentScript\(\)/g)).toHaveLength(1);
  });
});
