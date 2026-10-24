import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectCheckSnapshot } from '../../../domains/comet-classic/classic-check-snapshot.js';
import { collectClassicSdkDeliveryInputs } from '../../../domains/comet-classic/classic-sdk-delivery-inputs.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic SDK declared delivery inputs', () => {
  let root: string;
  const identity = { argv: [process.execPath, 'check.cjs'], cwd: '.' };
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  const put = async (ref: string, source = 'original\n') => {
    await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
    await fs.writeFile(path.join(root, ref), source);
  };
  const inputs = async (files: string[], outputs: string[] = []) => {
    await put(
      '.comet/check-policy.json',
      JSON.stringify({ version: 2, commands: [{ ...identity, files, outputs }] }),
    );
    const snapshot = await collectCheckSnapshot(
      root,
      path.join(root, 'openspec/changes/example'),
      identity,
      { verificationReport: null },
    );
    return collectClassicSdkDeliveryInputs(root, snapshot.manifest, identity);
  };

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
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each(['src', 'src/**'])('includes staged deletions covered by %s', async (pattern) => {
    git('rm', '--', 'src/obsolete.js', 'src/nested/obsolete.js');
    await put('source.js', 'updated\n');
    await put('src/kept.js');
    expect(await inputs(['source.js', pattern])).toEqual({
      'source.js': expect.stringMatching(/^[a-f0-9]{64}$/u),
      'src/kept.js': expect.stringMatching(/^[a-f0-9]{64}$/u),
      'src/obsolete.js': 'missing',
      'src/nested/obsolete.js': 'missing',
    });
  });

  it('keeps deleted descendants when the declared directory no longer exists', async () => {
    git('rm', '-r', '--', 'src');
    expect(await inputs(['src'])).toMatchObject({
      'src/obsolete.js': 'missing',
      'src/nested/obsolete.js': 'missing',
    });
  });

  it('does not include sibling paths or files outside the declared directory', async () => {
    git('rm', '-r', '--', 'src', 'src-other', 'src.js', 'source.js');
    expect(Object.keys((await inputs(['src']))!)).toEqual([
      'src/nested/obsolete.js',
      'src/obsolete.js',
    ]);
  });

  it('preserves exact-file and glob output exclusions for staged deletions', async () => {
    await put('src/obsolete.js.map');
    git('add', '--all');
    git('commit', '-m', 'add sibling file');
    git('rm', '-r', '--', 'src');
    expect(await inputs(['src'], ['src/obsolete.js', 'src/nested/**'])).toEqual({
      'src/obsolete.js.map': 'missing',
    });
  });

  it('keeps literal files exact and globs within their declared path segments', async () => {
    git('rm', '-r', '--', 'src');
    expect(await inputs(['src/obsolete.js'])).toEqual({ 'src/obsolete.js': 'missing' });
    expect(await inputs(['src/*.js'])).toEqual({ 'src/obsolete.js': 'missing' });
  });
});
