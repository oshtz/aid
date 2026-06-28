import type {
  ChatConversation,
  ChatMessage,
  ConversationMetadata,
  ProviderId,
  TabContext,
} from '@/shared/types';

export const buildSavedConversation = (options: {
  conversationId: string;
  existingConversation?: ChatConversation | null;
  messages: ChatMessage[];
  provider: ProviderId;
  model: string;
  context: TabContext[];
  now: number;
}): ChatConversation => {
  const {
    conversationId,
    existingConversation,
    messages,
    provider,
    model,
    context,
    now,
  } = options;
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const generatedTitle = firstUserMessage
    ? firstUserMessage.content.substring(0, 50).trim() + (firstUserMessage.content.length > 50 ? '...' : '')
    : 'New Conversation';
  const manualTitle = existingConversation?.userTitle ||
    (existingConversation && !existingConversation.autoTitle ? existingConversation.title : undefined);
  const tags = existingConversation?.tags || [];
  const totalTokens = messages.reduce((sum, message) => sum + (message.content.length / 4), 0);
  const metadata: ConversationMetadata = {
    provider,
    model,
    context,
    messageCount: messages.length,
    tokenUsage: {
      promptTokens: Math.floor(totalTokens * 0.7),
      completionTokens: Math.floor(totalTokens * 0.3),
      totalTokens: Math.floor(totalTokens),
    },
    lastActivity: now,
    source: existingConversation?.metadata.source || 'sidepanel',
    tags,
  };

  return {
    id: conversationId,
    title: manualTitle || generatedTitle,
    autoTitle: existingConversation?.autoTitle ?? true,
    ...(existingConversation?.userTitle ? { userTitle: existingConversation.userTitle } : {}),
    tags,
    messages,
    metadata,
    createdAt: existingConversation?.createdAt || now,
    updatedAt: now,
    isActive: true,
    isPinned: existingConversation?.isPinned || false,
  };
};
