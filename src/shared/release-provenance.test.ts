import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

const releaseVersionScript = resolve(process.cwd(), 'tools/assert-release-version.js');
const artifactCheckScript = resolve(process.cwd(), 'tools/check-package-artifacts.js');

const run = (command: string, args: string[], cwd: string, env = process.env): boolean => {
  try {
    execFileSync(command, args, { cwd, env, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
};

const writeVersionFiles = (cwd: string, version: string) => {
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(cwd, 'package-lock.json'), JSON.stringify({ packages: { '': { version } } }));
  writeFileSync(join(cwd, 'manifest.json'), JSON.stringify({ version }));
  writeFileSync(join(cwd, 'manifest-firefox.json'), JSON.stringify({ version }));
};

describe('release provenance', () => {
  it('uses the checked-out Git tag instead of a spoofable environment value', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'aid-release-tag-'));
    try {
      writeVersionFiles(cwd, '0.2.0');
      execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd });
      execFileSync('git', ['config', 'user.name', 'Aid Test'], { cwd });
      execFileSync('git', ['add', '.'], { cwd });
      execFileSync('git', ['commit', '-m', 'fixture'], { cwd, stdio: 'ignore' });

      expect(run(process.execPath, [releaseVersionScript, '--require-tag'], cwd, {
        ...process.env,
        RELEASE_TAG: 'v0.2.0',
      })).toBe(false);

      execFileSync('git', ['tag', 'v0.2.0'], { cwd });
      expect(run(process.execPath, [releaseVersionScript, '--require-tag'], cwd, {
        ...process.env,
        RELEASE_TAG: 'v9.9.9',
      })).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 15_000);

  it('opens release packages and verifies manifests and checksums', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'aid-release-artifacts-'));
    const version = '0.2.0';
    const writePackage = async (target: 'chrome' | 'firefox', manifest: object) => {
      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify(manifest));
      writeFileSync(
        join(cwd, `artifacts/aid-${target}-${version}.zip`),
        await zip.generateAsync({ type: 'nodebuffer' })
      );
    };
    const writeChecksums = () => {
      const files = ['aid-chrome-0.2.0.zip', 'aid-firefox-0.2.0.zip', 'aid-source-0.2.0.zip'];
      writeFileSync(
        join(cwd, 'artifacts/SHA256SUMS-0.2.0.txt'),
        `${files
          .map((file) => {
            const path = join(cwd, 'artifacts', file);
            return `${createHash('sha256').update(readFileSync(path)).digest('hex')}  ${basename(path)}`;
          })
          .join('\n')}\n`
      );
    };

    try {
      mkdirSync(join(cwd, 'artifacts'));
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version }));
      await writePackage('chrome', { version, background: { service_worker: 'background/service-worker.js' } });
      await writePackage('firefox', {
        version,
        browser_specific_settings: { gecko: { id: 'aid-test' } },
        background: { scripts: ['background/service-worker.js'] },
      });
      const source = new JSZip();
      source.file('package.json', JSON.stringify({ version }));
      source.file('AMO_SOURCE_README.md', '# Source build');
      writeFileSync(
        join(cwd, `artifacts/aid-source-${version}.zip`),
        await source.generateAsync({ type: 'nodebuffer' })
      );
      writeChecksums();

      expect(run(process.execPath, [artifactCheckScript], cwd)).toBe(true);

      await writePackage('chrome', {
        version,
        browser_specific_settings: { gecko: { id: 'wrong-target' } },
        background: { scripts: ['background/service-worker.js'] },
      });
      writeChecksums();
      expect(run(process.execPath, [artifactCheckScript], cwd)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('checks out immutable release sources and wires every release artifact', () => {
    const storeWorkflow = readFileSync(
      resolve(process.cwd(), '.github/workflows/publish-stores.yml'),
      'utf8'
    );
    const releaseWorkflow = readFileSync(
      resolve(process.cwd(), '.github/workflows/extension-artifacts.yml'),
      'utf8'
    );
    const packager = readFileSync(resolve(process.cwd(), 'tools/package-extension.js'), 'utf8');
    const releasePackager = readFileSync(
      resolve(process.cwd(), 'tools/package-release-artifacts.js'),
      'utf8'
    );

    expect(storeWorkflow).toContain('ref: ${{ inputs.release_tag || github.ref }}');
    expect(storeWorkflow).toContain('fetch-depth: 0');
    expect(storeWorkflow).toContain('--upload-source-code "$SOURCE_CODE"');
    expect(releaseWorkflow).toContain('gh release create "$GITHUB_REF_NAME"');
    expect(packager).toContain("git', ['status', '--porcelain', '--untracked-files=all']");
    expect(releasePackager).toContain("git', ['archive'");
  });
});
