import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
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

    git(root, 'add', 'committed.txt');
    expect(await nativeCheckInputGate(gate)).not.toBe(afterEdit);

    git(root, 'switch', '-c', 'gate-branch', '--quiet');
    expect(await nativeCheckInputGate(gate)).not.toBe(before);

    await fs.writeFile(path.join(root, 'untracked.txt'), 'one\n');
    const withUntracked = await nativeCheckInputGate(gate);
    await fs.writeFile(path.join(root, 'untracked.txt'), 'two\n');
    expect(await nativeCheckInputGate(gate)).not.toBe(withUntracked);
  });
});
