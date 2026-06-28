import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('background provider routing', () => {
  it('does not silently fall back to another configured provider', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/background/service-worker.ts'), 'utf8');

    expect(source).not.toContain('getFallbackProvider');
    expect(source).not.toContain('falling back to');
  });
});
