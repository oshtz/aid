import browser from 'webextension-polyfill';
import type {
  ProviderAuthMap,
  ExtensionSettings,
  ChatConversation,
  ChatHistoryFilter,
  ChatHistoryGroup,
  ChatHistoryExport,
  StorageUsage,
  ChatRequest
} from './types';
import { DEFAULT_ACCENT_COLOR, normalizeAccentColor } from './accent';

interface LegacyTabChatHistory {
  tabId: number;
  history: Array<{
    request: ChatRequest;
    timestamp: number;
  }>;
  timestamp: number;
}

type SortableConversationValue = string | number;

type StorageAreaWithUsage = {
  getBytesInUse?: () => Promise<number>;
};

/**
 * Encryption utilities for secure storage
 */
class EncryptionManager {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;
  private static readonly IV_LENGTH = 12;

  /**
   * Generate a cryptographic key from a password
   */
  private static async deriveKey(password: string, salt: BufferSource): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: this.ALGORITHM, length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Generate a master key for the extension
   */
  private static async getMasterKey(): Promise<CryptoKey> {
    // Use extension ID as a consistent seed for key derivation
    const extensionId = browser.runtime.id;
    const salt = new TextEncoder().encode(extensionId).slice(0, 16);

    // Pad salt to 16 bytes if needed
    const paddedSalt = new Uint8Array(16);
    paddedSalt.set(salt);

    return this.deriveKey(extensionId, paddedSalt);
  }

  /**
   * Encrypt data using AES-GCM
   */
  static async encrypt(data: string): Promise<string> {
    try {
      const key = await this.getMasterKey();
      const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));
      const encoder = new TextEncoder();

      const encrypted = await crypto.subtle.encrypt(
        { name: this.ALGORITHM, iv },
        key,
        encoder.encode(data)
      );

      // Combine IV and encrypted data
      const combined = new Uint8Array(iv.length + encrypted.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(encrypted), iv.length);

