import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('webextension-polyfill', () => ({
  default: {
    tabs: {
      sendMessage: vi.fn(),
    },
  },
}));

import { ContextCollector } from './context-collector';

interface FakeRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface FakeSelection {
  anchorNode?: unknown;
  focusNode?: unknown;
  rangeCount: number;
  getRangeAt?: (index: number) => {
    startContainer?: unknown;
    startOffset?: number;
    toString: () => string;
  };
  toString: () => string;
}

class FakeElement {
  textContent: string;
  private rect: FakeRect;

  constructor(textContent: string, rect: FakeRect) {
    this.textContent = textContent;
    this.rect = rect;
  }

  getBoundingClientRect(): FakeRect {
    return this.rect;
  }
}

class FakeControl extends FakeElement {
  tagName: string;
  type: string | undefined;
  value: string | undefined;
  checked: boolean | undefined;
  id: string | undefined;
  name: string | undefined;
  placeholder: string | undefined;
  disabled: boolean | undefined;
  readOnly: boolean | undefined;
  required: boolean | undefined;
  validationMessage: string | undefined;
  validity: { valid: boolean } | undefined;
  files: Array<{ name: string; size?: number; type?: string }> | undefined;
  selectionEnd: number | undefined;
  selectionStart: number | undefined;
  labels: FakeElement[] | undefined;
  selectedOptions: FakeElement[] | undefined;
  private attributes: Record<string, string>;

  constructor(options: {
    tagName: string;
    rect: FakeRect;
    textContent?: string;
    type?: string;
    value?: string;
    checked?: boolean;
    id?: string;
    name?: string;
    placeholder?: string;
    disabled?: boolean;
    readOnly?: boolean;
    required?: boolean;
    validationMessage?: string;
    validity?: { valid: boolean };
    files?: Array<{ name: string; size?: number; type?: string }>;
    selectionEnd?: number;
    selectionStart?: number;
    labels?: FakeElement[];
    selectedOptions?: FakeElement[];
    attributes?: Record<string, string>;
  }) {
    super(options.textContent || '', options.rect);
    this.tagName = options.tagName.toUpperCase();
    this.type = options.type;
    this.value = options.value;
    this.checked = options.checked;
    this.id = options.id;
    this.name = options.name;
    this.placeholder = options.placeholder;
    this.disabled = options.disabled;
    this.readOnly = options.readOnly;
    this.required = options.required;
    this.validationMessage = options.validationMessage;
    this.validity = options.validity;
    this.files = options.files;
    this.selectionEnd = options.selectionEnd;
    this.selectionStart = options.selectionStart;
    this.labels = options.labels;
    this.selectedOptions = options.selectedOptions;
    this.attributes = options.attributes || {};
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  closest(_selector: string): null {
    return null;
  }
}

class FakeMediaElement extends FakeElement {
  tagName: string;
  currentSrc: string | undefined;
  src: string | undefined;
  poster: string | undefined;
  private attributes: Record<string, string>;
  private caption: string | undefined;
  private childSource: string | undefined;
  private svgTitle: string | undefined;

  constructor(options: {
    tagName: string;
    rect: FakeRect;
    textContent?: string;
    currentSrc?: string;
    src?: string;
    poster?: string;
    caption?: string;
    childSource?: string;
    svgTitle?: string;
    attributes?: Record<string, string>;
  }) {
    super(options.textContent || '', options.rect);
    this.tagName = options.tagName.toUpperCase();
    this.currentSrc = options.currentSrc;
    this.src = options.src;
    this.poster = options.poster;
    this.caption = options.caption;
    this.childSource = options.childSource;
    this.svgTitle = options.svgTitle;
    this.attributes = options.attributes || {};
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  closest(selector: string): { querySelector: (query: string) => FakeElement | null } | null {
    if (selector !== 'figure' || !this.caption) {
      return null;
    }

    return {
      querySelector: (query: string) => query === 'figcaption'
        ? new FakeElement(this.caption || '', makeRect(0, 20))
        : null,
    };
  }

  querySelector(selector: string): { textContent?: string; getAttribute?: (name: string) => string | null } | null {
    if (selector === 'title' && this.svgTitle) {
      return { textContent: this.svgTitle };
    }

    if (selector === 'source' && this.childSource) {
      return {
        getAttribute: (name: string) => name === 'src' ? this.childSource || null : null,
      };
    }

    return null;
  }
}

class FakeActionElement extends FakeElement {
  tagName: string;
  type: string | undefined;
  value: string | undefined;
  href: string | undefined;
  disabled: boolean | undefined;
  private attributes: Record<string, string>;
  private imageAlt: string | undefined;

  constructor(options: {
    tagName: string;
    rect: FakeRect;
    textContent?: string;
    type?: string;
    value?: string;
    href?: string;
    disabled?: boolean;
    imageAlt?: string;
    attributes?: Record<string, string>;
  }) {
    super(options.textContent || '', options.rect);
    this.tagName = options.tagName.toUpperCase();
    this.type = options.type;
    this.value = options.value;
    this.href = options.href;
    this.disabled = options.disabled;
    this.imageAlt = options.imageAlt;
    this.attributes = options.attributes || {};
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  querySelector(selector: string): { getAttribute: (name: string) => string | null } | null {
    if (selector === 'img[alt]' && this.imageAlt) {
      return {
        getAttribute: (name: string) => name === 'alt' ? this.imageAlt || null : null,
      };
    }

    return null;
  }
}

class FakeStructureElement extends FakeElement {
  tagName: string;
  private attributes: Record<string, string>;
  private currentItem: FakeActionElement | undefined;
  private heading: FakeElement | undefined;

  constructor(options: {
    tagName: string;
    rect: FakeRect;
    textContent?: string;
    attributes?: Record<string, string>;
    currentItem?: FakeActionElement;
    heading?: FakeElement;
  }) {
    super(options.textContent || '', options.rect);
    this.tagName = options.tagName.toUpperCase();
    this.attributes = options.attributes || {};
    this.currentItem = options.currentItem;
    this.heading = options.heading;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  querySelector(selector: string): FakeActionElement | FakeElement | null {
    if (selector.includes('aria-current') && this.currentItem) {
      return this.currentItem;
    }

    if (selector.includes('h1') && this.heading) {
      return this.heading;
    }

    return null;
  }
}

class FakeListItemElement extends FakeElement {
  private attributes: Record<string, string>;
  private stateControl: FakeControl | undefined;

  constructor(options: {
    textContent: string;
    rect: FakeRect;
    attributes?: Record<string, string>;
    stateControl?: FakeControl;
  }) {
    super(options.textContent, options.rect);
    this.attributes = options.attributes || {};
    this.stateControl = options.stateControl;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  querySelector(selector: string): FakeControl | null {
    if (selector.includes('checkbox') || selector.includes('radio')) {
      return this.stateControl || null;
    }

    return null;
  }
}

class FakeListElement extends FakeElement {
  tagName: string;
  private attributes: Record<string, string>;
  private items: FakeListItemElement[];
  private heading: FakeElement | undefined;

  constructor(options: {
    tagName: string;
    rect: FakeRect;
    items: FakeListItemElement[];
    attributes?: Record<string, string>;
    heading?: FakeElement;
  }) {
    super(options.items.map((item) => item.textContent).join(' '), options.rect);
    this.tagName = options.tagName.toUpperCase();
    this.attributes = options.attributes || {};
    this.items = options.items;
    this.heading = options.heading;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  closest(_selector: string): null {
    return null;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.includes('h1') && this.heading) {
      return this.heading;
    }

    return null;
  }

  querySelectorAll(selector: string): FakeListItemElement[] {
    if (selector.includes('li') || selector.includes('[role="listitem"]') || selector.includes('article')) {
      return this.items;
    }

    return [];
  }
}

class FakeTableCell extends FakeElement {
  tagName: string;
  private attributes: Record<string, string>;

  constructor(textContent: string, options: { tagName?: string; attributes?: Record<string, string> } = {}) {
    super(textContent, makeRect(0, 24));
    this.tagName = (options.tagName || 'td').toUpperCase();
    this.attributes = options.attributes || {};
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }
}

class FakeTableRow extends FakeElement {
  private cells: FakeTableCell[];

  constructor(cells: FakeTableCell[], rect: FakeRect) {
    super(cells.map((cell) => cell.textContent).join(' '), rect);
    this.cells = cells;
  }

  querySelectorAll(selector: string): FakeTableCell[] {
    if (
      selector.includes('th') ||
      selector.includes('td') ||
      selector.includes('[role="columnheader"]') ||
      selector.includes('[role="rowheader"]') ||
      selector.includes('[role="cell"]') ||
      selector.includes('[role="gridcell"]')
    ) {
      return this.cells;
    }

    return [];
  }

  querySelector(selector: string): FakeTableCell | null {
    if (selector.includes('th') || selector.includes('[role="columnheader"]') || selector.includes('[role="rowheader"]')) {
      return this.cells.find((cell) => {
        const role = cell.getAttribute('role');
        return cell.tagName === 'TH' || role === 'columnheader' || role === 'rowheader';
      }) || null;
    }

    return null;
  }
}

class FakeTableElement extends FakeElement {
  private rows: FakeTableRow[];
  private attributes: Record<string, string>;
  private caption: string | undefined;

  constructor(options: {
    rect: FakeRect;
    rows: FakeTableRow[];
    caption?: string;
    attributes?: Record<string, string>;
  }) {
    super(options.rows.map((row) => row.textContent).join(' '), options.rect);
    this.rows = options.rows;
    this.caption = options.caption;
    this.attributes = options.attributes || {};
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  querySelectorAll(selector: string): Array<FakeTableRow | FakeTableCell> {
    if (selector.includes('tr') || selector.includes('[role="row"]')) {
      return this.rows;
    }

    if (selector.includes('thead th') || selector.includes('[role="columnheader"]')) {
      return this.rows.flatMap((row) =>
        row.querySelectorAll('th, [role="columnheader"]').filter((cell) => {
          return cell.tagName === 'TH' || cell.getAttribute('role') === 'columnheader';
        })
      );
    }

    return [];
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === 'caption' && this.caption) {
      return new FakeElement(this.caption, makeRect(0, 24));
    }

    return null;
  }
}

class FakeUiStateElement extends FakeElement {
  tagName: string;
  value: string | undefined;
  max: string | undefined;
  private attributes: Record<string, string>;
  private heading: string | undefined;

