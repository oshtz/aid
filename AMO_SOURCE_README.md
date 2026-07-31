# Aid 0.2.0 source build for AMO reviewers

This source archive corresponds to `aid-firefox-0.2.0.zip`.

## Environment

- Node.js 20.19.0 or newer
- npm with lockfile v3 support
- No credentials, provider calls, proprietary tools, or remote build services are required
- Locally verified on Windows 11 x64 with Node.js 22.22.3 and npm 10.9.8

All build dependencies are open-source packages declared in `package.json` and pinned by `package-lock.json`.

## Build

From the extracted source directory:

```bash
npm ci --ignore-scripts
npm run build:firefox
npm run lint:firefox
```

The unpacked Firefox extension is written to `dist/`. Its paths and file contents match the submitted add-on; ZIP compression metadata may differ when the package is rebuilt.

`npm run package:firefox` is the maintainer packaging command and intentionally requires a clean Git checkout. It is not required for source review.
