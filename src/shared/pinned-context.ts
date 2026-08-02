import { hasReadableTabContext } from './chat-context';
import { ContextCollector } from './context-collector';
import { sanitizePageUrl } from './page-context-safety';
import type { PinnedPageContext, TabContext } from './types';

export const MAX_PINNED_CONTEXTS = 3;

const recordOf = (value: unknown): Record<string, unknown> | null => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
);

const safeText = (value: unknown, maximumLength: number): string => (
  typeof value === 'string' ? ContextCollector.redactSensitiveText(value).slice(0, maximumLength) : ''
);

const sanitizeSnapshotContext = (value: unknown): TabContext | null => {
  const context = recordOf(value);
  if (!context) return null;
  const url = sanitizePageUrl(context.url);
  if (!url) return null;
  const selection = safeText(context.selection, 8_000);
  const snapshot: TabContext = {
    url,
    title: safeText(context.title, 300),
    abstract: safeText(context.abstract, 32_000),
    ...(selection ? { selection } : {}),
  };
  return hasReadableTabContext(snapshot) ? snapshot : null;
};

export const sanitizePinnedPageContext = (value: unknown): PinnedPageContext | null => {
  const pin = recordOf(value);
  if (!pin) return null;
  const context = sanitizeSnapshotContext(pin.context);
  const id = typeof pin.id === 'string' ? pin.id.replace(/[^a-z0-9_-]/gi, '').slice(0, 128) : '';
  if (!context || !id) return null;
  return {
    id,
    capturedAt: typeof pin.capturedAt === 'number' && Number.isFinite(pin.capturedAt)
      ? Math.max(0, Math.floor(pin.capturedAt))
      : 0,
    context,
  };
};

export const sanitizePinnedContexts = (value: unknown): PinnedPageContext[] => {
  if (!Array.isArray(value)) return [];
  const pins: PinnedPageContext[] = [];
  for (const candidate of value) {
    const pin = sanitizePinnedPageContext(candidate);
    if (!pin) continue;
    const duplicateIndex = pin.context.url
      ? pins.findIndex((current) => current.context.url === pin.context.url)
      : -1;
    if (duplicateIndex >= 0) {
      pins[duplicateIndex] = { ...pin, id: pins[duplicateIndex]?.id || pin.id };
    } else if (pins.length < MAX_PINNED_CONTEXTS) {
      pins.push(pin);
    }
  }
  return pins;
};

export const upsertPinnedContext = (
  pins: PinnedPageContext[],
  context: TabContext,
  capturedAt: number,
  id: string
): PinnedPageContext[] => {
  const pin = sanitizePinnedPageContext({ id, capturedAt, context });
  if (!pin) return pins;
  const duplicateIndex = pin.context.url
    ? pins.findIndex((current) => current.context.url === pin.context.url)
    : -1;
  if (duplicateIndex >= 0) {
    return pins.map((current, index) => index === duplicateIndex
      ? { ...pin, id: current.id }
      : current);
  }
  return pins.length < MAX_PINNED_CONTEXTS ? [...pins, pin] : pins;
};