  constructor(options: {
    tagName: string;
    rect: FakeRect;
    textContent?: string;
    value?: string;
    max?: string;
    heading?: string;
    attributes?: Record<string, string>;
  }) {
    super(options.textContent || '', options.rect);
    this.tagName = options.tagName.toUpperCase();
    this.value = options.value;
    this.max = options.max;
    this.heading = options.heading;
    this.attributes = options.attributes || {};
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  hasAttribute(name: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  querySelector(selector: string): FakeElement | null {
    if (selector.includes('h1') && this.heading) {
      return new FakeElement(this.heading, makeRect(0, 24));
    }

    return null;
  }
}

class FakeChoiceOptionElement extends FakeElement {
  private attributes: Record<string, string>;

  constructor(textContent: string, rect: FakeRect, attributes: Record<string, string> = {}) {
    super(textContent, rect);
    this.attributes = attributes;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }
}

class FakeChoiceGroupElement extends FakeElement {
  private attributes: Record<string, string>;
  private options: FakeChoiceOptionElement[];

  constructor(options: {
    rect: FakeRect;
    choices: FakeChoiceOptionElement[];
    attributes?: Record<string, string>;
  }) {
    super(options.choices.map((choice) => choice.textContent).join(' '), options.rect);
    this.attributes = options.attributes || {};
    this.options = options.choices;
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  querySelector(_selector: string): null {
    return null;
  }

  querySelectorAll(selector: string): FakeChoiceOptionElement[] {
    if (
      selector.includes('[role="option"]') ||
      selector.includes('[role="menuitem"]') ||
      selector.includes('[role="menuitemcheckbox"]') ||
      selector.includes('[role="menuitemradio"]') ||
      selector.includes('[role="radio"]') ||
      selector.includes('[role="treeitem"]') ||
      selector.includes('[role="tab"]')
    ) {
      return this.options;
    }

    return [];
  }
}

class FakeExpandedRegionElement extends FakeElement {
  private attributes: Record<string, string>;
  private summary: string | undefined;
  private heading: string | undefined;

  constructor(options: {
    rect: FakeRect;
    textContent: string;
    summary?: string;
    heading?: string;
    attributes?: Record<string, string>;
  }) {
    super(options.textContent, options.rect);
    this.summary = options.summary;
    this.heading = options.heading;
    this.attributes = options.attributes || {};
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === 'summary' && this.summary) {
      return new FakeElement(this.summary, makeRect(0, 24));
    }

    if (selector.includes('h1') && this.heading) {
      return new FakeElement(this.heading, makeRect(0, 24));
    }

    return null;
  }

  cloneNode(): { textContent: string; querySelectorAll: () => Array<{ remove: () => void }> } {
    return {
      textContent: this.textContent,
      querySelectorAll: () => [],
    };
  }
}

class FakeFrameElement extends FakeElement {
  tagName = 'IFRAME';
  src: string | undefined;
  name: string | undefined;
  private attributes: Record<string, string>;
  private frameDocument: {
    activeElement?: FakeElement | null;
    title?: string;
    body?: { textContent?: string };
    createRange?: () => {
      selectNodeContents: () => void;
      setEnd: () => void;
      toString: () => string;
    };
    documentElement?: { clientHeight: number; clientWidth: number };
    getElementById?: (id: string) => FakeElement | null;
    getSelection?: () => FakeSelection | null;
    querySelectorAll?: (selector: string) => Array<FakeControl | FakeActionElement | FakeChoiceGroupElement | FakeListElement | FakeTableElement | FakeMediaElement>;
  } | undefined;
  private throwOnContentAccess: boolean;

  constructor(options: {
    rect: FakeRect;
    textContent?: string;
    src?: string;
    name?: string;
    contentTitle?: string;
    contentText?: string;
    contentActiveElement?: FakeElement | null;
    contentActions?: FakeActionElement[];
    contentChoices?: FakeChoiceGroupElement[];
    contentControls?: FakeControl[];
    contentLists?: FakeListElement[];
    contentMedia?: FakeMediaElement[];
    contentTables?: FakeTableElement[];
    contentLabelledElements?: Record<string, FakeElement>;
    contentSelection?: FakeSelection;
    contentSelectionPrefixText?: string;
    attributes?: Record<string, string>;
    throwOnContentAccess?: boolean;
  }) {
    super(options.textContent || '', options.rect);
    this.src = options.src;
    this.name = options.name;
    this.attributes = options.attributes || {};
    this.throwOnContentAccess = Boolean(options.throwOnContentAccess);
    if (!this.throwOnContentAccess) {
      const contentActions = options.contentActions || [];
      const contentChoices = options.contentChoices || [];
      const contentControls = options.contentControls || [];
      const contentLists = options.contentLists || [];
      const contentMedia = options.contentMedia || [];
      const contentTables = options.contentTables || [];
      const contentLabelledElements = options.contentLabelledElements || {};
      this.frameDocument = {
        activeElement: options.contentActiveElement || null,
        title: options.contentTitle || '',
        body: {
          textContent: options.contentText || '',
        },
        createRange: () => ({
          selectNodeContents: () => undefined,
          setEnd: () => undefined,
          toString: () => options.contentSelectionPrefixText ?? '',
        }),
        documentElement: {
          clientHeight: 900,
          clientWidth: 1000,
        },
        getElementById: (id: string) => contentLabelledElements[id] || null,
        getSelection: () => options.contentSelection || null,
        querySelectorAll: (selector: string) => {
          const selectorParts = selector.split(',').map((part) => part.trim());
          if (
            selectorParts.includes('ol') ||
            selectorParts.includes('ul') ||
            selectorParts.includes('[role="list"]') ||
            selectorParts.includes('[role="feed"]')
          ) {
            return contentLists;
          }

          if (
            selector.includes('img') ||
            selector.includes('video') ||
            selector.includes('audio') ||
            selector.includes('canvas') ||
            selector.includes('[role="img"]')
          ) {
            return contentMedia;
          }

          if (
            selector.trim() === 'table' ||
            selector.includes('table,') ||
            selector.includes('[role="table"]') ||
            selector.includes('[role="grid"]')
          ) {
            return contentTables;
          }

          if (
            selector.includes('[role="listbox"]') ||
            selector.includes('[role="menu"]') ||
            selector.includes('[role="menubar"]') ||
            selector.includes('[role="radiogroup"]') ||
            selector.includes('[role="tree"]') ||
            selector.includes('[role="tablist"]')
          ) {
            return contentChoices;
          }

          const isActionSelector =
            selector.includes('a[href]') ||
            selector.includes(', button') ||
            selector.includes('button,') ||
            selector.trim() === 'button' ||
            selector.includes('summary') ||
            selector.includes('input[type="button"]') ||
            selector.includes('input[type="submit"]') ||
            selector.includes('input[type="reset"]') ||
            selector.includes('[role="button"]') ||
            selector.includes('[role="link"]') ||
            selector.includes('[role="menuitem"]') ||
            selector.includes('[role="tab"]') ||
            selector.includes('[onclick]');
          if (isActionSelector) {
            return contentActions;
          }

          if (
            selector.includes('input') ||
            selector.includes('textarea') ||
            selector.includes('select') ||
            selector.includes('[contenteditable="true"]') ||
            selector.includes('role="textbox"') ||
            selector.includes('role="combobox"') ||
            selector.includes('role="checkbox"') ||
            selector.includes('role="switch"') ||
            selector.includes('role="radio"') ||
            selector.includes('role="slider"') ||
            selector.includes('role="spinbutton"')
          ) {
            return contentControls;
          }

          return [];
        },
      };
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  get contentDocument(): {
    activeElement?: FakeElement | null;
    title?: string;
    body?: { textContent?: string };
    createRange?: () => {
      selectNodeContents: () => void;
      setEnd: () => void;
      toString: () => string;
    };
    documentElement?: { clientHeight: number; clientWidth: number };
    getElementById?: (id: string) => FakeElement | null;
    getSelection?: () => FakeSelection | null;
    querySelectorAll?: (selector: string) => Array<FakeControl | FakeActionElement | FakeChoiceGroupElement | FakeListElement | FakeTableElement | FakeMediaElement>;
  } | undefined {
    if (this.throwOnContentAccess) {
      throw new Error('Cross-origin frame');
    }

    return this.frameDocument;
  }
}

class FakeShadowHostElement extends FakeElement {
  tagName: string;
  shadowRoot: {
    activeElement?: FakeElement | null;
    textContent?: string;
    createRange?: () => {
      selectNodeContents: () => void;
      setEnd: () => void;
      toString: () => string;
    };
    cloneNode?: () => {
      textContent?: string;
      querySelectorAll?: (selector: string) => Array<{ remove: () => void }>;
    };
    getElementById?: (id: string) => FakeElement | null;
    getSelection?: () => FakeSelection | null;
    querySelectorAll?: (selector: string) => Array<FakeControl | FakeActionElement | FakeChoiceGroupElement | FakeListElement | FakeTableElement | FakeMediaElement>;
  };
  private attributes: Record<string, string>;

  constructor(options: {
    tagName: string;
    rect: FakeRect;
    textContent?: string;
    shadowText: string;
    cloneText?: string;
    shadowActiveElement?: FakeElement | null;
    shadowActions?: FakeActionElement[];
    shadowChoices?: FakeChoiceGroupElement[];
    shadowControls?: FakeControl[];
    shadowLists?: FakeListElement[];
    shadowMedia?: FakeMediaElement[];
    shadowTables?: FakeTableElement[];
    shadowLabelledElements?: Record<string, FakeElement>;
    shadowSelection?: FakeSelection;
    shadowSelectionPrefixText?: string;
    attributes?: Record<string, string>;
  }) {
    super(options.textContent || '', options.rect);
    this.tagName = options.tagName.toUpperCase();
    this.attributes = options.attributes || {};
    const shadowActions = options.shadowActions || [];
    const shadowChoices = options.shadowChoices || [];
    const shadowControls = options.shadowControls || [];
    const shadowLists = options.shadowLists || [];
    const shadowMedia = options.shadowMedia || [];
    const shadowTables = options.shadowTables || [];
    const shadowLabelledElements = options.shadowLabelledElements || {};
    this.shadowRoot = {
      activeElement: options.shadowActiveElement || null,
      textContent: options.shadowText,
      createRange: () => ({
        selectNodeContents: () => undefined,
        setEnd: () => undefined,
        toString: () => options.shadowSelectionPrefixText ?? '',
      }),
      cloneNode: () => ({
        textContent: options.cloneText ?? options.shadowText,
        querySelectorAll: () => [{ remove: () => undefined }],
      }),
      getElementById: (id: string) => shadowLabelledElements[id] || null,
      getSelection: () => options.shadowSelection || null,
      querySelectorAll: (selector: string) => {
        const selectorParts = selector.split(',').map((part) => part.trim());
        if (
          selectorParts.includes('ol') ||
          selectorParts.includes('ul') ||
          selectorParts.includes('[role="list"]') ||
          selectorParts.includes('[role="feed"]')
        ) {
          return shadowLists;
        }

        if (
          selector.includes('img') ||
          selector.includes('video') ||
          selector.includes('audio') ||
          selector.includes('canvas') ||
          selector.includes('[role="img"]')
        ) {
          return shadowMedia;
        }

        if (
          selector.trim() === 'table' ||
          selector.includes('table,') ||
          selector.includes('[role="table"]') ||
          selector.includes('[role="grid"]')
        ) {
          return shadowTables;
        }

        if (
          selector.includes('[role="listbox"]') ||
          selector.includes('[role="menu"]') ||
          selector.includes('[role="menubar"]') ||
          selector.includes('[role="radiogroup"]') ||
          selector.includes('[role="tree"]') ||
          selector.includes('[role="tablist"]')
        ) {
          return shadowChoices;
        }

        const isActionSelector =
          selector.includes('a[href]') ||
          selector.includes(', button') ||
          selector.includes('button,') ||
          selector.trim() === 'button' ||
          selector.includes('summary') ||
          selector.includes('input[type="button"]') ||
          selector.includes('input[type="submit"]') ||
          selector.includes('input[type="reset"]') ||
          selector.includes('[role="button"]') ||
          selector.includes('[role="link"]') ||
          selector.includes('[role="menuitem"]') ||
          selector.includes('[role="tab"]') ||
          selector.includes('[onclick]');
        if (isActionSelector) {
          return shadowActions;
        }

        if (
          selector.includes('input') ||
          selector.includes('textarea') ||
          selector.includes('select') ||
          selector.includes('[contenteditable="true"]') ||
          selector.includes('role="textbox"') ||
          selector.includes('role="combobox"') ||
          selector.includes('role="checkbox"') ||
          selector.includes('role="switch"') ||
          selector.includes('role="radio"') ||
          selector.includes('role="slider"') ||
            selector.includes('role="spinbutton"')
          ) {
          return shadowControls;
        }

          return [];
        },
    };
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }
}

class FakeScrollContainerElement extends FakeElement {
  clientHeight: number;
  clientWidth: number;
  scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  scrollWidth: number;
  overflowX: string;
  overflowY: string;
  private attributes: Record<string, string>;
  private children: FakeElement[];

  constructor(options: {
    rect: FakeRect;
    children: FakeElement[];
    clientHeight: number;
    clientWidth: number;
    scrollHeight: number;
    scrollWidth: number;
    scrollLeft?: number;
    scrollTop?: number;
    overflowX?: string;
    overflowY?: string;
    attributes?: Record<string, string>;
  }) {
    super(options.children.map((child) => child.textContent).join(' '), options.rect);
    this.children = options.children;
    this.clientHeight = options.clientHeight;
    this.clientWidth = options.clientWidth;
    this.scrollHeight = options.scrollHeight;
    this.scrollWidth = options.scrollWidth;
    this.scrollLeft = options.scrollLeft ?? 0;
    this.scrollTop = options.scrollTop ?? 0;
    this.overflowX = options.overflowX || 'visible';
    this.overflowY = options.overflowY || 'auto';
    this.attributes = options.attributes || {};
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] || null;
  }

  querySelector(_selector: string): null {
    return null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    if (
      selector.includes('article') ||
      selector.includes('li') ||
      selector.includes('p') ||
      selector.includes('button') ||
      selector.includes('a')
    ) {
      return this.children;
    }

    return [];
  }
}

const makeRect = (top: number, height = 120): FakeRect => ({
  bottom: top + height,
  height,
  left: 80,
  right: 680,
  top,
  width: 600,
});

const setupTableDocument = (
  tableElements: FakeTableElement[],
  labelledElements: Record<string, FakeElement> = {}
) => {
  const fakeDocument = {
    title: 'Table Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: (id: string) => labelledElements[id] || null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector.includes('table') || selector.includes('role="table"') || selector.includes('role="grid"')) {
        return tableElements;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/tables',
    },
  });
};

const setupTimelineDocument = (articles: FakeElement[]) => {
  const fakeDocument = {
    title: 'Home / X',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector === 'article' || selector === '[role="article"]' || selector === '[data-testid="tweet"]') {
        return articles;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://x.com/home',
    },
  });
};

const setupFormDocument = (controls: FakeControl[], labelledElements: Record<string, FakeElement> = {}) => {
  const fakeDocument = {
    title: 'Form Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: (id: string) => labelledElements[id] || null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector.includes('input') || selector.includes('textarea') || selector.includes('select')) {
        return controls;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/form',
    },
  });
};

const setupStructureDocument = (
  structureElements: FakeStructureElement[],
  labelledElements: Record<string, FakeElement> = {}
) => {
  const fakeDocument = {
    title: 'Structure Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: (id: string) => labelledElements[id] || null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (
        selector.includes('h1') ||
        selector.includes('[role="heading"]') ||
        selector.includes('nav') ||
        selector.includes('section') ||
        selector.includes('[role="navigation"]') ||
        selector.includes('[role="main"]') ||
        selector.includes('[role="region"]')
      ) {
        return structureElements;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/structure',
    },
  });
};

