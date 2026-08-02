import type { ExtensionSettings, MessageType } from './types';

export const DATA_DISCLOSURE_VERSION = 1;
export const DATA_DISCLOSURE_ERROR = 'Review and accept Aid\'s data disclosure before using page or provider features.';

const DISCLOSURE_GATED_MESSAGES = new Set<MessageType>([
  'CHAT_REQUEST',
  'GET_TAB_CONTEXT',
  'TEST_PROVIDER',
  'GET_PROVIDER_MODELS',
  'OPEN_SIDE_PANEL_WITH_SELECTION',
  'EXPLAIN_SELECTION',
  'TRANSLATE_SELECTION',
  'SUMMARIZE_PAGE',
  'EXTRACT_KEY_POINTS',
  'MAKE_LIST',
]);

export const hasAcceptedDataDisclosure = (settings?: Pick<ExtensionSettings, 'dataDisclosureVersion'>): boolean => (
  (settings?.dataDisclosureVersion || 0) >= DATA_DISCLOSURE_VERSION
);

export const messageRequiresDataDisclosure = (type: MessageType): boolean => (
  DISCLOSURE_GATED_MESSAGES.has(type)
);
