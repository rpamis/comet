import { promises as fs, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasGitlinksInIndex,
  nativeCheckInputFingerprint,
  nativeCheckInputGate,
  nativeCandidateInputGate,
} from '../../../domains/comet-native/native-portable-checks.js';
import * as gitCommands from '../../../platform/process/git.js';
import { resolveWorkspaceRuntimeRoot } from '../../../domains/workflow-contract/workspace-runtime.js';

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

  describe('tracked submodule inputs', () => {
    let source: string;
    let dependency: string;

    beforeEach(async () => {
      source = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-check-gate-submodule-'));
      dependency = path.join(root, 'dependency');
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
      git(dependency, 'config', 'user.email', 'test@example.com');
      git(dependency, 'config', 'user.name', 'Test');
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await fs.rm(source, { recursive: true, force: true });
    });

    async function advanceDependency(value: string): Promise<void> {
      await fs.writeFile(path.join(dependency, 'value.txt'), value);
      git(dependency, 'commit', '--quiet', '-am', value.trim());
    }

    function addNestedDependency(): void {
      git(
        dependency,
        '-c',
        'protocol.file.allow=always',
        'submodule',
        'add',
        '--quiet',
        source,
        'nested',
      );
      git(dependency, 'commit', '--quiet', '-am', 'add nested submodule');
    }

    it('binds clean advanced submodule HEAD and the parent index without reading ignored caches or secrets', async () => {
      await fs.writeFile(path.join(root, '.gitignore'), '.pnpm-store/\neval/.env\n');
      git(root, 'add', '.gitignore');
      git(root, 'commit', '--quiet', '-m', 'ignore local files');
      await fs.mkdir(path.join(root, '.pnpm-store'));
      await fs.mkdir(path.join(root, 'eval'));
      const cache = path.join(root, '.pnpm-store', 'cached.txt');
      const secret = path.join(root, 'eval', '.env');
      await fs.writeFile(cache, 'local cache\n');
      await fs.writeFile(secret, 'fixture secret\n');
      const open = vi.spyOn(fs, 'open');
      const read = vi.spyOn(fs, 'readFile');
      const readdir = vi.spyOn(fs, 'readdir');
      const gate = {
        projectRoot: root,
        candidateId: null,
        editReviewScope: {
          projectRoot: root,
          runtimeRoot: await resolveWorkspaceRuntimeRoot(root),
          workflow: 'native' as const,
          change: 'demo',
          candidateKey: 'candidate',
          formalPrefixes: [],
        },
      };
      const baseline = await nativeCandidateInputGate(gate);

      await advanceDependency('first commit\n');
      const checkGate = await nativeCheckInputGate(gate);
      const candidateGate = await nativeCandidateInputGate(gate);
      expect(checkGate).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
      expect(candidateGate).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/u));
      expect(candidateGate).not.toBe(baseline);
      expect(await nativeCheckInputGate(gate)).toBe(checkGate);
      expect(await nativeCandidateInputGate(gate)).toBe(candidateGate);

      await advanceDependency('second commit\n');
      const advancedCheck = await nativeCheckInputGate(gate);
      const advancedCandidate = await nativeCandidateInputGate(gate);
      expect(advancedCheck).not.toBeNull();
      expect(advancedCandidate).not.toBeNull();
      expect(advancedCheck).not.toBe(checkGate);
      expect(advancedCandidate).not.toBe(candidateGate);

      git(root, 'add', 'dependency');
      expect(await nativeCheckInputGate(gate)).not.toBe(advancedCheck);
      expect(await nativeCandidateInputGate(gate)).not.toBe(advancedCandidate);
      for (const spy of [open, read]) {
        expect(spy.mock.calls.some(([file]) => [cache, secret].includes(String(file)))).toBe(false);
      }
      expect(
        readdir.mock.calls.some(([directory]) => String(directory) === path.dirname(cache)),
      ).toBe(false);
    });

    it('disables the fast gate for dirty and untracked submodule contents despite ignore configuration', async () => {
      git(root, 'config', 'submodule.dependency.ignore', 'all');
      const gate = { projectRoot: root, candidateId: null };
      await fs.writeFile(path.join(dependency, 'untracked.txt'), 'untracked input\n');
      expect(await nativeCheckInputGate(gate)).toBeNull();
      await fs.rm(path.join(dependency, 'untracked.txt'));

      await fs.writeFile(path.join(dependency, 'value.txt'), 'first dirty value\n');
      expect(await nativeCheckInputGate(gate)).toBeNull();

      await fs.writeFile(path.join(dependency, 'value.txt'), 'second dirty value\n');
      expect(await nativeCheckInputGate(gate)).toBeNull();
      git(dependency, 'add', 'value.txt');
      expect(await nativeCheckInputGate(gate)).toBeNull();
    });

    it('keeps a document-named submodule HEAD bound to the candidate', async () => {
      git(root, 'mv', 'dependency', 'dependency.md');
      dependency = path.join(root, 'dependency.md');
      git(root, 'commit', '--quiet', '-am', 'rename submodule');
      const gate = { projectRoot: root, candidateId: null };
      await advanceDependency('first commit\n');
      const before = await nativeCandidateInputGate(gate);
      expect(before).not.toBeNull();
      await advanceDependency('second commit\n');
      const after = await nativeCandidateInputGate(gate);
      expect(after).not.toBeNull();
      expect(after).not.toBe(before);
    });

    it('rejects dirty nested submodules even when their ignore setting hides changes', async () => {
      addNestedDependency();
      git(dependency, 'config', 'submodule.nested.ignore', 'all');
      await fs.writeFile(path.join(dependency, 'nested', 'value.txt'), 'nested dirty input\n');
      expect(git(dependency, 'status', '--porcelain=v1').trim()).toBe('');
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBeNull();
    });

    it('rejects deinitialized nested submodules after a clean advanced parent', async () => {
      addNestedDependency();
      const gate = { projectRoot: root, candidateId: null };
      const beforeCheck = await nativeCheckInputGate(gate);
      const beforeCandidate = await nativeCandidateInputGate(gate);
      const beforeFingerprint = await nativeCheckInputFingerprint(fingerprintInput(root));
      expect(beforeCheck).not.toBeNull();
      expect(beforeCandidate).not.toBeNull();
      expect(await nativeCheckInputGate(gate)).toBe(beforeCheck);
      expect(await nativeCandidateInputGate(gate)).toBe(beforeCandidate);

      git(dependency, 'submodule', 'deinit', '--force', '--', 'nested');
      expect(git(dependency, 'status', '--porcelain=v1', '--ignore-submodules=none')).toBe('');
      await expect(fs.stat(path.join(dependency, 'nested', 'value.txt'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await nativeCheckInputGate(gate)).toBeNull();
      expect(await nativeCandidateInputGate(gate)).not.toBe(beforeCandidate);
      expect(await nativeCheckInputFingerprint(fingerprintInput(root))).not.toBe(beforeFingerprint);
    });

    it('rejects nested submodule deinitialization during sampling', async () => {
      addNestedDependency();
      const nested = path.join(dependency, 'nested');
      const readStatus = gitCommands.readGitStatusPorcelain;
      let changed = false;
      vi.spyOn(gitCommands, 'readGitStatusPorcelain').mockImplementation((cwd, pathspecs) => {
        const status = readStatus(cwd, pathspecs);
        if (path.resolve(cwd) === nested && !changed) {
          changed = true;
          git(dependency, 'submodule', 'deinit', '--force', '--', 'nested');
        }
        return status;
      });
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBeNull();
      expect(changed).toBe(true);
    });

    it('rejects an uninitialized submodule instead of discovering the committed parent repository', async () => {
      git(root, 'submodule', 'deinit', '--force', '--', 'dependency');
      expect(git(dependency, 'rev-parse', '--show-toplevel').trim()).toBe(
        root.replaceAll('\\', '/'),
      );
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBeNull();
    });

    it('rejects a file replacing a tracked submodule directory', async () => {
      await fs.rm(dependency, { recursive: true, force: true });
      await fs.writeFile(dependency, 'replacement input\n');
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBeNull();
    });

    it('rejects a submodule directory replaced by a symbolic link or junction', async () => {
      await fs.rm(dependency, { recursive: true, force: true });
      await fs.symlink(source, dependency, process.platform === 'win32' ? 'junction' : 'dir');
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBeNull();
    });

    it('rejects a submodule HEAD changing while its clean status is sampled', async () => {
      await advanceDependency('first commit\n');
      const first = git(dependency, 'rev-parse', 'HEAD').trim();
      await advanceDependency('second commit\n');
      const second = git(dependency, 'rev-parse', 'HEAD').trim();
      git(dependency, 'checkout', '--quiet', first);
      const readStatus = gitCommands.readGitStatusPorcelain;
      let changed = false;
      vi.spyOn(gitCommands, 'readGitStatusPorcelain').mockImplementation((cwd, pathspecs) => {
        const status = readStatus(cwd, pathspecs);
        if (path.resolve(cwd) === dependency && !changed) {
          changed = true;
          git(dependency, 'checkout', '--quiet', second);
        }
        return status;
      });
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBeNull();
      expect(changed).toBe(true);
    });

    it('rejects submodule contents changing after the first status sample without changing HEAD', async () => {
      await advanceDependency('first commit\n');
      const head = git(dependency, 'rev-parse', 'HEAD');
      const readStatus = gitCommands.readGitStatusPorcelain;
      let changed = false;
      vi.spyOn(gitCommands, 'readGitStatusPorcelain').mockImplementation((cwd, pathspecs) => {
        const status = readStatus(cwd, pathspecs);
        if (path.resolve(cwd) === dependency && !changed) {
          changed = true;
          writeFileSync(path.join(dependency, 'value.txt'), 'changed after status\n');
        }
        return status;
      });
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBeNull();
      expect(changed).toBe(true);
      expect(git(dependency, 'rev-parse', 'HEAD')).toBe(head);
    });
  });
});
