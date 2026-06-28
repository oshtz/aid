/**
 * Context Collection System for Aid Browser Extension
 * Handles text selection extraction, page content analysis, and multi-tab context aggregation
 */

import browser from 'webextension-polyfill';
import type { TabContext } from './types';
import {
  getFrameDocument,
  getShadowRoot,
  getTagName,
  type FormControlSurface,
  type FormFieldRoot,
  type FrameSurface,
  type MediaSurface,
  type ScrollSurface,
} from './context-dom';

export interface ContextCollectionOptions {
  maxTokens?: number;
  includeSelection?: boolean;
  includeFullPage?: boolean;
  sanitizeUrls?: boolean;
}

export class ContextCollector {
  private static readonly DEFAULT_MAX_TOKENS = 4000;
  private static readonly CHARS_PER_TOKEN = 4; // Rough estimate
  private static readonly MAX_ABSTRACT_LENGTH = 500;
  private static readonly MAX_SELECTION_LENGTH = 2000;
  private static readonly MAX_VISIBLE_ITEMS = 8;
  private static readonly MAX_VISIBLE_FORM_FIELDS = 12;
  private static readonly MAX_VISIBLE_MEDIA_ITEMS = 8;
  private static readonly MAX_VISIBLE_ACTION_ITEMS = 12;
  private static readonly MAX_VISIBLE_TABLE_ITEMS = 3;
  private static readonly MAX_VISIBLE_TABLE_ROWS = 8;
  private static readonly MAX_VISIBLE_TABLE_COLUMNS = 6;
  private static readonly MAX_VISIBLE_STATE_ITEMS = 8;
  private static readonly MAX_VISIBLE_FRAME_ITEMS = 4;
  private static readonly MAX_VISIBLE_FRAME_CONTENT_LENGTH = 800;
  private static readonly MAX_VISIBLE_SHADOW_ITEMS = 6;
  private static readonly MAX_VISIBLE_SHADOW_CONTENT_LENGTH = 800;
  private static readonly MAX_VISIBLE_STRUCTURE_ITEMS = 12;
  private static readonly MAX_VISIBLE_LIST_ITEMS = 5;
  private static readonly MAX_VISIBLE_LIST_ROWS = 8;
  private static readonly MAX_FOCUSED_SELECTION_LENGTH = 160;
  private static readonly MAX_VISIBLE_SCROLL_CONTAINERS = 6;
  private static readonly MAX_SCROLL_CONTAINER_TEXT_LENGTH = 240;
  private static readonly MAX_VISIBLE_CHOICE_GROUPS = 6;
  private static readonly MAX_VISIBLE_CHOICES_PER_GROUP = 12;
  private static readonly MAX_VISIBLE_REGION_ITEMS = 6;
  private static readonly MAX_VISIBLE_REGION_CONTENT_LENGTH = 600;
  private static readonly SENSITIVE_FIELD_PATTERN =
    /(password|passcode|secret|token|api\s*key|apikey|access\s*key|private\s*key|credit\s*card|card\s*number|cc-number|cvv|cvc|ssn|social\s*security)/i;
  private static readonly SENSITIVE_VALUE_PATTERN =
    /\b(?:sk|pk|rk|AKIA|AIza)[A-Za-z0-9_-]{8,}\b|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

  /**
   * Extract text selection from the current document
   */
  static extractSelection(): string {
    const selectedText = this.getSelectionTextFromRoot(document);
    if (selectedText) {
      return selectedText;
    }

    return this.getEmbeddedSelectionText();
  }

  private static getSelectionTextFromRoot(root: Pick<FormFieldRoot, 'getSelection'>): string {
    try {
      const selection = root.getSelection?.();
      if (!selection || selection.rangeCount === 0) {
        return '';
      }

      return this.formatSelectionText(selection.toString());
    } catch {
      return '';
    }
  }

  private static getEmbeddedSelectionText(): string {
    const frameSelection = this.getFrameSelectionText();
    if (frameSelection) {
      return frameSelection;
    }

    return this.getShadowSelectionText();
  }

  private static getFrameSelectionText(): string {
    try {
      const frames = Array.from(document.querySelectorAll('iframe, frame'));
      for (const frame of frames) {
        if (!this.isVisibleInViewport(frame)) {
          continue;
        }

        const frameDocument = getFrameDocument(frame);
        const selectedText = frameDocument ? this.getSelectionTextFromRoot(frameDocument) : '';
        if (selectedText) {
          return selectedText;
        }
      }
    } catch {
      return '';
    }

    return '';
  }

  private static getShadowSelectionText(): string {
    try {
      const hosts = Array.from(document.querySelectorAll('*'))
        .filter((element) => Boolean(getShadowRoot(element)))
        .filter((element) => this.isVisibleInViewport(element));

      for (const host of hosts) {
        const shadowRoot = getShadowRoot(host);
        if (!shadowRoot) {
          continue;
        }

        const selectedText = this.getSelectionTextFromRoot(shadowRoot);
        if (selectedText) {
          return selectedText;
        }
      }
    } catch {
      return '';
    }

    return '';
  }

  private static formatSelectionText(text: string): string {
    const selectedText = this.redactSensitiveText(text.trim());
    if (!selectedText) {
      return '';
    }

    if (selectedText.length > this.MAX_SELECTION_LENGTH) {
      return `${selectedText.substring(0, this.MAX_SELECTION_LENGTH)}...`;
    }

    return selectedText;
  }

  /**
   * Extract full page content with token limits
   */
  static extractFullPageContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    // Remove script, style, and navigation elements
    const clonedDoc = document.cloneNode(true) as Document;
    const elementsToRemove = clonedDoc.querySelectorAll(
      'script, style, template, noscript, nav, header, footer, aside, table, [role="table"], [role="grid"], dialog, [role="dialog"], [role="alertdialog"], [role="alert"], [role="status"], [role="log"], [role="progressbar"], [aria-live], [aria-busy="true"], [hidden], [aria-hidden="true"], [style*="display: none"], [style*="display:none"], [style*="visibility: hidden"], [style*="visibility:hidden"], .nav, .navbar, .sidebar, .menu'
    );
    elementsToRemove.forEach(el => el.remove());

    // Try to find main content area
    const contentSelectors = [
      'main',
      'article',
      '[role="main"]',
      '.content',
      '#content',
      '.post',
      '.article',
      '.entry-content',
      '.post-content'
    ];

    let textSource: Element | null = null;
    for (const selector of contentSelectors) {
      textSource = clonedDoc.querySelector(selector);
      if (textSource) break;
    }

    // Fallback to body if no main content found
    if (!textSource) {
      textSource = clonedDoc.body;
    }

    if (!textSource) {
      return '';
    }

    // Extract and clean text
    let text = textSource.textContent || '';

    // Normalize whitespace
    text = text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
    text = this.redactSensitiveText(text);

    // Apply token limit
    const maxChars = maxTokens * this.CHARS_PER_TOKEN;
    if (text.length > maxChars) {
      text = `${text.substring(0, maxChars)}...`;
    }

