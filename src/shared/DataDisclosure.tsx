import React from 'react';

interface DataDisclosureProps {
  onAccept: () => void;
  isSaving?: boolean;
}

export const DataDisclosure: React.FC<DataDisclosureProps> = ({ onAccept, isSaving = false }) => (
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
    <p className="data-disclosure-note">Session-only credentials are the default.</p>
    <button type="button" className="primary-action" onClick={onAccept} disabled={isSaving}>
      {isSaving ? 'Saving' : 'Accept and continue'}
    </button>
  </section>
);
