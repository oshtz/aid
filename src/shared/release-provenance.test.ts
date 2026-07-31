import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
  });

  it('opens both packages and verifies their browser-specific manifests', async () => {
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

    try {
      mkdirSync(join(cwd, 'artifacts'));
      writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version }));
      await writePackage('chrome', { version, background: { service_worker: 'background/service-worker.js' } });
      await writePackage('firefox', {
        version,
        browser_specific_settings: { gecko: { id: 'aid-test' } },
        background: { scripts: ['background/service-worker.js'] },
      });

      expect(run(process.execPath, [artifactCheckScript], cwd)).toBe(true);

      await writePackage('chrome', {
        version,
        browser_specific_settings: { gecko: { id: 'wrong-target' } },
        background: { scripts: ['background/service-worker.js'] },
      });
      expect(run(process.execPath, [artifactCheckScript], cwd)).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('checks out the requested release tag and rejects dirty package sources', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/publish-stores.yml'), 'utf8');
    const packager = readFileSync(resolve(process.cwd(), 'tools/package-extension.js'), 'utf8');

    expect(workflow).toContain('ref: ${{ inputs.release_tag || github.ref }}');
    expect(workflow).toContain('fetch-depth: 0');
    expect(packager).toContain("git', ['status', '--porcelain', '--untracked-files=all']");
  });
});
