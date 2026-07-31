import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveActivationModel } from '@/shared/provider-ux';

describe('provider activation model selection', () => {
  it('prefers manual, then saved, then recommended discovered models', () => {
    const models = ['other/model', 'openai/gpt-4o-mini'];
    expect(resolveActivationModel('openrouter', models, 'manual/model', 'other/model')).toBe('manual/model');
    expect(resolveActivationModel('openrouter', models, '', 'other/model')).toBe('other/model');
    expect(resolveActivationModel('openrouter', models, '')).toBe('openai/gpt-4o-mini');
    expect(resolveActivationModel('ollama', [], '')).toBeUndefined();
  });

  it('requests browser permission before the first provider message', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/sidepanel/components/ProviderActivation.tsx'), 'utf8');
    const connectStart = source.indexOf('const connect = async');
    const connect = source.slice(connectStart, source.indexOf('\n  return (', connectStart));

    expect(connect.indexOf('await ensureOriginPermissions(')).toBeLessThan(
      connect.indexOf('await browser.runtime.sendMessage(')
    );
  });
});