const setupListDocument = (
  listElements: FakeListElement[],
  labelledElements: Record<string, FakeElement> = {}
) => {
  const fakeDocument = {
    title: 'List Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: (id: string) => labelledElements[id] || null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector.includes('ol') || selector.includes('ul') || selector.includes('[role="list"]') || selector.includes('[role="feed"]')) {
        return listElements;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/lists',
    },
  });
};

const setupLongTextFormDocument = (control: FakeControl, longText: string) => {
  const fakeBody = new FakeElement(longText, makeRect(0, 2200));
  const fakeMain = new FakeElement(longText, makeRect(0, 2200));
  const fakeDocumentElement = {
    clientHeight: 900,
    clientWidth: 1000,
    scrollHeight: 2200,
    scrollWidth: 1200,
  };
  const fakeDocument = {
    activeElement: null,
    body: {
      ...fakeBody,
      clientHeight: 900,
      clientWidth: 1000,
      scrollHeight: 2200,
      scrollWidth: 1200,
    },
    cloneNode: () => ({
      body: fakeBody,
      querySelector: (selector: string) => selector === 'main' ? fakeMain : null,
      querySelectorAll: () => [],
    }),
    documentElement: fakeDocumentElement,
    getElementById: () => null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector.includes('input') || selector.includes('textarea') || selector.includes('select')) {
        return [control];
      }

      return [];
    },
    title: 'Long Context Page',
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/long-context',
    },
    pageXOffset: 0,
    pageYOffset: 0,
    scrollX: 0,
    scrollY: 0,
  });
};

const setupViewportDocument = (
  activeElement: FakeElement,
  options: {
    viewportWidth?: number;
    viewportHeight?: number;
    pageWidth?: number;
    pageHeight?: number;
    scrollX?: number;
    scrollY?: number;
    selection?: FakeSelection;
    selectionPrefixText?: string;
  } = {}
) => {
  const viewportWidth = options.viewportWidth ?? 1000;
  const viewportHeight = options.viewportHeight ?? 900;
  const pageWidth = options.pageWidth ?? 1200;
  const pageHeight = options.pageHeight ?? 2400;
  const fakeBody = new FakeElement('', makeRect(0, pageHeight));
  const fakeDocumentElement = {
    clientHeight: viewportHeight,
    clientWidth: viewportWidth,
    scrollHeight: pageHeight,
    scrollWidth: pageWidth,
  };
  const fakeDocument = {
    activeElement,
    body: {
      ...fakeBody,
      clientHeight: viewportHeight,
      clientWidth: viewportWidth,
      scrollHeight: pageHeight,
      scrollWidth: pageWidth,
    },
    createRange: () => ({
      selectNodeContents: () => undefined,
      setEnd: () => undefined,
      toString: () => options.selectionPrefixText ?? '',
    }),
    documentElement: fakeDocumentElement,
    getElementById: () => null,
    getSelection: () => options.selection || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    title: 'Viewport Page',
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: viewportHeight,
    innerWidth: viewportWidth,
    location: {
      href: 'https://example.com/viewport',
    },
    pageXOffset: options.scrollX ?? 0,
    pageYOffset: options.scrollY ?? 0,
    scrollX: options.scrollX ?? 0,
    scrollY: options.scrollY ?? 0,
  });
};

const setupScrollContainerDocument = (scrollContainers: FakeScrollContainerElement[]) => {
  const fakeDocument = {
    title: 'Scrollable Workspace',
    body: {},
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: () => null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector === '*') {
        return scrollContainers;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: (element: FakeScrollContainerElement) => ({
      display: 'block',
      overflowX: element.overflowX || 'visible',
      overflowY: element.overflowY || 'visible',
      visibility: 'visible',
    }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/scroll-workspace',
    },
  });
};

const setupMediaDocument = (
  mediaElements: FakeMediaElement[],
  labelledElements: Record<string, FakeElement> = {}
) => {
  const fakeDocument = {
    title: 'Media Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: (id: string) => labelledElements[id] || null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (
        selector.includes('img') ||
        selector.includes('video') ||
        selector.includes('audio') ||
        selector.includes('canvas') ||
        selector.includes('[role="img"]')
      ) {
        return mediaElements;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/media-board',
    },
  });
};

