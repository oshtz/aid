/**
 * Quick Actions Implementation for Aid Browser Extension
 * Provides pre-defined actions like Summarise, Draft Email, and Translate
 */

import { ContextCollector } from './context-collector';
import type { ChatMessage, TabContext } from './types';

export interface QuickActionResult {
  messages: ChatMessage[];
  context: TabContext[];
}

const getPreCollectedContent = (tabContext: TabContext): string => {
  return tabContext.selection?.trim() || tabContext.abstract?.trim() || 'No content available';
};

const requireSelectedText = (context: TabContext, action: string): string => {
  const selection = context.selection?.trim();
  if (!selection) {
    throw new Error(`Please select text to ${action}`);
  }

  if (selection.length < 2) {
    throw new Error(`Please select more text to ${action}`);
  }

  return selection;
};

export class QuickActions {
  /**
   * Summarise the current page
   */
  static async summarisePage(): Promise<QuickActionResult> {
    const context = ContextCollector.getCurrentTabContext({
      maxTokens: 3000,
      includeSelection: false
    });

    const fullContent = ContextCollector.extractFullPageContent(2000);

    const systemMessage: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'system',
      content: 'You are a helpful assistant that creates concise, informative summaries of web pages. Focus on the main points and key information.',
      timestamp: Date.now()
    };

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Please provide a concise summary of this webpage:

**Page Title:** ${context.title}
**URL:** ${context.url}

**Content:**
${fullContent}

Please summarize the main points, key information, and any important details in 2-3 paragraphs.`,
      timestamp: Date.now()
    };

    return {
      messages: [systemMessage, userMessage],
      context: [context]
    };
  }

  /**
   * Summarise the page using pre-collected context from content script
   */
  static async summarisePageWithContext(tabContext: TabContext): Promise<QuickActionResult> {
    const fullContent = getPreCollectedContent(tabContext);

    const systemMessage: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'system',
      content: 'You are a helpful assistant that creates concise, informative summaries of web pages. Focus on the main points and key information.',
      timestamp: Date.now()
    };

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Please provide a concise summary of this webpage:

**Page Title:** ${tabContext.title}
**URL:** ${tabContext.url}

**Content:**
${fullContent}

Please summarize the main points, key information, and any important details in 2-3 paragraphs.`,
      timestamp: Date.now()
    };

    return {
      messages: [systemMessage, userMessage],
      context: [tabContext]
    };
  }

  static async proofreadContentWithContext(context: TabContext): Promise<QuickActionResult> {
    const selection = requireSelectedText(context, 'proofread');

    const systemMessage: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'system',
      content: 'You are a professional proofreading assistant. Check grammar, spelling, punctuation, and clarity while preserving the original meaning and tone. Provide clear corrections and explanations.',
      timestamp: Date.now()
    };

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Please proofread the following text for grammar, spelling, and clarity:

**Source Page:** ${context.title}
**URL:** ${context.url}

**Text to Proofread:**
${selection}

Please:
1. Identify and correct any grammar, spelling, or punctuation errors
2. Suggest improvements for clarity and readability
3. Preserve the original meaning and tone
4. Explain any significant changes made`,
      timestamp: Date.now()
    };

    return {
      messages: [systemMessage, userMessage],
      context: [context]
    };
  }

  static async rewriteContentWithContext(context: TabContext, tone?: string): Promise<QuickActionResult> {
    const selection = requireSelectedText(context, 'rewrite');
    const selectedTone = tone || 'professional';

    const systemMessage: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'system',
      content: 'You are a skilled writing assistant that can rewrite text in different tones and styles while preserving the core meaning and information.',
      timestamp: Date.now()
    };

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Please rewrite the following text in a ${selectedTone} tone:

**Source Page:** ${context.title}
**URL:** ${context.url}

**Text to Rewrite:**
${selection}

Please:
1. Rewrite the text with a ${selectedTone} tone
2. Preserve all key information and meaning
3. Maintain appropriate length and structure
4. Ensure the rewritten version flows naturally`,
      timestamp: Date.now()
    };

    return {
      messages: [systemMessage, userMessage],
      context: [context]
    };
  }

  /**
   * Extract key points using pre-collected context from content script
   */
  static async extractKeyPointsWithContext(tabContext: TabContext): Promise<QuickActionResult> {
    const fullContent = getPreCollectedContent(tabContext);

    const systemMessage: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'system',
      content: 'You are an expert at extracting and organizing key points from web content. Create clear, concise bullet points that capture the most important information.',
      timestamp: Date.now()
    };

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Please extract the key points from this webpage:

