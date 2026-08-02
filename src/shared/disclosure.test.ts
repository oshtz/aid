import { describe, expect, it } from 'vitest';
import {
  DATA_DISCLOSURE_VERSION,
  hasAcceptedDataDisclosure,
  messageRequiresDataDisclosure,
} from './disclosure';

describe('data disclosure enforcement', () => {
  it('requires the current disclosure for page and provider operations', () => {
    expect(hasAcceptedDataDisclosure()).toBe(false);
    expect(hasAcceptedDataDisclosure({ dataDisclosureVersion: DATA_DISCLOSURE_VERSION - 1 })).toBe(false);
    expect(hasAcceptedDataDisclosure({ dataDisclosureVersion: DATA_DISCLOSURE_VERSION })).toBe(true);
    expect(messageRequiresDataDisclosure('GET_TAB_CONTEXT')).toBe(true);
    expect(messageRequiresDataDisclosure('CHAT_REQUEST')).toBe(true);
    expect(messageRequiresDataDisclosure('TEST_PROVIDER')).toBe(true);
    expect(messageRequiresDataDisclosure('UPDATE_SETTINGS')).toBe(false);
    expect(messageRequiresDataDisclosure('GET_SETTINGS')).toBe(false);
  });
});
