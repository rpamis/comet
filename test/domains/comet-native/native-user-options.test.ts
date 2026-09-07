import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { archiveNativePortableChange } from '../../../domains/comet-native/native-portable-archive.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { nativeWorkspaceIsClean } from '../../../domains/comet-native/native-workspace-config.js';

const roots: string[] = [];
const git = (root: string, args: string[]) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
async function cli(root: string, args: string[]) {
  const argv = [...args, '--project-root', root, '--json'];
  const result =
    process.env.COMET_TEST_NATIVE_RUNTIME === '1'
      ? {
          stdout: execFileSync(
            process.execPath,
            [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...argv],
            { cwd: root, encoding: 'utf8', windowsHide: true },
          ),
        }
      : await runNativeCli(argv);
  const payload = JSON.parse(result.stdout!);
  expect(payload.exitCode, JSON.stringify(payload)).toBe(0);
  return payload.data;
}
async function follow(root: string, args: string[]) {
  return cli(
    root,
    args.slice(2).map((arg) => (arg === '<summary>' ? 'User confirmed fixture' : arg)),
  );
}
async function input(root: string, name: string, value: unknown) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'native-options-input-'));
  roots.push(temp);
  const file = path.join(temp, 'input.json');
  await fs.writeFile(file, JSON.stringify(value));
  return cli(root, ['next', name, '--runner-input', file]);
}
async function repository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-user-options-'));
  roots.push(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Native Test']);
  git(root, ['config', 'user.email', 'native@example.test']);
  await fs.writeFile(
    path.join(root, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'seed']);
  return root;
}
const checks = (name: string, files: string[]) => [
  {
    id: name,
    name,
    executable: process.execPath,
    argv: [
      '-e',
      files
        .map(
          (file) =>
            `require('node:assert').equal(require('node:fs').readFileSync('${file}.txt','utf8'),'${file}')`,
        )
        .join(';'),
    ],
    cwdRef: '.',
    timeoutMs: 30000,
    repeatable: true,
  },
];
async function acceptCandidate(root: string, name: string, ids: string[], plans: unknown[]) {
  await input(root, name, {
    kind: 'builder-handoff',
    summary: 'Protocol regression fixture',
    addressed_acceptance_ids: ids,
    checks: [],
    known_limits: ['Fixture semantic verdict'],
    review: {
      status: 'passed',
      summary: 'Fixture review',
      reviewer_execution_ref: 'fixture-review',
    },
  });
  const dispatched = await input(root, name, { kind: 'dispatch-verifier', checks: plans });
  const result = await input(root, name, {
    kind: 'verifier-response',
    response: {
      kind: 'final-result',
      result: {
        iteration: dispatched.state.loop.iteration,
        attempt: dispatched.state.loop.attempt,
        verdict: 'pass',
        acceptance: ids.map((id) => ({ id, result: 'passed', reason: 'Fixture result' })),
        risks: [],
        summary: 'Fixture result',
      },
    },
  });
  return follow(
    root,
    result.continuation.commandAlternatives.find(
      (item: { name: string }) => item.name === 'accept-result',
    ).commandArgs,
  );
}
afterEach(async () => {
  for (const root of roots.splice(0).reverse()) {
    expect(path.relative(os.tmpdir(), root)).not.toMatch(/^\.\./u);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe('Native public user-option paths', () => {
  it.each(['branch', 'worktree'] as const)(
    'delivers Supervisor to its %s change and preserves keep',
    async (isolation) => {
      const primary = await repository();
      const original = git(primary, ['rev-parse', 'main']);
      // Exercise Runtime-created configuration, not a precommitted fixture config.
      const created = await cli(primary, ['new', 'parent', '--isolation', isolation]);
      const root = created.preparation.projectRoot;
      const dir = path.join(root, 'docs/comet/changes/parent');
      await fs.mkdir(path.join(dir, 'specs/options'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'specs/options/spec.md'),
        '# Requirement\nBoth outputs MUST be available.\n',
      );
      await fs.writeFile(
        path.join(dir, 'brief.md'),
        '# Acceptance examples\n- Alpha works.\n- Beta works.\n',
      );
      await fs.writeFile(
        path.join(dir, 'children.yaml'),
        'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: Alpha works.\n  A2:\n    source: brief.md\n    text: Beta works.\nchildren:\n  - name: alpha\n    depends_on: []\n    covers: [A1]\n  - name: beta\n    depends_on: []\n    covers: [A2]\n',
      );
      const prepared = await cli(root, [
        'next',
        'parent',
        '--summary',
        'Ready',
        '--coordination-mode',
        'single-session',
      ]);
      let state = await follow(root, prepared.continuation.commandAlternatives[0].commandArgs);
      // Simulate an upgrade from the old target binding, then loss of the
      // machine overlay. Both recover from the real portable/Git state.
      const supervisorFile = path.join(
        root,
        '.comet/runtime/native/changes/parent/supervisor/state.json',
      );
      const legacySupervisor = JSON.parse(await fs.readFile(supervisorFile, 'utf8'));
      legacySupervisor.integration.targetBranch = 'main';
      await fs.writeFile(supervisorFile, JSON.stringify(legacySupervisor));
      expect((await cli(root, ['status', 'parent'])).supervisor.integration.targetBranch).toBe(
        'comet/parent',
      );
      await fs.unlink(supervisorFile);
      expect((await cli(root, ['status', 'parent'])).supervisor.integration.targetBranch).toBe(
        'comet/parent',
      );
      const completed: string[] = [];
      for (const name of ['alpha', 'beta']) {
        expect(state.continuation.commandArgs).not.toBeNull();
        const dispatched = await follow(root, state.continuation.commandArgs);
        expect(dispatched.supervisorTasks).toHaveLength(1);
        let task = dispatched.supervisorTasks[0];
        expect(dispatched.readyChildren).toContain(name);
        expect(task.child).toBe(name);
        expect(nativeWorkspaceIsClean(task.projectRoot)).toBe(true);
        const status = await cli(root, ['status', 'parent']);
        const resumed = await follow(root, status.continuation.commandArgs);
        expect(resumed.supervisorTasks).toEqual(dispatched.supervisorTasks);
        expect(resumed.readyChildren).toEqual([]);
        const cancelled = await input(root, 'parent', {
          kind: 'supervisor-cancel',
          child: name,
          runId: task.runId,
          reason: 'Previous host session was lost',
        });
        const restarted = await follow(root, cancelled.continuation.commandArgs);
        expect(restarted.supervisorTasks).toHaveLength(1);
        expect(restarted.supervisorTasks[0].runId).not.toBe(task.runId);
        task = restarted.supervisorTasks[0];
        await fs.writeFile(path.join(task.projectRoot, `${name}.txt`), name);
        git(task.projectRoot, ['add', `${name}.txt`]);
        git(task.projectRoot, ['commit', '-m', `feat: ${name}`]);
        const candidateCommit = git(task.projectRoot, ['rev-parse', 'HEAD']);
        const verifier = (
          await input(root, 'parent', {
            kind: 'supervisor-builder-result',
            child: name,
            runId: task.runId,
            candidateCommit,
          })
        ).supervisorTask;
        const checked = await input(root, 'parent', {
          kind: 'supervisor-checks',
          child: name,
          runId: verifier.runId,
          checks: checks(name, [name]),
          materials: [],
        });
        expect(checked.checkExecution.status).toBe('completed');
        const verified = await input(root, 'parent', {
          kind: 'supervisor-verifier-result',
          child: name,
          runId: verifier.runId,
          verdict: 'pass',
          evidence: {
            summary: 'File assertion passed',
            checks: [],
            receiptRef: checked.checkExecution.receiptRef,
            acceptance: verifier.acceptance.map((item: { id: string }) => ({
              id: item.id,
              result: 'passed',
              reason: 'File assertion passed',
            })),
          },
        });
        completed.push(name);
        expect(verified.continuation.inputOptions[0].template).toMatchObject({
          kind: 'supervisor-integrate',
          child: name,
        });
        state = await input(root, 'parent', {
          ...verified.continuation.inputOptions[0].template,
          checks: checks(`integrate-${name}`, completed),
        });
      }
      await acceptCandidate(root, 'parent', ['A1', 'A2'], checks('parent', completed));
      const preview = await cli(root, ['archive', 'parent', '--dry-run', '--finish', 'keep']);
      expect(preview.ready).toBe(true);
      if (isolation === 'worktree') {
        await expect(
          archiveNativePortableChange({
            paths: await nativeProjectPaths(root, 'docs'),
            name: 'parent',
            hooks: {
              afterSpecApplied: async () => {
                throw new Error('simulated-archive-interruption');
              },
            },
          }),
        ).rejects.toThrow('simulated-archive-interruption');
      }
      const archived = await follow(root, preview.continuation.commandArgs);
      expect(archived.workspaceFinishResult.status).toBe('kept');
      expect(git(root, ['rev-parse', 'main'])).toBe(original);
      expect(await fs.readFile(path.join(root, 'alpha.txt'), 'utf8')).toBe('alpha');
      expect(await fs.readFile(path.join(root, 'beta.txt'), 'utf8')).toBe('beta');
      expect(git(root, ['worktree', 'list', '--porcelain'])).not.toContain('/parent-alpha');
      expect(git(root, ['branch', '--list', 'comet/supervisor/*'])).toBe('');
      expect(git(root, ['ls-files', '.comet/config.yaml'])).toBe('');
    },
    120000,
  );

  it('provides an executable serial Archive choice for two real worktrees', async () => {
    const primary = await repository();
    const worktrees: string[] = [];
    for (const name of ['first', 'second']) {
      const root = (await cli(primary, ['new', name, '--isolation', 'worktree'])).preparation
        .projectRoot;
      worktrees.push(root);
      const dir = path.join(root, 'docs/comet/changes', name);
      await fs.writeFile(
        path.join(dir, 'brief.md'),
        '# Acceptance examples\n- Shared behavior works.\n',
      );
      await fs.mkdir(path.join(dir, 'specs/shared'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'specs/shared/spec.md'),
        '# Requirement\nShared behavior MUST work.\n',
      );
      const prepared = await cli(root, ['next', name, '--summary', 'Ready']);
      await follow(root, prepared.continuation.commandAlternatives[0].commandArgs);
      await acceptCandidate(root, name, ['A1'], []);
    }
    const preview = await cli(worktrees[0], ['archive', 'first', '--dry-run', '--finish', 'keep']);
    expect(preview.ready).toBe(false);
    const ordered = await follow(
      worktrees[0],
      preview.continuation.commandAlternatives[0].commandArgs,
    );
    expect(ordered.ready).toBe(true);
    expect(ordered.continuation.commandArgs).toContain('--serial-first');
    const archived = await follow(worktrees[0], ordered.continuation.commandArgs);
    expect(archived.state.status).toBe('done');
  }, 120000);
});
