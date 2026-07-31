# Aid Privacy Policy

Last updated: July 31, 2026

Aid is a browser extension that adds an AI chat side panel to Chrome and Firefox. Aid does not operate a cloud service, does not run tracking or analytics, and does not sell user data.

## Data Aid May Handle

Aid may handle the following data when you use the extension:

- Chat messages, Agent tasks, selected text, image attachments, live current-page context, and pinned page snapshots sent to an AI provider or local endpoint.
- Browser tab metadata, such as current or pinned page titles and URLs, when page context is attached.
- Extension settings, conversation history, and provider configuration.
- AI provider API keys that you enter in the extension.

## How Data Is Used

Aid uses this data only to provide the extension's features:

- Sending prompts, attached page context, and attachments directly from your browser to the AI provider or local endpoint you select.
- Saving settings and optional conversation history in browser storage.
- Testing provider connections and listing available provider models.

Aid does not use your data for advertising, profiling, analytics, or resale.

## Storage

Aid stores settings and conversation history, including pinned page snapshots, locally in your browser. API keys use session-only browser extension storage by default. If you choose **Remember on this browser profile**, Aid stores credentials in extension-local browser storage. This option does not protect credentials from someone with access to your browser profile or device.

## Third-Party Providers

When you send a message through a cloud provider, your browser sends the message and any attached context directly to that provider, such as OpenAI, Anthropic, Google Gemini, or OpenRouter. Local providers such as Ollama and LM Studio receive requests only at an HTTP `localhost` or `127.0.0.1` endpoint. Those providers process data under their own terms and privacy policies.

## Page Context

Aid reads page context only after you accept the in-extension disclosure and use features that attach context from the active page, start an opt-in Agent task, or grant optional site access. You can explicitly pin up to three redacted page snapshots to a conversation; normal chat sends the live page first and then those snapshots while context attachment is enabled. Quick actions and Agent mode use only the live current page. During an Agent task, Aid sends redacted observations of the starting tab to the selected provider so the model can choose actions. Agent mode blocks links and sensitive controls, strips serialized field values, asks before consequential actions, and stops when the page navigates or the active tab changes. Redaction is best effort, so avoid attaching pages containing sensitive information you do not want processed by the selected provider.

## Data Sharing

Aid does not share data with the developer's servers because Aid does not operate any. Data is shared only with the provider or endpoint you choose when you send a request.

Aid's use and transfer of user data is limited to providing or improving the single-purpose, user-facing extension features described above. Aid does not transfer data for advertising, creditworthiness, lending, sale, or use by data brokers. Human access is not permitted except with the user's affirmative consent for support, for security or abuse investigation, to comply with law, or when the data is aggregated and anonymized for internal operations.

## Data Deletion

You can delete Aid data by clearing conversation history, clearing provider authentication data in the extension, or uninstalling the extension and removing its browser storage.

## Contact

For privacy questions, contact omershatz@gmail.com.