      // Convert to base64 for storage
      return btoa(String.fromCharCode(...combined));
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt data using AES-GCM
   */
  static async decrypt(encryptedData: string): Promise<string> {
    try {
      const key = await this.getMasterKey();

      // Convert from base64
      const combined = new Uint8Array(
        atob(encryptedData).split('').map(char => char.charCodeAt(0))
      );

      // Extract IV and encrypted data
      const iv = combined.slice(0, this.IV_LENGTH);
      const encrypted = combined.slice(this.IV_LENGTH);

      const decrypted = await crypto.subtle.decrypt(
        { name: this.ALGORITHM, iv },
        key,
        encrypted
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }
}

/**
 * Enhanced IndexedDB manager for chat history storage
 */
class IndexedDBManager {
  private static readonly DB_NAME = 'AidExtension';
  private static readonly DB_VERSION = 2; // Incremented for schema upgrade
  private static readonly CHAT_STORE = 'chatHistory'; // Legacy store
  public static readonly CONVERSATIONS_STORE = 'conversations'; // New conversations store

  private static db: IDBDatabase | null = null;

  /**
   * Initialize IndexedDB with schema upgrade support
   */
  public static async initDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        const oldVersion = event.oldVersion;

        // Create legacy chat history store (v1)
        if (!db.objectStoreNames.contains(this.CHAT_STORE)) {
          const store = db.createObjectStore(this.CHAT_STORE, { keyPath: 'tabId' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Create new conversations store (v2)
        if (oldVersion < 2 && !db.objectStoreNames.contains(this.CONVERSATIONS_STORE)) {
          const conversationsStore = db.createObjectStore(this.CONVERSATIONS_STORE, { keyPath: 'id' });

          // Create indexes for efficient querying
          conversationsStore.createIndex('createdAt', 'createdAt', { unique: false });
          conversationsStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          conversationsStore.createIndex('isActive', 'isActive', { unique: false });
          conversationsStore.createIndex('isPinned', 'isPinned', { unique: false });
          conversationsStore.createIndex('provider', 'metadata.provider', { unique: false });
          conversationsStore.createIndex('model', 'metadata.model', { unique: false });
          conversationsStore.createIndex('tags', 'tags', { unique: false, multiEntry: true });
          conversationsStore.createIndex('title', 'title', { unique: false });

          // Migrate existing chat history if available
          if (oldVersion >= 1 && transaction) {
            transaction.oncomplete = () => {
              this.migrateLegacyChatHistory().catch(console.error);
            };
          }
        }
      };
    });
  }

  /**
   * Migrate legacy per-tab chat data to new conversation format
   */
  private static async migrateLegacyChatHistory(): Promise<void> {
    try {
      const db = await this.initDB();
      const transaction = db.transaction([this.CHAT_STORE, this.CONVERSATIONS_STORE], 'readwrite');
      const legacyStore = transaction.objectStore(this.CHAT_STORE);
      const conversationsStore = transaction.objectStore(this.CONVERSATIONS_STORE);

      const legacyData = await new Promise<LegacyTabChatHistory[]>((resolve, reject) => {
        const request = legacyStore.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });

      for (const entry of legacyData) {
        if (entry.history && Array.isArray(entry.history) && entry.history.length > 0) {
          const messages = entry.history.flatMap(historyEntry => historyEntry.request.messages);

          if (messages.length === 0) {
            continue;
          }

          const conversation: ChatConversation = {
            id: `migrated_${entry.tabId}_${Date.now()}`,
            title: `Migrated Conversation (Tab ${entry.tabId})`,
            autoTitle: true,
            tags: ['migrated'],
            messages,
            metadata: {
              provider: 'unknown',
              model: 'unknown',
              context: [],
              messageCount: messages.length,
              tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              lastActivity: entry.timestamp || Date.now(),
              source: 'sidepanel'
            },
            createdAt: entry.timestamp || Date.now(),
            updatedAt: entry.timestamp || Date.now(),
            isActive: false,
            isPinned: false
          };

          await new Promise<void>((resolve, reject) => {
            const request = conversationsStore.add(conversation);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
          });
        }
      }
    } catch (error) {
      console.error('Failed to migrate legacy chat history:', error);
    }
  }

  /**
   * Clear all chat history
   */
  static async clearAllChatHistory(): Promise<void> {
    const db = await this.initDB();
    const transaction = db.transaction([this.CHAT_STORE], 'readwrite');
    const store = transaction.objectStore(this.CHAT_STORE);

    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }
}

/**
 * Chat History Manager for enhanced conversation storage
 */
export class ChatHistoryManager {
  /**
   * Save a conversation to storage
   */
  static async saveConversation(conversation: ChatConversation): Promise<void> {
    const db = await IndexedDBManager.initDB();
    const transaction = db.transaction([IndexedDBManager.CONVERSATIONS_STORE], 'readwrite');
    const store = transaction.objectStore(IndexedDBManager.CONVERSATIONS_STORE);

    // Update timestamps
    const now = Date.now();
    conversation.updatedAt = now;
    if (!conversation.createdAt) {
      conversation.createdAt = now;
    }

    return new Promise((resolve, reject) => {
      const request = store.put(conversation);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Get a specific conversation by ID
   */
  static async getConversation(id: string): Promise<ChatConversation | null> {
    const db = await IndexedDBManager.initDB();
    const transaction = db.transaction([IndexedDBManager.CONVERSATIONS_STORE], 'readonly');
    const store = transaction.objectStore(IndexedDBManager.CONVERSATIONS_STORE);

    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || null);
    });
  }

