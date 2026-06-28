import type { ChatMessage, TabContext } from './types';

const PAGE_CONTEXT_MARKERS = [
  'context from current page',
  'use this current page context when answering the user',
  'page title:',
  'source page:',
  'page content:',
  'selected content:',
  'selected text:',
];

export const hasReadableTabContext = (context: TabContext | undefined): context is TabContext => {
  if (!context) {
    return false;
  }

  return Boolean(
    context.url.trim() ||
      context.title.trim() ||
      context.abstract.trim() ||
      context.selection?.trim()
  );
};

export const messageHasPageContext = (message: ChatMessage): boolean => {
  const normalizedContent = message.content.toLowerCase();
  return PAGE_CONTEXT_MARKERS.some((marker) => normalizedContent.includes(marker));
};

export const messagesAlreadyIncludePageContext = (messages: ChatMessage[]): boolean => {
  return messages.some(messageHasPageContext);
};

export const formatPageContextForPrompt = (contexts: TabContext[]): string => {
  const readableContexts = contexts.filter(hasReadableTabContext);

  return readableContexts
    .map((context, index) => {
      const lines = [
        readableContexts.length > 1 ? `Page ${index + 1}` : 'Current page',
        `Title: ${context.title.trim() || 'Untitled page'}`,
        `URL: ${context.url.trim() || 'Unknown URL'}`,
      ];

      const selection = context.selection?.trim();
      if (selection) {
        lines.push('Selected text:', selection);
      }

      if (context.abstract.trim()) {
        lines.push('Page content:', context.abstract.trim());
      }

      return lines.join('\n');
    })
    .join('\n\n');
};

export const estimateContextTokens = (contexts: TabContext[]): number => {
  const promptContext = formatPageContextForPrompt(contexts);
  return Math.ceil(promptContext.length / 4);
};

export const getContextPreviewLabel = (contexts: TabContext[]): string => {
  const readableContexts = contexts.filter(hasReadableTabContext);
  const [firstContext] = readableContexts;

  if (!firstContext) {
    return 'No page context';
  }

  const selection = firstContext.selection?.trim();
  if (selection) {
    return 'Selection attached';
  }

  return firstContext.title.trim() || 'Page context ready';
};

export const addPageContextToLatestUserMessage = (
  messages: ChatMessage[],
  contexts: TabContext[]
): ChatMessage[] => {
  const readableContexts = contexts.filter(hasReadableTabContext);

  if (readableContexts.length === 0) {
    return messages;
  }

  let latestUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      latestUserIndex = index;
      break;
    }
  }

  if (latestUserIndex === -1) {
    return messages;
  }

  const latestUserMessage = messages[latestUserIndex];
  if (!latestUserMessage || messageHasPageContext(latestUserMessage)) {
    return messages;
  }

  const pageContext = formatPageContextForPrompt(readableContexts);
  return messages.map((message, index) => {
    if (index !== latestUserIndex) {
      return message;
    }

    return {
      ...message,
      content: [
        'Use this current page context when answering the user. If the user asks about "this page", "here", or visible content, answer from this context.',
        pageContext,
        'User request:',
        message.content,
      ].join('\n\n'),
    };
  });
};
