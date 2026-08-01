import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_DISCLOSURE_ERROR } from '@/shared/disclosure';

describe('background provider routing', () => {
  it('does not silently fall back to another configured provider', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/background/service-worker.ts'), 'utf8');

    expect(source).not.toContain('getFallbackProvider');
    expect(source).not.toContain('falling back to');
  });

  it('registers wake-up listeners synchronously and avoids cross-window tab scans', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/background/service-worker.ts'), 'utf8');
    const constructor = source.slice(
      source.indexOf('constructor()'),
      source.indexOf('private async resolveModelForProvider')
    );

    expect(constructor).toContain('browser.runtime.onMessage.addListener');
    expect(constructor).toContain('browser.runtime.onInstalled.addListener');
    expect(constructor).not.toContain('await ');
    expect(source).toContain('await this.settingsReady');
    expect(source).not.toContain("source: 'all-tabs'");
    expect(source).not.toContain("source: 'all-active-tabs'");
  });

  it('enforces disclosure before page or provider work', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/background/service-worker.ts'), 'utf8');

    expect(source).toContain('messageRequiresDataDisclosure(message.type)');
    expect(source).toContain('hasAcceptedDataDisclosure(this.settingsService.getSettings())');
    expect(DATA_DISCLOSURE_ERROR).toContain('accept Aid');
  });

  it('reports missing host permission without parsing browser-specific errors', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/background/service-worker.ts'), 'utf8');

    expect(source).toContain('permissionRequired = !(await browser.permissions.contains');
    expect(source).toContain('contentDiagnostic.permissionRequired = scriptStatus.permissionRequired');
  });
});