  /**
   * Get all conversations with optional filtering
   */
  static async getAllConversations(filter?: ChatHistoryFilter): Promise<ChatConversation[]> {
    const db = await IndexedDBManager.initDB();
    const transaction = db.transaction([IndexedDBManager.CONVERSATIONS_STORE], 'readonly');
    const store = transaction.objectStore(IndexedDBManager.CONVERSATIONS_STORE);

    let conversations: ChatConversation[] = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result || []);
    });

    // Apply filters
    if (filter) {
      conversations = this.applyFilters(conversations, filter);
    }

    // Sort conversations
    const sortBy = filter?.sortBy || 'updatedAt';
    const sortOrder = filter?.sortOrder || 'desc';
    conversations.sort((a, b) => {
      const aValue = this.getSortValue(a, sortBy);
      const bValue = this.getSortValue(b, sortBy);

      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : aValue < bValue ? -1 : 0;
      } else {
        return aValue < bValue ? 1 : aValue > bValue ? -1 : 0;
      }
    });

    // Apply pagination
    if (filter?.offset || filter?.limit) {
      const start = filter.offset || 0;
      const end = filter.limit ? start + filter.limit : undefined;
      conversations = conversations.slice(start, end);
    }

    return conversations;
  }

  private static getSortValue(
    conversation: ChatConversation,
    sortBy: NonNullable<ChatHistoryFilter['sortBy']>
  ): SortableConversationValue {
    switch (sortBy) {
      case 'createdAt':
        return conversation.createdAt;
      case 'updatedAt':
        return conversation.updatedAt;
      case 'messageCount':
        return conversation.metadata.messageCount;
      case 'title':
        return conversation.title.toLowerCase();
      default:
        return conversation.updatedAt;
    }
  }

  /**
   * Delete a conversation
   */
  static async deleteConversation(id: string): Promise<void> {
    const db = await IndexedDBManager.initDB();
    const transaction = db.transaction([IndexedDBManager.CONVERSATIONS_STORE], 'readwrite');
    const store = transaction.objectStore(IndexedDBManager.CONVERSATIONS_STORE);

    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }

  /**
   * Update conversation metadata
   */
  static async updateConversation(id: string, updates: Partial<ChatConversation>): Promise<void> {
    const conversation = await this.getConversation(id);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    const updatedConversation = { ...conversation, ...updates, updatedAt: Date.now() };
    await this.saveConversation(updatedConversation);
  }

  /**
   * Search conversations by text content
   */
  static async searchConversations(filter: ChatHistoryFilter): Promise<ChatConversation[]> {
    const conversations = await this.getAllConversations();

    if (!filter.query) {
      return this.applyFilters(conversations, filter);
    }

    const query = filter.query.toLowerCase();
    const matchingConversations = conversations.filter(conversation => {
      // Search in title
      if (conversation.title.toLowerCase().includes(query)) {
        return true;
      }

      // Search in user title
      if (conversation.userTitle?.toLowerCase().includes(query)) {
        return true;
      }

      // Search in tags
      if (conversation.tags.some(tag => tag.toLowerCase().includes(query))) {
        return true;
      }

      // Search in message content
      return conversation.messages.some(message =>
        message.content.toLowerCase().includes(query)
      );
    });

    return this.applyFilters(matchingConversations, filter);
  }

  /**
   * Get conversations grouped by time periods
   */
  static async getConversationGroups(filter?: ChatHistoryFilter): Promise<ChatHistoryGroup[]> {
    const conversations = await this.getAllConversations(filter);
    const now = Date.now();
    const today = new Date(now).setHours(0, 0, 0, 0);
    const yesterday = today - 24 * 60 * 60 * 1000;
    const thisWeekStart = today - (new Date(today).getDay() * 24 * 60 * 60 * 1000);
    const lastWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;
    const thisMonthStart = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).getTime();

    const groups: ChatHistoryGroup[] = [
      { period: 'today', label: 'Today', conversations: [], count: 0 },
      { period: 'yesterday', label: 'Yesterday', conversations: [], count: 0 },
      { period: 'this_week', label: 'This Week', conversations: [], count: 0 },
      { period: 'last_week', label: 'Last Week', conversations: [], count: 0 },
      { period: 'this_month', label: 'This Month', conversations: [], count: 0 },
      { period: 'older', label: 'Older', conversations: [], count: 0 }
    ];
    const [todayGroup, yesterdayGroup, thisWeekGroup, lastWeekGroup, thisMonthGroup, olderGroup] = groups;

    if (
      !todayGroup ||
      !yesterdayGroup ||
      !thisWeekGroup ||
      !lastWeekGroup ||
      !thisMonthGroup ||
      !olderGroup
    ) {
      throw new Error('Conversation groups were not initialized');
    }

    conversations.forEach(conversation => {
      const conversationDate = conversation.updatedAt;

      if (conversationDate >= today) {
        todayGroup.conversations.push(conversation);
      } else if (conversationDate >= yesterday) {
        yesterdayGroup.conversations.push(conversation);
      } else if (conversationDate >= thisWeekStart) {
        thisWeekGroup.conversations.push(conversation);
      } else if (conversationDate >= lastWeekStart) {
        lastWeekGroup.conversations.push(conversation);
      } else if (conversationDate >= thisMonthStart) {
        thisMonthGroup.conversations.push(conversation);
      } else {
        olderGroup.conversations.push(conversation);
      }
    });

    // Update counts and filter out empty groups
    return groups
      .map(group => ({ ...group, count: group.conversations.length }))
      .filter(group => group.count > 0);
  }

  /**
   * Export chat history
   */
  static async exportHistory(filter?: ChatHistoryFilter): Promise<ChatHistoryExport> {
    const conversations = await this.getAllConversations(filter);

    const providers = [...new Set(conversations.map(c => c.metadata.provider))];
    const models = [...new Set(conversations.map(c => c.metadata.model))];
    const dates = conversations.map(c => c.createdAt);
    const dateRange = dates.length > 0
      ? { start: Math.min(...dates), end: Math.max(...dates) }
      : { start: 0, end: 0 };

    return {
      version: '1.0',
      exportedAt: Date.now(),
      conversations,
      metadata: {
        totalConversations: conversations.length,
        totalMessages: conversations.reduce((sum, c) => sum + c.messages.length, 0),
        dateRange,
        providers,
        models
      }
    };
  }

  /**
   * Import chat history
   */
  static async importHistory(exportData: ChatHistoryExport): Promise<{ imported: number; skipped: number; errors: number }> {
    let imported = 0;
    let skipped = 0;
    let errors = 0;

    for (const conversation of exportData.conversations) {
      try {
        // Check if conversation already exists
        const existing = await this.getConversation(conversation.id);
        if (existing) {
          skipped++;
          continue;
        }

        // Validate conversation structure
        if (!conversation.id || !conversation.messages || !Array.isArray(conversation.messages)) {
          errors++;
          continue;
        }

        await this.saveConversation(conversation);
        imported++;
      } catch (error) {
        console.error('Failed to import conversation:', error);
        errors++;
      }
    }

    return { imported, skipped, errors };
  }

  /**
   * Clean up old conversations based on retention policy
   */
  static async cleanupOldConversations(retentionDays: number = 90): Promise<number> {
    const cutoffDate = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
    const conversations = await this.getAllConversations();

    let deletedCount = 0;
    for (const conversation of conversations) {
      if (!conversation.isPinned && conversation.updatedAt < cutoffDate) {
        await this.deleteConversation(conversation.id);
        deletedCount++;
      }
    }

    return deletedCount;
  }

  /**
   * Optimize storage by removing orphaned data
   */
  static async optimizeStorage(): Promise<{ cleaned: number; sizeBefore: number; sizeAfter: number }> {
    const sizeBefore = await this.getStorageSize();
    let cleaned = 0;

    // Remove conversations with no messages
    const conversations = await this.getAllConversations();
    for (const conversation of conversations) {
      if (!conversation.messages || conversation.messages.length === 0) {
        await this.deleteConversation(conversation.id);
        cleaned++;
      }
    }

    const sizeAfter = await this.getStorageSize();

    return { cleaned, sizeBefore, sizeAfter };
  }

  /**
   * Get storage statistics
   */
  static async getStorageStats(): Promise<StorageUsage & { conversationCount: number; messageCount: number }> {
    const conversations = await this.getAllConversations();
    const messageCount = conversations.reduce((sum, c) => sum + c.messages.length, 0);
    const storageSize = await this.getStorageSize();

    return {
      settings: 0, // Will be filled by StorageManager
      authMap: 0, // Will be filled by StorageManager
      chatHistory: 0, // Legacy
      conversations: storageSize,
      totalSize: storageSize,
      conversationCount: conversations.length,
      messageCount
    };
  }

  /**
   * Apply filters to conversation list
   */
  private static applyFilters(conversations: ChatConversation[], filter: ChatHistoryFilter): ChatConversation[] {
    let filtered = conversations;

    if (filter.provider) {
      filtered = filtered.filter(c => c.metadata.provider === filter.provider);
    }

    if (filter.model) {
      filtered = filtered.filter(c => c.metadata.model === filter.model);
    }

    const tags = filter.tags;
    if (tags && tags.length > 0) {
      filtered = filtered.filter(c =>
        tags.some(tag => c.tags.includes(tag))
      );
    }

    const dateRange = filter.dateRange;
    if (dateRange) {
      filtered = filtered.filter(c =>
        c.createdAt >= dateRange.start &&
        c.createdAt <= dateRange.end
      );
    }

    if (filter.isPinned !== undefined) {
      filtered = filtered.filter(c => c.isPinned === filter.isPinned);
    }

    const minMessages = filter.minMessages;
    if (minMessages) {
      filtered = filtered.filter(c => c.messages.length >= minMessages);
    }

    return filtered;
  }

  /**
   * Get approximate storage size
   */
  private static async getStorageSize(): Promise<number> {
    try {
      const conversations = await this.getAllConversations();
      const jsonString = JSON.stringify(conversations);
      return new Blob([jsonString]).size;
    } catch (error) {
      console.error('Failed to calculate storage size:', error);
      return 0;
    }
  }
}

