import { describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({ default: { tabs: { sendMessage: vi.fn() } } }));
import {
  sanitizeAgentRunReceipt,
  summarizeAgentTokenUsage,
} from './agent-receipts';

describe('Agent receipt sanitization', () => {
  it('keeps only safe receipt fields and aggregates usage without retaining raw history', () => {
    const secret = 'sk-super-secret-123456';
    const history = [{
      type: 'step',
      reflection: { memory: secret },
      action: { name: 'input_text', input: { text: secret }, output: `value=${secret}` },
      usage: { promptTokens: 11, completionTokens: 4, totalTokens: 15 },
      rawRequest: { prompt: secret },
      rawResponse: { answer: secret },
    }];
    const receipt = sanitizeAgentRunReceipt({
      runId: 'agent_1',
      taskMessageId: 'user_1',
      pageUrl: 'https://name:password@example.com/account/billing?token=secret#private',
      pageTitle: `Account token=${secret}`,
      startedAt: 10,
      completedAt: 20,
      status: 'failed',
      tokenUsage: summarizeAgentTokenUsage(history),
      steps: [{
        tool: 'input',
        targetLabel: `<input name="notes" value="${secret}">`,
        outcome: 'failed',
        approvalState: 'not_required',
        durationMs: 8,
        failure: `Authorization=${secret}`,
        enteredText: secret,
        observation: secret,
      }],
      history,
      reflection: secret,
      rawRequest: secret,
      rawResponse: secret,
    });

    expect(receipt).not.toBeNull();
    expect(receipt?.pageUrl).toBe('https://example.com/account/[private]');
    expect(receipt?.tokenUsage).toEqual({ promptTokens: 11, completionTokens: 4, totalTokens: 15 });
    expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(JSON.stringify(receipt)).not.toMatch(/history|reflection|rawRequest|rawResponse|enteredText|observation/);
    expect(receipt?.steps[0]?.targetLabel).toBe('<input name="notes">');
  });
});
