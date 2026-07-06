## <img alt="Aid logo" src="./icons/icon-32.png" width="32" height="32"> Aid - AI Side Panel for Chrome and Firefox

Aid is a browser extension that docks an AI chat side panel next to the current page. It can attach page context, selected text, visible UI state, forms, tables, lists, media labels, same-origin frames, open shadow DOM, and image attachments to provider requests.

<p align="center">
  <a href="https://youtu.be/Hqj6oXya_dA">
    <img alt="Watch the Aid demo video" src="https://i.ytimg.com/vi/Hqj6oXya_dA/maxresdefault.jpg" width="720">
  </a>
</p>

## Supported Browsers

- Chrome: available on [Chrome Web Store](https://chromewebstore.google.com/detail/aid/fellkedaphlkgjnllooocaokjbjnhffk)
- Firefox: available on [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/aid/)
- Release packages: https://github.com/oshtz/aid/releases/tag/v0.1.0

## Features

- Side panel chat for Chrome and Firefox.
- Providers: OpenAI, Anthropic Claude, Google Gemini, OpenRouter, Ollama, and LM Studio.
- Current-page context with redaction for common secrets, tokens, passwords, and private URL patterns.
- Context inspector with attach/detach control, token estimate, and redacted provider prompt preview.
- Selected-text quick actions from the page and the side panel.
- Image attachments for vision-capable provider models.
- Streaming stop and regenerate controls.
- Conversation history with search and filtering.
- Theme and accent color settings.
- Session-only API key storage by default, with optional encrypted persistent local storage.

## Installation

### Chrome

Install Aid from the [Chrome Web Store](https://chromewebstore.google.com/detail/aid/fellkedaphlkgjnllooocaokjbjnhffk).

For a temporary local build:

1. Download `aid-chrome-<version>.zip` from the latest release.
2. Extract the zip.
3. Open `chrome://extensions/`.
4. Enable Developer mode.
5. Choose "Load unpacked" and select the extracted folder.

### Firefox

Install Aid from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/aid/).

For a temporary local build:

1. Download `aid-firefox-<version>.zip` from the latest release.
2. Open `about:debugging#/runtime/this-firefox`.
3. Choose "Load Temporary Add-on".
4. Select the downloaded zip, or extract it and select `manifest.json`.

## Usage

1. Open Aid from the browser toolbar or sidebar.
2. Configure at least one provider in the options page.
3. Test the connection and choose a model.
4. Ask about the current page, review the attached context, run a selected-text quick action, or attach an image for a vision-capable model.

## Provider Setup

- Cloud providers require an API key saved in the extension settings.
- Ollama defaults to `http://localhost:11434/v1`.
- LM Studio defaults to `http://localhost:1234/v1`.
- Local provider hosts require browser host access when configured.

## Privacy

- Full privacy policy: [PRIVACY.md](PRIVACY.md)
- Aid does not operate a cloud service.
- Requests go directly from your browser to the selected AI provider or local endpoint.
- API keys use session-only browser extension storage by default.
- Persistent API key storage encrypts keys before writing them to extension local storage, but it is not a substitute for full-device security.
- Page context is collected only from the active page or optional site access; Aid does not auto-run a content script on every website at install time.
- No tracking or analytics.

## Browser Notes

| Browser | Minimum version | UI API |
| --- | --- | --- |
| Chrome | 116 | `sidePanel` |
| Firefox | 142 | `sidebar_action` |

Firefox for Android is not supported by the Firefox sidebar build.

## Development

```bash
npm install
npm run dev
```

Useful checks:

```bash
npm run lint
npm run type-check
npm test
npm run test:e2e
npm run release:check
```

Build release packages:

```bash
npm run package
```

Release artifacts:

```text
artifacts/aid-chrome-<version>.zip
artifacts/aid-firefox-<version>.zip
```

Do not load a Chrome build into Firefox. The Chrome build uses `background.service_worker`; the Firefox build uses `background.scripts` and a sidebar-compatible entry point.

## License

[MIT License](LICENSE)
