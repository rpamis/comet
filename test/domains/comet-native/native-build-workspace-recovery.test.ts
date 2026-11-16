import '../../helpers/isolated-agent-home.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';

interface NativeResult {
  exitCode: number;
  error?: { message: string };
  data?: {
    stateVersion?: number;
    phase?: string;
    preparation?: { projectRoot: string };
    task?: { actionId: string; session: string; status: string };
    continuation?: { commandAlternatives: Array<{ name: string; commandArgs: string[] }> };
  };
}

describe('Native Build workspace recovery', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-build-workspace-recovery-'));
    git('init', '-b', 'main');
    git('config', 'core.autocrlf', 'false');
    git('commit', '--allow-empty', '-m', 'Fixture baseline');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  function git(...args: string[]): void {
    execFileSync(
      'git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', ...args],
      {
        cwd: projectRoot,
        stdio: 'ignore',
      },
    );
  }

  async function cli(args: string[], root = projectRoot): Promise<NativeResult> {
    const result = await runNativeCli([
      ...args,
      ...(args.includes('--project-root') ? [] : ['--project-root', root]),
      ...(args.includes('--json') ? [] : ['--json']),
    ]);
    return JSON.parse(result.stdout!) as NativeResult;
  }

  async function prepareShape(names = ['shape-a', 'shape-b'], root = projectRoot): Promise<number> {
    for (const name of names) {
      const created = await cli(['new', name], root);
      expect(created.exitCode, created.error?.message).toBe(0);
    }
    const changeDir = path.join(root, 'docs/comet/changes/shape-a');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Outcome\nShip behavior.\n# Scope\nOne feature.\n## Directory structure\n### Modified\n- src/ — feature.\n# Non-goals\nNone.\n# Acceptance examples\n- Behavior works.\n# Constraints and invariants\nPreserve compatibility.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nFocused tests.\n',
    );
    await fs.mkdir(path.join(changeDir, 'specs/feature'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs/feature/spec.md'),
      '# Feature\nBehavior works.\n',
    );
    const ready = await cli(['next', 'shape-a'], root);
    expect(ready.exitCode, ready.error?.message).toBe(0);
    return ready.data!.stateVersion!;
  }

  async function approve(version: number, root = projectRoot): Promise<void> {
    const approved = await cli(
      [
        'next',
        'shape-a',
        '--confirmed',
        '--defer-build',
        '--summary',
        'Approve and queue implementation',
        '--expected-state-version',
        String(version),
        '--expected-action',
        'confirm-shape',
      ],
      root,
    );
    expect(approved.exitCode, approved.error?.message).toBe(0);
  }

  it('rejects shared Shape planning without a Git branch while retaining the single-change workflow', async () => {
    await fs.rename(path.join(projectRoot, '.git'), path.join(projectRoot, '.retained-git'));
    const version = await prepareShape(['shape-a']);
    const original = (await inspectNativeSdkRun(projectRoot, 'shape-a')).run;
    const rejected = await cli(['new', 'shape-b']);
    expect(rejected.exitCode).not.toBe(0);
    expect((await inspectNativeSdkRun(projectRoot, 'shape-a')).run).toEqual(original);
    await expect(
      fs.lstat(path.join(projectRoot, 'docs/comet/changes/shape-b')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await approve(version);
    const started = startPackagedBuild();
    expect(started.exitCode, started.error?.message).toBe(0);
    expect(started.data?.task?.status).toBe('running');
  });

  function startPackagedBuild(root = projectRoot): NativeResult {
    const result = spawnSync(
      process.execPath,
      [
        path.resolve('assets/skills/comet-native/scripts/comet-native-next.mjs'),
        'shape-a',
        '--session',
        'approved-builder',
        '--project-root',
        root,
        '--json',
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(result.error).toBeUndefined();
    return JSON.parse(result.stdout) as NativeResult;
  }

  it('preserves the approved planning branch before handoff and permits switching back', async () => {
    await approve(await prepareShape(['shape-a']));
    const approved = (await inspectNativeSdkRun(projectRoot, 'shape-a')).run;
    git('switch', '-c', 'other-planning-branch');
    expect((await cli(['new', 'shape-b'])).exitCode).toBe(0);
    const rejected = await cli(['next', 'shape-a']);
    expect(JSON.stringify(rejected)).toContain('confirm-current-branch-ownership');
    expect(rejected.data?.task).toBeUndefined();
    expect((await inspectNativeSdkRun(projectRoot, 'shape-a')).run).toEqual(approved);
    await expect(fs.lstat(path.join(projectRoot, '.worktrees/shape-a'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    git('switch', 'main');
    expect((await cli(['new', 'shape-c'])).exitCode).toBe(0);
    const started = startPackagedBuild();
    expect(started.exitCode, started.error?.message).toBe(0);
    expect(started.data?.task?.status).toBe('running');
    expect(
      (await inspectNativeSdkRun(path.join(projectRoot, '.worktrees/shape-a'), 'shape-a')).run.id,
    ).toBe(approved.id);
  });

  it.each([true, false])(
    'hands off edited Chinese Shape materials while preserving code checks (quotePath=%s)',
    async (quotePath) => {
      git('config', 'core.quotePath', String(quotePath));
      const version = await prepareShape();
      const material = 'docs/comet/changes/shape-a/补充 说明.md';
      const implementation = '实现.ts';
      await fs.writeFile(path.join(projectRoot, material), '# Initial notes\n');
      await fs.writeFile(path.join(projectRoot, implementation), '// Committed baseline\n');
      git('add', 'docs', implementation);
      git('commit', '-m', 'Commit Chinese Shape materials and implementation baseline');
      await fs.writeFile(path.join(projectRoot, material), '# Approved additional notes\n');
      await approve(version);
      const approved = (await inspectNativeSdkRun(projectRoot, 'shape-a')).run;

      await fs.writeFile(path.join(projectRoot, implementation), '// Pending implementation\n');
      const blocked = startPackagedBuild();
      expect(blocked.exitCode).not.toBe(0);
      expect(blocked.error?.message).toContain('committed code changes');
      expect((await inspectNativeSdkRun(projectRoot, 'shape-a')).run).toEqual(approved);
      git('add', implementation);
      git('commit', '-m', 'Commit implementation before handoff');

      const started = startPackagedBuild();
      expect(started.exitCode, started.error?.message).toBe(0);
      expect(started.data?.task).toMatchObject({ session: 'approved-builder', status: 'running' });
      const target = path.join(projectRoot, '.worktrees/shape-a');
      expect(await fs.readFile(path.join(target, material), 'utf8')).toBe(
        '# Approved additional notes\n',
      );
      expect(await fs.readFile(path.join(target, implementation), 'utf8')).toBe(
        '// Pending implementation\n',
      );
      const moved = (await inspectNativeSdkRun(target, 'shape-a')).run;
      expect(moved.id).toBe(approved.id);
      expect(moved.waits).toEqual(approved.waits);
      expect((await cli(['status', 'shape-b'])).data?.phase).toBe('shape');
    },
  );

  it('does not restore deleted committed Shape materials during first packaged Build handoff', async () => {
    const version = await prepareShape();
    const relative = 'docs/comet/changes/shape-a/specs/obsolete';
    await fs.mkdir(path.join(projectRoot, relative), { recursive: true });
    await fs.writeFile(path.join(projectRoot, relative, 'spec.md'), '# Obsolete requirement\n');
    git('add', 'docs');
    git('commit', '-m', 'Review initial Shape documents');
    await fs.rm(path.join(projectRoot, relative), { recursive: true });
    await approve(version);

    const approved = (await inspectNativeSdkRun(projectRoot, 'shape-a')).run;
    const started = startPackagedBuild();
    expect(started.exitCode, started.error?.message).toBe(0);
    expect(started.data?.task).toMatchObject({ session: 'approved-builder', status: 'running' });
    const target = path.join(projectRoot, '.worktrees/shape-a');
    await expect(fs.lstat(path.join(target, relative))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      await fs.readFile(
        path.join(target, 'docs/comet/changes/shape-a/specs/feature/spec.md'),
        'utf8',
      ),
    ).toBe('# Feature\nBehavior works.\n');
    const moved = (await inspectNativeSdkRun(target, 'shape-a')).run;
    expect(moved.id).toBe(approved.id);
    expect(moved.waits).toEqual(approved.waits);
    expect((await cli(['status', 'shape-b'])).data?.phase).toBe('shape');
  });

  it('rejects a stale existing Build branch before packaged handoff and permits its aligned baseline', async () => {
    git('branch', 'comet/shape-a');
    await fs.writeFile(
      path.join(projectRoot, 'implementation.txt'),
      'Current implementation baseline\n',
    );
    git('add', 'implementation.txt');
    git('commit', '-m', 'Advance implementation baseline');
    await approve(await prepareShape());
    const approved = (await inspectNativeSdkRun(projectRoot, 'shape-a')).run;

    const rejected = startPackagedBuild();
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.error?.message).toContain('baseline');
    expect((await inspectNativeSdkRun(projectRoot, 'shape-a')).run).toEqual(approved);
    await expect(fs.lstat(path.join(projectRoot, '.worktrees/shape-a'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    git('branch', '-f', 'comet/shape-a', 'HEAD');
    const started = startPackagedBuild();
    expect(started.exitCode, started.error?.message).toBe(0);
    const target = path.join(projectRoot, '.worktrees/shape-a');
    expect(await fs.readFile(path.join(target, 'implementation.txt'), 'utf8')).toBe(
      'Current implementation baseline\n',
    );
  });

  it('resumes a prepared clean checkout with inherited Shape documents before transfer publication', async () => {
    const version = await prepareShape();
    git('add', 'docs');
    git('commit', '-m', 'Commit reviewed Shape materials');
    await approve(version);
    const target = path.join(projectRoot, '.worktrees/shape-a');
    git('worktree', 'add', '-b', 'comet/shape-a', target);
    const started = startPackagedBuild();
    expect(started.exitCode, started.error?.message).toBe(0);
    expect(started.data?.task?.session).toBe('approved-builder');
    expect(
      (await inspectNativeSdkRun(target, 'shape-a')).run.actions.filter(
        (action) => action.stepId === 'build.builder' && action.status === 'running',
      ),
    ).toHaveLength(1);
  });

  it('preserves local implementation changes in a reused Build worktree', async () => {
    await fs.writeFile(path.join(projectRoot, 'implementation.txt'), 'Committed baseline\n');
    git('add', 'implementation.txt');
    git('commit', '-m', 'Implementation baseline');
    await approve(await prepareShape());
    const target = path.join(projectRoot, '.worktrees/shape-a');
    git('worktree', 'add', '-b', 'comet/shape-a', target);
    await fs.writeFile(path.join(target, 'implementation.txt'), 'Unrelated target work\n');
    const before = (await inspectNativeSdkRun(projectRoot, 'shape-a')).run;
    const rejected = startPackagedBuild();
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.error?.message).toContain('local changes');
    expect(await fs.readFile(path.join(target, 'implementation.txt'), 'utf8')).toBe(
      'Unrelated target work\n',
    );
    expect((await inspectNativeSdkRun(projectRoot, 'shape-a')).run).toEqual(before);
  });

  it('reads a redirected relative result from the original workspace instead of the target', async () => {
    await approve(await prepareShape());
    const started = startPackagedBuild();
    expect(started.exitCode, started.error?.message).toBe(0);
    const target = path.join(projectRoot, '.worktrees/shape-a');
    for (const [root, summary] of [
      [projectRoot, 'Actual source report'],
      [target, 'Wrong target report'],
    ]) {
      await fs.mkdir(path.join(root, '.comet/results'), { recursive: true });
      await fs.writeFile(
        path.join(root, '.comet/results/build.json'),
        JSON.stringify({ status: 'failed', output: null, summary }),
      );
    }
    const reported = await cli([
      'next',
      'shape-a',
      '--session',
      'approved-builder',
      '--action',
      started.data!.task!.actionId,
      '--result',
      '.comet/results/build.json',
    ]);
    expect(reported.exitCode, reported.error?.message).toBe(0);
    const run = (await inspectNativeSdkRun(target, 'shape-a')).run;
    expect(run.actions.find((action) => action.id === started.data!.task!.actionId)?.status).toBe(
      'failed',
    );
    expect(JSON.stringify(run)).toContain('Actual source report');
    expect(JSON.stringify(run)).not.toContain('Wrong target report');
  });

  it.each([
    [
      'reconsiders Build isolation after a failed Builder and renewed Shape approval',
      'failed',
      false,
    ],
    [
      'reconsiders Build isolation after a succeeded Builder and renewed Shape approval',
      'succeeded',
      false,
    ],
    ['admits another shared Shape after a failed Builder is reapproved', 'failed', true],
    ['admits another shared Shape after a succeeded Builder is reapproved', 'succeeded', true],
  ] as const)('%s', async (_name, builderStatus, peerAfterApproval) => {
    await fs.writeFile(path.join(projectRoot, 'implementation.txt'), 'Initial implementation\n');
    git('add', 'implementation.txt');
    git('commit', '-m', 'Initial implementation');
    await approve(await prepareShape(['shape-a']));
    const started = startPackagedBuild();
    expect(started.exitCode, started.error?.message).toBe(0);
    await fs.writeFile(
      path.join(projectRoot, 'implementation.txt'),
      'Preserved partial implementation\n',
    );
    const file = path.join(projectRoot, '.comet/failed-builder.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        status: builderStatus,
        output:
          builderStatus === 'failed'
            ? null
            : {
                summary: 'Implemented the original requirements.',
                addressedAcceptanceIds: ['A1'],
                acceptanceReview: fixtureAcceptanceReview(['A1']),
                checks: [],
                knownLimits: [],
                review: null,
                submittedAt: new Date().toISOString(),
              },
        summary: 'Requirements need revision',
      }),
    );
    const failed = await cli([
      'next',
      'shape-a',
      '--session',
      'approved-builder',
      '--action',
      started.data!.task!.actionId,
      '--result',
      file,
      ...(builderStatus === 'succeeded' ? ['--review', 'independent'] : []),
    ]);
    expect(failed.exitCode, failed.error?.message).toBe(0);
    const status = await cli(['status', 'shape-a', '--details']);
    const revision =
      builderStatus === 'failed'
        ? status.data?.continuation?.commandAlternatives.find(
            (option) => option.name === 'revise-requirements',
          )
        : {
            commandArgs: [
              'comet',
              'native',
              'next',
              'shape-a',
              '--revise-requirements',
              '--summary',
              'User approved revised requirements',
              '--expected-state-version',
              String(status.data!.stateVersion),
              '--expected-action',
              'revise-requirements',
            ],
          };
    expect(revision, JSON.stringify(status.data?.continuation)).toBeDefined();
    const revised = await cli(
      revision!.commandArgs
        .slice(2)
        .map((value) => (value === '<summary>' ? 'User approved revised requirements' : value)),
    );
    expect(revised.exitCode, revised.error?.message).toBe(0);
    if (!peerAfterApproval) expect((await cli(['new', 'shape-b'])).exitCode).toBe(0);
    const ready = await cli(['next', 'shape-a']);
    expect(ready.exitCode, ready.error?.message).toBe(0);
    await approve(ready.data!.stateVersion!);
    if (peerAfterApproval) expect((await cli(['new', 'shape-b'])).exitCode).toBe(0);
    const blocked = startPackagedBuild();
    expect(blocked.exitCode).not.toBe(0);
    expect(blocked.error?.message).toContain('committed code changes');
    git('add', 'implementation.txt');
    git('commit', '-m', 'Preserve reviewed partial implementation');
    const resumed = startPackagedBuild();
    expect(resumed.exitCode, resumed.error?.message).toBe(0);
    expect(
      await fs.readFile(path.join(projectRoot, '.worktrees/shape-a/implementation.txt'), 'utf8'),
    ).toBe('Preserved partial implementation\n');
  });

  it.each(['branch', 'worktree'] as const)(
    'hands off from a shared %s planning workspace already using the default execution name',
    async (isolation) => {
      const created = await cli(['new', 'shape-a', '--isolation', isolation]);
      expect(created.exitCode, created.error?.message).toBe(0);
      const planning = created.data!.preparation!.projectRoot;
      await approve(await prepareShape(['shape-b'], planning), planning);
      const original = (await inspectNativeSdkRun(planning, 'shape-a')).run;
      const peerFile = path.join(planning, 'docs/comet/changes/shape-b/brief.md');
      const peer = await fs.readFile(peerFile, 'utf8');
      const started = startPackagedBuild(planning);
      expect(started.exitCode, started.error?.message).toBe(0);
      expect(started.data?.task?.status).toBe('running');
      const target = path.join(projectRoot, '.worktrees/shape-a-build');
      expect(target).not.toBe(planning);
      expect((await inspectNativeSdkRun(target, 'shape-a')).run.runId).toBe(original.runId);
      expect(await fs.readFile(peerFile, 'utf8')).toBe(peer);
    },
  );

  it('preserves the current target checkpoint and original Builder when its local Run is missing', async () => {
    await approve(await prepareShape());
    const first = await cli(['next', 'shape-a', '--session', 'original-builder']);
    expect(first.exitCode, first.error?.message).toBe(0);
    expect(first.data?.task).toMatchObject({ session: 'original-builder', status: 'running' });

    const target = path.join(projectRoot, '.worktrees/shape-a');
    const checkpointFile = path.join(target, 'docs/comet/changes/shape-a/comet-state.yaml');
    const checkpoint = await fs.readFile(checkpointFile);
    const localRunDirectory = path.join(resolveWorkspaceRuntimeRootSync(target), 'sdk-runs/native');
    await fs.rename(localRunDirectory, `${localRunDirectory}-saved`);

    const retried = await cli(['next', 'shape-a', '--session', 'replacement-builder']);
    expect(retried.data?.task?.session).not.toBe('replacement-builder');
    expect(await fs.readFile(checkpointFile)).toEqual(checkpoint);

    const repaired = await cli(['doctor', 'shape-a', '--repair', '--confirmed'], target);
    expect(repaired.exitCode, repaired.error?.message).toBe(0);
    const resumed = await cli(['next', 'shape-a', '--session', 'original-builder'], target);
    expect(resumed.exitCode, resumed.error?.message).toBe(0);
    const recovered = (await inspectNativeSdkRun(target, 'shape-a', { readOnly: true })).run;
    const builder = recovered.actions.find((action) => action.stepId === 'build.builder');
    expect(builder?.id).toBe(first.data!.task!.actionId);
    expect(builder?.claim?.sessionId).toBe('original-builder');
    expect(['running', 'unknown']).toContain(builder?.status);
  });

  it('inherits committed Shape documents while preserving the approved Run', async () => {
    const version = await prepareShape();
    git('add', 'docs');
    git('commit', '-m', 'Review Shape documents');
    await approve(version);
    const started = await cli(['next', 'shape-a', '--session', 'approved-builder']);
    expect(started.exitCode, started.error?.message).toBe(0);
    expect(started.data?.task).toMatchObject({ session: 'approved-builder', status: 'running' });
    const target = path.join(projectRoot, '.worktrees/shape-a');
    const spec = 'docs/comet/changes/shape-a/specs/feature/spec.md';
    expect(await fs.readFile(path.join(target, spec), 'utf8')).toBe(
      await fs.readFile(path.join(projectRoot, spec), 'utf8'),
    );
    expect((await cli(['status', 'shape-b'])).data?.phase).toBe('shape');
  });
});
