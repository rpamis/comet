import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import {
  captureApprovedShapeOriginals,
  captureNativeShapeReviewAnchor,
  nativeShapeReviewAnchorMatches,
  readApprovedShapeOriginal,
} from '../../../domains/comet-native/native-shape-review-evidence.js';
import {
  nativeShapeArtifactContractHash,
  nativeShapeArtifactSnapshot,
} from '../../../domains/comet-native/native-shape-semantics.js';

describe('Native Shape original evidence', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-shape-original-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const original = '# Worker\n\nKeep the worker running.\n';
  async function fixture() {
    const paths = await nativeProjectPaths(root, 'docs');
    const state = createNativePortableState({ name: 'worker', language: 'en' });
    const approved = nativeShapeArtifactSnapshot('brief.md', original);
    state.shape_semantic_snapshot = {
      schema: 'comet.native.shape-semantics.v1',
      artifacts: [approved],
    };
    const file = path.join(paths.changesDir, state.name, approved.source);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, original);
    return { paths, state, approved, file };
  }

  it('captures the exact approved original idempotently and rejects cache tampering', async () => {
    const f = await fixture();
    await captureApprovedShapeOriginals(f.paths, f.state);
    const cached = await readApprovedShapeOriginal(f.paths, f.state, f.approved);
    expect(cached.text).toBe(original);
    await captureApprovedShapeOriginals(f.paths, f.state);
    await fs.writeFile(cached.path, 'unapproved replacement');
    await expect(readApprovedShapeOriginal(f.paths, f.state, f.approved)).rejects.toThrow(
      'no longer matches',
    );
    await expect(captureApprovedShapeOriginals(f.paths, f.state)).rejects.toThrow(
      'original changed',
    );
    expect(await fs.readFile(cached.path, 'utf8')).toBe('unapproved replacement');
  });

  it.each(['index', 'history'] as const)(
    'recovers an approved original from Git %s without replacing current edits',
    async (location) => {
      const f = await fixture();
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
      git(['init', '--quiet']);
      git(['config', 'core.autocrlf', 'false']);
      git(['add', '--', path.relative(root, f.file)]);
      if (location === 'history') {
        git([
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '--quiet',
          '-m',
          'approved Shape',
        ]);
        await fs.writeFile(f.file, '# Worker\nA later committed requirement.\n');
        git(['add', '--', path.relative(root, f.file)]);
        git([
          '-c',
          'user.name=Test',
          '-c',
          'user.email=test@example.invalid',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '--quiet',
          '-m',
          'later Shape',
        ]);
      }
      const edited = '# Worker\nCurrent user edits.\n';
      await fs.writeFile(f.file, edited);
      const recovered = await readApprovedShapeOriginal(f.paths, f.state, f.approved);
      expect(recovered.text).toBe(original);
      expect(await fs.readFile(recovered.path, 'utf8')).toBe(original);
      expect(await fs.readFile(f.file, 'utf8')).toBe(edited);
    },
  );
});
