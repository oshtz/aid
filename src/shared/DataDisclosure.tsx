import React, { useState } from 'react';

export type PageAccessChoice = 'all-sites' | 'per-site';

interface DataDisclosureProps {
  onAccept: (choice: PageAccessChoice) => Promise<boolean>;
  isSaving?: boolean;
}

export const DataDisclosure: React.FC<DataDisclosureProps> = ({ onAccept, isSaving = false }) => {
  const [choiceError, setChoiceError] = useState<string | null>(null);

  const chooseAccess = async (choice: PageAccessChoice) => {
    setChoiceError(null);
    try {
      const accepted = await onAccept(choice);
      if (!accepted) {
        setChoiceError(choice === 'all-sites'
          ? 'All-sites access was not granted. Try again or continue with per-site access.'
          : 'Aid could not save your choice. Please try again.');
      }
    } catch {
      setChoiceError('The browser could not complete that request. Please try again.');
    }
  };

  return (
    <section className="data-disclosure" aria-labelledby="data-disclosure-title">
      <div className="data-disclosure-mark" aria-hidden="true">A</div>
      <h1 id="data-disclosure-title">Choose how Aid can use page data</h1>
      <p>Before Aid reads a page or contacts a provider, enable the AI features you want to use.</p>
      <ul>
        <li>Page content and the page URL or title you choose to attach</li>
        <li>Messages, images, and Agent actions you submit</li>
        <li>Provider credentials and local host settings you enter</li>
      </ul>
      <p>
        Aid sends attached content and prompts directly from your browser to the provider you select.
        Local providers stay on the loopback address. Aid does not run an intermediary server, sell
        data, use it for advertising, or train models. Provider terms apply.
      </p>
      <div className="data-disclosure-access">
        <strong>Choose page access</strong>
        <span>
          Recommended: allow normal websites once. Permission alone does not send page content.
          While the Aid sidebar is open, it reads the current page locally to show context status
          and sends page content only when you attach context or use a current-page action.
        </span>
      </div>
      <div className="data-disclosure-actions">
        <button
          type="button"
          className="primary-action"
          onClick={() => void chooseAccess('all-sites')}
          disabled={isSaving}
        >
          {isSaving ? 'Waiting for browser' : 'Allow on all websites'}
        </button>
        <button
          type="button"
          className="secondary-action"
          onClick={() => void chooseAccess('per-site')}
          disabled={isSaving}
        >
          Ask for each website
        </button>
      </div>
      {choiceError && <p className="data-disclosure-error" role="alert">{choiceError}</p>}
      <p className="data-disclosure-note">
        Browser pages and protected sites remain unavailable. Session-only credentials are the default.
      </p>
    </section>
  );
};