    return text;
  }

  /**
   * Extract visible feed/timeline items from SPA pages such as X, where the
   * viewport is a better signal than SEO metadata or the first page paragraph.
   */
  static extractVisibleArticleContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const candidates = Array.from(
      new Set([
        ...Array.from(document.querySelectorAll('article')),
        ...Array.from(document.querySelectorAll('[role="article"]')),
        ...Array.from(document.querySelectorAll('[data-testid="tweet"]')),
      ])
    );

    const visibleItems = candidates
      .filter((element) => this.isVisibleInViewport(element))
      .map((element) => this.cleanExtractedText(element.textContent || ''))
      .map((text) => this.redactSensitiveText(text))
      .filter((text) => text.length >= 20)
      .slice(0, this.MAX_VISIBLE_ITEMS);

    if (visibleItems.length < 2) {
      return '';
    }

    return this.truncateToTokenLimit(
      [
        'Visible timeline posts:',
        ...visibleItems.map((text, index) => `Post ${index + 1}:\n${text}`),
      ].join('\n\n'),
      maxTokens
    );
  }

  /**
   * Extract live viewport and focus state. This captures browser action state
   * that is not represented by page text, such as scroll position and the
   * currently focused field/control.
   */
  static extractViewportStateContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return '';
    }

    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const pageWidth = Math.max(
      document.documentElement.scrollWidth || 0,
      document.documentElement.clientWidth || 0,
      document.body?.scrollWidth || 0,
      document.body?.clientWidth || 0
    );
    const pageHeight = Math.max(
      document.documentElement.scrollHeight || 0,
      document.documentElement.clientHeight || 0,
      document.body?.scrollHeight || 0,
      document.body?.clientHeight || 0
    );
    const scrollX = Math.round(window.scrollX || window.pageXOffset || 0);
    const scrollY = Math.round(window.scrollY || window.pageYOffset || 0);
    const lines = [
      'Visible browser state:',
      `Viewport: ${Math.round(viewportWidth)}x${Math.round(viewportHeight)}; scroll: x=${scrollX}, y=${scrollY}; page: ${Math.round(pageWidth)}x${Math.round(pageHeight)}`,
    ];
    const focusedLine = this.getFocusedElementLine();

    if (focusedLine) {
      lines.push(focusedLine);
    }

    return this.truncateToTokenLimit(lines.join('\n'), maxTokens);
  }

  /**
   * Extract visible page structure such as headings, labelled landmarks, and
   * current navigation items. This gives browser prompts a stable map of where
   * the user is on rich pages without relying on flattened body text.
   */
  static extractVisiblePageStructureContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const structureElements = Array.from(
      new Set(
        Array.from(
          document.querySelectorAll(
            [
              'h1',
              'h2',
              'h3',
              'h4',
              'h5',
              'h6',
              '[role="heading"]',
              'nav',
              '[role="navigation"]',
              'main[aria-label]',
              'main[aria-labelledby]',
              '[role="main"][aria-label]',
              '[role="main"][aria-labelledby]',
              'section[aria-label]',
              'section[aria-labelledby]',
              '[role="region"][aria-label]',
              '[role="region"][aria-labelledby]',
              'aside[aria-label]',
              'aside[aria-labelledby]',
              '[role="search"]',
              '[role="banner"]',
              '[role="contentinfo"]',
              '[role="complementary"]',
            ].join(', ')
          )
        )
      )
    );

    const seen = new Set<string>();
    const structureLines = structureElements
      .filter((element) => this.isVisibleInViewport(element))
      .map((element) => this.extractPageStructureLine(element))
      .filter((line): line is string => Boolean(line))
      .filter((line) => {
        if (seen.has(line)) {
          return false;
        }
        seen.add(line);
        return true;
      })
      .slice(0, this.MAX_VISIBLE_STRUCTURE_ITEMS);

    if (structureLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible page structure:', ...structureLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  /**
   * Extract visible lists and checklists with item order/state preserved.
   * Flattened page text loses bullets, ordering, and checked/unchecked state.
   */
  static extractVisibleListContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const listLines = this.getVisibleListLines(document, this.MAX_VISIBLE_LIST_ITEMS);

    if (listLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible lists:', ...listLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  private static getVisibleListLines(
    root: Pick<FormFieldRoot, 'getElementById' | 'querySelectorAll'>,
    maxItems: number
  ): string[] {
    const listElements = Array.from(
      new Set(
        Array.from(root.querySelectorAll('ol, ul, [role="list"], [role="feed"]'))
      )
    );

    const seen = new Set<string>();
    return listElements
      .filter((element) => this.isVisibleInViewport(element))
      .filter((element) => !this.isStructuralNavigationList(element))
      .map((element) => this.extractListLine(element, root))
      .filter((line): line is string => Boolean(line))
      .filter((line) => {
        if (seen.has(line)) {
          return false;
        }
        seen.add(line);
        return true;
      })
      .slice(0, maxItems);
  }

  /**
   * Extract visible form/control state from the live DOM. This intentionally
   * reads from the current document, not a clone, so typed values are current.
   */
  static extractVisibleFormContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const fields = this.getVisibleFormFieldLines(document);

    if (fields.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible form fields:', ...fields.map((field, index) => `${index + 1}. ${field}`)].join('\n'),
      maxTokens
    );
  }

  /**
   * Extract visible media affordances from the live DOM. Text extraction does
   * not include image alt text, posters, or diagram labels reliably, so this
   * preserves the evidence a user can see on media-heavy pages.
   */
  static extractVisibleMediaContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const mediaLines = this.getVisibleMediaLines(document, this.MAX_VISIBLE_MEDIA_ITEMS);

    if (mediaLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible media:', ...mediaLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  private static getVisibleMediaLines(
    root: Pick<FormFieldRoot, 'getElementById' | 'querySelectorAll'>,
    maxItems: number
  ): string[] {
    const mediaElements = Array.from(
      new Set(
        Array.from(
          root.querySelectorAll(
            'img, video, audio, canvas, svg[role="img"], [role="img"]'
          )
        )
      )
    );

    return mediaElements
      .filter((element) => this.isVisibleInViewport(element))
      .map((element) => this.extractMediaLine(element, root))
      .filter((line): line is string => Boolean(line))
      .slice(0, maxItems);
  }

  /**
   * Extract visible embedded frame context when same-origin access is available.
   * Many apps render important state inside iframes; top-level text extraction
   * does not include that content.
   */
  static extractVisibleFrameContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const frameElements = Array.from(new Set(Array.from(document.querySelectorAll('iframe, frame'))));
    const frameLines = frameElements
      .filter((element) => this.isVisibleInViewport(element))
      .map((element) => this.extractFrameLine(element))
      .filter((line): line is string => Boolean(line))
      .slice(0, this.MAX_VISIBLE_FRAME_ITEMS);

    if (frameLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible frames:', ...frameLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  /**
   * Extract visible open shadow DOM content from web components. Native
   * textContent and document queries do not include open shadow-root text.
   */
  static extractVisibleShadowContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const shadowHosts = Array.from(document.querySelectorAll('*'))
      .filter((element) => Boolean(getShadowRoot(element)))
      .filter((element) => this.isVisibleInViewport(element));

    const shadowLines = shadowHosts
      .map((element) => this.extractShadowLine(element))
      .filter((line): line is string => Boolean(line))
      .slice(0, this.MAX_VISIBLE_SHADOW_ITEMS);

    if (shadowLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible shadow DOM:', ...shadowLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  /**
   * Extract visible tabular data with row/column shape preserved. Plain
   * textContent collapses tables into ambiguous text, which is weak context for
   * browser prompts that ask for comparisons or specific rows.
   */
  static extractVisibleTableContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const tableBlocks = this.getVisibleTableBlocks(document, this.MAX_VISIBLE_TABLE_ITEMS);

    if (tableBlocks.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible tables:', ...tableBlocks.flat()].join('\n'),
      maxTokens
    );
  }

  private static getVisibleTableBlocks(
    root: Pick<FormFieldRoot, 'getElementById' | 'querySelectorAll'>,
    maxItems: number
  ): string[][] {
    const tableElements = Array.from(
      new Set(
        Array.from(root.querySelectorAll('table, [role="table"], [role="grid"]'))
      )
    );

    return tableElements
      .filter((element) => this.isVisibleInViewport(element))
      .map((element, index) => this.extractTableBlock(element, index + 1, root))
      .filter((block): block is string[] => block.length > 0)
      .slice(0, maxItems);
  }

  /**
   * Extract transient visible UI state such as dialogs, alerts, toasts, live
   * regions, and progress indicators. These often appear after browser actions
   * and are more useful when identified by role/state than as generic text.
   */
  static extractVisibleUiStateContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const stateElements = Array.from(
      new Set(
        Array.from(
          document.querySelectorAll(
            [
              'dialog',
              '[role="dialog"]',
              '[role="alertdialog"]',
              '[role="alert"]',
              '[role="status"]',
              '[role="log"]',
              '[role="tooltip"]',
              '[role="progressbar"]',
              '[aria-live]',
              '[aria-busy="true"]',
              '[popover]',
              '[data-testid*="toast"]',
              '[data-testid*="modal"]',
              '[data-testid*="tooltip"]',
              '[data-testid*="popover"]',
              '[class*="toast"]',
              '[class*="modal"]',
              '[class*="tooltip"]',
              '[class*="popover"]',
            ].join(', ')
          )
        )
      )
    );

    const seen = new Set<string>();
    const stateLines = stateElements
      .filter((element) => this.isVisibleInViewport(element))
      .map((element) => this.extractUiStateLine(element))
      .filter((line): line is string => Boolean(line))
      .filter((line) => {
        if (seen.has(line)) {
          return false;
        }
        seen.add(line);
        return true;
      })
      .slice(0, this.MAX_VISIBLE_STATE_ITEMS);

    if (stateLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible UI state:', ...stateLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  /**
   * Extract visible choice surfaces such as opened listboxes, menus, radio
   * groups, trees, and tablists. These often appear after a browser click and
   * need option-level selected/disabled state, not only flattened text.
   */
  static extractVisibleChoiceGroupContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const choiceLines = this.getVisibleChoiceGroupLines(document, this.MAX_VISIBLE_CHOICE_GROUPS);

    if (choiceLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible choice groups:', ...choiceLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  private static getVisibleChoiceGroupLines(
    root: Pick<FormFieldRoot, 'getElementById' | 'querySelectorAll'>,
    maxItems: number
  ): string[] {
    const choiceGroups = Array.from(
      new Set(
        Array.from(
          root.querySelectorAll(
            '[role="listbox"], [role="menu"], [role="menubar"], [role="radiogroup"], [role="tree"], [role="tablist"]'
          )
        )
      )
    );

    const choiceLines = choiceGroups
      .filter((element) => this.isVisibleInViewport(element))
      .map((element) => this.extractChoiceGroupLine(element, root))
      .filter((line): line is string => Boolean(line))
      .slice(0, maxItems);

    return choiceLines;
  }

  /**
   * Extract content that becomes visible after expanding an accordion,
   * disclosure, details element, or aria-controls target. Generic page text can
   * include hidden panels before expansion, so this keeps expanded state explicit.
   */
  static extractVisibleExpandedRegionContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const regionSources: Array<{ element: Element; label: string | undefined }> = [];
    const seenElements = new Set<Element>();

    const addRegion = (element: Element | null | undefined, label?: string) => {
      if (!element || seenElements.has(element) || !this.isVisibleInViewport(element)) {
        return;
      }

      seenElements.add(element);
      regionSources.push({ element, label });
    };

    Array.from(document.querySelectorAll('details[open]')).forEach((element) => addRegion(element));
    Array.from(document.querySelectorAll('[role="region"][aria-expanded="true"], [role="tabpanel"][aria-selected="true"]'))
      .forEach((element) => addRegion(element));

    Array.from(document.querySelectorAll('[aria-expanded="true"][aria-controls]')).forEach((control) => {
      const controlledIds = String(control.getAttribute?.('aria-controls') || '').split(/\s+/).filter(Boolean);
      controlledIds.forEach((id) => addRegion(document.getElementById?.(id), this.getActionLabel(control)));
    });

    const regionLines = regionSources
      .map((source) => this.extractExpandedRegionLine(source.element, source.label))
      .filter((line): line is string => Boolean(line))
      .slice(0, this.MAX_VISIBLE_REGION_ITEMS);

    if (regionLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible expanded regions:', ...regionLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  /**
   * Extract scroll position for visible overflow containers. Many modern apps
   * scroll timelines, panes, and menus inside fixed containers without changing
   * window.scrollY, so this preserves browser action state after panel scrolling.
   */
  static extractVisibleScrollContainerContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined' || typeof window === 'undefined') {
      return '';
    }

    const seen = new Set<string>();
    const scrollLines = Array.from(document.querySelectorAll('*'))
      .filter((element) => this.isVisibleScrolledContainer(element))
      .map((element) => this.extractScrollContainerLine(element))
      .filter((line): line is string => Boolean(line))
      .filter((line) => {
        if (seen.has(line)) {
          return false;
        }
        seen.add(line);
        return true;
      })
      .slice(0, this.MAX_VISIBLE_SCROLL_CONTAINERS);

    if (scrollLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible scroll containers:', ...scrollLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  /**
   * Extract visible clickable/actionable targets. This helps prompts reason
   * about what a browser action can do next, not only what text is visible.
   */
  static extractVisibleActionContent(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    if (typeof document === 'undefined') {
      return '';
    }

    const actionLines = this.getVisibleActionLines(document, this.MAX_VISIBLE_ACTION_ITEMS);

    if (actionLines.length === 0) {
      return '';
    }

    return this.truncateToTokenLimit(
      ['Visible actions:', ...actionLines.map((line, index) => `${index + 1}. ${line}`)].join('\n'),
      maxTokens
    );
  }

  private static getVisibleActionLines(root: Pick<FormFieldRoot, 'querySelectorAll'>, maxItems: number): string[] {
    const actionElements = Array.from(
      new Set(
        Array.from(
          root.querySelectorAll(
            [
              'a[href]',
              'button',
              'summary',
              'input[type="button"]',
              'input[type="submit"]',
              'input[type="reset"]',
              '[role="button"]',
              '[role="link"]',
              '[role="menuitem"]',
              '[role="tab"]',
              '[onclick]',
            ].join(', ')
          )
        )
      )
    );

    const seen = new Set<string>();
    return actionElements
      .filter((element) => this.isVisibleInViewport(element))
      .map((element) => this.extractActionLine(element))
      .filter((line): line is string => Boolean(line))
      .filter((line) => {
        if (seen.has(line)) {
          return false;
        }
        seen.add(line);
        return true;
      })
      .slice(0, maxItems);
  }

  static extractPageContext(maxTokens: number = this.DEFAULT_MAX_TOKENS): string {
    const viewportStateContent = this.extractViewportStateContent(maxTokens);
    const visiblePageStructureContent = this.extractVisiblePageStructureContent(maxTokens);
    const visibleListContent = this.extractVisibleListContent(maxTokens);
    const visibleArticleContent = this.extractVisibleArticleContent(maxTokens);
    const visibleTableContent = this.extractVisibleTableContent(maxTokens);
    const visibleUiStateContent = this.extractVisibleUiStateContent(maxTokens);
    const visibleChoiceGroupContent = this.extractVisibleChoiceGroupContent(maxTokens);
    const visibleExpandedRegionContent = this.extractVisibleExpandedRegionContent(maxTokens);
    const visibleScrollContainerContent = this.extractVisibleScrollContainerContent(maxTokens);
    const visibleFormContent = this.extractVisibleFormContent(maxTokens);
    const visibleMediaContent = this.extractVisibleMediaContent(maxTokens);
    const visibleFrameContent = this.extractVisibleFrameContent(maxTokens);
    const visibleShadowContent = this.extractVisibleShadowContent(maxTokens);
    const visibleActionContent = this.extractVisibleActionContent(maxTokens);
    const supplementalContext = [
      viewportStateContent,
      visiblePageStructureContent,
      visibleListContent,
      visibleTableContent,
      visibleUiStateContent,
      visibleChoiceGroupContent,
      visibleExpandedRegionContent,
      visibleScrollContainerContent,
      visibleFormContent,
      visibleMediaContent,
      visibleFrameContent,
      visibleShadowContent,
      visibleActionContent,
    ].filter(Boolean).join('\n\n');

    if (visibleArticleContent) {
      return this.truncateToTokenLimit(
        [supplementalContext, visibleArticleContent].filter(Boolean).join('\n\n'),
        maxTokens
      );
    }

    const fullText = this.extractFullPageContent(maxTokens);
    if (fullText.length > 50) {
      return this.truncateToTokenLimit(
        [supplementalContext, fullText].filter(Boolean).join('\n\n'),
        maxTokens
      );
    }

    if (supplementalContext) {
      return this.truncateToTokenLimit(supplementalContext, maxTokens);
    }

    return this.extractPageAbstract();
  }

  /**
   * Extract page abstract/summary
   */
  static extractPageAbstract(): string {
    // Try meta description first
    const metaDescription = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (metaDescription?.content?.trim()) {
      const content = metaDescription.content.trim();
      return content.length > this.MAX_ABSTRACT_LENGTH
        ? `${content.substring(0, this.MAX_ABSTRACT_LENGTH)}...`
        : content;
    }

    // Try Open Graph description
    const ogDescription = document.querySelector('meta[property="og:description"]') as HTMLMetaElement;
    if (ogDescription?.content?.trim()) {
      const content = ogDescription.content.trim();
      return content.length > this.MAX_ABSTRACT_LENGTH
        ? `${content.substring(0, this.MAX_ABSTRACT_LENGTH)}...`
        : content;
    }

    // Try to find first substantial paragraph
    const paragraphs = document.querySelectorAll('p, .summary, .excerpt, .description');
    for (const p of paragraphs) {
      const text = p.textContent?.trim();
      if (text && text.length > 50) {
        return text.length > this.MAX_ABSTRACT_LENGTH
          ? `${text.substring(0, this.MAX_ABSTRACT_LENGTH)}...`
          : text;
    }
    }

    // Fallback to first part of page content
    const fullText = this.extractFullPageContent(500); // Small sample
    if (fullText.length > 50) {
      return fullText.length > this.MAX_ABSTRACT_LENGTH
        ? `${fullText.substring(0, this.MAX_ABSTRACT_LENGTH)}...`
        : fullText;
    }

    return 'No substantial content found on this page.';
  }

  /**
   * Sanitize URL by removing query parameters and private paths
   */
  static sanitizeUrl(url: string): string {
    try {
      const urlObj = new URL(url);

      // Remove query parameters and hash
      urlObj.search = '';
      urlObj.hash = '';

      // Remove common private/tracking paths
      const privatePaths = [
        '/admin',
        '/dashboard',
        '/profile',
        '/account',
        '/settings',
        '/private',
        '/secure'
      ];

      const path = urlObj.pathname.toLowerCase();
      for (const privatePath of privatePaths) {
        if (path.startsWith(privatePath)) {
          urlObj.pathname = `${privatePath}/[private]`;
          break;
        }
      }

      return urlObj.toString();
    } catch {
      // If URL parsing fails, return a sanitized version
      const parts = url.split('?')[0];
      const result = parts?.split('#')[0];
      return result || url;
    }
  }

  /**
   * Get current tab context
   */
  static getCurrentTabContext(options: ContextCollectionOptions = {}): TabContext {
    const {
      maxTokens = this.DEFAULT_MAX_TOKENS,
      includeSelection = true,
      includeFullPage = true,
      sanitizeUrls = true
    } = options;

    const url = sanitizeUrls ? this.sanitizeUrl(window.location.href) : window.location.href;
    const title = document.title || 'Untitled Page';
    const abstract = includeFullPage
      ? this.extractPageContext(maxTokens)
      : this.extractPageAbstract();
    const selection = includeSelection ? this.extractSelection() : undefined;

    const result: TabContext = {
      url,
      title,
      abstract
    };

    if (selection) {
      result.selection = selection;
    }

    return result;
  }

  /**
   * Aggregate context from multiple tabs
   */
  static async aggregateMultiTabContext(
    tabIds: number[],
    options: ContextCollectionOptions = {}
  ): Promise<TabContext[]> {
    const contexts: TabContext[] = [];

    for (const tabId of tabIds) {
      try {
        // Send message to content script in each tab
        const response = await browser.tabs.sendMessage(tabId, {
          type: 'GET_TAB_CONTEXT',
          payload: options
        });

        if (response && response.context) {
          contexts.push(response.context);
        }
      } catch (error) {
        console.warn(`Failed to get context from tab ${tabId}:`, error);
        // Continue with other tabs
      }
    }

    return contexts;
  }

  /**
   * Count approximate tokens in text
   */
  static countTokens(text: string): number {
    return Math.ceil(text.length / this.CHARS_PER_TOKEN);
  }

  /**
   * Truncate text to fit within token limit
   */
  static truncateToTokenLimit(text: string, maxTokens: number): string {
    const maxChars = maxTokens * this.CHARS_PER_TOKEN;
    if (text.length <= maxChars) {
      return text;
    }

    return `${text.substring(0, maxChars)}...`;
  }

  /**
   * Validate and clean context data
   */
  static validateContext(context: TabContext): TabContext {
    const result: TabContext = {
      url: context.url || '',
      title: context.title || 'Untitled',
      abstract: context.abstract || ''
    };

    if (context.selection?.trim()) {
      result.selection = context.selection.trim();
    }

    return result;
  }

  private static isVisibleInViewport(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const ownerDocument = element.ownerDocument || document;
    const ownerWindow = ownerDocument.defaultView || window;
    const viewportHeight = ownerWindow.innerHeight || ownerDocument.documentElement.clientHeight;
    const viewportWidth = ownerWindow.innerWidth || ownerDocument.documentElement.clientWidth;
    if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth) {
      return false;
    }

    const style = ownerWindow.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  private static cleanExtractedText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\bShow more\b/g, 'Show more')
      .trim();
  }

  private static getVisibleFormFieldLines(rootDocument: FormFieldRoot): string[] {
    const controls = Array.from(
      rootDocument.querySelectorAll(
        'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="checkbox"], [role="switch"], [role="radio"], [role="slider"], [role="spinbutton"]'
      )
    );
    const seen = new Set<string>();

    return controls
      .filter((element) => this.isVisibleInViewport(element))
      .map((element) => this.extractFormFieldLine(element, rootDocument))
      .filter((line): line is string => Boolean(line))
      .filter((line) => {
        if (seen.has(line)) {
          return false;
        }
        seen.add(line);
        return true;
      })
      .slice(0, this.MAX_VISIBLE_FORM_FIELDS);
  }

  private static extractFormFieldLine(element: Element, rootDocument: FormFieldRoot = document): string | null {
    const control = element as FormControlSurface;
    const tagName = getTagName(control);
    const role = String(control.getAttribute?.('role') || '').toLowerCase();
    const type = String(control.type || role || '').toLowerCase();

    if (tagName === 'input' && ['button', 'hidden', 'image', 'reset', 'submit'].includes(type)) {
      return null;
    }

    const label = this.getFormFieldLabel(element, rootDocument);
    if (!label) {
      return null;
    }

    if (this.isSensitiveField(element, label)) {
      const hasSensitiveValue = Boolean(this.getFormFieldValue(element, tagName, type, role));
      const sensitiveState = this.getFormFieldState(element, label, true, hasSensitiveValue, rootDocument);
      return [`${label}: [redacted]`, sensitiveState].filter(Boolean).join('; ');
    }

    const value = this.getSafeFormFieldValue(element, tagName, type, role);
    const state = this.getFormFieldState(element, label, false, Boolean(value), rootDocument);

    return [`${label}: ${value || '[empty]'}`, state].filter(Boolean).join('; ');
  }

  private static getFormFieldValue(
    element: Element,
    tagName: string,
    type: string,
    role: string
  ): string | null {
    const control = element as FormControlSurface;

    if (tagName === 'input' && ['checkbox', 'radio'].includes(type)) {
      return control.checked ? 'checked' : 'not checked';
    }

    if (tagName === 'input' && type === 'file') {
      const files = Array.from(control.files || [])
        .map((file) => this.formatUploadedFile(file))
        .filter(Boolean);
      return files.length > 0 ? files.join(', ') : null;
    }

    if (role === 'checkbox' || role === 'switch' || role === 'radio') {
      const checked = control.getAttribute?.('aria-checked');
      if (checked === 'true') return 'checked';
      if (checked === 'false') return 'not checked';
    }

    if (role === 'slider' || role === 'spinbutton') {
      const ariaValueText = this.cleanExtractedText(String(control.getAttribute?.('aria-valuetext') || ''));
      if (ariaValueText) {
        return ariaValueText;
      }

      const ariaValueNow = this.cleanExtractedText(String(control.getAttribute?.('aria-valuenow') || ''));
      if (ariaValueNow) {
        return ariaValueNow;
      }
    }

    if (tagName === 'select' || role === 'combobox') {
      const selectedOptions = Array.from(control.selectedOptions || [])
        .map((option) => this.cleanExtractedText(option.textContent || option.value || ''))
        .filter(Boolean);
      if (selectedOptions.length > 0) {
        return selectedOptions.join(', ');
      }

      const value = this.cleanExtractedText(String(control.value || ''));
      return value || null;
    }

    if (tagName === 'textarea' || tagName === 'input') {
      const value = this.cleanExtractedText(String(control.value || ''));
      return value || null;
    }

    if (String(control.getAttribute?.('contenteditable') || '').toLowerCase() === 'true' || role === 'textbox') {
      const value = this.cleanExtractedText(control.textContent || '');
      return value || null;
    }

    return null;
  }

  private static getSafeFormFieldValue(
    element: Element,
    tagName: string,
    type: string,
    role: string
  ): string | null {
    const value = this.getFormFieldValue(element, tagName, type, role);
    return value ? this.redactSensitiveText(value) : value;
  }

  private static formatUploadedFile(file: File): string {
    const name = this.redactSensitiveText(this.cleanExtractedText(String(file?.name || '')));
    if (!name) {
      return '';
    }

    const details = [
      this.cleanExtractedText(String(file?.type || '')),
      Number.isFinite(Number(file?.size)) ? `${Math.round(Number(file.size))} bytes` : '',
    ].filter(Boolean);

    return details.length > 0 ? `${name} (${details.join(', ')})` : name;
  }

  private static getFormFieldLabel(element: Element, rootDocument: FormFieldRoot = document): string {
    const control = element as FormControlSurface;
    const ariaLabel = this.cleanExtractedText(control.getAttribute?.('aria-label') || '');
    if (ariaLabel) {
      return ariaLabel;
    }

    const labelledBy = this.cleanExtractedText(
      String(control.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => rootDocument.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    if (labelledBy) {
      return labelledBy;
    }

    const labels = Array.from(control.labels || [])
      .map((label) => this.getLabelElementText(label))
      .filter(Boolean);
    if (labels.length > 0) {
      return labels.join(' / ');
    }

    const parentLabel = control.closest?.('label');
    const parentLabelText = parentLabel ? this.getLabelElementText(parentLabel) : '';
    if (parentLabelText) {
      return parentLabelText;
    }

    return this.cleanExtractedText(
      control.placeholder ||
        control.name ||
        control.id ||
        control.getAttribute?.('data-testid') ||
        control.getAttribute?.('role') ||
        ''
    );
  }

  private static getFormFieldState(
    element: Element,
    label: string,
    isSensitive: boolean,
    hasValue = false,
    rootDocument: FormFieldRoot = document
  ): string {
    const control = element as FormControlSurface;
    const states: string[] = [];
    const ariaInvalid = String(control.getAttribute?.('aria-invalid') || '').toLowerCase();
    const required = Boolean(control.required) || control.getAttribute?.('aria-required') === 'true';
    const invalid = ariaInvalid === 'true' || (control.validity && control.validity.valid === false);

    if (invalid) {
      states.push('invalid');
    }

    if (required) {
      states.push('required');
    }

    if (control.disabled || control.getAttribute?.('aria-disabled') === 'true') {
      states.push('disabled');
    }

    if (control.readOnly || control.getAttribute?.('aria-readonly') === 'true') {
      states.push('read only');
    }

    const range = this.getFormFieldRange(element);
    const step = this.getFormFieldStep(element);
    const message = invalid
      ? isSensitive
        ? this.getFormFieldValidationMessage(element, label, rootDocument) ? '[redacted]' : ''
        : this.getFormFieldValidationMessage(element, label, rootDocument)
      : '';
    const description = !invalid
      ? isSensitive
        ? this.getFormFieldDescription(element, label, rootDocument) ? '[redacted]' : ''
        : this.getFormFieldDescription(element, label, rootDocument)
      : '';
    const placeholder = !hasValue
      ? isSensitive
        ? this.getFormFieldPlaceholder(element, label) ? '[redacted]' : ''
        : this.getFormFieldPlaceholder(element, label)
      : '';

    return [
      states.length > 0 ? `state: ${Array.from(new Set(states)).join(', ')}` : '',
      range ? `range: ${range}` : '',
      step ? `step: ${step}` : '',
      message ? `message: ${message}` : '',
      description ? `description: ${description}` : '',
      placeholder ? `placeholder: ${placeholder}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  }

  private static getFormFieldRange(element: Element): string {
    const control = element as FormControlSurface;
    const min = this.cleanExtractedText(String(control.getAttribute?.('aria-valuemin') || control.min || ''));
    const max = this.cleanExtractedText(String(control.getAttribute?.('aria-valuemax') || control.max || ''));

    if (min && max) {
      return `${min}-${max}`;
    }

    return min || max || '';
  }

  private static getFormFieldStep(element: Element): string {
    const control = element as FormControlSurface;
    return this.cleanExtractedText(String(control.getAttribute?.('aria-valuestep') || control.step || ''));
  }

  private static getFormFieldPlaceholder(element: Element, label: string): string {
    const control = element as FormControlSurface;
    const placeholder = this.normalizeFormFieldSupportText(
      control.placeholder || control.getAttribute?.('aria-placeholder') || '',
      label
    );

    return placeholder === label ? '' : placeholder;
  }

  private static getFormFieldValidationMessage(element: Element, label: string, rootDocument: FormFieldRoot = document): string {
    const control = element as FormControlSurface;
    const ids = [
      ...String(control.getAttribute?.('aria-errormessage') || '').split(/\s+/),
      ...String(control.getAttribute?.('aria-describedby') || '').split(/\s+/),
    ].filter(Boolean);
    const idMessages = this.getVisibleReferencedTexts(ids, rootDocument);

    const nativeMessage = this.cleanExtractedText(String(control.validationMessage || ''));
    return this.normalizeFormFieldSupportText(idMessages[0] || nativeMessage, label);
  }

  private static getFormFieldDescription(element: Element, label: string, rootDocument: FormFieldRoot = document): string {
    const control = element as FormControlSurface;
    const ids = String(control.getAttribute?.('aria-describedby') || '').split(/\s+/).filter(Boolean);
    const descriptions = this.getVisibleReferencedTexts(ids, rootDocument);
    return this.normalizeFormFieldSupportText(descriptions[0] || '', label);
  }

  private static getVisibleReferencedTexts(ids: string[], rootDocument: FormFieldRoot = document): string[] {
    return ids
      .map((id) => {
        const referencedElement = rootDocument.getElementById?.(id);
        if (!referencedElement || !this.isVisibleInViewport(referencedElement)) {
          return '';
        }

        return this.cleanExtractedText(referencedElement.textContent || '');
      })
      .filter(Boolean);
  }

  private static normalizeFormFieldSupportText(text: string, label: string): string {
    const message = this.redactSensitiveText(this.cleanExtractedText(text));
    if (!message || message === label) {
      return '';
    }

    return message.startsWith(label)
      ? this.cleanExtractedText(message.slice(label.length))
      : message;
  }

  private static isSensitiveField(element: Element, label: string): boolean {
    const control = element as FormControlSurface;
    return this.SENSITIVE_FIELD_PATTERN.test(
      [
        control.type,
        control.name,
        control.id,
        control.placeholder,
        label,
        control.getAttribute?.('autocomplete'),
        control.getAttribute?.('aria-label'),
      ]
        .filter(Boolean)
        .join(' ')
    );
  }

  private static getLabelElementText(label: Element): string {
    const clone = label.cloneNode?.(true) as Element | undefined;
    if (clone?.querySelectorAll) {
      clone
        .querySelectorAll('input, textarea, select, option, button, [contenteditable="true"]')
        .forEach((element) => element.remove());
      return this.cleanExtractedText(clone.textContent || '');
    }

    return this.cleanExtractedText(label.textContent || '');
  }

  private static extractPageStructureLine(element: Element): string | null {
    if (this.isHeadingElement(element)) {
      const headingText = this.redactSensitiveText(element.textContent || '');
      if (!headingText) {
        return null;
      }

      return `H${this.getHeadingLevel(element)}: ${headingText}`;
    }

    const landmarkType = this.getLandmarkTypeLabel(element);
    if (!landmarkType) {
      return null;
    }

    const label = this.getLandmarkLabel(element);
    const currentItem = this.getCurrentStructureItem(element);
    if (!label && !currentItem) {
      return null;
    }

    return [
      label ? `${landmarkType}: ${label}` : landmarkType,
      currentItem ? `current: ${currentItem}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  }

  private static isHeadingElement(element: Element): boolean {
    const tagName = getTagName(element);
    const role = String(element.getAttribute?.('role') || '').toLowerCase();
    return /^h[1-6]$/.test(tagName) || role === 'heading';
  }

  private static getHeadingLevel(element: Element): number {
    const tagName = getTagName(element);
    const nativeLevel = /^h[1-6]$/.test(tagName) ? Number(tagName.slice(1)) : 0;
    const ariaLevel = Number(element.getAttribute?.('aria-level') || '');
    if (Number.isFinite(ariaLevel) && ariaLevel >= 1 && ariaLevel <= 6) {
      return ariaLevel;
    }

    return nativeLevel || 2;
  }

  private static getLandmarkTypeLabel(element: Element): string {
    const tagName = getTagName(element);
    const role = String(element.getAttribute?.('role') || '').toLowerCase();

    if (tagName === 'nav' || role === 'navigation') return 'Navigation';
    if (tagName === 'main' || role === 'main') return 'Main';
    if (tagName === 'section' || role === 'region') return 'Section';
    if (tagName === 'aside' || role === 'complementary') return 'Complementary';
    if (role === 'search') return 'Search';
    if (role === 'banner') return 'Banner';
    if (role === 'contentinfo') return 'Content info';
    return '';
  }

  private static getLandmarkLabel(element: Element): string {
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => document.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    const heading = this.cleanExtractedText(
      element.querySelector?.('h1, h2, h3, h4, h5, h6, [role="heading"]')?.textContent || ''
    );

    return [
      element.getAttribute?.('aria-label'),
      labelledBy,
      heading,
      element.getAttribute?.('title'),
      element.getAttribute?.('data-testid'),
      element.getAttribute?.('id'),
    ]
      .map((value) => this.redactSensitiveText(String(value || '')))
      .find(Boolean) || '';
  }

  private static getCurrentStructureItem(element: Element): string {
    const currentElement = element.querySelector?.('[aria-current]:not([aria-current="false"])');
    if (!currentElement || !this.isVisibleInViewport(currentElement)) {
      return '';
    }

    const label = this.redactSensitiveText(this.getActionLabel(currentElement));
    if (!label) {
      return '';
    }

    const current = String(currentElement.getAttribute?.('aria-current') || '').toLowerCase();
    const currentState = current && current !== 'true' ? current : 'current';
    return `${label} (${currentState})`;
  }

  private static isStructuralNavigationList(element: Element): boolean {
    const role = String(element.getAttribute?.('role') || '').toLowerCase();
    if (['menu', 'menubar', 'listbox', 'tablist', 'tree'].includes(role)) {
      return true;
    }

    return Boolean(element.closest?.('nav, [role="navigation"], [role="menu"], [role="menubar"], [role="listbox"], [role="tablist"], [role="tree"]'));
  }

  private static extractListLine(
    element: Element,
    root: Pick<FormFieldRoot, 'getElementById'> = document
  ): string | null {
    const items = this.getVisibleListItemLines(element);
    if (items.length === 0) {
      return null;
    }

    const listType = this.getListTypeLabel(element);
    const label = this.getListLabel(element, root);
    return [
      label ? `${listType}: ${label}` : listType,
      `items: ${items.join(' | ')}`,
    ].join('; ');
  }

  private static getListTypeLabel(element: Element): string {
    const tagName = getTagName(element);
    const role = String(element.getAttribute?.('role') || '').toLowerCase();

    if (tagName === 'ol') return 'Ordered list';
    if (role === 'feed') return 'Feed';
    return 'List';
  }

  private static getListLabel(
    element: Element,
    root: Pick<FormFieldRoot, 'getElementById'> = document
  ): string {
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => root.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    const heading = this.cleanExtractedText(
      element.querySelector?.('h1, h2, h3, h4, h5, h6, [role="heading"]')?.textContent || ''
    );

    return [
      element.getAttribute?.('aria-label'),
      labelledBy,
      heading,
      element.getAttribute?.('title'),
      element.getAttribute?.('data-testid'),
      element.getAttribute?.('id'),
    ]
      .map((value) => this.redactSensitiveText(String(value || '')))
      .find(Boolean) || '';
  }

  private static getVisibleListItemLines(element: Element): string[] {
    const itemElements = Array.from(
      element.querySelectorAll?.('li, [role="listitem"], article, [role="article"]') || []
    );
    const seen = new Set<string>();

    return itemElements
      .filter((item) => this.isVisibleInViewport(item))
      .map((item, index) => this.extractListItemLine(item, index + 1))
      .filter((line): line is string => Boolean(line))
      .filter((line) => {
        if (seen.has(line)) {
          return false;
        }
        seen.add(line);
        return true;
      })
      .slice(0, this.MAX_VISIBLE_LIST_ROWS);
  }

  private static extractListItemLine(element: Element, index: number): string | null {
    const text = this.redactSensitiveText(element.textContent || '');
    if (!text) {
      return null;
    }

    const state = this.getListItemState(element);
    return `${index}. ${text}${state ? ` (${state})` : ''}`;
  }

  private static getListItemState(element: Element): string {
    const stateControl = element.querySelector?.('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]') as FormControlSurface | null;
    const states: string[] = [];

    if (stateControl) {
      const checked = stateControl.checked;
      const ariaChecked = stateControl.getAttribute?.('aria-checked');
      if (checked === true || ariaChecked === 'true') {
        states.push('checked');
      } else if (checked === false || ariaChecked === 'false') {
        states.push('not checked');
      }
    }

    const selected = element.getAttribute?.('aria-selected');
    const current = element.getAttribute?.('aria-current');
    if (selected === 'true') states.push('selected');
    if (current && current !== 'false') states.push(current === 'true' ? 'current' : `current ${current}`);

    return Array.from(new Set(states)).join(', ');
  }

  private static getFocusedElementLine(
    rootDocument: FormFieldRoot = document,
    options: { frameLabel?: string; shadowLabel?: string; depth?: number } = {}
  ): string {
    const activeElement = rootDocument.activeElement;
    if (!activeElement || activeElement === rootDocument.body || activeElement === rootDocument.documentElement) {
      return '';
    }

    if (!this.isVisibleInViewport(activeElement)) {
      return '';
    }

    const tagName = getTagName(activeElement);
    if (['iframe', 'frame'].includes(tagName) && (options.depth || 0) < 2) {
      const frameLine = this.getFocusedFrameElementLine(activeElement, options.depth || 0);
      if (frameLine) {
        return frameLine;
      }
    }

    if (getShadowRoot(activeElement) && (options.depth || 0) < 2) {
      const shadowLine = this.getFocusedShadowElementLine(activeElement, options.depth || 0);
      if (shadowLine) {
        return shadowLine;
      }
    }

    const role = String(activeElement.getAttribute?.('role') || '').toLowerCase();
    const type = String((activeElement as FormControlSurface).type || role || '').toLowerCase();
    const isField =
      ['input', 'textarea', 'select'].includes(tagName) ||
      String(activeElement.getAttribute?.('contenteditable') || '').toLowerCase() === 'true' ||
      ['textbox', 'combobox', 'checkbox', 'switch', 'radio', 'slider', 'spinbutton'].includes(role);

    if (isField) {
      const label = this.getFormFieldLabel(activeElement, rootDocument) || tagName || role || 'field';
      const isSensitive = this.isSensitiveField(activeElement, label);
      const value = isSensitive ? '[redacted]' : this.getSafeFormFieldValue(activeElement, tagName, type, role);
      const editState = this.getFocusedFieldEditState(activeElement, tagName, role, isSensitive, rootDocument);
      const prefix = options.frameLabel
        ? `Focused element: Frame: ${options.frameLabel}; Field: ${label}`
        : options.shadowLabel
          ? `Focused element: Shadow host: ${options.shadowLabel}; Field: ${label}`
          : `Focused element: Field: ${label}`;
      return [
        prefix,
        value ? `value: ${value}` : '',
        editState,
      ]
        .filter(Boolean)
        .join('; ');
    }

    const actionLabel = this.getActionLabel(activeElement);
    if (actionLabel) {
      const actionLine = `${this.getActionTypeLabel(activeElement)}: ${actionLabel}`;
      if (options.frameLabel) return `Focused element: Frame: ${options.frameLabel}; ${actionLine}`;
      if (options.shadowLabel) return `Focused element: Shadow host: ${options.shadowLabel}; ${actionLine}`;
      return `Focused element: ${actionLine}`;
    }

    const label = this.cleanExtractedText(
      activeElement.getAttribute?.('aria-label') ||
        activeElement.getAttribute?.('title') ||
        activeElement.textContent ||
        tagName ||
        ''
    );

    if (!label) {
      return '';
    }

    if (options.frameLabel) return `Focused element: Frame: ${options.frameLabel}; ${label}`;
    if (options.shadowLabel) return `Focused element: Shadow host: ${options.shadowLabel}; ${label}`;
    return `Focused element: ${label}`;
  }

  private static getFocusedFrameElementLine(frameElement: Element, depth: number): string {
    try {
      const frameDocument = getFrameDocument(frameElement);
      if (!frameDocument || !frameDocument.activeElement) {
        return '';
      }

      const frameLabel = this.getFrameLabel(frameElement) || 'embedded frame';
      return this.getFocusedElementLine(frameDocument, {
        frameLabel,
        depth: depth + 1,
      });
    } catch {
      return '';
    }
  }

  private static getFocusedShadowElementLine(hostElement: Element, depth: number): string {
    const shadowRoot = getShadowRoot(hostElement);
    if (!shadowRoot || !shadowRoot.activeElement) {
      return '';
    }

    const shadowLabel = this.getShadowHostLabel(hostElement) || 'open shadow root';
    return this.getFocusedElementLine(shadowRoot, {
      shadowLabel,
      depth: depth + 1,
    });
  }

  private static getFocusedFieldEditState(
    element: Element,
    tagName: string,
    role: string,
    isSensitive: boolean,
    rootDocument: FormFieldRoot = document
  ): string | null {
    const control = element as FormControlSurface;
    const canHaveNativeSelection =
      tagName === 'textarea' ||
      (tagName === 'input' && ['text', 'search', 'url', 'tel', 'email', 'password', ''].includes(String(control.type || '').toLowerCase()));
    const canHaveRichTextSelection =
      String(element.getAttribute?.('contenteditable') || '').toLowerCase() === 'true' ||
      role === 'textbox';

    if (!canHaveNativeSelection && !canHaveRichTextSelection) {
      return null;
    }

    if (typeof control.selectionStart !== 'number' || typeof control.selectionEnd !== 'number') {
      return this.getFocusedRichTextEditState(element, role, isSensitive, rootDocument);
    }

    const start = Math.max(0, Math.min(control.selectionStart, control.selectionEnd));
    const end = Math.max(0, Math.max(control.selectionStart, control.selectionEnd));

    if (start === end) {
      return `caret: ${start}`;
    }

    if (isSensitive) {
      return `selection: ${start}-${end}; selected text: [redacted]`;
    }

    const value = String(control.value || control.textContent || '');
    const selectedText = this.redactSensitiveText(value.slice(start, end));
    const truncatedSelection = selectedText.length > this.MAX_FOCUSED_SELECTION_LENGTH
      ? `${selectedText.substring(0, this.MAX_FOCUSED_SELECTION_LENGTH)}...`
      : selectedText;

    return [
      `selection: ${start}-${end}`,
      truncatedSelection ? `selected text: ${truncatedSelection}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  }

  private static getFocusedRichTextEditState(
    element: Element,
    role: string,
    isSensitive: boolean,
    rootDocument: FormFieldRoot = document
  ): string | null {
    const isRichTextField =
      String(element.getAttribute?.('contenteditable') || '').toLowerCase() === 'true' ||
      role === 'textbox';
    if (!isRichTextField || typeof rootDocument.getSelection !== 'function') {
      return null;
    }

    const selection = rootDocument.getSelection();
    if (!selection || selection.rangeCount === 0 || !this.isSelectionInsideElement(selection, element)) {
      return null;
    }

    const range = selection.getRangeAt(0);
    const rangeText = String(range.toString?.() || selection.toString?.() || '');
    const start = this.getTextOffsetWithinElement(element, range.startContainer, range.startOffset);
    if (start < 0) {
      return null;
    }

    if (rangeText.length === 0) {
      return `caret: ${start}`;
    }

    const end = start + rangeText.length;
    if (isSensitive) {
      return `selection: ${start}-${end}; selected text: [redacted]`;
    }

    const selectedText = this.redactSensitiveText(rangeText);
    const truncatedSelection = selectedText.length > this.MAX_FOCUSED_SELECTION_LENGTH
      ? `${selectedText.substring(0, this.MAX_FOCUSED_SELECTION_LENGTH)}...`
      : selectedText;

    return [
      `selection: ${start}-${end}`,
      truncatedSelection ? `selected text: ${truncatedSelection}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  }

  private static isSelectionInsideElement(selection: Selection, element: Element): boolean {
    return (
      this.isNodeInsideElement(selection.anchorNode, element) &&
      this.isNodeInsideElement(selection.focusNode, element)
    );
  }

  private static isNodeInsideElement(node: Node | null, element: Element): boolean {
    if (!node) {
      return false;
    }

    if (node === element) {
      return true;
    }

    if (typeof element.contains === 'function') {
      const candidate = node.nodeType === 1 ? node : node.parentNode;
      return candidate ? element.contains(candidate) : false;
    }

    let current: Node | null = node;
    while (current) {
      if (current === element) {
        return true;
      }
      current = current.parentNode;
    }

    return false;
  }

  private static getTextOffsetWithinElement(element: Element, node: Node, offset: number): number {
    try {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.setEnd(node, offset);
      return range.toString().length;
    } catch {
      return -1;
    }
  }

  private static extractMediaLine(
    element: Element,
    root: Pick<FormFieldRoot, 'getElementById'> = document
  ): string | null {
    const mediaType = this.getMediaTypeLabel(element);
    const label = this.getMediaLabel(element, root);
    const caption = this.getMediaCaption(element);
    const source = this.getMediaSource(element);
    const details: string[] = [];

    details.push(label ? `${mediaType}: ${label}` : mediaType);

    if (caption && caption !== label) {
      details.push(`caption: ${caption}`);
    }

    if (source) {
      details.push(`${source.kind}: ${source.url}`);
    }

    if (details.length === 1 && !label && !caption && !source) {
      return null;
    }

    return details.join('; ');
  }

  private static getMediaTypeLabel(element: Element): string {
    const tagName = getTagName(element);
    const role = String(element.getAttribute?.('role') || '').toLowerCase();

    if (tagName === 'video') return 'Video';
    if (tagName === 'audio') return 'Audio';
    if (tagName === 'canvas') return 'Canvas';
    if (tagName === 'svg' || role === 'img') return 'Graphic';
    return 'Image';
  }

  private static getMediaLabel(
    element: Element,
    root: Pick<FormFieldRoot, 'getElementById'> = document
  ): string {
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => root.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    const svgTitle = this.cleanExtractedText(element.querySelector?.('title')?.textContent || '');
    const role = String(element.getAttribute?.('role') || '').toLowerCase();
    const textLabel = role === 'img' || getTagName(element) === 'canvas'
      ? this.cleanExtractedText(element.textContent || '')
      : '';

    return [
      element.getAttribute?.('alt'),
      element.getAttribute?.('aria-label'),
      labelledBy,
      element.getAttribute?.('title'),
      svgTitle,
      textLabel,
    ]
      .map((value) => this.cleanExtractedText(value || ''))
      .find(Boolean) || '';
  }

  private static getMediaCaption(element: Element): string {
    const figure = element.closest?.('figure');
    const caption = figure?.querySelector?.('figcaption');
    return this.cleanExtractedText(caption?.textContent || '');
  }

  private static getMediaSource(element: Element): { kind: 'source' | 'poster'; url: string } | null {
    const tagName = getTagName(element);
    const mediaElement = element as MediaSurface;
    const posterUrl = tagName === 'video'
      ? this.sanitizeMediaUrl(mediaElement.poster || mediaElement.getAttribute?.('poster') || '')
      : '';

    if (posterUrl) {
      return { kind: 'poster', url: posterUrl };
    }

    const sourceUrl = this.sanitizeMediaUrl(
      mediaElement.currentSrc ||
        mediaElement.src ||
        mediaElement.getAttribute?.('src') ||
        element.querySelector?.('source')?.getAttribute?.('src') ||
        ''
    );

    return sourceUrl ? { kind: 'source', url: sourceUrl } : null;
  }

  private static sanitizeMediaUrl(rawUrl: string): string {
    const trimmedUrl = String(rawUrl || '').trim();
    if (!trimmedUrl || /^(data|blob|javascript):/i.test(trimmedUrl)) {
      return '';
    }

    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.href : undefined;
      const url = new URL(trimmedUrl, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return '';
      }

      url.search = '';
      url.hash = '';
      return url.toString();
    } catch {
      return trimmedUrl.split('?')[0]?.split('#')[0] || '';
    }
  }

  private static extractFrameLine(element: Element): string | null {
    const label = this.getFrameLabel(element);
    const src = this.getFrameSource(element);
    const frameContent = this.getFrameContent(element);
    const frameListContent = this.getFrameListContent(element);
    const frameFormContent = this.getFrameFormContent(element);
    const frameActionContent = this.getFrameActionContent(element);
    const frameChoiceContent = this.getFrameChoiceContent(element);
    const frameTableContent = this.getFrameTableContent(element);
    const frameMediaContent = this.getFrameMediaContent(element);
    const details: string[] = [];

    details.push(label ? `Frame: ${label}` : 'Frame');

    if (src) {
      details.push(`src: ${src}`);
    }

    if (frameContent) {
      details.push(`content: ${frameContent}`);
    }

    if (frameListContent) {
      details.push(`lists: ${frameListContent}`);
    }

    if (frameFormContent) {
      details.push(`form fields: ${frameFormContent}`);
    }

    if (frameActionContent) {
      details.push(`actions: ${frameActionContent}`);
    }

    if (frameChoiceContent) {
      details.push(`choices: ${frameChoiceContent}`);
    }

    if (frameTableContent) {
      details.push(`tables: ${frameTableContent}`);
    }

    if (frameMediaContent) {
      details.push(`media: ${frameMediaContent}`);
    }

    if (
      details.length === 1 &&
      !label &&
      !src &&
      !frameContent &&
      !frameListContent &&
      !frameFormContent &&
      !frameActionContent &&
      !frameChoiceContent &&
      !frameTableContent &&
      !frameMediaContent
    ) {
      return null;
    }

    return details.join('; ');
  }

  private static getFrameLabel(element: Element): string {
    const frame = element as FrameSurface;
    const frameTitle = this.getFrameDocumentTitle(element);

    return [
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      frame.name,
      element.getAttribute?.('name'),
      frameTitle,
    ]
      .map((value) => this.cleanExtractedText(String(value || '')))
      .find(Boolean) || '';
  }

  private static getFrameSource(element: Element): string {
    const frame = element as FrameSurface;
    return this.sanitizeActionUrl(frame.src || element.getAttribute?.('src') || '');
  }

  private static getFrameDocumentTitle(element: Element): string {
    try {
      return this.cleanExtractedText(getFrameDocument(element)?.title || '');
    } catch {
      return '';
    }
  }

  private static getFrameContent(element: Element): string {
    try {
      const frameDocument = (element as FrameSurface).contentDocument || undefined;
      const bodyText = this.cleanExtractedText(frameDocument?.body?.textContent || '');
      if (!bodyText) {
        return '[accessible but no readable text]';
      }

      const redactedText = this.redactSensitiveText(bodyText);
      return redactedText.length > this.MAX_VISIBLE_FRAME_CONTENT_LENGTH
        ? `${redactedText.substring(0, this.MAX_VISIBLE_FRAME_CONTENT_LENGTH)}...`
        : redactedText;
    } catch {
      return '[content unavailable]';
    }
  }

  private static joinEmbeddedRootLines(
    root: FormFieldRoot | undefined,
    getLines: (root: FormFieldRoot) => string[]
  ): string {
    if (!root || typeof root.querySelectorAll !== 'function') {
      return '';
    }

    const lines = getLines(root);
    return lines.length > 0 ? lines.join(' | ') : '';
  }

  private static getFrameRootContent(
    element: Element,
    getLines: (root: FormFieldRoot) => string[]
  ): string {
    try {
      return this.joinEmbeddedRootLines(getFrameDocument(element), getLines);
    } catch {
      return '';
    }
  }

  private static getShadowRootLineContent(
    element: Element,
    getLines: (root: FormFieldRoot) => string[]
  ): string {
    return this.joinEmbeddedRootLines(getShadowRoot(element), getLines);
  }

  private static getFrameFormContent(element: Element): string {
    return this.getFrameRootContent(element, (root) => this.getVisibleFormFieldLines(root).slice(0, 4));
  }

  private static getFrameListContent(element: Element): string {
    return this.getFrameRootContent(element, (root) => this.getVisibleListLines(root, 3));
  }

  private static getFrameActionContent(element: Element): string {
    return this.getFrameRootContent(element, (root) => this.getVisibleActionLines(root, 4));
  }

  private static getFrameChoiceContent(element: Element): string {
    return this.getFrameRootContent(element, (root) => this.getVisibleChoiceGroupLines(root, 3));
  }

  private static getFrameTableContent(element: Element): string {
    return this.getFrameRootContent(element, (root) => (
      this.getVisibleTableBlocks(root, 2).map((block) => block.join(' / '))
    ));
  }

  private static getFrameMediaContent(element: Element): string {
    return this.getFrameRootContent(element, (root) => this.getVisibleMediaLines(root, 3));
  }

  private static extractShadowLine(element: Element): string | null {
    const label = this.getShadowHostLabel(element);
    const content = this.getShadowRootContent(element);
    const shadowListContent = this.getShadowListContent(element);
    const shadowFormContent = this.getShadowFormContent(element);
    const shadowActionContent = this.getShadowActionContent(element);
    const shadowChoiceContent = this.getShadowChoiceContent(element);
    const shadowTableContent = this.getShadowTableContent(element);
    const shadowMediaContent = this.getShadowMediaContent(element);
    const details: string[] = [];

    details.push(label ? `Shadow host: ${label}` : 'Shadow host');

    if (content) {
      details.push(`content: ${content}`);
    }

    if (shadowListContent) {
      details.push(`lists: ${shadowListContent}`);
    }

    if (shadowFormContent) {
      details.push(`form fields: ${shadowFormContent}`);
    }

    if (shadowActionContent) {
      details.push(`actions: ${shadowActionContent}`);
    }

    if (shadowChoiceContent) {
      details.push(`choices: ${shadowChoiceContent}`);
    }

    if (shadowTableContent) {
      details.push(`tables: ${shadowTableContent}`);
    }

    if (shadowMediaContent) {
      details.push(`media: ${shadowMediaContent}`);
    }

    if (
      details.length === 1 &&
      !label &&
      !content &&
      !shadowListContent &&
      !shadowFormContent &&
      !shadowActionContent &&
      !shadowChoiceContent &&
      !shadowTableContent &&
      !shadowMediaContent
    ) {
      return null;
    }

    return details.join('; ');
  }

  private static getShadowHostLabel(element: Element): string {
    const tagName = getTagName(element);
    return [
      element.getAttribute?.('aria-label'),
      element.getAttribute?.('title'),
      element.getAttribute?.('id'),
      element.getAttribute?.('data-testid'),
      tagName,
    ]
      .map((value) => this.cleanExtractedText(String(value || '')))
      .find(Boolean) || '';
  }

  private static getShadowRootContent(element: Element): string {
    const shadowRoot = getShadowRoot(element);
    if (!shadowRoot) {
      return '';
    }

    let text = '';
    try {
      text = this.collectTextExcludingIgnoredNodes(shadowRoot);
      if (!text) {
        const clone = shadowRoot.cloneNode?.(true) as DocumentFragment | undefined;
        clone
          ?.querySelectorAll?.('script, style')
          .forEach((child) => child.remove());
        text = this.cleanExtractedText(clone?.textContent || shadowRoot.textContent || '');
      }
    } catch {
      text = this.cleanExtractedText(shadowRoot.textContent || '');
    }

    const redactedText = this.redactSensitiveText(text);
    return redactedText.length > this.MAX_VISIBLE_SHADOW_CONTENT_LENGTH
      ? `${redactedText.substring(0, this.MAX_VISIBLE_SHADOW_CONTENT_LENGTH)}...`
      : redactedText;
  }

  private static getShadowFormContent(element: Element): string {
    return this.getShadowRootLineContent(element, (root) => this.getVisibleFormFieldLines(root).slice(0, 4));
  }

  private static getShadowListContent(element: Element): string {
    return this.getShadowRootLineContent(element, (root) => this.getVisibleListLines(root, 3));
  }

  private static getShadowActionContent(element: Element): string {
    return this.getShadowRootLineContent(element, (root) => this.getVisibleActionLines(root, 4));
  }

  private static getShadowChoiceContent(element: Element): string {
    return this.getShadowRootLineContent(element, (root) => this.getVisibleChoiceGroupLines(root, 3));
  }

  private static getShadowTableContent(element: Element): string {
    return this.getShadowRootLineContent(element, (root) => (
      this.getVisibleTableBlocks(root, 2).map((block) => block.join(' / '))
    ));
  }

  private static getShadowMediaContent(element: Element): string {
    return this.getShadowRootLineContent(element, (root) => this.getVisibleMediaLines(root, 3));
  }

  private static collectTextExcludingIgnoredNodes(root: ParentNode): string {
    const ignoredTags = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);
    const pieces: string[] = [];

    const visit = (node: Node) => {
      const nodeType = Number(node.nodeType);
      if (nodeType === 3) {
        pieces.push(node.textContent || '');
        return;
      }

      const tagName = String((node as Node & { tagName?: string }).tagName || '').toUpperCase();
      if (nodeType === 1 && ignoredTags.has(tagName)) {
        return;
      }

      Array.from(node.childNodes || []).forEach(visit);
    };

    visit(root);
    return this.cleanExtractedText(pieces.join(' '));
  }

  private static extractTableBlock(
    element: Element,
    tableIndex: number,
    root: Pick<FormFieldRoot, 'getElementById'> = document
  ): string[] {
    const rowElements = this.getTableRowElements(element)
      .filter((row) => this.isVisibleInViewport(row));
    const rows = rowElements
      .map((row) => ({
        cells: this.extractTableCells(row),
        hasHeaderCells: this.hasTableHeaderCells(row),
      }))
      .filter((row) => row.cells.length > 0);

    if (rows.length === 0) {
      return [];
    }

    let headers = this.getExplicitTableHeaders(element);
    let rowStartIndex = 0;
    if (headers.length > 0 && rows[0]?.hasHeaderCells) {
      rowStartIndex = 1;
    } else if (headers.length === 0 && rows[0]?.hasHeaderCells) {
      headers = rows[0].cells;
      rowStartIndex = 1;
    }

    headers = headers.slice(0, this.MAX_VISIBLE_TABLE_COLUMNS);
    const dataRows = rows
      .slice(rowStartIndex)
      .filter((row) => row.cells.some(Boolean))
      .slice(0, this.MAX_VISIBLE_TABLE_ROWS);

    if (headers.length === 0 && dataRows.length === 0) {
      return [];
    }

    const label = this.getTableLabel(element, root);
    const block = [`Table ${tableIndex}${label ? `: ${label}` : ''}`];
    if (headers.length > 0) {
      block.push(`Columns: ${headers.join(' | ')}`);
    }

    dataRows.forEach((row, index) => {
      const cells = row.cells
        .slice(0, this.MAX_VISIBLE_TABLE_COLUMNS)
        .map((cell, cellIndex) => this.sanitizeTableCell(cell, headers[cellIndex] || ''));
      block.push(`Row ${index + 1}: ${cells.join(' | ')}`);
    });

    return block;
  }

  private static getTableRowElements(element: Element): Element[] {
    const rows = Array.from(element.querySelectorAll?.('tr, [role="row"]') || []);
    if (rows.length > 0) {
      return rows;
    }

    return [element];
  }

  private static extractTableCells(row: Element): string[] {
    return Array.from(
      row.querySelectorAll?.(
        'th, td, [role="columnheader"], [role="rowheader"], [role="cell"], [role="gridcell"]'
      ) || []
    )
      .map((cell) => this.cleanExtractedText(cell.textContent || ''))
      .filter(Boolean);
  }

  private static hasTableHeaderCells(row: Element): boolean {
    return Boolean(
      row.querySelector?.('th, [role="columnheader"], [role="rowheader"]')
    );
  }

  private static getExplicitTableHeaders(element: Element): string[] {
    return Array.from(element.querySelectorAll?.('thead th, [role="columnheader"]') || [])
      .map((header) => this.cleanExtractedText(header.textContent || ''))
      .filter(Boolean)
      .slice(0, this.MAX_VISIBLE_TABLE_COLUMNS);
  }

  private static getTableLabel(
    element: Element,
    root: Pick<FormFieldRoot, 'getElementById'> = document
  ): string {
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => root.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    const caption = this.cleanExtractedText(element.querySelector?.('caption')?.textContent || '');

    return [
      element.getAttribute?.('aria-label'),
      labelledBy,
      caption,
      element.getAttribute?.('title'),
    ]
      .map((value) => this.cleanExtractedText(value || ''))
      .find(Boolean) || '';
  }

  private static sanitizeTableCell(value: string, header: string): string {
    if (this.SENSITIVE_FIELD_PATTERN.test(header) || this.SENSITIVE_VALUE_PATTERN.test(value)) {
      return '[redacted]';
    }

    return value;
  }

  private static extractUiStateLine(element: Element): string | null {
    const type = this.getUiStateTypeLabel(element);
    const label = this.getUiStateLabel(element);
    const message = this.sanitizeUiStateText(this.cleanExtractedText(element.textContent || ''), label);
    const state = this.getUiStateDetails(element);
    const details: string[] = [];

    details.push(label ? `${type}: ${label}` : type);

    if (message && message !== label) {
      details.push(`message: ${message}`);
    }

    if (state) {
      details.push(`state: ${state}`);
    }

    if (details.length === 1 && !label && !message && !state) {
      return null;
    }

    return details.join('; ');
  }

  private static getUiStateTypeLabel(element: Element): string {
    const tagName = getTagName(element);
    const role = String(element.getAttribute?.('role') || '').toLowerCase();

    if (role === 'alertdialog') return 'Alert dialog';
    if (role === 'dialog' || tagName === 'dialog') return 'Dialog';
    if (role === 'alert') return 'Alert';
    if (role === 'status') return 'Status';
    if (role === 'log') return 'Log';
    if (role === 'tooltip') return 'Tooltip';
    if (role === 'progressbar') return 'Progress';
    if (this.hasElementAttribute(element, 'popover')) return 'Popover';
    if (element.getAttribute?.('aria-live')) return 'Live region';
    if (element.getAttribute?.('aria-busy') === 'true') return 'Busy region';
    return 'Notice';
  }

  private static getUiStateLabel(element: Element): string {
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => document.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    const heading = this.cleanExtractedText(
      element.querySelector?.('h1, h2, h3, h4, h5, h6, [role="heading"]')?.textContent || ''
    );

    return [
      element.getAttribute?.('aria-label'),
      labelledBy,
      heading,
      element.getAttribute?.('title'),
    ]
      .map((value) => this.cleanExtractedText(value || ''))
      .find(Boolean) || '';
  }

  private static getUiStateDetails(element: Element): string {
    const details: string[] = [];
    const ariaLive = element.getAttribute?.('aria-live');
    const ariaBusy = element.getAttribute?.('aria-busy');
    const ariaModal = element.getAttribute?.('aria-modal');
    const ariaExpanded = element.getAttribute?.('aria-expanded');
    const role = String(element.getAttribute?.('role') || '').toLowerCase();

    if (ariaLive && ariaLive !== 'off') {
      details.push(`live ${ariaLive}`);
    }

    if (ariaBusy === 'true') {
      details.push('busy');
    }

    if (ariaModal === 'true') {
      details.push('modal');
    }

    if (ariaExpanded === 'true') {
      details.push('expanded');
    } else if (ariaExpanded === 'false') {
      details.push('collapsed');
    }

    if (role === 'progressbar') {
      const control = element as FormControlSurface;
      const value = element.getAttribute?.('aria-valuenow') || String(control.value || '');
      const max = element.getAttribute?.('aria-valuemax') || String(control.max || '');
      if (value) {
        details.push(max && max !== '1' ? `progress ${value}/${max}` : `progress ${value}`);
      }
    }

    if (this.hasElementAttribute(element, 'popover')) {
      details.push('popover open');
    }

    return details.join(', ');
  }

  private static hasElementAttribute(element: Element, name: string): boolean {
    if (typeof element.hasAttribute === 'function') {
      return element.hasAttribute(name);
    }

    return element.getAttribute?.(name) !== null;
  }

  private static sanitizeUiStateText(text: string, label: string): string {
    if (!text) {
      return '';
    }

    const withoutDuplicateLabel = label && text.startsWith(label)
      ? this.cleanExtractedText(text.slice(label.length))
      : text;

    return this.redactSensitiveText(withoutDuplicateLabel);
  }

  private static extractChoiceGroupLine(
    element: Element,
    root: Pick<FormFieldRoot, 'getElementById' | 'querySelectorAll'> = document
  ): string | null {
    const choiceType = this.getChoiceGroupTypeLabel(element);
    const label = this.getChoiceGroupLabel(element, root);
    const options = this.getVisibleChoiceOptions(element, root);
    if (options.length === 0) {
      return null;
    }

    const details = [
      label ? `${choiceType}: ${label}` : choiceType,
      `options: ${options.join(' | ')}`,
    ];

    return details.join('; ');
  }

  private static getChoiceGroupTypeLabel(element: Element): string {
    const role = String(element.getAttribute?.('role') || '').toLowerCase();

    if (role === 'listbox') return 'Listbox';
    if (role === 'menu' || role === 'menubar') return 'Menu';
    if (role === 'radiogroup') return 'Radio group';
    if (role === 'tree') return 'Tree';
    if (role === 'tablist') return 'Tab list';
    return 'Choice group';
  }

  private static getChoiceGroupLabel(
    element: Element,
    root: Pick<FormFieldRoot, 'getElementById'> = document
  ): string {
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => root.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    const heading = this.cleanExtractedText(
      element.querySelector?.('h1, h2, h3, h4, h5, h6, [role="heading"]')?.textContent || ''
    );

    return [
      element.getAttribute?.('aria-label'),
      labelledBy,
      heading,
      element.getAttribute?.('title'),
      element.getAttribute?.('data-testid'),
      element.getAttribute?.('id'),
    ]
      .map((value) => this.redactSensitiveText(String(value || '')))
      .find(Boolean) || '';
  }

  private static getVisibleChoiceOptions(
    element: Element,
    root: Pick<FormFieldRoot, 'getElementById' | 'querySelectorAll'> = document
  ): string[] {
    const optionElements = Array.from(
      element.querySelectorAll?.(
        '[role="option"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="radio"], [role="treeitem"], [role="tab"]'
      ) || []
    );
    const seen = new Set<string>();
    const activeDescendantId = this.getActiveDescendantId(element, root);

    return optionElements
      .filter((option) => this.isVisibleInViewport(option))
      .map((option) => this.extractChoiceOptionLine(option, activeDescendantId, root))
      .filter((line): line is string => Boolean(line))
      .filter((line) => {
        if (seen.has(line)) {
          return false;
        }
        seen.add(line);
        return true;
      })
      .slice(0, this.MAX_VISIBLE_CHOICES_PER_GROUP);
  }

  private static extractChoiceOptionLine(
    element: Element,
    activeDescendantId = '',
    root: Pick<FormFieldRoot, 'getElementById'> = document
  ): string | null {
    const label = this.getChoiceOptionLabel(element, root);
    if (!label) {
      return null;
    }

    const state = this.getChoiceOptionState(element, activeDescendantId);
    return state ? `${label} (${state})` : label;
  }

  private static getChoiceOptionLabel(
    element: Element,
    root: Pick<FormFieldRoot, 'getElementById'> = document
  ): string {
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => root.getElementById?.(id)?.textContent || '')
        .join(' ')
    );

    return [
      element.getAttribute?.('aria-label'),
      labelledBy,
      element.textContent,
      element.getAttribute?.('title'),
      element.getAttribute?.('data-testid'),
    ]
      .map((value) => this.redactSensitiveText(String(value || '')))
      .find(Boolean) || '';
  }

  private static getChoiceOptionState(element: Element, activeDescendantId = ''): string {
    const states: string[] = [];
    const role = String(element.getAttribute?.('role') || '').toLowerCase();
    const id = String(element.getAttribute?.('id') || element.id || '');
    const selected = element.getAttribute?.('aria-selected');
    const checked = element.getAttribute?.('aria-checked');
    const current = element.getAttribute?.('aria-current');
    const disabled = element.getAttribute?.('aria-disabled');
    const expanded = element.getAttribute?.('aria-expanded');

    if (activeDescendantId && id === activeDescendantId) states.push('active');
    if (selected === 'true') states.push('selected');
    if (checked === 'true') states.push(role.includes('checkbox') ? 'checked' : 'selected');
    if (checked === 'false' && (role === 'radio' || role === 'menuitemradio')) states.push('not selected');
    if (disabled === 'true' || (element as FormControlSurface).disabled) states.push('disabled');
    if (expanded === 'true') states.push('expanded');
    if (expanded === 'false') states.push('collapsed');
    if (current && current !== 'false') states.push(current === 'true' ? 'current' : `current ${current}`);

    return Array.from(new Set(states)).join(', ');
  }

  private static getActiveDescendantId(
    element: Element,
    root: Pick<FormFieldRoot, 'querySelectorAll'> = document
  ): string {
    const localActiveDescendant = this.cleanExtractedText(String(element.getAttribute?.('aria-activedescendant') || ''));
    if (localActiveDescendant) {
      return localActiveDescendant;
    }

    const groupId = this.cleanExtractedText(String(element.getAttribute?.('id') || ''));
    if (!groupId || typeof root.querySelectorAll !== 'function') {
      return '';
    }

    const ownerControls = Array.from(root.querySelectorAll('[aria-activedescendant]'));
    const owningControl = ownerControls.find((control) => {
      const controlledIds = [
        ...String(control.getAttribute?.('aria-controls') || '').split(/\s+/),
        ...String(control.getAttribute?.('aria-owns') || '').split(/\s+/),
      ].filter(Boolean);
      return controlledIds.includes(groupId);
    });

    return owningControl
      ? this.cleanExtractedText(String(owningControl.getAttribute?.('aria-activedescendant') || ''))
      : '';
  }

  private static extractExpandedRegionLine(element: Element, labelOverride?: string): string | null {
    const label = this.getExpandedRegionLabel(element, labelOverride);
    const content = this.getExpandedRegionContent(element, label);
    if (!label && !content) {
      return null;
    }

    return [
      label ? `Expanded region: ${label}` : 'Expanded region',
      content ? `content: ${content}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  }

  private static getExpandedRegionLabel(element: Element, labelOverride?: string): string {
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => document.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    const summary = this.cleanExtractedText(element.querySelector?.('summary')?.textContent || '');
    const heading = this.cleanExtractedText(
      element.querySelector?.('h1, h2, h3, h4, h5, h6, [role="heading"]')?.textContent || ''
    );

    return [
      labelOverride,
      element.getAttribute?.('aria-label'),
      labelledBy,
      summary,
      heading,
      element.getAttribute?.('title'),
      element.getAttribute?.('data-testid'),
      element.getAttribute?.('id'),
    ]
      .map((value) => this.redactSensitiveText(String(value || '')))
      .find(Boolean) || '';
  }

  private static getExpandedRegionContent(element: Element, label: string): string {
    let text = '';

    try {
      const clone = element.cloneNode?.(true) as Element | undefined;
      clone
        ?.querySelectorAll?.(
          'script, style, template, noscript, [hidden], [aria-hidden="true"], [style*="display: none"], [style*="display:none"], [style*="visibility: hidden"], [style*="visibility:hidden"]'
        )
        .forEach((child) => child.remove());
      text = this.cleanExtractedText(clone?.textContent || element.textContent || '');
    } catch {
      text = this.cleanExtractedText(element.textContent || '');
    }

    const withoutDuplicateLabel = label && text.startsWith(label)
      ? this.cleanExtractedText(text.slice(label.length))
      : text;
    const redactedText = this.redactSensitiveText(withoutDuplicateLabel);

    return redactedText.length > this.MAX_VISIBLE_REGION_CONTENT_LENGTH
      ? `${redactedText.substring(0, this.MAX_VISIBLE_REGION_CONTENT_LENGTH)}...`
      : redactedText;
  }

  private static isVisibleScrolledContainer(element: Element): boolean {
    if (element === document.body || element === document.documentElement) {
      return false;
    }

    if (!this.isVisibleInViewport(element)) {
      return false;
    }

    const container = element as ScrollSurface;
    const scrollTop = Math.round(Number(container.scrollTop) || 0);
    const scrollLeft = Math.round(Number(container.scrollLeft) || 0);
    if (scrollTop <= 0 && scrollLeft <= 0) {
      return false;
    }

    const clientHeight = Number(container.clientHeight) || 0;
    const clientWidth = Number(container.clientWidth) || 0;
    const scrollHeight = Number(container.scrollHeight) || 0;
    const scrollWidth = Number(container.scrollWidth) || 0;
    const hasVerticalScroll = scrollHeight > clientHeight + 2;
    const hasHorizontalScroll = scrollWidth > clientWidth + 2;
    if (!hasVerticalScroll && !hasHorizontalScroll) {
      return false;
    }

    const style = window.getComputedStyle(element);
    const overflowY = String(style.overflowY || '').toLowerCase();
    const overflowX = String(style.overflowX || '').toLowerCase();
    const allowsVerticalScroll = ['auto', 'scroll', 'overlay'].includes(overflowY) || scrollTop > 0;
    const allowsHorizontalScroll = ['auto', 'scroll', 'overlay'].includes(overflowX) || scrollLeft > 0;

    return (hasVerticalScroll && allowsVerticalScroll) || (hasHorizontalScroll && allowsHorizontalScroll);
  }

  private static extractScrollContainerLine(element: Element): string | null {
    const container = element as ScrollSurface;
    const scrollTop = Math.round(Number(container.scrollTop) || 0);
    const scrollLeft = Math.round(Number(container.scrollLeft) || 0);
    const clientWidth = Math.round(Number(container.clientWidth) || element.getBoundingClientRect().width || 0);
    const clientHeight = Math.round(Number(container.clientHeight) || element.getBoundingClientRect().height || 0);
    const scrollWidth = Math.round(Number(container.scrollWidth) || clientWidth);
    const scrollHeight = Math.round(Number(container.scrollHeight) || clientHeight);
    const label = this.getScrollContainerLabel(element);
    const visibleText = this.getVisibleScrollContainerText(element);
    const details = [
      label ? `Scroll container: ${label}` : 'Scroll container',
      `scroll: x=${scrollLeft}, y=${scrollTop}`,
      `size: ${clientWidth}x${clientHeight}`,
      `content: ${scrollWidth}x${scrollHeight}`,
      visibleText ? `visible: ${visibleText}` : '',
    ].filter(Boolean);

    return details.join('; ');
  }

  private static getScrollContainerLabel(element: Element): string {
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => document.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    const heading = this.cleanExtractedText(
      element.querySelector?.('h1, h2, h3, h4, h5, h6, [role="heading"]')?.textContent || ''
    );

    return [
      element.getAttribute?.('aria-label'),
      labelledBy,
      heading,
      element.getAttribute?.('title'),
      element.getAttribute?.('data-testid'),
      element.getAttribute?.('id'),
      element.getAttribute?.('role'),
    ]
      .map((value) => this.cleanExtractedText(String(value || '')))
      .find(Boolean) || '';
  }

  private static getVisibleScrollContainerText(element: Element): string {
    const candidates = Array.from(
      element.querySelectorAll?.(
        'article, [role="article"], li, [role="listitem"], p, h1, h2, h3, h4, h5, h6, [role="heading"], button, a, [role="button"], [role="link"]'
      ) || []
    );
    const seen = new Set<string>();
    const visiblePieces = candidates
      .filter((candidate) => this.isVisibleInViewport(candidate))
      .filter((candidate) => this.intersectsContainerViewport(candidate, element))
      .map((candidate) => this.redactSensitiveText(candidate.textContent || ''))
      .filter((text) => text.length >= 8)
      .filter((text) => {
        if (seen.has(text)) {
          return false;
        }
        seen.add(text);
        return true;
      })
      .slice(0, 3);

    const text = visiblePieces.join(' | ');
    return text.length > this.MAX_SCROLL_CONTAINER_TEXT_LENGTH
      ? `${text.substring(0, this.MAX_SCROLL_CONTAINER_TEXT_LENGTH)}...`
      : text;
  }

  private static intersectsContainerViewport(child: Element, container: Element): boolean {
    const childRect = child.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    return (
      childRect.bottom > containerRect.top &&
      childRect.top < containerRect.bottom &&
      childRect.right > containerRect.left &&
      childRect.left < containerRect.right
    );
  }

  private static redactSensitiveText(text: string): string {
    return this.cleanExtractedText(text)
      .split(/\s+/)
      .map((token) => {
        const normalizedToken = token.replace(/^[^\w]+|[^\w]+$/g, '');
        if (this.SENSITIVE_VALUE_PATTERN.test(normalizedToken)) {
          return token.replace(normalizedToken, '[redacted]');
        }
        return token;
      })
      .join(' ');
  }

  private static extractActionLine(element: Element): string | null {
    const label = this.getActionLabel(element);
    if (!label) {
      return null;
    }

    const actionType = this.getActionTypeLabel(element);
    const destination = this.getActionDestination(element);
    const state = this.getActionState(element);
    const details = [`${actionType}: ${label}`];

    if (destination) {
      details.push(`href: ${destination}`);
    }

    if (state) {
      details.push(`state: ${state}`);
    }

    return details.join('; ');
  }

  private static getActionLabel(element: Element): string {
    const control = element as FormControlSurface;
    const labelledBy = this.cleanExtractedText(
      String(element.getAttribute?.('aria-labelledby') || '')
        .split(/\s+/)
        .map((id) => document.getElementById?.(id)?.textContent || '')
        .join(' ')
    );
    const imageAlt = this.cleanExtractedText(element.querySelector?.('img[alt]')?.getAttribute?.('alt') || '');

    return [
      element.getAttribute?.('aria-label'),
      labelledBy,
      control.value,
      element.textContent,
      element.getAttribute?.('title'),
      imageAlt,
      element.getAttribute?.('data-testid'),
    ]
      .map((value) => this.cleanExtractedText(String(value || '')))
      .find(Boolean) || '';
  }

  private static getActionTypeLabel(element: Element): string {
    const tagName = getTagName(element);
    const role = String(element.getAttribute?.('role') || '').toLowerCase();
    const type = String((element as FormControlSurface).type || '').toLowerCase();

    if (tagName === 'a' || role === 'link') return 'Link';
    if (role === 'menuitem') return 'Menu item';
    if (role === 'tab') return 'Tab';
    if (tagName === 'summary') return 'Disclosure';
    if (type === 'submit') return 'Submit button';
    if (type === 'reset') return 'Reset button';
    if (tagName === 'button' || role === 'button' || type === 'button') return 'Button';
    return 'Action';
  }

  private static getActionDestination(element: Element): string {
    const href = (element as FormControlSurface).href || element.getAttribute?.('href') || '';
    return this.sanitizeActionUrl(href);
  }

  private static getActionState(element: Element): string {
    const control = element as FormControlSurface;
    const states: string[] = [];

    if (control.disabled || element.getAttribute?.('aria-disabled') === 'true') {
      states.push('disabled');
    }

    const expanded = element.getAttribute?.('aria-expanded');
    if (expanded === 'true') states.push('expanded');
    if (expanded === 'false') states.push('collapsed');

    const pressed = element.getAttribute?.('aria-pressed');
    if (pressed === 'true') states.push('pressed');
    if (pressed === 'false') states.push('not pressed');

    const selected = element.getAttribute?.('aria-selected');
    if (selected === 'true') states.push('selected');

    const current = element.getAttribute?.('aria-current');
    if (current && current !== 'false') {
      states.push(current === 'true' ? 'current' : `current ${current}`);
    }

    return states.join(', ');
  }

  private static sanitizeActionUrl(rawUrl: string): string {
    const trimmedUrl = String(rawUrl || '').trim();
    if (!trimmedUrl || /^(data|blob|javascript):/i.test(trimmedUrl)) {
      return '';
    }

    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.href : undefined;
      const url = new URL(trimmedUrl, baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        return '';
      }

      return this.sanitizeUrl(url.toString());
    } catch {
      return trimmedUrl.split('?')[0]?.split('#')[0] || '';
    }
  }
}
