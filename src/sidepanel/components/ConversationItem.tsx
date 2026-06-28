import React, { useState, useRef, useEffect } from 'react';
import { MoreHorizontal, Pencil, Pin, Tag, Trash2, X } from 'lucide-react';
import type { ChatConversation } from '@/shared/types';

interface ConversationItemProps {
  conversation: ChatConversation;
  isActive: boolean;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
  onPin: (isPinned: boolean) => void;
  onTag: (tags: string[]) => void;
  formatRelativeTime: (timestamp: number) => string;
}

export const ConversationItem: React.FC<ConversationItemProps> = ({
  conversation,
  isActive,
  isSelected,
  onSelect,
  onDelete,
  onRename,
  onPin,
  onTag,
  formatRelativeTime,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(conversation.title);
  const [showMenu, setShowMenu] = useState(false);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [tagInput, setTagInput] = useState('');

  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }

    return undefined;
  }, [showMenu]);

  useEffect(() => {
    if (isSelected && itemRef.current) {
      itemRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [isSelected]);

  const handleEditSubmit = () => {
    const trimmedTitle = editTitle.trim();
    if (trimmedTitle && trimmedTitle !== conversation.title) {
      onRename(trimmedTitle);
    }
    setIsEditing(false);
    setEditTitle(conversation.title);
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditTitle(conversation.title);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    }
  };

  const handleTagSubmit = () => {
    const newTags = tagInput
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);

    const updatedTags = [...new Set([...conversation.tags, ...newTags])];
    onTag(updatedTags);
    setTagInput('');
    setShowTagEditor(false);
  };

  const handleTagRemove = (tagToRemove: string) => {
    const updatedTags = conversation.tags.filter((tag) => tag !== tagToRemove);
    onTag(updatedTags);
  };

  const getProviderInitials = (provider: string): string => {
    switch (provider.toLowerCase()) {
      case 'openai':
        return 'OAI';
      case 'anthropic':
        return 'ANT';
      case 'gemini':
        return 'GEM';
      case 'openrouter':
        return 'OR';
      case 'ollama':
        return 'OLL';
      case 'lmstudio':
        return 'LM';
      default:
        return 'AI';
    }
  };

  const getPreviewText = (): string => {
    const lastUserMessage = conversation.messages
      .filter((m) => m.role === 'user')
      .pop();

    if (lastUserMessage) {
      return lastUserMessage.content.substring(0, 100);
    }

    return 'No messages';
  };

  const formatTokenUsage = (): string => {
    const usage = conversation.metadata.tokenUsage;
    if (usage.totalTokens > 1000) {
      return `${Math.round(usage.totalTokens / 1000)}k tokens`;
    }
    return `${usage.totalTokens} tokens`;
  };

  return (
    <div
      ref={itemRef}
      className={`conversation-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
      role="option"
      aria-selected={isActive}
      tabIndex={0}
    >
      {conversation.isPinned && (
        <div className="conversation-pin-indicator" title="Pinned conversation">
          <Pin size={13} />
        </div>
      )}

      <div className="conversation-item-content">
        <div className="conversation-item-header">
          {isEditing ? (
            <input
              ref={editInputRef}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={handleEditSubmit}
              onKeyDown={handleKeyDown}
              className="conversation-title-edit"
              maxLength={100}
            />
          ) : (
            <h4 className="conversation-title" title={conversation.title}>
              {conversation.title}
            </h4>
          )}

          <div className="conversation-actions">
            <button
              className="conversation-action-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              title="More actions"
              aria-label="More actions"
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
        </div>

        <div className="conversation-preview">
          {getPreviewText()}
        </div>

        <div className="conversation-metadata">
          <div className="conversation-provider">
            <span className="provider-icon" title={conversation.metadata.provider}>
              {getProviderInitials(conversation.metadata.provider)}
            </span>
            <span className="provider-model" title={conversation.metadata.model}>
              {conversation.metadata.model}
            </span>
          </div>

          <div className="conversation-stats">
            <span className="message-count" title="Message count">
              {conversation.metadata.messageCount} msgs
            </span>
            <span className="token-usage" title="Token usage">
              {formatTokenUsage()}
            </span>
            <span className="conversation-time" title={new Date(conversation.updatedAt).toLocaleString()}>
              {formatRelativeTime(conversation.updatedAt)}
            </span>
          </div>
        </div>

        {conversation.tags.length > 0 && (
          <div className="conversation-tags">
            {conversation.tags.map((tag) => (
              <span key={tag} className="conversation-tag">
                {tag}
                <button
                  className="tag-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleTagRemove(tag);
                  }}
                  title={`Remove tag: ${tag}`}
                  aria-label={`Remove tag ${tag}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {showTagEditor && (
          <div className="conversation-tag-editor">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleTagSubmit();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setShowTagEditor(false);
                  setTagInput('');
                }
              }}
              placeholder="Add tags, separated by commas"
              className="tag-input"
              autoFocus
            />
            <div className="tag-editor-actions">
              <button className="btn btn-sm btn-primary" onClick={handleTagSubmit}>
                Add
              </button>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => {
                  setShowTagEditor(false);
                  setTagInput('');
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {showMenu && (
        <div ref={menuRef} className="conversation-menu">
          <button
            className="conversation-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              setIsEditing(true);
              setShowMenu(false);
            }}
          >
            <Pencil size={14} /> Rename
          </button>

          <button
            className="conversation-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              onPin(!conversation.isPinned);
              setShowMenu(false);
            }}
          >
            <Pin size={14} /> {conversation.isPinned ? 'Unpin' : 'Pin'}
          </button>

          <button
            className="conversation-menu-item"
            onClick={(e) => {
              e.stopPropagation();
              setShowTagEditor(true);
              setShowMenu(false);
            }}
          >
            <Tag size={14} /> Add tags
          </button>

          <div className="conversation-menu-divider" />

          <button
            className="conversation-menu-item danger"
            onClick={(e) => {
              e.stopPropagation();
              if (confirm('Are you sure you want to delete this conversation?')) {
                onDelete();
              }
              setShowMenu(false);
            }}
          >
            <Trash2 size={14} /> Delete
          </button>
        </div>
      )}
    </div>
  );
};
