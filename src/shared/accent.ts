import type { ExtensionSettings } from './types';

export const DEFAULT_ACCENT_COLOR = '#3b82f6';
export const AID_ACCENT_STORAGE_KEY = 'aid-accent-color';

export const ACCENT_COLOR_OPTIONS = [
  { value: '#3b82f6', label: 'Blue' },
  { value: '#14b8a6', label: 'Teal' },
  { value: '#22c55e', label: 'Green' },
  { value: '#f59e0b', label: 'Amber' },
  { value: '#ef4444', label: 'Red' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#8b5cf6', label: 'Violet' },
  { value: '#64748b', label: 'Slate' },
];

const HEX_COLOR_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export const normalizeAccentColor = (color?: string): string => {
  const value = color?.trim();

  if (!value || !HEX_COLOR_PATTERN.test(value)) {
    return DEFAULT_ACCENT_COLOR;
  }

  const hex = value.startsWith('#') ? value.slice(1) : value;
  const normalized = hex.length === 3
    ? hex.split('').map((part) => `${part}${part}`).join('')
    : hex;

  return `#${normalized.toLowerCase()}`;
};

export const resolveAccentColor = (settings?: Pick<ExtensionSettings, 'accentColor'>): string => (
  normalizeAccentColor(settings?.accentColor)
);

export const getAccentFocusRing = (accentColor: string): string => {
  const normalized = normalizeAccentColor(accentColor);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);

  return `rgba(${red}, ${green}, ${blue}, 0.16)`;
};

export const applyAccentColorToDocument = (
  accentColor: string,
  target: HTMLElement = document.documentElement
) => {
  const normalized = normalizeAccentColor(accentColor);

  target.style.setProperty('--accent', normalized);
  target.style.setProperty('--accent-strong', normalized);
  target.style.setProperty('--success', normalized);

  return normalized;
};
