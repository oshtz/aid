import type { ChatImageAttachment, ChatMessage } from '@/shared/types';

export type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } };

export const getImageAttachments = (message: ChatMessage): ChatImageAttachment[] => (
  message.attachments?.filter((attachment): attachment is ChatImageAttachment => (
    attachment.kind === 'image' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(attachment.dataUrl)
  )) || []
);

export const toOpenAIContent = (message: ChatMessage): string | OpenAIContentPart[] => {
  const images = message.role === 'user' ? getImageAttachments(message) : [];
  if (images.length === 0) {
    return message.content;
  }

  return [
    ...images.map((image): OpenAIContentPart => ({
      type: 'image_url',
      image_url: { url: image.dataUrl, detail: 'auto' },
    })),
    ...(message.content.trim() ? [{ type: 'text' as const, text: message.content }] : []),
  ];
};

export const getBase64ImageData = (image: ChatImageAttachment): string => (
  image.dataUrl.split(',')[1] || ''
);
