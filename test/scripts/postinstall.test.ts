import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function installedPackage() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-postinstall-'));
  roots.push(root);
  await fs.mkdir(path.join(root, 'scripts', 'install'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const script = path.join(root, 'scripts', 'install', 'postinstall.js');
  await fs.copyFile('scripts/install/postinstall.js', script);
  return {
    root,
    run: (overrides: NodeJS.ProcessEnv = {}) =>
      execFileSync(process.execPath, [script], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: root,
          USERPROFILE: root,
          CI: '',
          COMET_NO_HINTS: '',
          ...overrides,
        },
      }),
  };
}

describe('installed package postinstall hint', () => {
  it('finds the package-root dist directory', async () => {
    const fixture = await installedPackage();
    await fs.mkdir(path.join(fixture.root, 'dist'));
    expect(fixture.run()).toContain('comet init');
  });

  it('does not mistake scripts/dist for a built package', async () => {
    const fixture = await installedPackage();
    await fs.mkdir(path.join(fixture.root, 'scripts', 'dist'));
    expect(fixture.run()).toBe('');
  });

  it.each([{ CI: 'true' }, { CI: '1' }, { COMET_NO_HINTS: '1' }])(
    'respects the hint opt-out %j',
    async (overrides) => {
      const fixture = await installedPackage();
      await fs.mkdir(path.join(fixture.root, 'dist'));
      expect(fixture.run(overrides)).toBe('');
    },
  );

  it('succeeds silently when dist is absent', async () => {
    const fixture = await installedPackage();
    expect(fixture.run()).toBe('');
  });
});
