# Aid Store Submission Preparation

This file prepares future store work. It does not record a submission, approval, or live dashboard change.

## Chrome Web Store privacy answers

Use the following disclosures for the next submission:

- Authentication information: provider API keys or tokens entered by the user.
- Personal communications: chat messages, Agent tasks, selected text, and image attachments submitted by the user.
- Browsing activity: current and explicitly pinned page URLs and titles when page context is enabled.
- Website content: readable text, visible UI state, forms, tables, lists, media labels, same-origin frame content, open shadow-DOM content, and pinned page snapshots attached by the user.

Purpose: provide Aid's user-facing AI chat, page-context, provider setup, and opt-in same-tab Agent features.

Data handling copy:

> Aid processes live or pinned page content, browsing activity, user messages, attachments, Agent tasks, and provider authentication information only when needed for features the user invokes. Requests go directly from the browser to the AI provider selected by the user, or to an HTTP loopback endpoint for Ollama or LM Studio. Aid operates no intermediary server, does not sell data, does not use data for advertising or credit decisions, and does not use data to train models. Provider terms apply. Session-only credential storage is the default.

Limited Use copy:

> Aid's use and transfer of user data is limited to providing or improving its single-purpose, user-facing extension features. Aid does not transfer data for personalized advertising, sale to data brokers, creditworthiness or lending, or unrelated purposes. Human access is prohibited except with the user's affirmative consent for support, for security or abuse investigation, to comply with applicable law, or when data is aggregated and anonymized for internal operations.

Prominent disclosure copy: use the exact disclosure rendered by `src/shared/DataDisclosure.tsx` before page access or provider contact.

## Store listing copy

Short description:

> Chat with the current page using your choice of cloud or local AI provider, with inspectable context and an approval-based Agent Beta.

Privacy summary:

> Aid is local-first and bring-your-own-provider. It has no analytics or developer-operated backend. You choose when live or pinned page context is attached and which provider receives it. API keys are session-only by default.

Page-access note:

> Users can allow normal websites once or approve them individually. Permission alone does not send page content. While the Aid sidebar is open, it reads the current page locally to show context status and sends content to the selected provider only when the user attaches context or invokes a current-page action.

Agent Beta note:

> Agent Beta controls one tab and can follow same-tab HTTP or HTTPS links. Same-site links can proceed automatically; cross-site and consequential actions require approval. Sensitive fields, downloads, new tabs, and tab switching are blocked. Redaction is best effort.

## Manual submission checklist

- [ ] Confirm package, Chrome manifest, Firefox manifest, and intended tag use the same version.
- [ ] Run `npm run release:check` from a clean source commit.
- [ ] Inspect both ZIP manifests and verify browser target, permissions, CSP, and version.
- [ ] Create `artifacts/aid-source-<version>.zip` from the exact clean release commit with `git archive --format=zip --output=artifacts/aid-source-<version>.zip HEAD`.
- [ ] Extract the source archive, run the commands in `AMO_SOURCE_README.md`, and confirm the resulting `dist/` paths and file contents match the Firefox ZIP.
- [ ] Generate `artifacts/SHA256SUMS-<version>.txt` for the Chrome, Firefox, and source ZIPs after their final bytes are produced.
- [ ] Update the Chrome privacy dashboard with every category and the copy above before upload.
- [ ] Confirm the public privacy-policy URL contains the same wording before submission.
- [ ] Upload the Chrome ZIP and complete Chrome review questions.
- [ ] Upload the Firefox ZIP and matching source ZIP, and confirm AMO data-collection declarations match the manifest.
- [ ] Install the packaged Chrome build and prove disclosure, provider setup, live and pinned context, pin restoration and removal, chat, cancellation, same-tab Agent navigation, cross-site approval, unexpected-navigation stop, and upgrade from the current public version.
- [ ] Manually install the packaged Firefox build in native Firefox, open the real sidebar, prove both the recommended all-websites grant and per-site fallback from direct clicks, and confirm readable page context. The automated smoke opens the sidebar code in a tab and is not evidence of this native permission flow.
- [ ] Record store review results and public versions only after the stores report them.

## Proof not yet claimed

No Chrome or AMO dashboard has been changed by this local roadmap. Native Firefox sidebar permission behavior still requires the manual packaged proof above. No public repository, tag, release, workflow, or store operation is implied by this file.
