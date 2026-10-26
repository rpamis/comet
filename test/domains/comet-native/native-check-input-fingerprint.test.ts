import { promises as fs, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  hasGitlinksInIndex,
  nativeCheckInputFingerprint,
  nativeCheckInputSnapshot,
  nativeCheckInputGate,
  nativeCandidateInputGate,
  nativeGeneratedCheckInputSnapshot,
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
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each([true, false])(
    'keeps Archive generated-only snapshots equivalent without binding moved materials (git=%s)',
    async (useGit) => {
      if (!useGit) await fs.rm(path.join(root, '.git'), { recursive: true, force: true });
      await fs.writeFile(path.join(root, '.gitignore'), 'dist/\n.worktrees/\n');
      const active = 'docs/comet/changes/example';
      const archive = 'docs/comet/archive/example';
      for (const ref of [
        'dist/output.txt',
        '.worktrees/side/dist/noise.txt',
        `${active}/specs/build/spec.md`,
      ]) {
        await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
        await fs.writeFile(path.join(root, ref), 'original');
      }
      const input = {
        ...fingerprintInput(root),
        managedArtifactRoot: path.join(root, 'docs'),
        generatedInputExclusions: [active, archive],
      };
      const full = await nativeCheckInputSnapshot(input);
      const generated = await nativeGeneratedCheckInputSnapshot(input);
      expect(full.complete).toBe(true);
      expect(generated).toEqual({ complete: true, fingerprint: full.generatedInputFingerprint });
      await fs.mkdir(path.dirname(path.join(root, archive)), { recursive: true });
      await fs.rename(path.join(root, active), path.join(root, archive));
      expect(await nativeGeneratedCheckInputSnapshot(input)).toEqual(generated);
      await fs.writeFile(path.join(root, 'dist/output.txt'), 'changed');
      expect((await nativeGeneratedCheckInputSnapshot(input)).fingerprint).not.toBe(
        generated.fingerprint,
      );
    },
  );

  it.each([true, false])(
    'keeps nested linked worktrees outside the complete project input boundary (ignored=%s)',
    async (ignored) => {
      await fs.writeFile(
        path.join(root, '.gitignore'),
        `${ignored ? '.worktrees/\n' : ''}.next/\n`,
      );
      git(root, 'add', '.gitignore');
      git(root, 'commit', '--quiet', '-m', 'declare input boundaries');
      const input = fingerprintInput(root);
      const before = await nativeCheckInputSnapshot(input);
      const gate = await nativeCheckInputGate({ projectRoot: root, candidateId: null });
      const side = path.join(root, '.worktrees/side');
      git(root, 'worktree', 'add', '--quiet', '--detach', side);
      await fs.mkdir(path.join(side, 'dist'), { recursive: true });
      await fs.writeFile(path.join(side, 'dist/input.js'), 'other candidate');
      const after = await nativeCheckInputSnapshot(input);
      expect(after.complete, after.diagnostics.join('; ')).toBe(true);
      expect(after.contentFingerprint).toBe(before.contentFingerprint);
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBe(gate);
      await fs.mkdir(path.join(root, '.next/dev/types'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.next/dev/types/routes.d.ts'),
        'export type Route = "/";',
      );
      const generated = await nativeCheckInputSnapshot(input);
      expect(generated.complete).toBe(true);
      expect(generated.contentFingerprint).not.toBe(after.contentFingerprint);
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).not.toBe(gate);
      const linked = await nativeCheckInputSnapshot(fingerprintInput(side));
      expect(linked.complete).toBe(true);
      expect(linked.contentFingerprint).not.toBe(generated.contentFingerprint);
    },
  );

  it('rejects a non-file repository entry inside declared generated input instead of silently skipping it', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), 'dist/\n');
    git(root, 'add', '.gitignore');
    git(root, 'commit', '--quiet', '-m', 'declare generated inputs');
    git(root, 'worktree', 'add', '--quiet', '--detach', path.join(root, 'dist/nested'));
    const snapshot = await nativeCheckInputSnapshot(fingerprintInput(root));
    expect(snapshot.complete).toBe(false);
    expect(snapshot.diagnostics.join('; ')).toContain('不是普通文件：dist/nested/');
    expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBeNull();
  });

  it('keeps a complete snapshot for a single-character dirty tracked path and binds untracked edits', async () => {
    await fs.writeFile(path.join(root, 'a'), 'base\n');
    git(root, 'add', 'a');
    git(root, 'commit', '--quiet', '-m', 'single-character path');
    await fs.writeFile(path.join(root, 'a'), 'dirty\n');
    await fs.writeFile(path.join(root, 'untracked'), 'first\n');
    const input = fingerprintInput(root);
    const before = await nativeCheckInputSnapshot(input);
    expect(before.complete, before.diagnostics.join('; ')).toBe(true);
    expect(await nativeCheckInputSnapshot(input)).toEqual(before);
    await fs.writeFile(path.join(root, 'untracked'), 'second\n');
    const after = await nativeCheckInputSnapshot(input);
    expect(after.complete, after.diagnostics.join('; ')).toBe(true);
    expect(after.contentFingerprint).not.toBe(before.contentFingerprint);
  });

  it('excludes declared Runtime-owned files inside generated roots without dropping production input', async () => {
    const managedArtifactRoot = path.join(root, 'dist');
    await fs.writeFile(path.join(root, '.gitignore'), 'dist/\n');
    const change = path.join(managedArtifactRoot, 'comet/changes/example');
    await fs.mkdir(change, { recursive: true });
    await fs.writeFile(path.join(change, 'comet-state.yaml'), 'state: one');
    await fs.writeFile(path.join(managedArtifactRoot, 'production.js'), 'one');
    const input = { ...fingerprintInput(root), managedArtifactRoot };
    const before = await nativeCheckInputSnapshot(input);
    await fs.writeFile(path.join(change, 'comet-state.yaml'), 'state: two');
    expect(await nativeCheckInputSnapshot(input)).toEqual(before);
    await fs.writeFile(path.join(managedArtifactRoot, 'production.js'), 'two');
    const after = await nativeCheckInputSnapshot(input);
    expect(after.complete).toBe(true);
    expect(after.contentFingerprint).not.toBe(before.contentFingerprint);
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

  it('separates execution context from the complete candidate content snapshot', async () => {
    const before = await nativeCheckInputSnapshot(fingerprintInput(root));
    const prior = process.env.HTTP_PROXY;
    process.env.HTTP_PROXY = 'http://different-fixture-proxy.test:8080';
    try {
      const after = await nativeCheckInputSnapshot(fingerprintInput(root));
      expect(after.complete).toBe(true);
      expect(after.contentFingerprint).toBe(before.contentFingerprint);
      expect(after.fingerprint).not.toBe(before.fingerprint);
    } finally {
      if (prior === undefined) delete process.env.HTTP_PROXY;
      else process.env.HTTP_PROXY = prior;
    }
  });

  it.each(['tracked', 'untracked', 'check-cwd'])(
    'binds nested project generated inputs without recursive dependency globs (%s)',
    async (discovery) => {
      await fs.writeFile(path.join(root, '.gitignore'), 'dist/\nnode_modules/\n');
      await fs.mkdir(path.join(root, 'packages/app/dist'), { recursive: true });
      await fs.writeFile(path.join(root, 'packages/app/package.json'), '{}');
      await fs.writeFile(path.join(root, 'packages/app/dist/input.txt'), 'one');
      if (discovery === 'tracked') git(root, 'add', 'packages/app/package.json');
      if (discovery === 'check-cwd') await fs.rm(path.join(root, 'packages/app/package.json'));
      const plans =
        discovery === 'check-cwd'
          ? [
              {
                id: 'test',
                name: 'Test',
                executable: process.execPath,
                argv: ['-e', ''],
                cwdRef: 'packages/app',
                timeoutMs: 10_000,
                repeatable: true,
              },
            ]
          : [];
      const input = { ...fingerprintInput(root), plans };
      const run = vi.spyOn(gitCommands, 'runGitCommandAsync');
      try {
        const before = await nativeCheckInputSnapshot(input);
        expect(before.complete).toBe(true);
        const beforeGate = await nativeCheckInputGate({
          projectRoot: root,
          candidateId: null,
          plans,
        });
        await fs.writeFile(path.join(root, 'packages/app/dist/input.txt'), 'two');
        expect((await nativeCheckInputSnapshot(input)).contentFingerprint).not.toBe(
          before.contentFingerprint,
        );
        expect(
          await nativeCheckInputGate({ projectRoot: root, candidateId: null, plans }),
        ).not.toBe(beforeGate);
        const queries = run.mock.calls.filter(
          ([, args]) => args.includes('--ignored') && args.includes('--'),
        );
        expect(queries.length).toBeGreaterThan(0);
        for (const [, args] of queries) {
          expect(args).not.toContain(':(glob)**/dist/**');
          expect(args).toContain(':(literal)packages/app/dist/');
        }
      } finally {
        run.mockRestore();
      }
    },
  );

  it('binds ignored generated inputs under a nested directory without a project manifest', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), 'dist/\nnode_modules/\n');
    await fs.mkdir(path.join(root, 'packages/app/dist'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules/pkg/dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'packages/app/dist/input.txt'), 'good');
    await fs.writeFile(path.join(root, 'node_modules/pkg/dist/output.txt'), 'dependency');
    const input = fingerprintInput(root);
    const before = await nativeCheckInputSnapshot(input);
    const gate = await nativeCheckInputGate({ projectRoot: root, candidateId: null });
    expect(before.complete).toBe(true);
    await fs.writeFile(path.join(root, 'packages/app/dist/input.txt'), 'bad');
    const after = await nativeCheckInputSnapshot(input);
    expect(after.contentFingerprint).not.toBe(before.contentFingerprint);
    expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).not.toBe(gate);
  });

  it('restricts ignored input queries to literal generated roots instead of traversing unrelated trees', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), 'dist/\nnode_modules/\n.tmp/\n');
    await fs.mkdir(path.join(root, 'dist'), { recursive: true });
    await fs.mkdir(path.join(root, 'packages/app/dist'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules/pkg/dist'), { recursive: true });
    await fs.writeFile(path.join(root, 'dist/output.txt'), 'root');
    await fs.writeFile(path.join(root, 'packages/app/dist/output.txt'), 'nested');
    await fs.writeFile(path.join(root, 'node_modules/pkg/dist/output.txt'), 'excluded');
    const sync = vi.spyOn(gitCommands, 'runGitCommand');
    const async = vi.spyOn(gitCommands, 'runGitCommandAsync');
    const input = fingerprintInput(root);
    const before = await nativeGeneratedCheckInputSnapshot(input);
    expect(before.complete).toBe(true);
    const queries = [...sync.mock.calls, ...async.mock.calls].filter(
      ([, args]) => args.includes('--ignored') && args.includes('--'),
    );
    expect(queries.length).toBeGreaterThan(0);
    for (const [, args] of queries) {
      const positive = args
        .slice(args.indexOf('--') + 1)
        .filter((arg) => !arg.startsWith(':(exclude'));
      expect(positive).toHaveLength(1);
      expect(positive[0]).toMatch(/^:\(literal\).+\/$/u);
    }
    await fs.writeFile(path.join(root, 'node_modules/pkg/dist/output.txt'), 'unrelated');
    expect(await nativeGeneratedCheckInputSnapshot(input)).toEqual(before);
    await fs.writeFile(path.join(root, 'packages/app/dist/output.txt'), 'changed');
    expect((await nativeGeneratedCheckInputSnapshot(input)).fingerprint).not.toBe(
      before.fingerprint,
    );
  });

  it('rejects a generated root appearing while the selected directories are queried', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), 'dist/\nbuild/\n');
    await fs.mkdir(path.join(root, 'dist'));
    await fs.writeFile(path.join(root, 'dist/output.txt'), 'verified');
    const query = gitCommands.runGitCommandAsync;
    let changed = false;
    vi.spyOn(gitCommands, 'runGitCommandAsync').mockImplementation(async (cwd, args) => {
      const result = await query(cwd, args);
      if (args.includes('--ignored') && !changed) {
        changed = true;
        await fs.mkdir(path.join(root, 'build'));
        await fs.writeFile(path.join(root, 'build/new.js'), 'unverified');
      }
      return result;
    });
    expect((await nativeGeneratedCheckInputSnapshot(fingerprintInput(root))).complete).toBe(false);
    expect(changed).toBe(true);
  });

  it('keeps volatile Next output churn outside the generated root identity fence', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), '.next/\n');
    await fs.mkdir(path.join(root, '.next/types'), { recursive: true });
    await fs.writeFile(path.join(root, '.next/types/routes.d.ts'), 'export type Route = "/";');
    const input = fingerprintInput(root);
    const before = await nativeGeneratedCheckInputSnapshot(input);
    expect(before.complete).toBe(true);
    const query = gitCommands.runGitCommandAsync;
    let changed = false;
    vi.spyOn(gitCommands, 'runGitCommandAsync').mockImplementation(async (cwd, args) => {
      const result = await query(cwd, args);
      if (args.includes(':(literal).next/') && !changed) {
        changed = true;
        await fs.mkdir(path.join(root, '.next/cache'), { recursive: true });
        await fs.writeFile(path.join(root, '.next/cache/state'), 'volatile');
        await fs.writeFile(path.join(root, '.next/trace'), 'volatile');
      }
      return result;
    });
    expect(await nativeGeneratedCheckInputSnapshot(input)).toEqual(before);
    expect(changed).toBe(true);
  });

  it.each(['git', 'physical'])(
    'binds Next production artifacts while ignoring volatile output (%s)',
    async (capture) => {
      if (capture === 'physical') {
        await fs.rm(path.join(root, '.git'), { recursive: true, force: true });
        await fs.mkdir(path.join(root, '.git'));
      } else {
        await fs.writeFile(path.join(root, '.gitignore'), '.next/\n');
      }
      for (const relative of [
        '.next/server/app/page.js',
        '.next/server/app/logs/page.js',
        '.next/server/.worktrees/page.js',
        '.next/static/chunks/main.js',
        '.next/BUILD_ID',
        '.next/routes-manifest.json',
        '.next/dev/types/routes.d.ts',
      ]) {
        await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
        await fs.writeFile(path.join(root, relative), 'one');
      }
      let before = await nativeCheckInputSnapshot(fingerprintInput(root));
      expect(before.complete).toBe(true);
      for (const relative of [
        '.next/cache/webpack/cache.bin',
        '.next/trace',
        '.next/trace-build',
        '.next/dev/server/app/page.js',
        '.next/dev/cache/cache.bin',
      ]) {
        await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
        await fs.writeFile(path.join(root, relative), 'volatile');
      }
      expect((await nativeCheckInputSnapshot(fingerprintInput(root))).contentFingerprint).toBe(
        before.contentFingerprint,
      );
      for (const relative of [
        '.next/server/app/page.js',
        '.next/server/app/logs/page.js',
        '.next/server/.worktrees/page.js',
        '.next/static/chunks/main.js',
        '.next/BUILD_ID',
        '.next/routes-manifest.json',
        '.next/dev/types/routes.d.ts',
      ]) {
        const gate = await nativeCheckInputGate({ projectRoot: root, candidateId: null });
        await fs.writeFile(path.join(root, relative), 'two');
        const after = await nativeCheckInputSnapshot(fingerprintInput(root));
        expect(after.complete).toBe(true);
        expect(after.contentFingerprint, relative).not.toBe(before.contentFingerprint);
        if (capture === 'git')
          expect(
            await nativeCheckInputGate({ projectRoot: root, candidateId: null }),
            relative,
          ).not.toBe(gate);
        before = after;
      }
    },
  );

  it.each(['sensitive', 'symlink-root', 'symlink-ancestor'])(
    'reports incomplete generated input instead of stable reusable evidence (%s)',
    async (failure) => {
      await fs.writeFile(path.join(root, '.gitignore'), 'dist/\n.next/\npackages/\n');
      await fs.mkdir(path.join(root, 'dist'));
      if (failure === 'sensitive') {
        await fs.writeFile(path.join(root, 'dist/.env'), 'TOKEN=fixture');
        // .env 可以参与摘要；本反例继续验证敏感内容不可读取时不能复用证据。
        const open = fs.open;
        vi.spyOn(fs, 'open').mockImplementation((file, flags, mode) => {
          if (path.resolve(String(file)) === path.join(root, 'dist/.env'))
            return Promise.reject(
              Object.assign(new Error('fixture access denied'), { code: 'EACCES' }),
            );
          return open(file, flags, mode);
        });
      }
      if (failure === 'symlink-root') {
        await fs.symlink(
          path.join(root, 'dist'),
          path.join(root, '.next'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
      if (failure === 'symlink-ancestor') {
        await fs.mkdir(path.join(root, '.next'));
        await fs.mkdir(path.join(root, 'dist/types'));
        await fs.writeFile(path.join(root, 'dist/types/input.d.ts'), 'export type Value = 1;');
        await fs.symlink(
          path.join(root, 'dist'),
          path.join(root, '.next/dev'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
      const snapshot = await nativeCheckInputSnapshot(fingerprintInput(root));
      expect(snapshot.complete).toBe(false);
      expect(snapshot.diagnostics).not.toEqual([]);
      expect(snapshot.diagnostics.join(' ')).toMatch(/无法稳定读取|链接/);
      expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).toBeNull();
    },
  );

  it('hashes an ignored generated file beyond the former one GiB cap', async () => {
    await fs.writeFile(path.join(root, '.gitignore'), 'dist/\n');
    await fs.mkdir(path.join(root, 'dist'));
    const large = path.join(root, 'dist/large.bin');
    await fs.writeFile(large, '');
    await fs.truncate(large, 1024 * 1024 * 1024 + 1);
    const snapshot = await nativeCheckInputSnapshot(fingerprintInput(root));
    expect(snapshot.complete).toBe(true);
  }, 120_000);

  it('captures tracked deletions as known input rather than an unreadable snapshot', async () => {
    const before = await nativeCheckInputSnapshot(fingerprintInput(root));
    await fs.rm(path.join(root, 'committed.txt'));
    const after = await nativeCheckInputSnapshot(fingerprintInput(root));
    expect(after.complete).toBe(true);
    expect(after.contentFingerprint).not.toBe(before.contentFingerprint);
    expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).not.toBeNull();
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

describe('Native physical check input snapshots', () => {
  it('reports unreadable environment inputs by path without reusable evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-509-unreadable-'));
    try {
      const file = path.join(root, '.env.development');
      await fs.writeFile(file, 'SYNTHETIC_CONTENT=must-not-appear\n');
      const open = fs.open;
      vi.spyOn(fs, 'open').mockImplementation((target, flags, mode) => {
        if (String(target) === file)
          return Promise.reject(
            Object.assign(new Error('fixture access denied'), { code: 'EACCES' }),
          );
        return open(target, flags, mode);
      });
      const snapshot = await nativeCheckInputSnapshot(fingerprintInput(root));
      expect(snapshot.complete).toBe(false);
      expect(snapshot.diagnostics.join(' ')).toContain('.env.development');
      expect(snapshot.diagnostics.join(' ')).toContain('文件无法读取');
      expect(JSON.stringify(snapshot)).not.toContain('must-not-appear');
      expect(
        await nativeCandidateInputGate({ projectRoot: root, candidateId: 'unreadable' }),
      ).toBeNull();
    } finally {
      vi.restoreAllMocks();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it.each(['tracked', 'untracked', 'ignored'])(
    'binds environment files in independent child repositories under a non-Git root (%s)',
    async (tracking) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-509-inputs-'));
      try {
        for (const name of ['server', 'client']) {
          const child = path.join(root, name);
          await fs.mkdir(child);
          git(child, 'init', '--quiet');
          git(child, 'config', 'user.email', 'fixture@example.invalid');
          git(child, 'config', 'user.name', 'Fixture');
          await fs.writeFile(path.join(child, 'index.js'), 'export const value = 1;\n');
          await fs.writeFile(
            path.join(child, '.gitignore'),
            tracking === 'ignored' ? '.env*\n' : '',
          );
          git(child, 'add', '.');
          git(child, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'baseline');
        }
        const input = {
          ...fingerprintInput(root),
          candidateId: 'issue-509',
          managedArtifactRoot: path.join(root, 'docs'),
          plans: ['server', 'client'].map((cwdRef) => ({
            id: cwdRef,
            name: cwdRef,
            executable: process.execPath,
            argv: ['-e', 'process.exit(0)'],
            cwdRef,
            timeoutMs: 1000,
            repeatable: true,
          })),
        };
        const baseline = await nativeCandidateInputGate(input);
        expect(baseline).toMatch(/^[a-f0-9]{64}$/u);
        const child = path.join(root, 'client');
        const file = path.join(child, '.env.development');
        const content = 'VUE_APP_BASE_API=/synthetic-509\n';
        await fs.writeFile(file, content);
        if (tracking === 'tracked') {
          git(child, 'add', '.env.development');
          git(child, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'environment');
        }
        const gate = await nativeCandidateInputGate(input);
        expect(gate).toMatch(/^[a-f0-9]{64}$/u);
        expect(gate).not.toBe(baseline);
        expect(await nativeCandidateInputGate(input)).toBe(gate);
        const snapshot = await nativeCheckInputSnapshot(input);
        expect(snapshot.complete).toBe(true);
        expect(JSON.stringify(snapshot)).not.toContain(content.trim());
        await fs.writeFile(file, 'VUE_APP_BASE_API=/changed\n');
        expect(await nativeCandidateInputGate(input)).not.toBe(gate);
        expect((await nativeCheckInputSnapshot(input)).contentFingerprint).not.toBe(
          snapshot.contentFingerprint,
        );
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it('hashes environment and key filenames in generated inputs without exposing their contents', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-509-generated-'));
    try {
      git(root, 'init', '--quiet');
      git(root, 'config', 'user.email', 'fixture@example.invalid');
      git(root, 'config', 'user.name', 'Fixture');
      await fs.writeFile(path.join(root, '.gitignore'), 'dist/\n');
      git(root, 'add', '.');
      git(root, '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'baseline');
      await fs.mkdir(path.join(root, 'dist'));
      const input = fingerprintInput(root);
      const contents = 'synthetic-509-content-only-for-hashing';
      for (const name of ['.env', '.env.local', 'fixture.key', 'fixture.pem']) {
        await fs.writeFile(path.join(root, 'dist', name), contents);
      }
      const before = await nativeCheckInputSnapshot(input);
      expect(before.complete).toBe(true);
      expect(JSON.stringify(before)).not.toContain(contents);
      for (const name of ['.env', '.env.local', 'fixture.key', 'fixture.pem']) {
        const gate = await nativeCheckInputGate({ projectRoot: root, candidateId: null });
        expect(gate).toMatch(/^[a-f0-9]{64}$/u);
        await fs.writeFile(path.join(root, 'dist', name), `${contents}-changed`);
        expect(await nativeCheckInputGate({ projectRoot: root, candidateId: null })).not.toBe(gate);
      }
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('binds root configuration and generated Next types for non-Git subdirectory checks', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-physical-check-inputs-'));
    try {
      // Invalid local .git prevents discovery of an unrelated ancestor repository.
      await fs.mkdir(path.join(root, '.git'));
      await fs.mkdir(path.join(root, 'packages/app/.next/dev/types'), { recursive: true });
      await fs.mkdir(path.join(root, 'packages/app/.next/cache'), { recursive: true });
      await fs.writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":1}');
      const typeFile = path.join(root, 'packages/app/.next/dev/types/routes.d.ts');
      await fs.writeFile(typeFile, 'export type Route = "/";');
      const input = {
        ...fingerprintInput(root),
        plans: [
          {
            id: 'test',
            name: 'Test',
            executable: process.execPath,
            argv: ['-e', ''],
            cwdRef: 'packages/app',
            timeoutMs: 10_000,
            repeatable: true,
          },
        ],
      };
      const before = await nativeCheckInputSnapshot(input);
      const candidate = await nativeCandidateInputGate({
        projectRoot: root,
        candidateId: null,
        plans: input.plans,
      });
      expect(before.complete).toBe(true);
      await fs.writeFile(typeFile, 'export type Route = "/new";');
      const afterTypes = await nativeCheckInputSnapshot(input);
      expect(afterTypes.contentFingerprint).not.toBe(before.contentFingerprint);
      expect(
        await nativeCandidateInputGate({
          projectRoot: root,
          candidateId: null,
          plans: input.plans,
        }),
      ).toBe(candidate);
      await fs.writeFile(path.join(root, 'packages/app/.next/cache/cache.bin'), 'cache churn');
      expect((await nativeCheckInputSnapshot(input)).contentFingerprint).toBe(
        afterTypes.contentFingerprint,
      );
      await fs.writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":2}');
      expect((await nativeCheckInputSnapshot(input)).contentFingerprint).not.toBe(
        afterTypes.contentFingerprint,
      );
      expect(
        await nativeCandidateInputGate({
          projectRoot: root,
          candidateId: null,
          plans: input.plans,
        }),
      ).not.toBe(candidate);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
