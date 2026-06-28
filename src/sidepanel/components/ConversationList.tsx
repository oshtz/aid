import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { ChatConversation, ChatHistoryGroup, ChatHistoryFilter } from '@/shared/types';
import { ConversationItem } from './ConversationItem';

interface ConversationListProps {
  conversations: ChatConversation[];
  conversationGroups: ChatHistoryGroup[];
  currentConversationId?: string | undefined;
  isLoading: boolean;
  onConversationSelect: (conversation: ChatConversation) => void;
  onConversationDelete: (conversationId: string) => void;
  onConversationRename: (conversationId: string, newTitle: string) => void;
  onConversationPin: (conversationId: string, isPinned: boolean) => void;
  onConversationTag: (conversationId: string, tags: string[]) => void;
  filter: ChatHistoryFilter;
  onLoadMore: () => void;
}

export const ConversationList: React.FC<ConversationListProps> = ({
  conversations,
  conversationGroups,
  currentConversationId,
  isLoading,
  onConversationSelect,
  onConversationDelete,
  onConversationRename,
  onConversationPin,
  onConversationTag,
  filter,
  onLoadMore
}) => {
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const listRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Virtual scrolling setup
  useEffect(() => {
    const handleScroll = () => {
      if (!listRef.current) return;

      const { scrollTop, clientHeight } = listRef.current;
      const itemHeight = 80; // Approximate height per conversation item
      const buffer = 10; // Extra items to render for smooth scrolling

      const start = Math.max(0, Math.floor(scrollTop / itemHeight) - buffer);
      const end = Math.min(
        conversations.length,
        Math.ceil((scrollTop + clientHeight) / itemHeight) + buffer
      );

      setVisibleRange({ start, end });
    };

    const listElement = listRef.current;
    if (listElement) {
      listElement.addEventListener('scroll', handleScroll);
      handleScroll(); // Initial calculation

      return () => listElement.removeEventListener('scroll', handleScroll);
    }

    return undefined;
  }, [conversations.length]);

  // Intersection observer for load more
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isLoading) {
          onLoadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [isLoading, onLoadMore]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!listRef.current?.contains(document.activeElement)) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev =>
            Math.min(conversations.length - 1, prev + 1)
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => Math.max(0, prev - 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (selectedIndex >= 0 && conversations[selectedIndex]) {
            onConversationSelect(conversations[selectedIndex]);
          }
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [conversations, selectedIndex, onConversationSelect]);

  const formatRelativeTime = useCallback((timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const weeks = Math.floor(diff / (1000 * 60 * 60 * 24 * 7));
    const months = Math.floor(diff / (1000 * 60 * 60 * 24 * 30));

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;
    if (weeks === 1) return 'Last week';
    if (weeks < 4) return `${weeks}w ago`;
    if (months === 1) return 'Last month';
    if (months < 12) return `${months}mo ago`;

    return new Date(timestamp).toLocaleDateString();
  }, []);

  const renderGroupedConversations = () => {
    if (conversationGroups.length === 0) {
      return renderEmptyState();
    }

    return conversationGroups.map((group) => (
      <div key={group.period} className="conversation-group">
        <div className="conversation-group-header">
          <h3 className="conversation-group-title">{group.label}</h3>
          <span className="conversation-group-count">
            {group.count} {group.count === 1 ? 'conversation' : 'conversations'}
          </span>
        </div>
        <div className="conversation-group-items">
          {group.conversations.map((conversation, index) => (
            <ConversationItem
              key={conversation.id}
              conversation={conversation}
              isActive={conversation.id === currentConversationId}
              isSelected={selectedIndex === index}
              onSelect={() => onConversationSelect(conversation)}
              onDelete={() => onConversationDelete(conversation.id)}
              onRename={(newTitle: string) => onConversationRename(conversation.id, newTitle)}
              onPin={(isPinned: boolean) => onConversationPin(conversation.id, isPinned)}
              onTag={(tags: string[]) => onConversationTag(conversation.id, tags)}
              formatRelativeTime={formatRelativeTime}
            />
          ))}
        </div>
      </div>
    ));
  };

  const renderFlatConversations = () => {
    if (conversations.length === 0) {
      return renderEmptyState();
    }

    const visibleConversations = conversations.slice(visibleRange.start, visibleRange.end);
    const itemHeight = 80;
    const totalHeight = conversations.length * itemHeight;
    const offsetY = visibleRange.start * itemHeight;

    return (
      <div className="conversation-list-virtual">
        <div style={{ height: totalHeight, position: 'relative' }}>
          <div style={{ transform: `translateY(${offsetY}px)` }}>
            {visibleConversations.map((conversation, index) => {
              const actualIndex = visibleRange.start + index;
              return (
                <ConversationItem
                  key={conversation.id}
                  conversation={conversation}
                  isActive={conversation.id === currentConversationId}
                  isSelected={selectedIndex === actualIndex}
                  onSelect={() => onConversationSelect(conversation)}
                  onDelete={() => onConversationDelete(conversation.id)}
                  onRename={(newTitle: string) => onConversationRename(conversation.id, newTitle)}
                  onPin={(isPinned: boolean) => onConversationPin(conversation.id, isPinned)}
                  onTag={(tags: string[]) => onConversationTag(conversation.id, tags)}
                  formatRelativeTime={formatRelativeTime}
                />
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderEmptyState = () => {
    if (isLoading) {
      return (
        <div className="conversation-list-loading">
          <div className="loading-spinner">
            <div className="spinner-border" role="status">
              <span className="visually-hidden">Loading conversations...</span>
            </div>
          </div>
          <div className="loading-text">Loading conversations...</div>
        </div>
      );
    }

    const hasActiveFilters = filter.query || filter.provider || filter.model ||
                            filter.tags?.length || filter.isPinned !== undefined;

    return (
      <div className="conversation-list-empty">
        <div className="empty-state-icon">
          {hasActiveFilters ? '🔍' : '💬'}
        </div>
        <div className="empty-state-title">
          {hasActiveFilters ? 'No conversations found' : 'No conversations yet'}
        </div>
        <div className="empty-state-subtitle">
          {hasActiveFilters
            ? 'Try adjusting your search filters'
            : 'Start a conversation to see your chat history here'
          }
        </div>
      </div>
    );
  };

  const useGroupedView = !filter.query && !filter.provider && !filter.model &&
                        !filter.tags?.length && filter.isPinned === undefined;

  return (
    <div
      className="conversation-list"
      ref={listRef}
      role="listbox"
      aria-label="Conversation history"
      tabIndex={0}
    >
      {isLoading && conversations.length === 0 ? (
        renderEmptyState()
      ) : useGroupedView ? (
        renderGroupedConversations()
      ) : (
        renderFlatConversations()
      )}

      {/* Load more trigger */}
      {conversations.length > 0 && !isLoading && (
        <div
          ref={loadMoreRef}
          className="conversation-list-load-more"
          style={{ height: '20px', margin: '10px 0' }}
        />
      )}

      {/* Loading indicator for pagination */}
      {isLoading && conversations.length > 0 && (
        <div className="conversation-list-loading-more">
          <div className="spinner-border spinner-border-sm" role="status">
            <span className="visually-hidden">Loading more...</span>
          </div>
          <span className="loading-more-text">Loading more conversations...</span>
        </div>
      )}
    </div>
  );
};