const setupActionDocument = (
  actionElements: FakeActionElement[],
  labelledElements: Record<string, FakeElement> = {}
) => {
  const fakeDocument = {
    title: 'Action Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: (id: string) => labelledElements[id] || null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (
        selector.includes('a[href]') ||
        selector.includes('button') ||
        selector.includes('summary') ||
        selector.includes('role="button"') ||
        selector.includes('role="link"') ||
        selector.includes('role="menuitem"') ||
        selector.includes('role="tab"') ||
        selector.includes('[onclick]')
      ) {
        return actionElements;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/workspace',
    },
  });
};

const setupUiStateDocument = (
  stateElements: FakeUiStateElement[],
  labelledElements: Record<string, FakeElement> = {}
) => {
  const fakeDocument = {
    title: 'UI State Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: (id: string) => labelledElements[id] || null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (
        selector.includes('dialog') ||
        selector.includes('[role="alertdialog"]') ||
        selector.includes('[role="alert"]') ||
        selector.includes('[role="status"]') ||
        selector.includes('[role="log"]') ||
        selector.includes('[role="tooltip"]') ||
        selector.includes('[role="progressbar"]') ||
        selector.includes('[aria-live]') ||
        selector.includes('[aria-busy="true"]') ||
        selector.includes('[popover]') ||
        selector.includes('toast') ||
        selector.includes('modal') ||
        selector.includes('tooltip') ||
        selector.includes('popover')
      ) {
        return stateElements;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/ui-state',
    },
  });
};

const setupChoiceDocument = (
  choiceGroups: FakeChoiceGroupElement[],
  labelledElements: Record<string, FakeElement> = {}
) => {
  const fakeDocument = {
    title: 'Choice Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: (id: string) => labelledElements[id] || null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (
        selector.includes('[role="listbox"]') ||
        selector.includes('[role="menu"]') ||
        selector.includes('[role="menubar"]') ||
        selector.includes('[role="radiogroup"]') ||
        selector.includes('[role="tree"]') ||
        selector.includes('[role="tablist"]')
      ) {
        return choiceGroups;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/choices',
    },
  });
};

const setupExpandedRegionDocument = (
  regions: FakeExpandedRegionElement[],
  labelledElements: Record<string, FakeElement> = {}
) => {
  const fakeDocument = {
    title: 'Expanded Region Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getElementById: (id: string) => labelledElements[id] || null,
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (
        selector.includes('details[open]') ||
        selector.includes('[role="region"][aria-expanded="true"]') ||
        selector.includes('[role="tabpanel"][aria-selected="true"]')
      ) {
        return regions;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/expanded-region',
    },
  });
};

const setupFrameDocument = (frameElements: FakeFrameElement[]) => {
  const fakeDocument = {
    title: 'Frame Host',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector.includes('iframe') || selector.includes('frame')) {
        return frameElements;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/frame-host',
    },
  });
};

