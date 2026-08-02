import type {
  AgentReceiptApprovalState,
  AgentReceiptStatus,
  AgentReceiptStep,
  AgentReceiptStepOutcome,
  AgentRunReceipt,
  TokenUsage,
} from './types';
import { ContextCollector } from './context-collector';
import { sanitizePageUrl } from './page-context-safety';

const RECEIPT_STATUSES = new Set<AgentReceiptStatus>(['completed', 'failed', 'stopped']);
const STEP_OUTCOMES = new Set<AgentReceiptStepOutcome>(['completed', 'failed', 'blocked', 'denied']);
const APPROVAL_STATES = new Set<AgentReceiptApprovalState>(['not_required', 'approved', 'denied', 'blocked', 'cancelled']);
const SECRET_ASSIGNMENT = /\b(password|passcode|secret|token|api[-_ ]?key|authorization)\b\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
const SECRET_TOKEN = /\b(?:sk|pk|api|token)[-_][a-z0-9_-]{8,}\b/gi;
const VALUE_ATTRIBUTE = /\svalue=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
const URL_CREDENTIALS = /(https?:\/\/)[^/@\s]+@/gi;

const recordOf = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const finiteInteger = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): number => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(Math.floor(value), 0), maximum)
    : 0
);

const safeId = (value: unknown): string => (
  typeof value === 'string' ? value.replace(/[^a-z0-9_-]/gi, '').slice(0, 128) : ''
);

const withoutControlCharacters = (value: string): string => Array.from(value, (character) => {
  const code = character.charCodeAt(0);
  return code < 32 || code === 127 ? ' ' : character;
}).join('');

export const sanitizeAgentReceiptText = (value: unknown, maximumLength: number): string => {
  if (typeof value !== 'string') return '';
  return ContextCollector.redactSensitiveText(withoutControlCharacters(value)
    .replace(VALUE_ATTRIBUTE, '')
    .replace(SECRET_ASSIGNMENT, '$1=[redacted]')
    .replace(SECRET_TOKEN, '[redacted]')
    .replace(URL_CREDENTIALS, '$1[redacted]@')
    .replace(/\s+/g, ' ')
    .trim())
    .slice(0, maximumLength);
};

export const sanitizeAgentReceiptUrl = sanitizePageUrl;

export const summarizeAgentTokenUsage = (history: unknown): TokenUsage => {
  const usage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  if (!Array.isArray(history)) return usage;

  for (const event of history) {
    const eventRecord = recordOf(event);
    const eventUsage = eventRecord?.type === 'step' ? recordOf(eventRecord.usage) : null;
    if (!eventUsage) continue;
    usage.promptTokens += finiteInteger(eventUsage.promptTokens);
    usage.completionTokens += finiteInteger(eventUsage.completionTokens);
    usage.totalTokens += finiteInteger(eventUsage.totalTokens);
  }
  return usage;
};

export const sanitizeAgentReceiptStep = (value: unknown): AgentReceiptStep | null => {
  const step = recordOf(value);
  if (!step) return null;
  const tool = typeof step.tool === 'string'
    ? step.tool.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48)
    : '';
  const targetLabel = sanitizeAgentReceiptText(step.targetLabel, 160);
  const outcome = STEP_OUTCOMES.has(step.outcome as AgentReceiptStepOutcome)
    ? step.outcome as AgentReceiptStepOutcome
    : null;
  const approvalState = APPROVAL_STATES.has(step.approvalState as AgentReceiptApprovalState)
    ? step.approvalState as AgentReceiptApprovalState
    : null;
  if (!tool || !targetLabel || !outcome || !approvalState) return null;

  const failure = sanitizeAgentReceiptText(step.failure, 240);
  return {
    tool,
    targetLabel,
    outcome,
    approvalState,
    durationMs: finiteInteger(step.durationMs, 60 * 60 * 1000),
    ...(failure ? { failure } : {}),
  };
};

export const sanitizeAgentRunReceipt = (value: unknown): AgentRunReceipt | null => {
  const receipt = recordOf(value);
  if (!receipt) return null;
  const runId = safeId(receipt.runId);
  const taskMessageId = safeId(receipt.taskMessageId);
  const status = RECEIPT_STATUSES.has(receipt.status as AgentReceiptStatus)
    ? receipt.status as AgentReceiptStatus
    : null;
  const usage = recordOf(receipt.tokenUsage);
  if (!runId || !taskMessageId || !status || !usage) return null;

  const steps = Array.isArray(receipt.steps)
    ? receipt.steps.map(sanitizeAgentReceiptStep).filter((step): step is AgentReceiptStep => step !== null).slice(0, 48)
    : [];
  return {
    runId,
    taskMessageId,
    pageUrl: sanitizeAgentReceiptUrl(receipt.pageUrl),
    pageTitle: sanitizeAgentReceiptText(receipt.pageTitle, 160) || 'Untitled page',
    startedAt: finiteInteger(receipt.startedAt),
    completedAt: finiteInteger(receipt.completedAt),
    status,
    tokenUsage: {
      promptTokens: finiteInteger(usage.promptTokens),
      completionTokens: finiteInteger(usage.completionTokens),
      totalTokens: finiteInteger(usage.totalTokens),
    },
    steps,
  };
};

export const sanitizeAgentReceipts = (value: unknown): AgentRunReceipt[] => (
  Array.isArray(value)
    ? value.map(sanitizeAgentRunReceipt).filter((receipt): receipt is AgentRunReceipt => receipt !== null).slice(0, 100)
    : []
);
