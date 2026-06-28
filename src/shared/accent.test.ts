import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCENT_COLOR,
  getAccentFocusRing,
  normalizeAccentColor,
  resolveAccentColor,
} from './accent';

describe('accent color helpers', () => {
  it('normalizes valid hex colors', () => {
    expect(normalizeAccentColor('#ABCDEF')).toBe('#abcdef');
    expect(normalizeAccentColor('0f8')).toBe('#00ff88');
  });

  it('falls back to the default accent for invalid colors', () => {
    expect(normalizeAccentColor('tomato')).toBe(DEFAULT_ACCENT_COLOR);
    expect(normalizeAccentColor('#12')).toBe(DEFAULT_ACCENT_COLOR);
    expect(resolveAccentColor()).toBe(DEFAULT_ACCENT_COLOR);
  });

  it('builds a matching focus ring color', () => {
    expect(getAccentFocusRing('#0f8')).toBe('rgba(0, 255, 136, 0.16)');
  });
});
