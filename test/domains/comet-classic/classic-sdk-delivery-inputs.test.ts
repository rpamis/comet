import { execFileSync } from 'node:child_process';
import nativeFs, { promises as fs } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertClassicSdkDeliveryFileInputs,
  collectClassicSdkDeliveryInputs,
} from '../../../domains/comet-classic/classic-sdk-delivery-inputs.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

describe('Classic SDK declared delivery inputs', () => {
  let root: string;
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const put = async (ref: string, source = 'original\n') => {
    await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
    await fs.writeFile(path.join(root, ref), source);
  };
  const inputs = (deliveryPaths?: string[]) =>
    collectClassicSdkDeliveryInputs(root, undefined, deliveryPaths);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-delivery-inputs-'));
    await prepareClassicLegacyProject(root);
    git('init');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.invalid');
    await put('source.js');
    await put('src/obsolete.js');
    await put('src/nested/obsolete.js');
    await put('src-other/obsolete.js');
    await put('src.js');
    git('add', '--all');
    git('commit', '-m', 'baseline');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    syncBuiltinESMExports();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('verifies 100 unchanged committed inputs within 800 filesystem calls', async () => {
    const names = Array.from({ length: 100 }, (_, index) => `budget/input-${index}.unknown`);
    await Promise.all(names.map((name) => put(name)));
    git('add', '--all');
    git('commit', '-m', 'delivery input budget');
    const rows = execFileSync('git', ['ls-files', '--stage', '-z', '--', 'budget'], {
      cwd: root,
      encoding: 'utf8',
    });
    const inputs = Object.fromEntries(
      rows
        .split('\0')
        .filter(Boolean)
        .map((row) => [row.slice(row.indexOf('\t') + 1), `git:${row.split(' ')[1]}`]),
    );
    const probes = [
      vi.spyOn(fs, 'lstat'),
      vi.spyOn(fs, 'realpath'),
      vi.spyOn(fs, 'stat'),
      vi.spyOn(nativeFs, 'lstatSync'),
    ];
    syncBuiltinESMExports();
    const commandsBefore = vi.mocked(execFileSync).mock.calls.length;
    expect(await assertClassicSdkDeliveryFileInputs(root, inputs)).toEqual(new Set(names));
    expect(vi.mocked(execFileSync).mock.calls.length - commandsBefore).toBeLessThanOrEqual(2);
    expect(probes.reduce((count, probe) => count + probe.mock.calls.length, 0)).toBeLessThanOrEqual(
      800,
    );
  });

  it.each(['staged', 'unstaged'])(
    'includes %s deletions among current delivery paths',
    async (mode) => {
      if (mode === 'staged') git('rm', '--', 'src/obsolete.js', 'src/nested/obsolete.js');
      else {
        await fs.unlink(path.join(root, 'src/obsolete.js'));
        await fs.unlink(path.join(root, 'src/nested/obsolete.js'));
      }
      await put('source.js', 'updated\n');
      await put('src/kept.js');
      expect(await inputs()).toEqual([
        'source.js',
        'src/kept.js',
        'src/nested/obsolete.js',
        'src/obsolete.js',
      ]);
    },
  );

  it('keeps deleted descendants when their directory no longer exists', async () => {
    git('rm', '-r', '--', 'src');
    expect(await inputs()).toEqual(['src/nested/obsolete.js', 'src/obsolete.js']);
  });

  it('keeps an explicit delivery selection separate from deleted sibling paths', async () => {
    git('rm', '-r', '--', 'src', 'src-other', 'src.js', 'source.js');
    expect(await inputs(['src/nested/obsolete.js', 'src/obsolete.js'])).toEqual([
      'src/nested/obsolete.js',
      'src/obsolete.js',
    ]);
  });

  it('retains only the deleted output explicitly selected for delivery', async () => {
    await put('src/obsolete.js.map');
    git('add', '--all');
    git('commit', '-m', 'add sibling file');
    git('rm', '-r', '--', 'src');
    expect(await inputs(['src/obsolete.js.map'])).toEqual(['src/obsolete.js.map']);
  });

  it('keeps explicit delivery files exact without applying old check-policy globs', async () => {
    git('rm', '-r', '--', 'src');
    await put('.comet/check-policy.json', '{invalid retired policy');
    expect(await inputs(['src/obsolete.js'])).toEqual(['src/obsolete.js']);
    expect(await inputs()).toEqual(['src/nested/obsolete.js', 'src/obsolete.js']);
  });
});
