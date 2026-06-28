import React from 'react';
import { ClipboardList, Eye, EyeOff, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  estimateContextTokens,
  formatPageContextForPrompt,
  getContextPreviewLabel,
  hasReadableTabContext,
} from '@/shared/chat-context';
import type { TabContext } from '@/shared/types';

interface ContextInspectorProps {
  contexts: TabContext[];
  isAttached: boolean;
  isOpen: boolean;
  isRefreshing?: boolean;
  disabled?: boolean;
  onRefresh: () => void;
  onToggleAttached: (isAttached: boolean) => void;
  onToggleOpen: () => void;
}

const MAX_PREVIEW_LENGTH = 1800;

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  contexts,
  isAttached,
  isOpen,
  isRefreshing = false,
  disabled = false,
  onRefresh,
  onToggleAttached,
  onToggleOpen,
}) => {
  const hasContext = contexts.some(hasReadableTabContext);
  const preview = formatPageContextForPrompt(contexts);
  const tokenEstimate = estimateContextTokens(contexts);
  const previewText = preview.length > MAX_PREVIEW_LENGTH
    ? `${preview.slice(0, MAX_PREVIEW_LENGTH)}...`
    : preview;
  const label = getContextPreviewLabel(contexts);

  return (
    <section className={`context-inspector ${isAttached ? 'is-attached' : 'is-detached'}`}>
      <div className="context-inspector-row">
        <label className="context-attach-toggle">
          <input
            type="checkbox"
            checked={isAttached}
            disabled={disabled}
            onChange={(event) => onToggleAttached(event.target.checked)}
          />
          <span>{isAttached ? <Eye size={14} /> : <EyeOff size={14} />}</span>
          <strong>Attach context</strong>
        </label>
        <button
          type="button"
          className="context-inspector-action"
          onClick={onRefresh}
          disabled={disabled || isRefreshing}
        >
          <RefreshCw size={13} className={isRefreshing ? 'spin-icon' : undefined} />
          Refresh
        </button>
        <button
          type="button"
          className="context-inspector-action"
          onClick={onToggleOpen}
          disabled={!hasContext}
          aria-expanded={isOpen}
        >
          <ClipboardList size={13} />
          Review
        </button>
      </div>

      <div className="context-inspector-summary" aria-live="polite">
        <span>{isAttached ? label : 'Context detached'}</span>
        <small>{hasContext && isAttached ? `~${tokenEstimate} tokens` : 'Prompt only'}</small>
      </div>

      {isOpen && (
        <div className="context-inspector-preview">
          <div className="context-inspector-preview-head">
            <span>
              <ShieldCheck size={14} />
              Provider prompt context
            </span>
            <small>Redacted preview</small>
          </div>
          <pre>{previewText || 'No readable page context is available.'}</pre>
        </div>
      )}
    </section>
  );
};