const setupShadowDocument = (shadowHosts: FakeShadowHostElement[]) => {
  const fakeDocument = {
    title: 'Shadow Host Page',
    documentElement: {
      clientHeight: 900,
      clientWidth: 1000,
    },
    getSelection: () => null,
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector === '*') {
        return shadowHosts;
      }

      return [];
    },
  };

  vi.stubGlobal('document', fakeDocument);
  vi.stubGlobal('window', {
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    innerHeight: 900,
    innerWidth: 1000,
    location: {
      href: 'https://example.com/shadow-host',
    },
  });
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ContextCollector', () => {
  it('extracts visible timeline posts including a partially visible third post', () => {
    setupTimelineDocument([
      new FakeElement('Ray Wang @wangray Holy crap, someone dug up Fable 5 prompt. Show more', makeRect(180, 220)),
      new FakeElement('Bybit @Bybit_Official Ad Something Bigger Has Just Taken Off. Click Here.', makeRect(430, 300)),
      new FakeElement('monokern @monokern Xiaomi just dropped a FREE CLAUDE CODE with memory. Show more', makeRect(820, 260)),
    ]);

    const context = ContextCollector.getCurrentTabContext({ maxTokens: 1000 });

    expect(context.abstract).toContain('Visible timeline posts:');
    expect(context.abstract).toContain('Post 1:');
    expect(context.abstract).toContain('Ray Wang');
    expect(context.abstract).toContain('Post 2:');
    expect(context.abstract).toContain('Bybit');
    expect(context.abstract).toContain('Post 3:');
    expect(context.abstract).toContain('monokern');
  });

  it('redacts sensitive values from visible timeline posts', () => {
    setupTimelineDocument([
      new FakeElement('Release event Secret token sk-live-visible-secret123 should never reach the provider.', makeRect(180, 120)),
      new FakeElement('Release event Follow-up visible post keeps timeline extraction active.', makeRect(340, 120)),
    ]);

    const context = ContextCollector.getCurrentTabContext({ maxTokens: 1000 });

    expect(context.abstract).toContain('Visible timeline posts:');
    expect(context.abstract).toContain('Secret token [redacted] should never reach the provider.');
    expect(context.abstract).not.toContain('sk-live-visible-secret123');
  });

  it('extracts visible live form values from inputs, checkboxes, selects, and textareas', () => {
    setupFormDocument([
      new FakeControl({
        tagName: 'input',
        type: 'text',
        value: 'Apollo Rollout',
        rect: makeRect(120, 32),
        labels: [new FakeElement('Project name', makeRect(100, 20))],
      }),
      new FakeControl({
        tagName: 'input',
        type: 'checkbox',
        checked: true,
        rect: makeRect(170, 24),
        labels: [new FakeElement('Include screenshots', makeRect(150, 20))],
      }),
      new FakeControl({
        tagName: 'select',
        value: 'blocked',
        rect: makeRect(220, 32),
        labels: [new FakeElement('Status', makeRect(200, 20))],
        selectedOptions: [new FakeElement('Blocked', makeRect(220, 20))],
      }),
      new FakeControl({
        tagName: 'textarea',
        value: 'Waiting on provider logs before release.',
        rect: makeRect(270, 80),
        attributes: { 'aria-label': 'Notes' },
      }),
    ]);

    const formContent = ContextCollector.extractVisibleFormContent();

    expect(formContent).toContain('Visible form fields:');
    expect(formContent).toContain('Project name: Apollo Rollout');
    expect(formContent).toContain('Include screenshots: checked');
    expect(formContent).toContain('Status: Blocked');
    expect(formContent).toContain('Notes: Waiting on provider logs before release.');
  });

  it('extracts empty visible fields and placeholder hints without leaking token-shaped text', () => {
    setupFormDocument([
      new FakeControl({
        tagName: 'input',
        type: 'text',
        value: '',
        placeholder: 'e.g. Apollo rollout',
        rect: makeRect(120, 32),
        labels: [new FakeElement('Launch title', makeRect(100, 20))],
      }),
      new FakeControl({
        tagName: 'textarea',
        value: '',
        placeholder: 'Paste sk-live-placeholder-value123 here',
        rect: makeRect(170, 80),
        attributes: { 'aria-label': 'Release notes' },
      }),
      new FakeControl({
        tagName: 'input',
        type: 'search',
        value: '',
        placeholder: 'Search projects',
        rect: makeRect(270, 32),
      }),
    ]);

    const formContent = ContextCollector.extractVisibleFormContent();

    expect(formContent).toContain('Visible form fields:');
    expect(formContent).toContain('Launch title: [empty]; placeholder: e.g. Apollo rollout');
    expect(formContent).toContain('Release notes: [empty]; placeholder: Paste [redacted] here');
    expect(formContent).toContain('Search projects: [empty]');
    expect(formContent).not.toContain('Search projects: [empty]; placeholder: Search projects');
    expect(formContent).not.toContain('sk-live-placeholder-value123');
  });

  it('extracts slider and spinbutton values with range metadata', () => {
    setupFormDocument([
      new FakeControl({
        tagName: 'div',
        rect: makeRect(120, 32),
        attributes: {
          role: 'slider',
          'aria-label': 'Confidence threshold',
          'aria-valuetext': '70 percent',
          'aria-valuenow': '70',
          'aria-valuemin': '0',
          'aria-valuemax': '100',
          'aria-valuestep': '5',
        },
      }),
      new FakeControl({
        tagName: 'div',
        rect: makeRect(170, 32),
        attributes: {
          role: 'spinbutton',
          'aria-label': 'Retry count',
          'aria-valuenow': '3',
          'aria-valuemin': '1',
          'aria-valuemax': '10',
        },
      }),
    ]);

    const formContent = ContextCollector.extractVisibleFormContent();

    expect(formContent).toContain('Confidence threshold: 70 percent; range: 0-100; step: 5');
    expect(formContent).toContain('Retry count: 3; range: 1-10');
  });

  it('redacts sensitive visible form values before adding them to context', () => {
    setupFormDocument([
      new FakeControl({
        tagName: 'input',
        type: 'password',
        value: 'do-not-leak',
        rect: makeRect(120, 32),
        labels: [new FakeElement('Password', makeRect(100, 20))],
      }),
      new FakeControl({
        tagName: 'input',
        type: 'text',
        value: 'sk-live-secret-token',
        rect: makeRect(170, 32),
        attributes: { 'aria-label': 'API token' },
      }),
    ]);

    const formContent = ContextCollector.extractVisibleFormContent();

    expect(formContent).toContain('Password: [redacted]');
    expect(formContent).toContain('API token: [redacted]');
    expect(formContent).not.toContain('do-not-leak');
    expect(formContent).not.toContain('sk-live-secret-token');
  });

  it('extracts invalid required form state and visible validation messages', () => {
    setupFormDocument(
      [
        new FakeControl({
          tagName: 'input',
          type: 'text',
          value: '',
          required: true,
          validity: { valid: false },
          rect: makeRect(120, 32),
          labels: [new FakeElement('Project owner', makeRect(100, 20))],
          attributes: {
            'aria-errormessage': 'owner-error',
            'aria-invalid': 'true',
          },
        }),
      ],
      {
        'owner-error': new FakeElement('Project owner is required before launch.', makeRect(168, 24)),
      }
    );

    const formContent = ContextCollector.extractVisibleFormContent();

    expect(formContent).toContain('Visible form fields:');
    expect(formContent).toContain('Project owner: [empty]; state: invalid, required; message: is required before launch.');
  });

  it('extracts valid form helper text as descriptions without treating it as validation', () => {
    setupFormDocument(
      [
        new FakeControl({
          tagName: 'select',
          value: 'staging',
          rect: makeRect(120, 32),
          labels: [new FakeElement('Release channel', makeRect(100, 20))],
          selectedOptions: [new FakeElement('Staging', makeRect(140, 20))],
          attributes: {
            'aria-describedby': 'channel-help',
          },
        }),
      ],
      {
        'channel-help': new FakeElement(
          'Choose staging unless production approval is complete. Helper token sk-live-description-secret123 should be redacted.',
          makeRect(168, 24)
        ),
      }
    );

    const formContent = ContextCollector.extractVisibleFormContent();

    expect(formContent).toContain(
      'Release channel: Staging; description: Choose staging unless production approval is complete. Helper token [redacted] should be redacted.'
    );
    expect(formContent).not.toContain('message: Choose staging');
    expect(formContent).not.toContain('sk-live-description-secret123');
  });

  it('extracts uploaded file names and metadata without leaking token-shaped names', () => {
    setupFormDocument([
      new FakeControl({
        tagName: 'input',
        type: 'file',
        rect: makeRect(120, 32),
        labels: [new FakeElement('Launch attachment', makeRect(100, 20))],
        files: [
          { name: 'qa-brief.txt', size: 42, type: 'text/plain' },
          { name: 'sk-live-upload-secret123.txt', size: 91, type: 'text/plain' },
        ],
      }),
    ]);

    const formContent = ContextCollector.extractVisibleFormContent();

    expect(formContent).toContain('Launch attachment: qa-brief.txt (text/plain, 42 bytes), [redacted] (text/plain, 91 bytes)');
    expect(formContent).not.toContain('sk-live-upload-secret123');
  });

  it('preserves live browser state before long page text is truncated', () => {
    setupLongTextFormDocument(
      new FakeControl({
        tagName: 'input',
        type: 'text',
        value: 'Approved after long review',
        rect: makeRect(160, 32),
        labels: [new FakeElement('Launch decision', makeRect(140, 20))],
      }),
      `Long narrative paragraph ${'release readiness '.repeat(400)} final long-text tail.`
    );

    const pageContext = ContextCollector.extractPageContext(80);

    expect(pageContext).toContain('Visible form fields:');
    expect(pageContext).toContain('Launch decision: Approved after long review');
    expect(pageContext).toContain('Long narrative paragraph');
    expect(pageContext).not.toContain('final long-text tail');
  });

  it('extracts visible page structure with headings, landmarks, current nav state, and redaction', () => {
    setupStructureDocument(
      [
        new FakeStructureElement({
          tagName: 'h1',
          textContent: 'Launch Command Center',
          rect: makeRect(90, 48),
        }),
        new FakeStructureElement({
          tagName: 'h2',
          textContent: 'Private token sk-live-structure-secret123',
          rect: makeRect(150, 40),
        }),
        new FakeStructureElement({
          tagName: 'nav',
          rect: makeRect(210, 80),
          attributes: { 'aria-label': 'Workspace navigation' },
          currentItem: new FakeActionElement({
            tagName: 'a',
            textContent: 'Release dashboard',
            rect: makeRect(220, 24),
            attributes: { 'aria-current': 'page' },
          }),
        }),
        new FakeStructureElement({
          tagName: 'section',
          rect: makeRect(320, 120),
          attributes: { 'aria-labelledby': 'release-section-title' },
        }),
        new FakeStructureElement({
          tagName: 'h3',
          textContent: 'Hidden heading should not appear',
          rect: makeRect(920, 0),
        }),
      ],
      {
        'release-section-title': new FakeElement('Release readiness', makeRect(300, 24)),
      }
    );

    const structureContent = ContextCollector.extractVisiblePageStructureContent();

    expect(structureContent).toContain('Visible page structure:');
    expect(structureContent).toContain('H1: Launch Command Center');
    expect(structureContent).toContain('H2: Private token [redacted]');
    expect(structureContent).toContain('Navigation: Workspace navigation; current: Release dashboard (page)');
    expect(structureContent).toContain('Section: Release readiness');
    expect(structureContent).not.toContain('sk-live-structure-secret123');
    expect(structureContent).not.toContain('Hidden heading should not appear');
  });

  it('extracts visible lists with item order, checkbox state, current state, and redaction', () => {
    setupListDocument(
      [
        new FakeListElement({
          tagName: 'ul',
          rect: makeRect(120, 220),
          attributes: { 'aria-labelledby': 'release-checklist-title' },
          items: [
            new FakeListItemElement({
              textContent: 'Smoke tests complete',
              rect: makeRect(150, 28),
              stateControl: new FakeControl({
                tagName: 'input',
                type: 'checkbox',
                checked: true,
                rect: makeRect(150, 20),
              }),
            }),
            new FakeListItemElement({
              textContent: 'Security review pending',
              rect: makeRect(184, 28),
              stateControl: new FakeControl({
                tagName: 'input',
                type: 'checkbox',
                checked: false,
                rect: makeRect(184, 20),
              }),
            }),
            new FakeListItemElement({
              textContent: 'Private token sk-live-list-secret123',
              rect: makeRect(218, 28),
            }),
          ],
        }),
        new FakeListElement({
          tagName: 'ol',
          rect: makeRect(400, 160),
          attributes: { 'aria-label': 'Deployment sequence' },
          items: [
            new FakeListItemElement({
              textContent: 'Prepare release notes',
              rect: makeRect(420, 28),
              attributes: { 'aria-current': 'step' },
            }),
            new FakeListItemElement({
              textContent: 'Notify support',
              rect: makeRect(454, 28),
            }),
          ],
        }),
      ],
      {
        'release-checklist-title': new FakeElement('Release checklist', makeRect(100, 24)),
      }
    );

    const listContent = ContextCollector.extractVisibleListContent();

    expect(listContent).toContain('Visible lists:');
    expect(listContent).toContain('List: Release checklist; items: 1. Smoke tests complete (checked) | 2. Security review pending (not checked) | 3. Private token [redacted]');
    expect(listContent).toContain('Ordered list: Deployment sequence; items: 1. Prepare release notes (current step) | 2. Notify support');
    expect(listContent).not.toContain('sk-live-list-secret123');
  });

  it('extracts viewport scroll position, page dimensions, and focused field value', () => {
    setupViewportDocument(
      new FakeControl({
        tagName: 'input',
        type: 'text',
        value: 'Visible state launch',
        rect: makeRect(220, 32),
        labels: [new FakeElement('Project filter', makeRect(190, 20))],
      }),
      {
        pageHeight: 2600,
        pageWidth: 1200,
        scrollY: 640,
        viewportHeight: 900,
        viewportWidth: 1000,
      }
    );

    const viewportContent = ContextCollector.extractViewportStateContent();

    expect(viewportContent).toContain('Visible browser state:');
    expect(viewportContent).toContain('Viewport: 1000x900; scroll: x=0, y=640; page: 1200x2600');
    expect(viewportContent).toContain('Focused element: Field: Project filter; value: Visible state launch');
  });

  it('extracts focused input selected text and range from browser edit state', () => {
    setupViewportDocument(
      new FakeControl({
        tagName: 'input',
        type: 'text',
        value: 'Visible state launch',
        selectionStart: 8,
        selectionEnd: 13,
        rect: makeRect(220, 32),
        labels: [new FakeElement('Project filter', makeRect(190, 20))],
      })
    );

    const viewportContent = ContextCollector.extractViewportStateContent();

    expect(viewportContent).toContain('Focused element: Field: Project filter; value: Visible state launch');
    expect(viewportContent).toContain('selection: 8-13; selected text: state');
  });

  it('extracts focused input edit state from a same-origin iframe', () => {
    const frameField = new FakeControl({
      tagName: 'input',
      type: 'text',
      value: 'Embedded approval ready sk-live-frame-focus-secret123',
      selectionStart: 9,
      selectionEnd: 17,
      rect: makeRect(220, 32),
      labels: [new FakeElement('Frame approval', makeRect(190, 20))],
    });

    setupViewportDocument(
      new FakeFrameElement({
        rect: makeRect(180, 260),
        src: 'https://example.com/frame-child.html',
        attributes: {
          title: 'Embedded QA report frame',
        },
        contentActiveElement: frameField,
        contentControls: [frameField],
        contentTitle: 'Embedded QA Report',
      })
    );

    const viewportContent = ContextCollector.extractViewportStateContent();

    expect(viewportContent).toContain(
      'Focused element: Frame: Embedded QA report frame; Field: Frame approval; value: Embedded approval ready [redacted]'
    );
    expect(viewportContent).toContain('selection: 9-17; selected text: approval');
    expect(viewportContent).not.toContain('sk-live-frame-focus-secret123');
  });

  it('extracts focused input edit state from an open shadow root', () => {
    const shadowField = new FakeControl({
      tagName: 'input',
      type: 'text',
      value: 'Shadow approval ready sk-live-shadow-focus-secret123',
      selectionStart: 7,
      selectionEnd: 15,
      rect: makeRect(220, 32),
      labels: [new FakeElement('Shadow approval', makeRect(190, 20))],
    });

    setupViewportDocument(
      new FakeShadowHostElement({
        tagName: 'qa-status-card',
        rect: makeRect(180, 260),
        shadowText: 'Web Component QA Panel',
        attributes: {
          'aria-label': 'QA status web component',
        },
        shadowActiveElement: shadowField,
        shadowControls: [shadowField],
      })
    );

    const viewportContent = ContextCollector.extractViewportStateContent();

    expect(viewportContent).toContain(
      'Focused element: Shadow host: QA status web component; Field: Shadow approval; value: Shadow approval ready [redacted]'
    );
    expect(viewportContent).toContain('selection: 7-15; selected text: approval');
    expect(viewportContent).not.toContain('sk-live-shadow-focus-secret123');
  });

  it('extracts focused rich text editor selection from DOM ranges while redacting token-shaped values', () => {
    const editor = new FakeControl({
      tagName: 'div',
      textContent: 'Draft launch state includes sk-live-rich-secret123',
      rect: makeRect(220, 80),
      attributes: {
        'aria-label': 'Launch notes',
        contenteditable: 'true',
      },
    });
    const selectedRange = {
      startContainer: editor,
      startOffset: 0,
      toString: () => 'state',
    };

    setupViewportDocument(editor, {
      selection: {
        anchorNode: editor,
        focusNode: editor,
        rangeCount: 1,
        getRangeAt: () => selectedRange,
        toString: () => 'state',
      },
      selectionPrefixText: 'Draft launch ',
    });

    const viewportContent = ContextCollector.extractViewportStateContent();

    expect(viewportContent).toContain('Focused element: Field: Launch notes; value: Draft launch state includes [redacted]');
    expect(viewportContent).toContain('selection: 13-18; selected text: state');
    expect(viewportContent).not.toContain('sk-live-rich-secret123');
  });

  it('redacts selected text from sensitive focused fields', () => {
    setupViewportDocument(
      new FakeControl({
        tagName: 'input',
        type: 'text',
        value: 'sk-live-focused-secret123',
        selectionStart: 0,
        selectionEnd: 25,
        rect: makeRect(220, 32),
        attributes: { 'aria-label': 'API token' },
      })
    );

    const viewportContent = ContextCollector.extractViewportStateContent();

    expect(viewportContent).toContain('Focused element: Field: API token; value: [redacted]');
    expect(viewportContent).toContain('selection: 0-25; selected text: [redacted]');
    expect(viewportContent).not.toContain('sk-live-focused-secret123');
  });

  it('redacts sensitive focused field values in viewport state', () => {
    setupViewportDocument(
      new FakeControl({
        tagName: 'input',
        type: 'text',
        value: 'sk-live-focused-secret123',
        rect: makeRect(220, 32),
        attributes: { 'aria-label': 'API token' },
      }),
      {
        pageHeight: 1800,
        scrollY: 320,
      }
    );

    const viewportContent = ContextCollector.extractViewportStateContent();

    expect(viewportContent).toContain('Focused element: Field: API token; value: [redacted]');
    expect(viewportContent).not.toContain('sk-live-focused-secret123');
  });

  it('extracts visible scroll container state and visible item text', () => {
    setupScrollContainerDocument([
      new FakeScrollContainerElement({
        rect: makeRect(120, 260),
        clientHeight: 260,
        clientWidth: 520,
        scrollHeight: 980,
        scrollWidth: 520,
        scrollTop: 420,
        attributes: { 'aria-label': 'Release activity feed' },
        children: [
          new FakeElement('Release event 6: internal panel scroll is visible.', makeRect(150, 48)),
          new FakeElement('Release event 7: token sk-live-scroll-secret123 is hidden.', makeRect(210, 48)),
          new FakeElement('Release event 8: browser context records pane position.', makeRect(270, 48)),
          new FakeElement('Release event 1: this old item is outside the scrolled pane.', makeRect(-260, 48)),
        ],
      }),
    ]);

    const scrollContent = ContextCollector.extractVisibleScrollContainerContent();

    expect(scrollContent).toContain('Visible scroll containers:');
    expect(scrollContent).toContain('Scroll container: Release activity feed');
    expect(scrollContent).toContain('scroll: x=0, y=420');
    expect(scrollContent).toContain('size: 520x260');
    expect(scrollContent).toContain('content: 520x980');
    expect(scrollContent).toContain('Release event 6: internal panel scroll is visible.');
    expect(scrollContent).toContain('Release event 8: browser context records pane position.');
    expect(scrollContent).not.toContain('sk-live-scroll-secret123');
    expect(scrollContent).not.toContain('outside the scrolled pane');
  });

  it('extracts visible choice groups with selected and disabled option state', () => {
    setupChoiceDocument([
      new FakeChoiceGroupElement({
        rect: makeRect(120, 220),
        attributes: { role: 'listbox', 'aria-label': 'Release region selector', 'aria-activedescendant': 'apac-option' },
        choices: [
          new FakeChoiceOptionElement('EMEA rollout', makeRect(140, 32), { role: 'option', 'aria-selected': 'true' }),
          new FakeChoiceOptionElement('APAC rollout', makeRect(180, 32), { role: 'option', id: 'apac-option' }),
          new FakeChoiceOptionElement('LATAM rollout', makeRect(220, 32), { role: 'option', 'aria-disabled': 'true' }),
          new FakeChoiceOptionElement('Secret sk-live-choice-secret123', makeRect(260, 32), { role: 'option' }),
        ],
      }),
    ]);

    const choiceContent = ContextCollector.extractVisibleChoiceGroupContent();

    expect(choiceContent).toContain('Visible choice groups:');
    expect(choiceContent).toContain('Listbox: Release region selector');
    expect(choiceContent).toContain('EMEA rollout (selected)');
    expect(choiceContent).toContain('APAC rollout (active)');
    expect(choiceContent).toContain('LATAM rollout (disabled)');
    expect(choiceContent).toContain('Secret [redacted]');
    expect(choiceContent).not.toContain('sk-live-choice-secret123');
  });

  it('extracts visible expanded regions with redaction', () => {
    setupExpandedRegionDocument([
      new FakeExpandedRegionElement({
        rect: makeRect(160, 180),
        summary: 'Release details',
        textContent: 'Release details Expanded release summary with token sk-live-region-secret123 hidden.',
        attributes: { open: '' },
      }),
    ]);

    const regionContent = ContextCollector.extractVisibleExpandedRegionContent();

    expect(regionContent).toContain('Visible expanded regions:');
    expect(regionContent).toContain('Expanded region: Release details');
    expect(regionContent).toContain('content: Expanded release summary with token [redacted] hidden.');
    expect(regionContent).not.toContain('sk-live-region-secret123');
  });

  it('extracts visible native tables and ARIA grids while redacting sensitive cells', () => {
    setupTableDocument([
      new FakeTableElement({
        rect: makeRect(120, 220),
        caption: 'Launch KPI table',
        rows: [
          new FakeTableRow([
            new FakeTableCell('Region', { tagName: 'th' }),
            new FakeTableCell('Status', { tagName: 'th' }),
            new FakeTableCell('Owner', { tagName: 'th' }),
            new FakeTableCell('API token', { tagName: 'th' }),
          ], makeRect(130, 28)),
          new FakeTableRow([
            new FakeTableCell('EMEA'),
            new FakeTableCell('Ready'),
            new FakeTableCell('Ana'),
            new FakeTableCell('sk-live-table-secret123'),
          ], makeRect(168, 28)),
          new FakeTableRow([
            new FakeTableCell('APAC'),
            new FakeTableCell('Blocked'),
            new FakeTableCell('Bo'),
            new FakeTableCell('sk-live-table-secret456'),
          ], makeRect(206, 28)),
        ],
      }),
      new FakeTableElement({
        rect: makeRect(380, 180),
        attributes: {
          role: 'grid',
          'aria-label': 'Incident grid',
        },
        rows: [
          new FakeTableRow([
            new FakeTableCell('Incident', { attributes: { role: 'columnheader' } }),
            new FakeTableCell('Severity', { attributes: { role: 'columnheader' } }),
            new FakeTableCell('SLA', { attributes: { role: 'columnheader' } }),
          ], makeRect(390, 28)),
          new FakeTableRow([
            new FakeTableCell('Auth outage', { attributes: { role: 'gridcell' } }),
            new FakeTableCell('High', { attributes: { role: 'gridcell' } }),
            new FakeTableCell('15m', { attributes: { role: 'gridcell' } }),
          ], makeRect(428, 28)),
        ],
      }),
    ]);

    const tableContent = ContextCollector.extractVisibleTableContent();

    expect(tableContent).toContain('Visible tables:');
    expect(tableContent).toContain('Table 1: Launch KPI table');
    expect(tableContent).toContain('Columns: Region | Status | Owner | API token');
    expect(tableContent).toContain('Row 1: EMEA | Ready | Ana | [redacted]');
    expect(tableContent).toContain('Row 2: APAC | Blocked | Bo | [redacted]');
    expect(tableContent).toContain('Table 2: Incident grid');
    expect(tableContent).toContain('Columns: Incident | Severity | SLA');
    expect(tableContent).toContain('Row 1: Auth outage | High | 15m');
    expect(tableContent).not.toContain('sk-live-table-secret123');
    expect(tableContent).not.toContain('sk-live-table-secret456');
  });

  it('extracts visible transient UI state with roles, state details, and redaction', () => {
    setupUiStateDocument([
      new FakeUiStateElement({
        tagName: 'div',
        rect: makeRect(100, 180),
        heading: 'Confirm deployment',
        textContent: 'Confirm deployment Deploying build 42 with token sk-live-dialog-secret123',
        attributes: {
          role: 'dialog',
          'aria-modal': 'true',
        },
      }),
      new FakeUiStateElement({
        tagName: 'div',
        rect: makeRect(320, 60),
        textContent: 'Release failed: missing approval',
        attributes: {
          role: 'alert',
        },
      }),
      new FakeUiStateElement({
        tagName: 'div',
        rect: makeRect(400, 60),
        textContent: 'Background sync queued',
        attributes: {
          role: 'status',
          'aria-live': 'polite',
        },
      }),
      new FakeUiStateElement({
        tagName: 'div',
        rect: makeRect(480, 40),
        textContent: 'Uploading artifact',
        attributes: {
          role: 'progressbar',
          'aria-valuenow': '65',
          'aria-valuemax': '100',
        },
      }),
    ]);

    const stateContent = ContextCollector.extractVisibleUiStateContent();

    expect(stateContent).toContain('Visible UI state:');
    expect(stateContent).toContain('Dialog: Confirm deployment');
    expect(stateContent).toContain('message: Deploying build 42 with token [redacted]');
    expect(stateContent).toContain('state: modal');
    expect(stateContent).toContain('Alert; message: Release failed: missing approval');
    expect(stateContent).toContain('Status; message: Background sync queued; state: live polite');
    expect(stateContent).toContain('Progress; message: Uploading artifact; state: progress 65/100');
    expect(stateContent).not.toContain('sk-live-dialog-secret123');
  });

  it('extracts visible tooltip and popover UI state with redaction', () => {
    setupUiStateDocument([
      new FakeUiStateElement({
        tagName: 'div',
        textContent: 'Release hint Tooltip token sk-live-tooltip-secret123 should be hidden.',
        rect: makeRect(180, 56),
        attributes: {
          role: 'tooltip',
          'aria-label': 'Release hint',
        },
      }),
      new FakeUiStateElement({
        tagName: 'div',
        textContent: 'Deploy popover Choose a region before deployment.',
        rect: makeRect(260, 120),
        heading: 'Deploy popover',
        attributes: {
          popover: '',
        },
      }),
    ]);

    const stateContent = ContextCollector.extractVisibleUiStateContent();

    expect(stateContent).toContain('Visible UI state:');
    expect(stateContent).toContain('Tooltip: Release hint');
    expect(stateContent).toContain('message: Tooltip token [redacted] should be hidden.');
    expect(stateContent).toContain('Popover: Deploy popover');
    expect(stateContent).toContain('message: Choose a region before deployment.');
    expect(stateContent).toContain('state: popover open');
    expect(stateContent).not.toContain('sk-live-tooltip-secret123');
  });

  it('extracts visible same-origin frame context with sanitized src and unavailable markers', () => {
    setupFrameDocument([
      new FakeFrameElement({
        rect: makeRect(120, 260),
        src: 'https://example.com/embed/report.html?session=secret-frame-token#private',
        attributes: {
          title: 'Embedded QA report',
        },
        contentTitle: 'Frame Report',
        contentText: 'Embedded frame status: Ready for QA. Token sk-live-frame-secret123 should not leak.',
        contentActions: [
          new FakeActionElement({
            tagName: 'a',
            rect: makeRect(260, 32),
            textContent: 'Open embedded checklist',
            attributes: {
              href: '/embedded/checklist?token=secret-frame-action#private',
            },
          }),
          new FakeActionElement({
            tagName: 'button',
            rect: makeRect(310, 36),
            textContent: 'Run embedded check',
            attributes: {
              'aria-pressed': 'true',
            },
          }),
        ],
        contentChoices: [
          new FakeChoiceGroupElement({
            rect: makeRect(360, 160),
            attributes: {
              role: 'listbox',
              'aria-label': 'Embedded release region',
              'aria-activedescendant': 'frame-apac-option',
            },
            choices: [
              new FakeChoiceOptionElement('Frame EMEA rollout', makeRect(370, 28), { role: 'option', 'aria-selected': 'true' }),
              new FakeChoiceOptionElement('Frame APAC rollout', makeRect(408, 28), { role: 'option', id: 'frame-apac-option' }),
              new FakeChoiceOptionElement('Frame secret sk-live-frame-choice-secret123', makeRect(446, 28), { role: 'option' }),
            ],
          }),
        ],
        contentTables: [
          new FakeTableElement({
            rect: makeRect(520, 150),
            caption: 'Embedded release table',
            rows: [
              new FakeTableRow([
                new FakeTableCell('Region', { tagName: 'th' }),
                new FakeTableCell('Status', { tagName: 'th' }),
                new FakeTableCell('Note', { tagName: 'th' }),
              ], makeRect(530, 28)),
              new FakeTableRow([
                new FakeTableCell('EMEA'),
                new FakeTableCell('Ready'),
                new FakeTableCell('sk-live-frame-table-secret123'),
              ], makeRect(570, 28)),
              new FakeTableRow([
                new FakeTableCell('APAC'),
                new FakeTableCell('Waiting'),
                new FakeTableCell('No blocker'),
              ], makeRect(610, 28)),
            ],
          }),
        ],
        contentLists: [
          new FakeListElement({
            tagName: 'ul',
            rect: makeRect(620, 120),
            attributes: { 'aria-label': 'Embedded release checklist' },
            items: [
              new FakeListItemElement({
                textContent: 'Frame smoke test complete',
                rect: makeRect(630, 24),
                stateControl: new FakeControl({
                  tagName: 'input',
                  type: 'checkbox',
                  checked: true,
                  rect: makeRect(630, 20),
                }),
              }),
              new FakeListItemElement({
                textContent: 'Frame security review pending',
                rect: makeRect(660, 24),
                stateControl: new FakeControl({
                  tagName: 'input',
                  type: 'checkbox',
                  checked: false,
                  rect: makeRect(660, 20),
                }),
              }),
              new FakeListItemElement({
                textContent: 'Frame list secret sk-live-frame-list-secret123',
                rect: makeRect(690, 24),
                attributes: { 'aria-current': 'step' },
              }),
            ],
          }),
        ],
        contentMedia: [
          new FakeMediaElement({
            tagName: 'img',
            rect: makeRect(660, 80),
            src: 'https://cdn.example.com/frame/diagram.png?token=secret-frame-media#private',
            caption: 'Embedded launch diagram',
            attributes: {
              alt: 'Embedded architecture diagram',
            },
          }),
          new FakeMediaElement({
            tagName: 'video',
            rect: makeRect(740, 80),
            poster: '/media/frame-walkthrough.jpg?signature=secret-frame-poster#private',
            attributes: {
              'aria-label': 'Embedded walkthrough video',
            },
          }),
        ],
        contentControls: [
          new FakeControl({
            tagName: 'input',
            type: 'text',
            value: 'Embedded approval ready',
            rect: makeRect(160, 32),
            labels: [new FakeElement('Frame approval', makeRect(140, 20))],
          }),
          new FakeControl({
            tagName: 'input',
            type: 'password',
            value: 'sk-live-frame-form-secret123',
            rect: makeRect(210, 32),
            attributes: {
              'aria-label': 'Frame API token',
            },
          }),
        ],
      }),
      new FakeFrameElement({
        rect: makeRect(420, 180),
        src: 'https://cross.example.com/widget?token=do-not-include',
        attributes: {
          title: 'External widget',
        },
        throwOnContentAccess: true,
      }),
    ]);

    const frameContent = ContextCollector.extractVisibleFrameContent();

    expect(frameContent).toContain('Visible frames:');
    expect(frameContent).toContain('Frame: Embedded QA report');
    expect(frameContent).toContain('src: https://example.com/embed/report.html');
    expect(frameContent).toContain('content: Embedded frame status: Ready for QA. Token [redacted] should not leak.');
    expect(frameContent).toContain('form fields: Frame approval: Embedded approval ready | Frame API token: [redacted]');
    expect(frameContent).toContain('actions: Link: Open embedded checklist; href: https://example.com/embedded/checklist | Button: Run embedded check; state: pressed');
    expect(frameContent).toContain('choices: Listbox: Embedded release region; options: Frame EMEA rollout (selected) | Frame APAC rollout (active) | Frame secret [redacted]');
    expect(frameContent).toContain('tables: Table 1: Embedded release table / Columns: Region | Status | Note / Row 1: EMEA | Ready | [redacted] / Row 2: APAC | Waiting | No blocker');
    expect(frameContent).toContain('lists: List: Embedded release checklist; items: 1. Frame smoke test complete (checked) | 2. Frame security review pending (not checked) | 3. Frame list secret [redacted] (current step)');
    expect(frameContent).toContain('media: Image: Embedded architecture diagram; caption: Embedded launch diagram; source: https://cdn.example.com/frame/diagram.png | Video: Embedded walkthrough video; poster: https://example.com/media/frame-walkthrough.jpg');
    expect(frameContent).toContain('Frame: External widget');
    expect(frameContent).toContain('src: https://cross.example.com/widget');
    expect(frameContent).toContain('content: [content unavailable]');
    expect(frameContent).not.toContain('secret-frame-token');
    expect(frameContent).not.toContain('private');
    expect(frameContent).not.toContain('sk-live-frame-secret123');
    expect(frameContent).not.toContain('sk-live-frame-form-secret123');
    expect(frameContent).not.toContain('secret-frame-action');
    expect(frameContent).not.toContain('sk-live-frame-choice-secret123');
    expect(frameContent).not.toContain('sk-live-frame-table-secret123');
    expect(frameContent).not.toContain('sk-live-frame-list-secret123');
    expect(frameContent).not.toContain('secret-frame-media');
    expect(frameContent).not.toContain('secret-frame-poster');
    expect(frameContent).not.toContain('do-not-include');
  });

  it('extracts selected text from a visible same-origin frame with redaction', () => {
    setupFrameDocument([
      new FakeFrameElement({
        rect: makeRect(120, 260),
        src: 'https://example.com/embed/report.html',
        attributes: {
          title: 'Embedded QA report',
        },
        contentSelection: {
          rangeCount: 1,
          toString: () => 'Selected frame insight sk-live-frame-selection-secret123',
        },
      }),
    ]);

    const selection = ContextCollector.extractSelection();

    expect(selection).toBe('Selected frame insight [redacted]');
    expect(selection).not.toContain('sk-live-frame-selection-secret123');
  });

  it('extracts visible open shadow DOM content with style stripping and redaction', () => {
    setupShadowDocument([
      new FakeShadowHostElement({
        tagName: 'qa-status-card',
        rect: makeRect(120, 220),
        shadowText: 'style { color: red } Web Component QA Panel Shadow status: Candidate build ready. Shadow API key sk-live-shadow-secret123 Next step: run browser context regression.',
        cloneText: 'Web Component QA Panel Shadow status: Candidate build ready. Shadow API key sk-live-shadow-secret123 Next step: run browser context regression.',
        attributes: {
          'aria-label': 'QA status web component',
        },
        shadowActions: [
          new FakeActionElement({
            tagName: 'a',
            rect: makeRect(280, 32),
            textContent: 'Open shadow checklist',
            attributes: {
              href: '/shadow/checklist?token=secret-shadow-action#private',
            },
          }),
          new FakeActionElement({
            tagName: 'button',
            rect: makeRect(330, 36),
            textContent: 'Run shadow check',
            attributes: {
              'aria-expanded': 'false',
            },
          }),
        ],
        shadowChoices: [
          new FakeChoiceGroupElement({
            rect: makeRect(380, 160),
            attributes: {
              role: 'listbox',
              'aria-label': 'Shadow release region',
              'aria-activedescendant': 'shadow-apac-option',
            },
            choices: [
              new FakeChoiceOptionElement('Shadow EMEA rollout', makeRect(390, 28), { role: 'option', 'aria-selected': 'true' }),
              new FakeChoiceOptionElement('Shadow APAC rollout', makeRect(428, 28), { role: 'option', id: 'shadow-apac-option' }),
              new FakeChoiceOptionElement('Shadow secret sk-live-shadow-choice-secret123', makeRect(466, 28), { role: 'option' }),
            ],
          }),
        ],
        shadowTables: [
          new FakeTableElement({
            rect: makeRect(540, 150),
            caption: 'Shadow release table',
            rows: [
              new FakeTableRow([
                new FakeTableCell('Region', { tagName: 'th' }),
                new FakeTableCell('Status', { tagName: 'th' }),
                new FakeTableCell('Note', { tagName: 'th' }),
              ], makeRect(550, 28)),
              new FakeTableRow([
                new FakeTableCell('EMEA'),
                new FakeTableCell('Ready'),
                new FakeTableCell('sk-live-shadow-table-secret123'),
              ], makeRect(590, 28)),
              new FakeTableRow([
                new FakeTableCell('APAC'),
                new FakeTableCell('Waiting'),
                new FakeTableCell('No blocker'),
              ], makeRect(630, 28)),
            ],
          }),
        ],
        shadowLists: [
          new FakeListElement({
            tagName: 'ul',
            rect: makeRect(640, 120),
            attributes: { 'aria-label': 'Shadow release checklist' },
            items: [
              new FakeListItemElement({
                textContent: 'Shadow smoke test complete',
                rect: makeRect(650, 24),
                stateControl: new FakeControl({
                  tagName: 'input',
                  type: 'checkbox',
                  checked: true,
                  rect: makeRect(650, 20),
                }),
              }),
              new FakeListItemElement({
                textContent: 'Shadow security review pending',
                rect: makeRect(680, 24),
                stateControl: new FakeControl({
                  tagName: 'input',
                  type: 'checkbox',
                  checked: false,
                  rect: makeRect(680, 20),
                }),
              }),
              new FakeListItemElement({
                textContent: 'Shadow list secret sk-live-shadow-list-secret123',
                rect: makeRect(710, 24),
                attributes: { 'aria-current': 'step' },
              }),
            ],
          }),
        ],
        shadowMedia: [
          new FakeMediaElement({
            tagName: 'img',
            rect: makeRect(680, 80),
            src: 'https://cdn.example.com/shadow/diagram.png?token=secret-shadow-media#private',
            caption: 'Shadow launch diagram',
            attributes: {
              alt: 'Shadow architecture diagram',
            },
          }),
          new FakeMediaElement({
            tagName: 'video',
            rect: makeRect(760, 80),
            poster: '/media/shadow-walkthrough.jpg?signature=secret-shadow-poster#private',
            attributes: {
              'aria-label': 'Shadow walkthrough video',
            },
          }),
        ],
        shadowControls: [
          new FakeControl({
            tagName: 'input',
            type: 'text',
            value: 'Shadow approval ready',
            rect: makeRect(180, 32),
            labels: [new FakeElement('Shadow approval', makeRect(160, 20))],
          }),
          new FakeControl({
            tagName: 'input',
            type: 'password',
            value: 'sk-live-shadow-form-secret123',
            rect: makeRect(230, 32),
            attributes: {
              'aria-label': 'Shadow API token',
            },
          }),
        ],
      }),
    ]);

    const shadowContent = ContextCollector.extractVisibleShadowContent();

    expect(shadowContent).toContain('Visible shadow DOM:');
    expect(shadowContent).toContain('Shadow host: QA status web component');
    expect(shadowContent).toContain('content: Web Component QA Panel Shadow status: Candidate build ready.');
    expect(shadowContent).toContain('Shadow API key [redacted]');
    expect(shadowContent).toContain('Next step: run browser context regression.');
    expect(shadowContent).toContain('form fields: Shadow approval: Shadow approval ready | Shadow API token: [redacted]');
    expect(shadowContent).toContain('actions: Link: Open shadow checklist; href: https://example.com/shadow/checklist | Button: Run shadow check; state: collapsed');
    expect(shadowContent).toContain('choices: Listbox: Shadow release region; options: Shadow EMEA rollout (selected) | Shadow APAC rollout (active) | Shadow secret [redacted]');
    expect(shadowContent).toContain('tables: Table 1: Shadow release table / Columns: Region | Status | Note / Row 1: EMEA | Ready | [redacted] / Row 2: APAC | Waiting | No blocker');
    expect(shadowContent).toContain('lists: List: Shadow release checklist; items: 1. Shadow smoke test complete (checked) | 2. Shadow security review pending (not checked) | 3. Shadow list secret [redacted] (current step)');
    expect(shadowContent).toContain('media: Image: Shadow architecture diagram; caption: Shadow launch diagram; source: https://cdn.example.com/shadow/diagram.png | Video: Shadow walkthrough video; poster: https://example.com/media/shadow-walkthrough.jpg');
    expect(shadowContent).not.toContain('color: red');
    expect(shadowContent).not.toContain('sk-live-shadow-secret123');
    expect(shadowContent).not.toContain('sk-live-shadow-form-secret123');
    expect(shadowContent).not.toContain('secret-shadow-action');
    expect(shadowContent).not.toContain('sk-live-shadow-choice-secret123');
    expect(shadowContent).not.toContain('sk-live-shadow-table-secret123');
    expect(shadowContent).not.toContain('sk-live-shadow-list-secret123');
    expect(shadowContent).not.toContain('secret-shadow-media');
    expect(shadowContent).not.toContain('secret-shadow-poster');
  });

  it('extracts selected text from a visible open shadow root with redaction', () => {
    setupShadowDocument([
      new FakeShadowHostElement({
        tagName: 'qa-status-card',
        rect: makeRect(120, 220),
        shadowText: 'Web Component QA Panel',
        attributes: {
          'aria-label': 'QA status web component',
        },
        shadowSelection: {
          rangeCount: 1,
          toString: () => 'Selected shadow insight sk-live-shadow-selection-secret123',
        },
      }),
    ]);

    const selection = ContextCollector.extractSelection();

    expect(selection).toBe('Selected shadow insight [redacted]');
    expect(selection).not.toContain('sk-live-shadow-selection-secret123');
  });

  it('extracts visible media labels, captions, posters, and sanitized sources', () => {
    setupMediaDocument([
      new FakeMediaElement({
        tagName: 'img',
        rect: makeRect(120, 180),
        src: 'https://cdn.example.com/media/dashboard.png?token=secret-value#fragment',
        caption: 'Launch readiness dashboard',
        attributes: {
          alt: 'Dashboard screenshot showing launch readiness by region',
        },
      }),
      new FakeMediaElement({
        tagName: 'video',
        rect: makeRect(340, 220),
        poster: '/media/walkthrough-poster.jpg?signature=do-not-include',
        attributes: {
          'aria-label': 'Product walkthrough video',
        },
      }),
      new FakeMediaElement({
        tagName: 'div',
        rect: makeRect(600, 140),
        attributes: {
          role: 'img',
          'aria-label': 'Architecture diagram with browser context, provider stream, and side panel',
        },
      }),
      new FakeMediaElement({
        tagName: 'img',
        rect: makeRect(760, 80),
        src: 'data:image/png;base64,do-not-include',
        attributes: {
          alt: 'Inline generated thumbnail',
        },
      }),
    ]);

    const mediaContent = ContextCollector.extractVisibleMediaContent();

    expect(mediaContent).toContain('Visible media:');
    expect(mediaContent).toContain('Image: Dashboard screenshot showing launch readiness by region');
    expect(mediaContent).toContain('caption: Launch readiness dashboard');
    expect(mediaContent).toContain('source: https://cdn.example.com/media/dashboard.png');
    expect(mediaContent).toContain('Video: Product walkthrough video');
    expect(mediaContent).toContain('poster: https://example.com/media/walkthrough-poster.jpg');
    expect(mediaContent).toContain('Graphic: Architecture diagram with browser context, provider stream, and side panel');
    expect(mediaContent).toContain('Image: Inline generated thumbnail');
    expect(mediaContent).not.toContain('secret-value');
    expect(mediaContent).not.toContain('signature=');
    expect(mediaContent).not.toContain('data:image');
    expect(mediaContent).not.toContain('do-not-include');
  });

  it('extracts visible action targets with sanitized hrefs and state', () => {
    setupActionDocument([
      new FakeActionElement({
        tagName: 'a',
        rect: makeRect(90, 32),
        textContent: 'Open launch checklist',
        href: 'https://example.com/checklist?token=secret-value#section',
        attributes: {
          href: '/checklist?token=secret-value#section',
        },
      }),
      new FakeActionElement({
        tagName: 'button',
        rect: makeRect(140, 36),
        textContent: 'Refresh feed',
        attributes: {
          'aria-expanded': 'false',
        },
      }),
      new FakeActionElement({
        tagName: 'input',
        type: 'submit',
        value: 'Deploy now',
        disabled: true,
        rect: makeRect(190, 32),
      }),
      new FakeActionElement({
        tagName: 'div',
        rect: makeRect(240, 32),
        textContent: 'QA tab',
        attributes: {
          role: 'tab',
          'aria-selected': 'true',
        },
      }),
      new FakeActionElement({
        tagName: 'a',
        rect: makeRect(290, 32),
        textContent: 'Unsafe script action',
        attributes: {
          href: 'javascript:alert("do-not-include")',
        },
      }),
    ]);

    const actionContent = ContextCollector.extractVisibleActionContent();

    expect(actionContent).toContain('Visible actions:');
    expect(actionContent).toContain('Link: Open launch checklist');
    expect(actionContent).toContain('href: https://example.com/checklist');
    expect(actionContent).toContain('Button: Refresh feed; state: collapsed');
    expect(actionContent).toContain('Submit button: Deploy now; state: disabled');
    expect(actionContent).toContain('Tab: QA tab; state: selected');
    expect(actionContent).toContain('Link: Unsafe script action');
    expect(actionContent).not.toContain('secret-value');
    expect(actionContent).not.toContain('#section');
    expect(actionContent).not.toContain('javascript:');
    expect(actionContent).not.toContain('do-not-include');
  });
});
