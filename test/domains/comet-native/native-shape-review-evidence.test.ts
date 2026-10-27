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

  it('does not capture a document edited after its approval snapshot', async () => {
    const f = await fixture();
    await fs.writeFile(f.file, '# Worker\nStop the worker.\n');
    await expect(captureApprovedShapeOriginals(f.paths, f.state)).rejects.toThrow(
      'before confirmation',
    );
    await expect(readApprovedShapeOriginal(f.paths, f.state, f.approved)).rejects.toMatchObject({
      code: 'ENOENT',
    });
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

  it('binds equivalent review anchors to their candidate and rejects changed requirements', async () => {
    const f = await fixture();
    const scope = {
      projectRoot: root,
      runtimeRoot: f.paths.workspaceRuntimeRoot,
      workflow: 'native' as const,
      change: f.state.name,
      candidateKey: 'candidate-one',
      formalPrefixes: [],
    };
    const formatted = original.replaceAll('\n\n', '\n\n\n');
    const changed = '# Worker\nStop the worker.\n';
    const formattedHash = nativeShapeArtifactSnapshot('brief.md', formatted).contentHash;
    const changedHash = nativeShapeArtifactSnapshot('brief.md', changed).contentHash;
    await expect(nativeShapeReviewAnchorMatches(scope, f.approved, null)).resolves.toBe(false);
    await expect(nativeShapeReviewAnchorMatches(scope, f.approved, 'invalid')).resolves.toBe(false);
    await expect(
      nativeShapeReviewAnchorMatches(scope, f.approved, f.approved.contentHash),
    ).resolves.toBe(true);
    await captureNativeShapeReviewAnchor(scope, f.approved, formatted);
    await captureNativeShapeReviewAnchor(scope, f.approved, formatted);
    await expect(nativeShapeReviewAnchorMatches(scope, f.approved, formattedHash)).resolves.toBe(
      true,
    );
    await expect(
      nativeShapeReviewAnchorMatches(
        { ...scope, candidateKey: 'candidate-two' },
        f.approved,
        formattedHash,
      ),
    ).resolves.toBe(false);
    await captureNativeShapeReviewAnchor(scope, f.approved, changed);
    await expect(nativeShapeReviewAnchorMatches(scope, f.approved, changedHash)).resolves.toBe(
      false,
    );
  });

  it('treats planned line numbers as auxiliary while preserving the test assertion contract', () => {
    const plan =
      '# Test plan\n\n| Test | Line | Assertion |\n| --- | --- | --- |\n| worker | planned | stays running |\n';
    const approved = nativeShapeArtifactSnapshot('brief.md', plan);
    const numbered = nativeShapeArtifactSnapshot('brief.md', plan.replace('planned', '12-18'));
    expect(approved.auxiliary).toEqual([
      { kind: 'test-plan-line', key: '0/0/1', value: 'planned' },
    ]);
    expect(numbered.auxiliary[0].value).toBe('12-18');
    expect(nativeShapeArtifactContractHash(numbered)).toBe(
      nativeShapeArtifactContractHash(approved),
    );
    for (const changed of [
      plan.replace('stays running', 'stops'),
      plan.replace('planned', 'skip this assertion'),
    ]) {
      expect(
        nativeShapeArtifactContractHash(nativeShapeArtifactSnapshot('brief.md', changed)),
      ).not.toBe(nativeShapeArtifactContractHash(approved));
    }
  });
});
