import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const validateBuildScript = resolve(process.cwd(), 'validate-build.js');

const validChromeManifest = () => ({
  manifest_version: 3,
  host_permissions: [],
  optional_host_permissions: ['http://*/*', 'https://*/*'],
  background: {
    service_worker: 'background/service-worker.js',
    type: 'module',
  },
  content_security_policy: {
    extension_pages: "default-src 'self'; connect-src 'self' https://api.openai.com http://localhost:* http://127.0.0.1:*; style-src 'self'; object-src 'none';",
  },
  web_accessible_resources: [],
});

const createBuildFixture = (manifest: object): string => {
  const cwd = mkdtempSync(join(tmpdir(), 'aid-build-validation-'));
  const dist = join(cwd, 'dist');

  for (const directory of ['background', 'content', 'sidepanel', 'options', 'icons']) {
    mkdirSync(join(dist, directory), { recursive: true });
  }

  writeFileSync(join(dist, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dist, 'background/service-worker.js'), 'console.log("background");\n');
  writeFileSync(join(dist, 'content/content-script.js'), 'console.log("content");\n');
  writeFileSync(join(dist, 'sidepanel/index.html'), '<!doctype html>\n');
  writeFileSync(join(dist, 'options/index.html'), '<!doctype html>\n');
  writeFileSync(join(dist, 'icons/icon-16.png'), '');

  return cwd;
};

const runValidateBuild = (cwd: string): { ok: boolean; stderr: string } => {
  try {
    execFileSync(process.execPath, [validateBuildScript], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { ok: true, stderr: '' };
  } catch (error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    return {
      ok: false,
      stderr: typeof stderr === 'string'
        ? stderr
        : Buffer.isBuffer(stderr)
          ? stderr.toString('utf8')
          : String(error),
    };
  }
};

describe('validate-build', () => {
  it('accepts a Chrome service worker manifest without broad provider CSP', () => {
    const cwd = createBuildFixture(validChromeManifest());
    try {
      expect(runValidateBuild(cwd).ok).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects Firefox background scripts in Chrome builds', () => {
    const manifest = {
      ...validChromeManifest(),
      background: {
        service_worker: 'background/service-worker.js',
        scripts: ['background/service-worker.js'],
        type: 'module',
      },
    };
    const cwd = createBuildFixture(manifest);
    try {
      const result = runValidateBuild(cwd);

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('Chrome builds must use background.service_worker');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects arbitrary provider connection CSP sources', () => {
    const manifest = {
      ...validChromeManifest(),
      content_security_policy: {
        extension_pages: "default-src 'self'; connect-src 'self' https://*:*; object-src 'none';",
      },
    };
    const cwd = createBuildFixture(manifest);
    try {
      const result = runValidateBuild(cwd);

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('Manifest CSP must not allow arbitrary provider connections');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