/**
 * Main storage manager for the Aid extension
 */
export class StorageManager {
  private static readonly SETTINGS_KEY = 'settings';
  private static readonly AUTH_MAP_KEY = 'authMap';
  private static readonly ENCRYPTED_AUTH_MAP_KEY = 'encryptedAuthMap';
  private static memorySessionAuthMap: ProviderAuthMap = {};

  /**
   * Load extension settings
   */
  static async loadSettings(): Promise<ExtensionSettings> {
    try {
      const result = await browser.storage.sync.get(this.SETTINGS_KEY);
      const settings = result[this.SETTINGS_KEY] || {
        defaultProvider: 'openai',
        defaultModels: {},
        sessionOnly: true,
        theme: 'auto',
        accentColor: DEFAULT_ACCENT_COLOR,
      };

      return {
        ...settings,
        defaultModels: settings.defaultModels || {},
        accentColor: normalizeAccentColor(settings.accentColor),
      };
    } catch (error) {
      console.error('Failed to load settings:', error);
      return {
        defaultProvider: 'openai',
        defaultModels: {},
        sessionOnly: true,
        theme: 'auto',
        accentColor: DEFAULT_ACCENT_COLOR,
      };
    }
  }

  /**
   * Save extension settings
   */
  static async saveSettings(settings: ExtensionSettings): Promise<void> {
    try {
      await browser.storage.sync.set({ [this.SETTINGS_KEY]: settings });
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw new Error('Failed to save settings');
    }
  }

