import browser from 'webextension-polyfill';
import { ContextCollector } from '@/shared/context-collector';
import { AID_ACCENT_STORAGE_KEY, getAccentFocusRing, normalizeAccentColor } from '@/shared/accent';
import type { ExtensionMessage, TabContext } from '@/shared/types';

type AidMenuThemeName = 'light' | 'dark';

interface AidMenuTheme {
  name: AidMenuThemeName;
  colorScheme: AidMenuThemeName;
  fontSans: string;
  fontDisplay: string;
  surfaceOverlay: string;
  surfaceHover: string;
  textSoft: string;
  text: string;
  muted: string;
  line: string;
  lineStrong: string;
  accent: string;
  focusRing: string;
  shadow: string;
  radius: string;
  ease: string;
}

interface TabContextOptions {
  maxTokens?: number;
  includeSelection?: boolean;
  sanitizeUrls?: boolean;
}

const AID_THEME_STORAGE_KEY = 'aid-theme';
const AID_CONTEXT_MENU_FONT_STYLE_ID = 'aid-context-menu-fonts';

const AID_MENU_THEMES: Record<AidMenuThemeName, AidMenuTheme> = {
  dark: {
    name: 'dark',
    colorScheme: 'dark',
    fontSans: '"Aid Instrument Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontDisplay: '"Aid Momo Trust Display", "Aid Instrument Sans", ui-sans-serif, system-ui, sans-serif',
    surfaceOverlay: 'rgba(17, 17, 17, 0.94)',
    surfaceHover: '#1c1c1c',
    textSoft: '#d4d4d4',
    text: '#f5f5f5',
    muted: '#858585',
    line: 'rgba(255, 255, 255, 0.09)',
    lineStrong: 'rgba(255, 255, 255, 0.16)',
    accent: '#3b82f6',
    focusRing: 'rgba(59, 130, 246, 0.16)',
    shadow: '0 22px 60px rgba(0, 0, 0, 0.42)',
    radius: '8px',
    ease: '180ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
  light: {
    name: 'light',
    colorScheme: 'light',
    fontSans: '"Aid Instrument Sans", Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontDisplay: '"Aid Momo Trust Display", "Aid Instrument Sans", ui-sans-serif, system-ui, sans-serif',
    surfaceOverlay: 'rgba(255, 255, 255, 0.94)',
    surfaceHover: '#eeeeee',
    textSoft: '#3f3f46',
    text: '#0a0a0a',
    muted: '#737373',
    line: 'rgba(0, 0, 0, 0.1)',
    lineStrong: 'rgba(0, 0, 0, 0.18)',
    accent: '#2563eb',
    focusRing: 'rgba(37, 99, 235, 0.16)',
    shadow: '0 22px 60px rgba(0, 0, 0, 0.12)',
    radius: '8px',
    ease: '180ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
} as const;

const isAidMenuThemeName = (value: unknown): value is AidMenuThemeName => (
  value === 'light' || value === 'dark'
);

/**
 * Enhanced content script for extracting page context and handling selection
 */
class ContentScript {
  private lastSelection = '';
  private selectionTimeout: NodeJS.Timeout | null = null;
  private contextMenu: HTMLElement | null = null;

  constructor() {
    this.initialize();
  }

  private initialize() {
    // Listen for messages from background script
    browser.runtime.onMessage.addListener(this.handleMessage.bind(this));

    // Track text selection changes
    document.addEventListener('selectionchange', this.handleSelectionChange.bind(this));

    // Handle mouse up for selection context menu
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));

    // Handle clicks to hide context menu
    document.addEventListener('click', this.handleDocumentClick.bind(this));
  }

  private async handleMessage(message: ExtensionMessage): Promise<unknown> {
    switch (message.type) {
      case 'PING':
        // Respond to ping to confirm content script is active
        return { pong: true };

      case 'GET_TAB_CONTEXT':
        return this.getTabContext(message.payload as TabContextOptions);

      case 'ASK_AID_SELECTION':
        return this.handleAskAidSelection();

      case 'SUMMARIZE_PAGE':
        return this.handleSummarizePage();

      default:
        return null;
    }
  }

  private handleSelectionChange() {
    const selection = document.getSelection();
    const newSelection = selection?.toString().trim() || '';

    if (newSelection !== this.lastSelection) {
      this.lastSelection = newSelection;

      // Clear existing timeout
      if (this.selectionTimeout) {
        clearTimeout(this.selectionTimeout);
      }

      // Hide context menu if selection is cleared
      if (!newSelection) {
        this.hideContextMenu();
      }
    }
  }

  private handleMouseUp(event: MouseEvent) {
    // Small delay to ensure selection is finalized
    setTimeout(() => {
      const selection = document.getSelection();
      const selectedText = selection?.toString().trim();

      if (selectedText && selectedText.length > 0) {
        void this.showContextMenu(event.clientX, event.clientY);
      } else {
        this.hideContextMenu();
      }
    }, 100);
  }

  private handleDocumentClick(event: MouseEvent) {
    // Hide context menu if clicking outside of it
    if (this.contextMenu && !this.contextMenu.contains(event.target as Node)) {
      this.hideContextMenu();
    }
  }

  private async showContextMenu(x: number, y: number) {
    this.hideContextMenu(); // Remove existing menu
    this.ensureContextMenuFonts();
    const theme = await this.getContextMenuTheme();

    if (!document.getSelection()?.toString().trim()) {
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'aid-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Aid selection actions');
    menu.setAttribute('data-aid-theme', theme.name);
    menu.style.cssText = `
      all: initial;
      box-sizing: border-box;
      position: fixed;
      top: ${y + 10}px;
      left: ${x}px;
      display: grid;
      width: min(342px, calc(100vw - 24px));
      overflow: hidden;
      padding: 0;
      border: 1px solid ${theme.lineStrong};
      border-radius: ${theme.radius};
      background: ${theme.surfaceOverlay};
      color: ${theme.text};
      box-shadow: ${theme.shadow};
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      z-index: 2147483647;
      color-scheme: ${theme.colorScheme};
      font-family: ${theme.fontSans};
      font-size: 14px;
      line-height: 1.5;
      font-optical-sizing: auto;
      -webkit-font-smoothing: antialiased;
      text-rendering: geometricPrecision;
      opacity: 0;
      transform: translateY(6px) scale(0.98);
      transform-origin: top left;
      transition: opacity ${theme.ease}, transform ${theme.ease};
    `;

    const header = this.createContextMenuHeader(theme);

    const askButton = document.createElement('button');
    this.decorateContextMenuButton(askButton, {
      label: 'Ask Aid',
      detail: 'Open in side panel',
      icon: 'message',
    }, theme);
    askButton.onclick = () => {
      this.handleAskAidSelection();
      this.hideContextMenu();
    };

    const explainButton = document.createElement('button');
    this.decorateContextMenuButton(explainButton, {
      label: 'Explain',
      detail: 'Explain the selection',
      icon: 'sparkles',
    }, theme);
    explainButton.onclick = () => {
      this.handleExplainSelection();
      this.hideContextMenu();
    };

    const translateButton = document.createElement('button');
    this.decorateContextMenuButton(translateButton, {
      label: 'Translate',
      detail: 'Translate selected text',
      icon: 'languages',
    }, theme);
    translateButton.onclick = () => {
      this.handleTranslateSelection();
      this.hideContextMenu();
    };

    const actions = document.createElement('div');
    actions.style.cssText = `
      box-sizing: border-box;
      display: grid;
      gap: 8px;
      padding: 10px;
    `;
    actions.append(askButton, explainButton, translateButton);
    menu.append(header, actions);

    document.body.appendChild(menu);
    this.contextMenu = menu;

    // Adjust position if menu goes off screen
    const rect = menu.getBoundingClientRect();
    const viewportGap = 12;
    const maxLeft = Math.max(viewportGap, window.innerWidth - rect.width - viewportGap);
    const maxTop = Math.max(viewportGap, window.innerHeight - rect.height - viewportGap);
    const nextLeft = Math.min(Math.max(x, viewportGap), maxLeft);
    const preferredTop = y + 10;
    const flippedTop = y - rect.height - 10;
    const nextTop = preferredTop + rect.height > window.innerHeight - viewportGap
      ? Math.min(Math.max(flippedTop, viewportGap), maxTop)
      : Math.min(Math.max(preferredTop, viewportGap), maxTop);

    menu.style.left = `${Math.round(nextLeft)}px`;
    menu.style.top = `${Math.round(nextTop)}px`;

    requestAnimationFrame(() => {
      if (this.contextMenu === menu) {
        menu.style.opacity = '1';
        menu.style.transform = 'translateY(0) scale(1)';
      }
    });
  }

  private async getContextMenuTheme(): Promise<AidMenuTheme> {
    try {
      const localResult = await browser.storage.local.get([AID_THEME_STORAGE_KEY, AID_ACCENT_STORAGE_KEY]);
      const localTheme = localResult[AID_THEME_STORAGE_KEY];
      const localAccent = localResult[AID_ACCENT_STORAGE_KEY];

      if (isAidMenuThemeName(localTheme)) {
        return this.withAccentColor(AID_MENU_THEMES[localTheme], localAccent);
      }

      const syncResult = await browser.storage.sync.get('settings');
      const settingsTheme = syncResult.settings?.theme;
      if (isAidMenuThemeName(settingsTheme)) {
        return this.withAccentColor(AID_MENU_THEMES[settingsTheme], syncResult.settings?.accentColor);
      }

      return this.withAccentColor(AID_MENU_THEMES.dark, syncResult.settings?.accentColor || localAccent);
    } catch (error) {
      console.warn('Failed to read Aid theme for selection menu:', error);
    }

    return AID_MENU_THEMES.dark;
  }

  private withAccentColor(theme: AidMenuTheme, accentColor?: string): AidMenuTheme {
    const accent = normalizeAccentColor(accentColor);

    return {
      ...theme,
      accent,
      focusRing: getAccentFocusRing(accent),
    };
  }

  private ensureContextMenuFonts(): void {
    if (document.getElementById(AID_CONTEXT_MENU_FONT_STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = AID_CONTEXT_MENU_FONT_STYLE_ID;
    style.setAttribute('data-aid-context-menu-fonts', 'true');

    const fontUrl = (fileName: string) => browser.runtime.getURL(`assets/fonts/${fileName}`);
    style.textContent = `
      @font-face {
        font-family: "Aid Instrument Sans";
        font-style: normal;
        font-weight: 400 700;
        font-stretch: 75% 100%;
        font-display: swap;
        src: url("${fontUrl('InstrumentSans-latin.woff2')}") format("woff2");
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308,
          U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
      }

      @font-face {
        font-family: "Aid Instrument Sans";
        font-style: normal;
        font-weight: 400 700;
        font-stretch: 75% 100%;
        font-display: swap;
        src: url("${fontUrl('InstrumentSans-latin-ext.woff2')}") format("woff2");
        unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308,
          U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113,
          U+2C60-2C7F, U+A720-A7FF;
      }

      @font-face {
        font-family: "Aid Momo Trust Display";
        font-style: normal;
        font-weight: 400;
        font-display: swap;
        src: url("${fontUrl('MomoTrustDisplay-vietnamese.woff2')}") format("woff2");
        unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0,
          U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
      }

      @font-face {
        font-family: "Aid Momo Trust Display";
        font-style: normal;
        font-weight: 400;
        font-display: swap;
        src: url("${fontUrl('MomoTrustDisplay-latin-ext.woff2')}") format("woff2");
        unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308,
          U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113,
          U+2C60-2C7F, U+A720-A7FF;
      }

      @font-face {
        font-family: "Aid Momo Trust Display";
        font-style: normal;
        font-weight: 400;
        font-display: swap;
        src: url("${fontUrl('MomoTrustDisplay-latin.woff2')}") format("woff2");
        unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308,
          U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
      }
    `;

    (document.head || document.documentElement).append(style);
  }

  private createContextMenuHeader(theme: AidMenuTheme): HTMLDivElement {
    const header = document.createElement('div');
    header.style.cssText = `
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 52px;
      padding: 12px;
      border-bottom: 1px solid ${theme.line};
      font-family: ${theme.fontDisplay};
      letter-spacing: 0;
    `;

    const titleGroup = document.createElement('div');
    titleGroup.style.cssText = `
      box-sizing: border-box;
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 9px;
    `;

    const mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.style.cssText = `
      box-sizing: border-box;
      display: grid;
      width: 28px;
      height: 28px;
      place-items: center;
      border: 1px solid ${theme.line};
      border-radius: 50%;
      background: transparent;
      color: ${theme.accent};
    `;
    mark.append(this.createContextMenuIcon('sparkles', 16));

    const title = document.createElement('strong');
    title.textContent = 'Selection actions';
    title.style.cssText = `
      overflow: hidden;
      color: ${theme.text};
      font-size: 13px;
      font-weight: 700;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;

    const subtitle = document.createElement('small');
    subtitle.style.cssText = `
      overflow: hidden;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: ${theme.muted};
      font-family: ${theme.fontSans};
      font-size: 11px;
      font-weight: 500;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;

    const statusDot = document.createElement('span');
    statusDot.setAttribute('aria-hidden', 'true');
    statusDot.style.cssText = `
      display: inline-block;
      width: 7px;
      height: 7px;
      flex: 0 0 auto;
      border-radius: 50%;
      background: ${theme.accent};
    `;

    const statusText = document.createElement('span');
    statusText.textContent = 'Selection ready';
    statusText.style.cssText = `
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;

    subtitle.append(statusDot, statusText);
    titleGroup.append(mark, title);
    header.append(titleGroup, subtitle);
    return header;
  }

  private decorateContextMenuButton(
    button: HTMLButtonElement,
    options: {
      label: string;
      detail: string;
      icon: 'message' | 'sparkles' | 'languages';
    },
    theme: AidMenuTheme
  ): void {
    const normalBackground = 'transparent';
    const hoverBackground = theme.surfaceHover;
    const normalBorder = theme.line;
    const hoverBorder = theme.lineStrong;

    button.replaceChildren();
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-label', options.label);
    button.style.cssText = `
      all: unset;
      box-sizing: border-box;
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      width: 100%;
      min-height: 56px;
      align-items: center;
      column-gap: 10px;
      gap: 10px;
      padding: 9px;
      border: 1px solid ${normalBorder};
      border-radius: ${theme.radius};
      background: ${normalBackground};
      color: ${theme.textSoft};
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      font-weight: 400;
      letter-spacing: 0;
      text-align: left;
      user-select: none;
      -webkit-user-select: none;
      outline: 0;
      transition: background ${theme.ease}, border-color ${theme.ease}, transform ${theme.ease}, box-shadow ${theme.ease}, color ${theme.ease};
    `;

    const applyHoverState = () => {
      button.style.background = hoverBackground;
      button.style.borderColor = hoverBorder;
      button.style.boxShadow = 'none';
      button.style.color = theme.text;
      button.style.transform = 'translateY(-1px)';
    };

    const applyFocusState = () => {
      button.style.background = hoverBackground;
      button.style.borderColor = hoverBorder;
      button.style.boxShadow = `0 0 0 3px ${theme.focusRing}`;
      button.style.color = theme.text;
      button.style.transform = 'translateY(-1px)';
    };

    const applyIdleState = () => {
      button.style.background = normalBackground;
      button.style.borderColor = normalBorder;
      button.style.boxShadow = 'none';
      button.style.color = theme.textSoft;
      button.style.transform = 'translateY(0)';
    };

    button.onmouseenter = applyHoverState;
    button.onfocus = applyFocusState;
    button.onmouseleave = applyIdleState;
    button.onblur = applyIdleState;

    const iconFrame = document.createElement('span');
    iconFrame.setAttribute('aria-hidden', 'true');
    iconFrame.style.cssText = `
      box-sizing: border-box;
      display: grid;
      width: 34px;
      height: 34px;
      place-items: center;
      background: transparent;
      color: ${theme.accent};
    `;
    iconFrame.append(this.createContextMenuIcon(options.icon, 18));

    const copy = document.createElement('span');
    copy.style.cssText = `
      display: grid;
      min-width: 0;
      gap: 2px;
    `;

    const label = document.createElement('strong');
    label.textContent = options.label;
    label.style.cssText = `
      display: block;
      min-width: 0;
      overflow: hidden;
      color: ${theme.text};
      font-family: ${theme.fontDisplay};
      font-size: 13px;
      font-weight: 680;
      line-height: 1.15;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;

    const detail = document.createElement('small');
    detail.textContent = options.detail;
    detail.setAttribute('aria-hidden', 'true');
    detail.style.cssText = `
      display: block;
      min-width: 0;
      overflow: hidden;
      color: ${theme.muted};
      font-size: 11px;
      font-weight: 400;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    `;

    copy.append(label, detail);
    button.append(iconFrame, copy);
  }

  private createContextMenuIcon(name: 'message' | 'sparkles' | 'languages', size = 18): SVGSVGElement {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const iconSize = String(size);
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('width', iconSize);
    icon.setAttribute('height', iconSize);
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true');
    icon.style.cssText = `
      width: ${iconSize}px;
      height: ${iconSize}px;
      flex: 0 0 auto;
      color: currentColor;
    `;

    const appendPath = (d: string) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      icon.appendChild(path);
    };

    if (name === 'message') {
      appendPath('M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z');
    } else if (name === 'sparkles') {
      appendPath('M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z');
      appendPath('M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z');
      appendPath('M5 14l.8 1.8L8 16.5l-2.2.7L5 19l-.8-1.8L2 16.5l2.2-.7z');
    } else {
      appendPath('M5 8h9');
      appendPath('M7 4h1');
      appendPath('M9 4h1');
      appendPath('M11 4h1');
      appendPath('M7 8c.8 2.7 2.5 4.7 5 6');
      appendPath('M12 8c-.7 2.1-2 3.9-4 5.3');
      appendPath('M17 22l3-8 3 8');
      appendPath('M18.2 19h3.6');
    }

    return icon;
  }

  private hideContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  private getTabContext(options: TabContextOptions = {}): TabContext {
    return ContextCollector.getCurrentTabContext({
      maxTokens: options.maxTokens || 4000,
      includeSelection: options.includeSelection !== false,
      sanitizeUrls: options.sanitizeUrls !== false
    });
  }

  private async handleAskAidSelection() {
    if (!this.lastSelection) {
      console.warn('No text selected');
      return;
    }

    // Open side panel and send selection context
    try {
      await browser.runtime.sendMessage({
        type: 'OPEN_SIDE_PANEL_WITH_SELECTION',
        payload: {
          selection: this.lastSelection,
          context: this.getTabContext()
        }
      });
    } catch (error) {
      console.error('Failed to open side panel:', error);
    }
  }

  private async handleExplainSelection() {
    if (!this.lastSelection) {
      console.warn('No text selected');
      return;
    }

    try {
      await browser.runtime.sendMessage({
        type: 'EXPLAIN_SELECTION',
        payload: {
          selection: this.lastSelection,
          context: this.getTabContext()
        }
      });
    } catch (error) {
      console.error('Failed to explain selection:', error);
    }
  }

  private async handleTranslateSelection() {
    if (!this.lastSelection) {
      console.warn('No text selected');
      return;
    }

    try {
      await browser.runtime.sendMessage({
        type: 'TRANSLATE_SELECTION',
        payload: {
          selection: this.lastSelection,
          context: this.getTabContext()
        }
      });
    } catch (error) {
      console.error('Failed to translate selection:', error);
    }
  }

  private async handleSummarizePage() {
    try {
      // This method is no longer needed since we handle summarization through GET_TAB_CONTEXT
      // Return the tab context for summarization
      return this.getTabContext({ includeSelection: false });
    } catch (error) {
      console.error('Failed to get tab context for summarization:', error);
      throw error;
    }
  }

  /**
   * Get the current selection text
   */
  getCurrentSelection(): string {
    return this.lastSelection;
  }

  /**
   * Get full page content
   */
  getFullPageContent(): string {
    return ContextCollector.extractFullPageContent();
  }

  /**
   * Get page abstract
   */
  getPageAbstract(): string {
    return ContextCollector.extractPageAbstract();
  }

  /**
   * Highlight text on the page
   */
  highlightText(text: string): boolean {
    return this.scrollToText(text);
  }

  /**
   * Scroll to specific text
   */
  scrollToText(text: string): boolean {
    const query = text.trim().toLowerCase();
    if (!query || !document.body) {
      return false;
    }

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      const parentElement = node.parentElement;
      if (parentElement && node.textContent?.toLowerCase().includes(query)) {
        parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return true;
      }

      node = walker.nextNode();
    }

    return false;
  }
}

// Initialize content script
const contentScript = new ContentScript();

// Expose a page-local handle for diagnostics and repeated programmatic injection checks.
(window as Window & { aidContentScript?: ContentScript }).aidContentScript = contentScript;
