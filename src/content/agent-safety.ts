import type {
  AgentActionAssessment,
  AgentElementAction,
} from '@/shared/agent';
import { ContextCollector } from '@/shared/context-collector';

const SENSITIVE_FIELD_PATTERN =
  /(password|passcode|one[- ]?time|otp|2fa|secret|token|api[- ]?key|private[- ]?key|credit[- ]?card|card[- ]?number|cc-number|cvv|cvc|ssn|social[- ]?security)/i;
const CONFIRM_ACTION_PATTERN =
  /\b(submit|send|publish|post|delete|remove|archive|unsubscribe|buy|purchase|order|checkout|pay|transfer|book|reserve|sign[ -]?in|log[ -]?in|sign[ -]?up|create account|authorize|allow access|connect account)\b/i;
const VALUE_ATTRIBUTE_PATTERN = /\svalue=(?:"[^"]*"|'[^']*'|.*?)(?=\s(?:title|type|checked|name|role|placeholder|data-[\w-]+|alt|aria-[\w-]+|id|for|target|contenteditable)=|>)/gi;
export const MAX_AGENT_PAGE_CONTENT_CHARS = 32_000;

export const SENSITIVE_ELEMENT_SELECTOR = [
  'input[type="password"]',
  'input[type="file"]',
  'input[autocomplete^="cc-"]',
  'input[autocomplete="one-time-code"]',
  '[data-aid-agent-sensitive="true"]',
].join(',');

export const sanitizeAgentPageContent = (content: string): string => ContextCollector.redactSensitiveText(
  content
    .split('\n')
    .map((line) => line.replace(VALUE_ATTRIBUTE_PATTERN, ''))
    .join('\n')
).slice(0, MAX_AGENT_PAGE_CONTENT_CHARS);

export const findAgentElementDescriptor = (content: string, index: number): string => {
  const marker = new RegExp(`\\*?\\[${index}\\]`);
  const match = marker.exec(content);
  if (!match) {
    return '';
  }

  const remainder = content.slice(match.index);
  const afterMarker = remainder.slice(match[0].length);
  const nextMarkerIndex = afterMarker.search(/\s+\*?\[\d+\]</);
  const lineEndIndex = remainder.indexOf('\n');
  const endIndex = nextMarkerIndex === -1
    ? lineEndIndex === -1 ? remainder.length : lineEndIndex
    : match[0].length + nextMarkerIndex;
  const candidate = remainder.slice(0, endIndex).trim().replace(/^\*/, '');
  const tagName = candidate.match(/^\*?\[\d+\]<([a-z][\w-]*)\b/i)?.[1]?.toLowerCase();
  const openingEnd = candidate.indexOf('>');
  if (!tagName || openingEnd === -1) {
    return candidate;
  }

  const serializedClose = candidate.indexOf('/>', openingEnd + 1);
  if (serializedClose !== -1) {
    return candidate.slice(0, serializedClose + 2).trim();
  }

  const closingTag = `</${tagName}>`;
  const closingTagIndex = candidate.toLowerCase().indexOf(closingTag, openingEnd + 1);
  if (closingTagIndex !== -1) {
    return candidate.slice(0, closingTagIndex + closingTag.length).trim();
  }

  return tagName === 'input' ? candidate.slice(0, openingEnd + 1).trim() : candidate;
};

export const requiresAgentActionConfirmation = (label: string): boolean =>
  /\btype=submit\b/i.test(label) || CONFIRM_ACTION_PATTERN.test(label);

export const assessAgentAction = (
  content: string,
  action: AgentElementAction,
  index: number
): AgentActionAssessment => {
  const label = findAgentElementDescriptor(content, index);
  const fingerprint = `${action}:${index}:${label}`;

  if (!label) {
    return {
      decision: 'block',
      action,
      index,
      label: `Element ${index}`,
      reason: 'The page changed and the target is no longer available.',
      fingerprint,
    };
  }

  if (SENSITIVE_FIELD_PATTERN.test(label) || /\btype=(?:password|file)\b/i.test(label)) {
    return {
      decision: 'block',
      action,
      index,
      label,
      reason: 'Aid does not operate credential, payment, secret, or file fields.',
      fingerprint,
    };
  }

  if (action === 'click' && /<(?:a|area)\b/i.test(label)) {
    return {
      decision: 'block',
      action,
      index,
      label,
      reason: 'Use the Agent navigation tool for links.',
      fingerprint,
    };
  }

  return {
    decision: 'allow',
    action,
    index,
    label,
    reason: 'Allowed by the current-page action policy.',
    fingerprint,
  };
};

export const markSensitiveAgentElements = (root: ParentNode = document): HTMLElement[] => {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>(
    'input, textarea, select, button, label, [contenteditable="true"], .aid-context-menu'
  ));

  return candidates.filter((element) => {
    const descriptor = [
      element.tagName,
      element.getAttribute('type'),
      element.getAttribute('name'),
      element.getAttribute('id'),
      element.getAttribute('placeholder'),
      element.getAttribute('autocomplete'),
      element.getAttribute('aria-label'),
    ].filter(Boolean).join(' ');

    const wrapsSensitiveControl = element.tagName === 'LABEL' && Boolean(
      element.querySelector?.(SENSITIVE_ELEMENT_SELECTOR)
    );
    if (
      !element.matches(SENSITIVE_ELEMENT_SELECTOR) &&
      !wrapsSensitiveControl &&
      !SENSITIVE_FIELD_PATTERN.test(descriptor)
    ) {
      return false;
    }

    if (!element.hasAttribute('data-page-agent-not-interactive')) {
      element.setAttribute('data-page-agent-not-interactive', '');
      element.setAttribute('data-aid-agent-marked', '');
    }
    return true;
  });
};

export const clearSensitiveAgentElementMarks = (root: ParentNode = document): void => {
  root.querySelectorAll<HTMLElement>('[data-aid-agent-marked]').forEach((element) => {
    element.removeAttribute('data-page-agent-not-interactive');
    element.removeAttribute('data-aid-agent-marked');
  });
};
