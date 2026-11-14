import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve('.');

describe('Codex repository marketplace', () => {
  it('fits tracked files inside the reported Windows marketplace checkout path', () => {
    const prefix =
      'C:\\Users\\BENYM\\.codex\\.tmp\\marketplaces\\.staging\\marketplace-windows-pWtvYi\\checkout\\';
    const files = execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      },
    ).split('\0');
    const tooLong = files.filter(
      (file) => existsSync(path.join(root, file)) && prefix.length + file.length > 259,
    );
    expect(tooLong).toEqual([]);
  });

  it('discovers the published plugin from the repository root without sparse paths', () => {
    const marketplace = JSON.parse(
      readFileSync(path.join(root, '.agents/plugins/marketplace.json'), 'utf8'),
    );
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(marketplace.name).toBe('comet-market');
    expect(marketplace.plugins).toEqual([
      {
        name: 'comet',
        source: {
          source: 'npm',
          package: '@rpamis/comet-codex-plugin',
          version: pkg.version,
          registry: 'https://registry.npmjs.org',
        },
        policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
        category: 'Developer Tools',
      },
    ]);
    for (const [file, status] of [
      ['.agents/plugins/marketplace.json', 1],
      ['.agents/skills/comet/SKILL.md', 0],
    ] as const) {
      const ignored = spawnSync('git', ['check-ignore', '--no-index', '--quiet', file], {
        cwd: root,
        windowsHide: true,
      });
      expect(ignored.status).toBe(status);
    }
  });
});