  /**
   * Load provider authentication map
   */
  static async loadAuthMap(sessionOnly: boolean): Promise<ProviderAuthMap> {
    try {
      if (sessionOnly) {
        if (browser.storage.session) {
          const result = await browser.storage.session.get(this.AUTH_MAP_KEY);
          return result[this.AUTH_MAP_KEY] || {};
        }

        return this.memorySessionAuthMap;
      } else {
        // Load from local storage (encrypted)
        const result = await browser.storage.local.get(this.ENCRYPTED_AUTH_MAP_KEY);
        const encryptedData = result[this.ENCRYPTED_AUTH_MAP_KEY];

        if (!encryptedData) {
          return {};
        }

        // Decrypt the auth map
        const decryptedJson = await EncryptionManager.decrypt(encryptedData);
        return JSON.parse(decryptedJson);
      }
    } catch (error) {
      console.error('Failed to load auth map:', error);
      return {};
    }
  }

  /**
   * Save provider authentication map
   */
  static async saveAuthMap(authMap: ProviderAuthMap, sessionOnly: boolean): Promise<void> {
    try {
      if (sessionOnly) {
        if (browser.storage.session) {
          await browser.storage.session.set({ [this.AUTH_MAP_KEY]: authMap });
        } else {
          this.memorySessionAuthMap = authMap;
        }
      } else {
        // Encrypt and save to local storage
        const jsonData = JSON.stringify(authMap);
        const encryptedData = await EncryptionManager.encrypt(jsonData);
        await browser.storage.local.set({ [this.ENCRYPTED_AUTH_MAP_KEY]: encryptedData });

        // Clear session storage to avoid conflicts
        if (browser.storage.session) {
          await browser.storage.session.remove(this.AUTH_MAP_KEY);
        } else {
          await browser.storage.local.remove(`session_${this.AUTH_MAP_KEY}`);
        }
      }
    } catch (error) {
      console.error('Failed to save auth map:', error);
      throw new Error('Failed to save authentication data');
    }
  }

