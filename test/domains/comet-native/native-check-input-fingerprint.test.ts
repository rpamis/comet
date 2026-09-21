import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  hasGitlinksInIndex,
  nativeCheckInputFingerprint,
  nativeCheckInputGate,
} from '../../../domains/comet-native/native-portable-checks.js';

function git(root: string, ...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function fingerprintInput(projectRoot: string) {
  return {
    state: {
      builder_handoff: null,
      shape_confirmation_hash: null,
      acceptance: [],
    },
    projectRoot,
    plans: [],
  };
}

describe('Native check input fingerprint', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-fingerprint-'));
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(root, 'committed.txt'), 'committed\n');
    await fs.writeFile(path.join(root, 'large.bin'), 'x'.repeat(300 * 1024));
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'baseline');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('detects tracked submodules from the staged index stream', () => {
    expect(hasGitlinksInIndex('100644 abc\tREADME.md\0')).toBe(false);
    expect(hasGitlinksInIndex('160000 abc\tdependency\0')).toBe(true);
  });

  it('stays stable when an unbound environment variable changes', async () => {
    const before = await nativeCheckInputFingerprint(fingerprintInput(root));
    process.env.COMET_TEST_INCIDENTAL_VARIABLE = `session-${Date.now()}`;
    try {
      const after = await nativeCheckInputFingerprint(fingerprintInput(root));
      expect(after).toBe(before);
    } finally {
      delete process.env.COMET_TEST_INCIDENTAL_VARIABLE;
    }
  });

  it('changes when a tracked working-tree file changes and when a file is staged', async () => {
    const before = await nativeCheckInputFingerprint(fingerprintInput(root));

    await fs.writeFile(path.join(root, 'committed.txt'), 'committed and edited\n');
    const afterEdit = await nativeCheckInputFingerprint(fingerprintInput(root));
    expect(afterEdit).not.toBe(before);

    git(root, 'add', 'committed.txt');
    const afterStage = await nativeCheckInputFingerprint(fingerprintInput(root));
    expect(afterStage).not.toBe(afterEdit);
  });

  it('changes when a PATH entry is added because PATH stays bound', async () => {
    const before = await nativeCheckInputFingerprint(fingerprintInput(root));
    const previous = process.env.PATH;
    process.env.PATH = `${previous}${path.delimiter}${path.join(root, 'bin')}`;
    try {
      const after = await nativeCheckInputFingerprint(fingerprintInput(root));
      expect(after).not.toBe(before);
    } finally {
      process.env.PATH = previous;
    }
  });

  it('excludes only Native-managed change metadata from a configured artifact root', async () => {
    const artifactRoot = path.join(root, 'docs');
    const changeDir = path.join(artifactRoot, 'comet', 'changes', 'demo');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'comet-state.yaml'), 'state: one\n');
    await fs.writeFile(path.join(changeDir, 'brief.md'), 'brief one\n');
    const input = { ...fingerprintInput(root), managedArtifactRoot: artifactRoot };

    const before = await nativeCheckInputFingerprint(input);
    await fs.writeFile(path.join(changeDir, 'comet-state.yaml'), 'state: two\n');
    expect(await nativeCheckInputFingerprint(input)).toBe(before);

    await fs.writeFile(path.join(changeDir, 'brief.md'), 'brief two\n');
    expect(await nativeCheckInputFingerprint(input)).not.toBe(before);

    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'comet-state.yaml'), 'source one\n');
    const withSourceMetadata = await nativeCheckInputFingerprint(input);
    await fs.writeFile(path.join(root, 'src', 'comet-state.yaml'), 'source two\n');
    expect(await nativeCheckInputFingerprint(input)).not.toBe(withSourceMetadata);
  });

  it('supports a project-root artifact directory without excluding source metadata', async () => {
    const changeDir = path.join(root, 'comet', 'changes', 'demo');
    await fs.mkdir(changeDir, { recursive: true });
    await fs.writeFile(path.join(changeDir, 'comet-state.yaml'), 'state: one\n');
    const input = { ...fingerprintInput(root), managedArtifactRoot: root };

    const before = await nativeCheckInputFingerprint(input);
    await fs.writeFile(path.join(changeDir, 'comet-state.yaml'), 'state: two\n');
    expect(await nativeCheckInputFingerprint(input)).toBe(before);

    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src', 'comet-state.yaml'), 'source one\n');
    const withSourceMetadata = await nativeCheckInputFingerprint(input);
    await fs.writeFile(path.join(root, 'src', 'comet-state.yaml'), 'source two\n');
    expect(await nativeCheckInputFingerprint(input)).not.toBe(withSourceMetadata);
  });
});

