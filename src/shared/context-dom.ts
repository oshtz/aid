export type FormFieldRoot = {
  activeElement?: Element | null;
  body?: Element | null;
  documentElement?: Element | null;
  getElementById?: (id: string) => Element | null;
  getSelection?: () => Selection | null;
  querySelectorAll: (selectors: string) => NodeListOf<Element> | Element[];
};

export type FormControlSurface = Element & {
  checked?: boolean;
  disabled?: boolean;
  files?: FileList | null;
  href?: string;
  id?: string;
  labels?: NodeListOf<HTMLLabelElement> | HTMLLabelElement[];
  max?: string;
  min?: string;
  name?: string;
  placeholder?: string;
  readOnly?: boolean;
  required?: boolean;
  selectedOptions?: HTMLCollectionOf<HTMLOptionElement> | HTMLOptionElement[];
  selectionEnd?: number | null;
  selectionStart?: number | null;
  step?: string;
  type?: string;
  validity?: ValidityState;
  validationMessage?: string;
  value?: string | number;
};

export type FrameSurface = Element & {
  contentDocument?: Document | null;
  name?: string;
  src?: string;
};

export type MediaSurface = Element & {
  currentSrc?: string;
  poster?: string;
  src?: string;
};

export type ScrollSurface = Element & {
  clientHeight?: number;
  clientWidth?: number;
  scrollHeight?: number;
  scrollLeft?: number;
  scrollTop?: number;
  scrollWidth?: number;
};

export type ShadowHostSurface = Element & {
  shadowRoot?: (DocumentFragment & FormFieldRoot) | null;
};

export function getTagName(element: Element | null | undefined): string {
  return String(element?.tagName || '').toLowerCase();
}

export function getShadowRoot(element: Element): (DocumentFragment & FormFieldRoot) | undefined {
  return (element as ShadowHostSurface).shadowRoot || undefined;
}

export function getFrameDocument(element: Element): Document | undefined {
  try {
    return (element as FrameSurface).contentDocument || undefined;
  } catch {
    return undefined;
  }
}