  /**
   * Clear all authentication data
   */
  static async clearAuthMap(): Promise<void> {
    try {
      const clearPromises = [
        browser.storage.local.remove(this.ENCRYPTED_AUTH_MAP_KEY),
        browser.storage.local.remove(`session_${this.AUTH_MAP_KEY}`),
      ];
      this.memorySessionAuthMap = {};

      // Only clear session storage if it's available
      if (browser.storage.session) {
        clearPromises.push(browser.storage.session.remove(this.AUTH_MAP_KEY));
      }

      await Promise.all(clearPromises);
    } catch (error) {
      console.error('Failed to clear auth map:', error);
      throw new Error('Failed to clear authentication data');
    }
  }

  /**
   * Migrate auth storage mode (session <-> persistent)
   */
  static async migrateAuthStorage(
    authMap: ProviderAuthMap,
    fromSessionOnly: boolean,
    toSessionOnly: boolean
  ): Promise<void> {
    if (fromSessionOnly === toSessionOnly) {
      return; // No migration needed
    }

    try {
      // Save to new storage mode
      await this.saveAuthMap(authMap, toSessionOnly);

      // Clear old storage mode
      if (fromSessionOnly) {
        if (browser.storage.session) {
          await browser.storage.session.remove(this.AUTH_MAP_KEY);
        } else {
          this.memorySessionAuthMap = {};
        }
      } else {
        await browser.storage.local.remove(this.ENCRYPTED_AUTH_MAP_KEY);
      }
    } catch (error) {
      console.error('Failed to migrate auth storage:', error);
      throw new Error('Failed to migrate authentication storage');
    }
  }

  /**
   * Clear all chat history
   */
  static async clearAllChatHistory(): Promise<void> {
    return IndexedDBManager.clearAllChatHistory();
  }

  /**
   * Get enhanced storage usage information
   */
  static async getStorageUsage(): Promise<StorageUsage> {
    try {
      // Chrome extension storage API may have getBytesInUse
      const syncStorage = browser.storage.sync as typeof browser.storage.sync & StorageAreaWithUsage;
      const localStorage = browser.storage.local as typeof browser.storage.local & StorageAreaWithUsage;

      const [syncUsage, localUsage, chatStats] = await Promise.all([
        syncStorage.getBytesInUse ? syncStorage.getBytesInUse() : 0,
        localStorage.getBytesInUse ? localStorage.getBytesInUse() : 0,
        ChatHistoryManager.getStorageStats().catch(() => ({ conversations: 0, totalSize: 0 }))
      ]);

      return {
        settings: syncUsage || 0,
        authMap: localUsage || 0,
        chatHistory: 0, // Legacy
        conversations: chatStats.conversations || 0,
        totalSize: (syncUsage || 0) + (localUsage || 0) + (chatStats.totalSize || 0)
      };
    } catch (error) {
      console.error('Failed to get storage usage:', error);
      return { settings: 0, authMap: 0, chatHistory: 0, conversations: 0, totalSize: 0 };
    }
  }

  /**
   * Clear all extension data
   */
  static async clearAllData(): Promise<void> {
    try {
      const clearPromises = [
        browser.storage.sync.clear(),
        browser.storage.local.clear(),
        this.clearAllChatHistory(),
      ];

      // Only clear session storage if it's available
      if (browser.storage.session) {
        clearPromises.push(browser.storage.session.clear());
      }

      await Promise.all(clearPromises);
    } catch (error) {
      console.error('Failed to clear all data:', error);
      throw new Error('Failed to clear extension data');
    }
  }
}
