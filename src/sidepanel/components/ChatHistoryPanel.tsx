import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, Download, Plus, Settings, Trash2, X } from 'lucide-react';
import { ChatHistoryManager } from '@/shared/storage';
import type { ChatConversation, ChatHistoryFilter, ChatHistoryGroup } from '@/shared/types';
import { ConversationList } from './ConversationList';
import { SearchAndFilter } from './SearchAndFilter';

type FilterUpdate = {
  [K in keyof ChatHistoryFilter]?: ChatHistoryFilter[K] | undefined;
};

interface ChatHistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onConversationSelect: (conversation: ChatConversation) => void;
  currentConversationId?: string | undefined;
  onNewChat: () => void;
}

export const ChatHistoryPanel: React.FC<ChatHistoryPanelProps> = ({
  isOpen,
  onClose,
  onConversationSelect,
  currentConversationId,
  onNewChat,
}) => {
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [conversationGroups, setConversationGroups] = useState<ChatHistoryGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ChatHistoryFilter>({
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  });
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'n':
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            onNewChat();
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onNewChat]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (backdropRef.current && e.target === backdropRef.current) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }

    return undefined;
  }, [isOpen, onClose]);

  const loadConversations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const [allConversations, groups] = await Promise.all([
        ChatHistoryManager.getAllConversations(filter),
        ChatHistoryManager.getConversationGroups(filter),
      ]);

      setConversations(allConversations);
      setConversationGroups(groups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
      console.error('Failed to load conversations:', err);
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  const loadAvailableTags = useCallback(async () => {
    try {
      const allConversations = await ChatHistoryManager.getAllConversations();
      const tags = new Set<string>();

      allConversations.forEach((conv) => {
        conv.tags?.forEach((tag) => tags.add(tag));
      });

      setAvailableTags(Array.from(tags).sort());
    } catch (err) {
      console.error('Failed to load available tags:', err);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadConversations();
      loadAvailableTags();
    }
  }, [isOpen, loadAvailableTags, loadConversations]);

  const handleFilterChange = useCallback((newFilter: FilterUpdate) => {
    setFilter((prev) => {
      const merged = { ...prev, ...newFilter };
      const entries = Object.entries(merged).filter(([, value]) => value !== undefined);
      return Object.fromEntries(entries) as ChatHistoryFilter;
    });
  }, []);

  const handleConversationDelete = useCallback(async (conversationId: string) => {
    try {
      await ChatHistoryManager.deleteConversation(conversationId);
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete conversation');
      console.error('Failed to delete conversation:', err);
    }
  }, [loadConversations]);

  const handleConversationRename = useCallback(async (conversationId: string, newTitle: string) => {
    try {
      await ChatHistoryManager.updateConversation(conversationId, {
        title: newTitle,
        userTitle: newTitle,
        autoTitle: false,
      });
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename conversation');
      console.error('Failed to rename conversation:', err);
    }
  }, [loadConversations]);

  const handleConversationPin = useCallback(async (conversationId: string, isPinned: boolean) => {
    try {
      await ChatHistoryManager.updateConversation(conversationId, { isPinned });
      await loadConversations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update conversation');
      console.error('Failed to update conversation:', err);
    }
  }, [loadConversations]);

  const handleConversationTag = useCallback(async (conversationId: string, tags: string[]) => {
    try {
      await ChatHistoryManager.updateConversation(conversationId, { tags });
      await loadConversations();
      await loadAvailableTags();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update conversation tags');
      console.error('Failed to update conversation tags:', err);
    }
  }, [loadConversations, loadAvailableTags]);

  const clearFilters = useCallback(() => {
    setFilter({
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });
  }, []);

  const exportConversations = useCallback(async () => {
    try {
      const exportData = await ChatHistoryManager.exportHistory(filter);
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      link.href = url;
      link.download = `aid-history-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export conversations');
      console.error('Failed to export conversations:', err);
    }
  }, [filter]);

  const clearAllConversations = useCallback(async () => {
    if (!window.confirm('Delete all saved conversations?')) {
      return;
    }

    try {
      const allConversations = await ChatHistoryManager.getAllConversations();
      await Promise.all(allConversations.map((conversation) => (
        ChatHistoryManager.deleteConversation(conversation.id)
      )));
      await loadConversations();
      await loadAvailableTags();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete conversations');
      console.error('Failed to delete conversations:', err);
    }
  }, [loadAvailableTags, loadConversations]);

  if (!isOpen) return null;

  return (
    <div className="chat-history-overlay" ref={backdropRef}>
      <div
        className={`chat-history-panel ${isOpen ? 'open' : ''}`}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-history-title"
      >
        <div className="chat-history-header">
          <div className="chat-history-header-content">
            <h2 id="chat-history-title" className="chat-history-title">
              Chat History
            </h2>
            <div className="chat-history-header-actions">
              <button
                className="icon-button"
                onClick={onNewChat}
                title="New Chat"
                aria-label="Start new chat"
              >
                <Plus size={16} />
              </button>
              <button
                className="icon-button"
                onClick={() => setShowSettings(!showSettings)}
                title="Settings"
                aria-label="Chat history settings"
              >
                <Settings size={16} />
              </button>
              <button
                className="icon-button"
                onClick={onClose}
                title="Close"
                aria-label="Close chat history"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="chat-history-search">
          <SearchAndFilter
            filter={filter}
            onFilterChange={handleFilterChange}
            availableTags={availableTags}
            onClearFilters={clearFilters}
            isLoading={isLoading}
          />
        </div>

        <div className="chat-history-content">
          {error && (
            <div className="chat-history-error">
              <div className="error-icon"><AlertTriangle size={18} /></div>
              <div className="error-message">{error}</div>
              <button className="btn btn-sm btn-ghost" onClick={loadConversations}>
                Retry
              </button>
            </div>
          )}

          {!error && (
            <ConversationList
              conversations={conversations}
              conversationGroups={conversationGroups}
              currentConversationId={currentConversationId}
              isLoading={isLoading}
              onConversationSelect={onConversationSelect}
              onConversationDelete={handleConversationDelete}
              onConversationRename={handleConversationRename}
              onConversationPin={handleConversationPin}
              onConversationTag={handleConversationTag}
              filter={filter}
              onLoadMore={() => {
                setFilter({
                  ...filter,
                  limit: (filter.limit || 50) + 50,
                });
              }}
            />
          )}
        </div>

        {showSettings && (
          <div className="chat-history-settings">
            <div className="settings-header">
              <h3>History Settings</h3>
              <button
                className="icon-button"
                onClick={() => setShowSettings(false)}
                aria-label="Close settings"
              >
                <X size={16} />
              </button>
            </div>
            <div className="settings-content">
              <div className="setting-item">
                <label>Export visible history</label>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => void exportConversations()}
                >
                  <Download size={14} />
                  Export JSON
                </button>
              </div>
              <div className="setting-item">
                <label>Delete all saved conversations</label>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => void clearAllConversations()}
                >
                  <Trash2 size={14} />
                  Delete all
                </button>
              </div>
              <div className="setting-item">
                <label>Auto-cleanup old conversations</label>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    try {
                      const cleaned = await ChatHistoryManager.cleanupOldConversations(30);
                      alert(`Cleaned up ${cleaned} old conversations`);
                      await loadConversations();
                    } catch {
                      alert('Failed to cleanup conversations');
                    }
                  }}
                >
                  Cleanup 30+ days
                </button>
              </div>
              <div className="setting-item">
                <label>Optimize storage</label>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={async () => {
                    try {
                      const result = await ChatHistoryManager.optimizeStorage();
                      alert(`Storage optimized. Cleaned ${result.cleaned} items.`);
                      await loadConversations();
                    } catch {
                      alert('Failed to optimize storage');
                    }
                  }}
                >
                  Optimize
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