describe('Native check input gate', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-gate-'));
    git(root, 'init', '--quiet');
    git(root, 'config', 'user.email', 'test@example.com');
    git(root, 'config', 'user.name', 'Test');
    await fs.writeFile(path.join(root, 'committed.txt'), 'committed\n');
    git(root, 'add', '.');
    git(root, 'commit', '--quiet', '-m', 'baseline');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stays stable across untouched reruns and incidental environment changes', async () => {
    const gate = { projectRoot: root, candidateId: null };
    const before = await nativeCheckInputGate(gate);
    expect(before).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
    process.env.COMET_TEST_GATE_INCIDENTAL = `noise-${Date.now()}`;
    try {
      expect(await nativeCheckInputGate(gate)).toBe(before);
    } finally {
      delete process.env.COMET_TEST_GATE_INCIDENTAL;
    }
  });

  it('changes on tracked edits, staged content, branch switches, and untracked edits', async () => {
    const gate = { projectRoot: root, candidateId: null };
    const before = await nativeCheckInputGate(gate);

    await fs.writeFile(path.join(root, 'committed.txt'), 'edited\n');
    const afterEdit = await nativeCheckInputGate(gate);
    expect(afterEdit).not.toBe(before);
    expect(afterEdit).not.toBeNull();

    await fs.writeFile(path.join(root, 'committed.txt'), 'edited again\n');
    const afterSecondEdit = await nativeCheckInputGate(gate);
    expect(afterSecondEdit).not.toBe(afterEdit);

    git(root, 'add', 'committed.txt');
    expect(await nativeCheckInputGate(gate)).not.toBe(afterSecondEdit);

    git(root, 'switch', '-c', 'gate-branch', '--quiet');
    expect(await nativeCheckInputGate(gate)).not.toBe(before);

    await fs.writeFile(path.join(root, 'untracked.txt'), 'one\n');
    const withUntracked = await nativeCheckInputGate(gate);
    await fs.writeFile(path.join(root, 'untracked.txt'), 'two\n');
    expect(await nativeCheckInputGate(gate)).not.toBe(withUntracked);
  });

  it('changes when an ignored generated input changes for a check cwd', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), 'dist/\n');
    git(root, 'add', '.gitignore');
    git(root, 'commit', '--quiet', '-m', 'ignore generated inputs');
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist', 'input.txt'), 'good\n');
    const gate = {
      projectRoot: root,
      candidateId: null,
      plans: [
        {
          id: 'generated-input',
          name: 'Generated input',
          executable: process.execPath,
          argv: ['-e', 'process.exit(0)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    };

    const before = await nativeCheckInputGate(gate);
    await fs.writeFile(path.join(root, 'dist', 'input.txt'), 'bad\n');
    expect(await nativeCheckInputGate(gate)).not.toBe(before);
  });

  it('disables the fast gate for a dirty submodule whose contents cannot be hashed as a file', async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-gate-submodule-'));
    try {
      git(source, 'init', '--quiet');
      git(source, 'config', 'user.email', 'test@example.com');
      git(source, 'config', 'user.name', 'Test');
      await fs.writeFile(path.join(source, 'value.txt'), 'baseline\n');
      git(source, 'add', '.');
      git(source, 'commit', '--quiet', '-m', 'baseline');
      git(
        root,
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        '--quiet',
        source,
        'dependency',
      );
      git(root, 'commit', '--quiet', '-am', 'add submodule');

      await fs.writeFile(path.join(root, 'dependency', 'value.txt'), 'first dirty value\n');
      const gate = { projectRoot: root, candidateId: null };
      expect(await nativeCheckInputGate(gate)).toBeNull();

      await fs.writeFile(path.join(root, 'dependency', 'value.txt'), 'second dirty value\n');
      expect(await nativeCheckInputGate(gate)).toBeNull();
    } finally {
      await fs.rm(source, { recursive: true, force: true });
    }
  });
});