**Page Title:** ${tabContext.title}
**URL:** ${tabContext.url}

**Content:**
${fullContent}

Please:
1. Extract the most important points and information
2. Organize them as clear, concise bullet points
3. Prioritize the points by importance
4. Ensure each point is self-contained and meaningful
5. Focus on actionable insights and key takeaways`,
      timestamp: Date.now()
    };

    return {
      messages: [systemMessage, userMessage],
      context: [tabContext]
    };
  }

  /**
   * Organize content into a structured list using pre-collected context from content script
   */
  static async makeListWithContext(tabContext: TabContext): Promise<QuickActionResult> {
    const fullContent = getPreCollectedContent(tabContext);

    const systemMessage: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'system',
      content: 'You are an expert at organizing web content into clear, structured lists. Create well-organized lists that make information easy to scan and understand.',
      timestamp: Date.now()
    };

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Please organize this webpage content into a structured list format:

**Page Title:** ${tabContext.title}
**URL:** ${tabContext.url}

**Content:**
${fullContent}

Please:
1. Organize the information into logical categories or sections
2. Use appropriate list formatting (numbered, bulleted, or nested lists)
3. Group related items together
4. Ensure the list is easy to scan and understand
5. Maintain all important information from the original content
6. Create clear headings for different sections`,
      timestamp: Date.now()
    };

    return {
      messages: [systemMessage, userMessage],
      context: [tabContext]
    };
  }

  /**
   * Translate selected text or page content
   */
  static async translateContent(targetLanguage?: string): Promise<QuickActionResult> {
    const context = ContextCollector.getCurrentTabContext({
      maxTokens: 2000,
      includeSelection: true
    });

    return this.translateContentWithContext(context, targetLanguage);
  }

  static async translateContentWithContext(context: TabContext, targetLanguage?: string): Promise<QuickActionResult> {
    const selection = requireSelectedText(context, 'translate');
    // Auto-detect user's preferred language if not specified
    const userLanguage = targetLanguage || this.detectUserLanguage();

    const systemMessage: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'system',
      content: 'You are a professional translator. Provide accurate translations while preserving the original meaning, tone, and context. Always specify the detected source language.',
      timestamp: Date.now()
    };

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Please translate the following text to ${userLanguage}:

**Source Page:** ${context.title}
**URL:** ${context.url}

**Text to Translate:**
${selection}

Please:
1. Detect and specify the source language
2. Provide an accurate translation to ${userLanguage}
3. Preserve the original meaning and tone
4. If there are any cultural references or idioms, provide brief explanations`,
      timestamp: Date.now()
    };

    return {
      messages: [systemMessage, userMessage],
      context: [context]
    };
  }

  /**
   * Explain or analyze selected content
   */
  static async explainSelection(): Promise<QuickActionResult> {
    const context = ContextCollector.getCurrentTabContext({
      maxTokens: 2000,
      includeSelection: true
    });

    return this.explainSelectionWithContext(context);
  }

  static async explainSelectionWithContext(context: TabContext): Promise<QuickActionResult> {
    const selection = requireSelectedText(context, 'explain');

    const systemMessage: ChatMessage = {
      id: `system-${Date.now()}`,
      role: 'system',
      content: 'You are a knowledgeable assistant that provides clear, detailed explanations of concepts, terms, or content. Break down complex topics into understandable parts.',
      timestamp: Date.now()
    };

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: `Please explain the following content in detail:

**Source Page:** ${context.title}
**URL:** ${context.url}

**Selected Content:**
${selection}

Please provide:
1. A clear explanation of the main concepts
2. Context and background information if relevant
3. Any technical terms or jargon explained in simple language
4. Why this information might be important or useful`,
      timestamp: Date.now()
    };

    return {
      messages: [systemMessage, userMessage],
      context: [context]
    };
  }

  /**
   * Detect user's preferred language based on browser settings
   */
  private static detectUserLanguage(): string {
    const browserLanguage = navigator.language || navigator.languages?.[0] || 'en';

    // Map common language codes to full language names
    const languageMap: Record<string, string> = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ru': 'Russian',
      'ja': 'Japanese',
      'ko': 'Korean',
      'zh': 'Chinese',
      'ar': 'Arabic',
      'hi': 'Hindi',
      'nl': 'Dutch',
      'sv': 'Swedish',
      'da': 'Danish',
      'no': 'Norwegian',
      'fi': 'Finnish',
      'pl': 'Polish',
      'tr': 'Turkish',
      'he': 'Hebrew'
    };

    const langCode = browserLanguage?.split('-')[0]?.toLowerCase() || 'en';
    return languageMap[langCode] || 'English';
  }

}
