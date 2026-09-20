import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkInputFingerprint,
  collectCheckSnapshot,
} from '../../../domains/comet-classic/classic-check-snapshot.js';
import {
  diffCheckManifests,
  parseCheckManifest,
  serializeCheckManifest,
} from '../../../domains/comet-classic/classic-check-manifest.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic check input snapshots', () => {
  let root: string;
  let change: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'ignore' });
  const fingerprint = () => checkInputFingerprint(root, change);
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-snapshot-'));
    await prepareClassicLegacyProject(root);
    change = path.join(root, 'openspec', 'changes', 'demo');
    await fs.mkdir(change, { recursive: true });
    git(root, 'init');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(root, 'source.js'), 'v1');
    git(root, 'add', 'source.js');
    git(root, 'commit', '-m', 'baseline');
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('keeps staging and commits inert by default and still invalidates worktree changes', async () => {
    const baseline = await fingerprint();
    await fs.writeFile(path.join(root, 'source.js'), 'v2');
    const unstaged = await fingerprint();
    expect(unstaged).not.toBe(baseline);
    git(root, 'add', 'source.js');
    git(root, 'commit', '-m', 'stage v2');
    expect(await fingerprint()).toBe(unstaged);
    await fs.unlink(path.join(root, 'source.js'));
    expect(await fingerprint()).not.toBe(unstaged);
  });

  it('binds HEAD and the index again when a policy declares git "all"', async () => {
    const identity = { argv: [process.execPath, 'check.cjs'], cwd: '.' };
    const bound = () => checkInputFingerprint(root, change, identity);
    await fs.writeFile(
      path.join(root, '.comet', 'check-policy.json'),
      JSON.stringify({ version: 1, argv: identity.argv, cwd: '.', git: 'all' }),
    );
    const baseline = await bound();
    await fs.writeFile(path.join(root, 'source.js'), 'v2');
    git(root, 'add', 'source.js');
    expect(await bound()).not.toBe(baseline);
    git(root, 'commit', '-m', 'stage v2');
    const committed = await bound();
    expect(committed).not.toBe(baseline);
    git(root, 'commit', '--allow-empty', '-m', 'empty');
    expect(await bound()).not.toBe(committed);
  });

  it('excludes declared command outputs while keeping source inputs bound', async () => {
    const identity = { argv: [process.execPath, 'build.cjs'], cwd: '.' };
    await fs.writeFile(
      path.join(root, '.comet', 'check-policy.json'),
      JSON.stringify({
        version: 2,
        commands: [
          {
            ...identity,
            files: ['source.js', 'dist/**'],
            outputs: ['dist/**'],
          },
        ],
      }),
    );
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist', 'bundle.js'), 'first');
    const before = await checkInputFingerprint(root, change, identity);

    await fs.writeFile(path.join(root, 'dist', 'bundle.js'), 'second');
    expect(await checkInputFingerprint(root, change, identity)).toBe(before);

    await fs.writeFile(path.join(root, 'source.js'), 'v2');
    expect(await checkInputFingerprint(root, change, identity)).not.toBe(before);
  });

  it('includes submodule HEAD and dirty contents', async () => {
    const source = path.join(root, 'library');
    await fs.mkdir(source);
    git(source, 'init');
    git(source, 'config', 'user.email', 'test@example.com');
    git(source, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(source, 'api.js'), 'v1');
    git(source, 'add', '.');
    git(source, 'commit', '-m', 'library');
    git(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', './library', 'vendor');
    const before = await fingerprint();
    await fs.writeFile(path.join(root, 'vendor', 'api.js'), 'v2');
    expect(await fingerprint()).not.toBe(before);
  });

  it('omits runtime records but includes project configuration and ignored dependency metadata', async () => {
    const before = await fingerprint();
    await fs.mkdir(path.join(change, '.comet'), { recursive: true });
    await fs.writeFile(path.join(change, '.comet', 'progress.md'), 'new progress');
    expect(await fingerprint()).toBe(before);
    await fs.appendFile(path.join(root, '.comet', 'config.yaml'), '\n# config changed\n');
    const config = await fingerprint();
    expect(config).not.toBe(before);
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true });
    await fs.writeFile(path.join(root, '.gitignore'), 'node_modules/\n');
    const ignored = await fingerprint();
    await fs.writeFile(path.join(root, 'node_modules', '.modules.yaml'), 'layoutVersion: 5');
    expect(await fingerprint()).not.toBe(ignored);
  });

  it('collects per-file entries; repository metadata binds only under legacy semantics', async () => {
    const snapshot = await collectCheckSnapshot(root, change);
    const source = snapshot.entries.find((entry) => entry.p === 'source.js');
    expect(source?.h).toBe(
      `git:${execFileSync('git', ['hash-object', 'source.js'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()}`,
    );
    expect(source?.s).toBe(2);
    expect(source?.m).toMatch(/^\d+$/);
    expect(snapshot.entries.map((entry) => entry.p)).not.toContain('\u0000git:.:head');
    expect(parseCheckManifest(snapshot.manifest)).toEqual(
      snapshot.entries.slice().sort((a, b) => (a.p < b.p ? -1 : a.p > b.p ? 1 : 0)),
    );
    expect(snapshot.digest).toBe(await fingerprint());
    const legacySnapshot = await collectCheckSnapshot(root, change, undefined, { legacy: true });
    expect(legacySnapshot.entries.map((entry) => entry.p)).toContain('\u0000git:.:head');
    expect(legacySnapshot.digest).not.toBe(snapshot.digest);
  });

  it('reuses baseline content hashes for files whose stat identity still matches', async () => {
    const baseline = await collectCheckSnapshot(root, change);
    const now = new Date();
    await fs.utimes(path.join(root, 'source.js'), now, now);
    await fs.writeFile(path.join(root, 'source.js'), 'v2');
    const touched = await collectCheckSnapshot(root, change, undefined, {
      baseline: baseline.entries,
    });
    const source = touched.entries.find((entry) => entry.p === 'source.js');
    expect(source?.h).toBe(
      `git:${execFileSync('git', ['hash-object', 'source.js'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()}`,
    );
    expect(touched.digest).not.toBe(baseline.digest);
  });

  it('differentially reuses untouched entries and still invalidates changes and additions', async () => {
    const baseline = await collectCheckSnapshot(root, change);

    // A pure mtime touch with unchanged content keeps the differential digest
    // stable: `git status` reports nothing, so every recorded entry is reused.
    const touched = new Date(Date.now() - 60_000);
    await fs.utimes(path.join(root, 'source.js'), touched, touched);
    const untouched = await collectCheckSnapshot(root, change, undefined, {
      baseline: baseline.entries,
    });
    expect(untouched.digest).toBe(baseline.digest);

    // Modifying tracked content and adding a new file both break the digest.
    await fs.writeFile(path.join(root, 'source.js'), 'v2');
    const modified = await collectCheckSnapshot(root, change, undefined, {
      baseline: baseline.entries,
    });
    expect(modified.digest).not.toBe(baseline.digest);

    await fs.writeFile(path.join(root, 'added.js'), 'new');
    const added = await collectCheckSnapshot(root, change, undefined, {
      baseline: baseline.entries,
    });
    const addedEntry = added.entries.find((entry) => entry.p === 'added.js');
    expect(addedEntry?.h).toBe(
      `git:${execFileSync('git', ['hash-object', 'added.js'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()}`,
    );
    expect(added.digest).not.toBe(modified.digest);
  });

  it('invalidates recorded content after a different file version is committed', async () => {
    const baseline = await collectCheckSnapshot(root, change);

    await fs.writeFile(path.join(root, 'source.js'), 'v2');
    git(root, 'add', 'source.js');
    git(root, 'commit', '-m', 'replace source');

    const committed = await collectCheckSnapshot(root, change, undefined, {
      baseline: baseline.entries,
    });
    expect(committed.digest).not.toBe(baseline.digest);
    expect(committed.entries.find((entry) => entry.p === 'source.js')?.h).toBe(
      `git:${execFileSync('git', ['hash-object', 'source.js'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()}`,
    );
  });

  it('fingerprints tracked files larger than 64 MiB without a byte cap', async () => {
    const size = 64 * 1024 * 1024 + 1;
    const large = path.join(root, 'recording.bin');
    const handle = await fs.open(large, 'w');
    try {
      await handle.truncate(size);
    } finally {
      await handle.close();
    }
    git(root, 'add', 'recording.bin');

    const snapshot = await collectCheckSnapshot(root, change);

    const entry = snapshot.entries.find((candidate) => candidate.p === 'recording.bin');
    expect(entry?.s).toBe(size);
    expect(entry?.h).toBe(
      `git:${execFileSync('git', ['hash-object', 'recording.bin'], {
        cwd: root,
        encoding: 'utf8',
      }).trim()}`,
    );
    const changed = await collectCheckSnapshot(root, change);
    expect(changed.digest).toBe(snapshot.digest);
  });

  it('reports added, removed and changed files between manifests', () => {
    const baseline = parseCheckManifest(
      serializeCheckManifest([
        { p: 'kept.js', h: 'a', s: 1, m: '1' },
        { p: 'removed.js', h: 'b', s: 2, m: '2' },
        { p: 'changed.js', h: 'c', s: 3, m: '3' },
      ]),
    );
    const current = parseCheckManifest(
      serializeCheckManifest([
        { p: 'kept.js', h: 'a', s: 1, m: '9' },
        { p: 'changed.js', h: 'd', s: 3, m: '3' },
        { p: 'added.js', h: 'e', s: 4, m: '4' },
      ]),
    );
    expect(diffCheckManifests(baseline, current)).toEqual({
      added: ['added.js'],
      removed: ['removed.js'],
      changed: ['changed.js'],
    });
    expect(diffCheckManifests(baseline, baseline)).toEqual({
      added: [],
      removed: [],
      changed: [],
    });
  });
});
