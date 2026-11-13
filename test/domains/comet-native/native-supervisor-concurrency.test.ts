import '../../helpers/isolated-agent-home.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { collectNativeSdkShapeProposal } from '../../../domains/comet-native/native-sdk-application.js';
import type { WorkflowRun } from '../../../domains/engine/runtime.js';
import { dispatchNativeSupervisorReadyTasks } from '../../../domains/comet-native/native-supervisor-coordinator.js';
import { createNativeSupervisorState } from '../../../domains/comet-native/native-supervisor-model.js';
import { writeNativeSupervisorState } from '../../../domains/comet-native/native-supervisor-state.js';
import { prepareNativeSupervisorIntegrationWorkspace } from '../../../domains/comet-native/native-supervisor-workspace.js';
import { parseNativeChildrenContract } from '../../../domains/comet-native/native-children.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function supervisor(limit: number | undefined, mode: 'multi-session' | 'single-session') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-supervisor-concurrency-'));
  roots.push(root);
  const project = path.join(root, 'project');
  await fs.mkdir(project);
  const config = defaultProjectConfig('docs', 'en');
  if (limit === undefined) delete config.native.max_parallel_children;
  else config.native.max_parallel_children = limit;
  await writeProjectConfig(project, config);
  // Explicitly retain an old project document without the new optional field.
  if (limit === undefined) {
    const file = path.join(project, '.comet/config.yaml');
    await fs.writeFile(
      file,
      (await fs.readFile(file, 'utf8')).replace(/^\s+max_parallel_children:.*\r?\n/mu, ''),
    );
  }
  const change = path.join(project, 'docs/comet/changes/parallel');
  await fs.mkdir(path.join(change, 'specs/workflow'), { recursive: true });
  await fs.writeFile(
    path.join(change, 'brief.md'),
    '# Outcome\nShip independently verifiable features.\n# Acceptance examples\n- All features work together.\n',
  );
  await fs.writeFile(
    path.join(change, 'specs/workflow/spec.md'),
    '# Workflow\nAll features work together.\n',
  );
  await fs.writeFile(
    path.join(change, 'children.yaml'),
    'schema: comet.native.children.v2\nchildren:\n' +
      ['api', 'ui', 'worker-a', 'worker-b', 'worker-c']
        .map((name) => `  - name: ${name}\n    summary: Implement ${name}\n    depends_on: []\n`)
        .join('') +
      '  - name: dependent\n    summary: Integrate the API and UI\n    depends_on: [api, ui]\n',
  );
  await fs.writeFile(
    path.join(project, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n.worktrees/\n**/comet-state.yaml\n**/verification.md\n',
  );
  const git = (...args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Comet Test');
  git('config', 'user.email', 'comet-test@example.com');
  git('add', '.');
  git('commit', '-m', 'Supervisor fixture');
  let sequence = 0;
  function cli(args: string[]) {
    const result = spawnSync(
      process.execPath,
      [path.resolve('dist/app/cli/index.js'), ...args, '--project-root', project],
      {
        encoding: 'utf8',
        timeout: 60000,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    if (result.error) throw result.error;
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return JSON.parse(result.stdout).data;
  }
  async function dispatch(request: Record<string, unknown>): Promise<WorkflowRun> {
    const file = path.join(root, `request-${++sequence}.json`);
    await fs.writeFile(file, JSON.stringify(request));
    return cli(['runtime', 'dispatch', '--application', 'native', '--request', file, '--details']);
  }
  const initialState = createNativePortableState({
    name: 'parallel',
    language: 'en',
    workspace: {
      isolation: 'current',
      change_branch: 'main',
      target_branch: 'main',
      finish: null,
    },
  });
  let run = await dispatch({
    operation: 'start',
    runId: 'parallel',
    workflow: { id: 'comet-native', version: '4' },
    input: { name: 'parallel', artifactRootRef: 'docs' },
    initialState,
  });
  const action = run.actions.at(-1)!;
  run = await dispatch({
    operation: 'claim',
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'SIMULATED-shape-author',
    claimToken: 'shape-claim',
  });
  const paths = await nativeProjectPaths(project, 'docs');
  run = await dispatch({
    operation: 'record-outcome',
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'shape-claim',
      outcomeId: 'SIMULATED-shape-result',
      status: 'succeeded',
      output: await collectNativeSdkShapeProposal({ paths, state: initialState }),
    },
  });
  const wait = run.waits.at(-1)!;
  run = await dispatch({
    operation: 'resolve-wait',
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'SIMULATED-user-approved',
    choice: mode,
  });
  run = await dispatch({
    operation: 'execute',
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'native-supervisor-prepare',
  });
  return { project, config, run, dispatch, cli };
}

async function archiveFirstChild(f: Awaited<ReturnType<typeof supervisor>>, nextLimit: number) {
  let run = f.run;
  const preparation = run.actions.find((action) => action.stepId === 'supervisor.child.prepare')!;
  run = await f.dispatch({
    operation: 'execute',
    runId: run.runId,
    actionId: preparation.id,
    executorId: 'native-supervisor-child-prepare',
  });
  const worktree = path.join(f.project, '.worktrees/parallel-api');
  await fs.writeFile(path.join(worktree, 'api.txt'), 'API fixture implementation\n');
  execFileSync('git', ['add', 'api.txt'], { cwd: worktree, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'API fixture candidate'], {
    cwd: worktree,
    stdio: 'ignore',
  });
  const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: worktree,
    encoding: 'utf8',
  }).trim();
  async function submit(output: Record<string, unknown>, session: string) {
    const action = run.actions.at(-1)!;
    await f.dispatch({
      operation: 'claim',
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: session,
      claimToken: session,
    });
    run = await f.dispatch({
      operation: 'record-outcome',
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: session,
        outcomeId: session + '-result',
        status: 'succeeded',
        output,
      },
    });
  }
  await submit({ candidateCommit, checks: [] }, 'SIMULATED-child-builder');
  await submit(
    {
      candidateCommit,
      verdict: 'pass',
      evidence: {
        summary: 'SIMULATED Agent protocol result for fixture code.',
        checks: [],
        acceptance: [
          {
            id: 'child:api',
            result: 'passed',
            reason: 'SIMULATED Agent acceptance; no model Eval.',
          },
        ],
      },
    },
    'SIMULATED-child-verifier',
  );
  run = await f.dispatch({
    operation: 'execute',
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'native-supervisor-integrate',
  });
  f.config.native.max_parallel_children = nextLimit;
  await writeProjectConfig(f.project, f.config);
  return f.dispatch({
    operation: 'execute',
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'native-supervisor-child-archive',
  });
}

it.each([
  { limit: undefined, mode: 'multi-session' as const, expected: 2 },
  { limit: 4, mode: 'multi-session' as const, expected: 4 },
  { limit: 4, mode: 'single-session' as const, expected: 1 },
])(
  'uses the configured Supervisor limit through the public CLI ($mode, limit=$limit)',
  async ({ limit, mode, expected }) => {
    const f = await supervisor(limit, mode);
    const children = f.run.actions.filter((action) => action.stepId === 'supervisor.child.prepare');
    expect(children).toHaveLength(expected);
    expect(
      children.map(
        (action) => (action.input as { activation: { child: string } }).activation.child,
      ),
    ).not.toContain('dependent');
    expect(f.run.outputs['supervisor.prepare'].value).toMatchObject({
      maxParallelChildren: mode === 'single-session' ? 1 : (limit ?? 2),
    });
    if (limit === 4 && mode === 'multi-session') {
      const waits = f.run.waits;
      f.config.native.max_parallel_children = 1;
      await writeProjectConfig(f.project, f.config);
      const restored = await f.dispatch({ operation: 'inspect', runId: f.run.runId });
      expect(restored.actions).toEqual(f.run.actions);
      expect(restored.waits).toEqual(waits);
      try {
        f.cli(['native', 'next', 'parallel', '--session', 'SIMULATED-parent-agent', '--json']);
      } catch (error) {
        const diagnosis = await f.dispatch({ operation: 'inspect', runId: f.run.runId });
        throw new Error(
          `${String(error)}\n${JSON.stringify(diagnosis.actions.filter((action) => action.status === 'unknown').map(({ id, stepId, reason }) => ({ id, stepId, reason })))}`,
        );
      }
      const continued = await f.dispatch({ operation: 'inspect', runId: f.run.runId });
      expect(
        continued.actions
          .filter((action) => action.stepId === 'supervisor.child.prepare')
          .map((action) => action.id),
      ).toEqual(children.map((action) => action.id));
      expect(continued.outputs['supervisor.prepare'].value).toMatchObject({
        maxParallelChildren: 4,
      });
      expect(continued.waits).toEqual(waits);
    }
  },
  120000,
);

it.each([undefined, 1])(
  'uses the same project limit for Compat and retains an explicit override %s',
  async (override) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-supervisor-compat-capacity-'));
    roots.push(root);
    const config = defaultProjectConfig('docs', 'en');
    config.native.max_parallel_children = 4;
    await writeProjectConfig(root, config);
    await fs.writeFile(path.join(root, '.gitignore'), '.comet/\n.worktrees/\n');
    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', 'Comet Test');
    git('config', 'user.email', 'comet-test@example.com');
    git('add', '.');
    git('commit', '-m', 'Compat fixture');
    const prepared = await prepareNativeSupervisorIntegrationWorkspace({
      projectRoot: root,
      parent: 'compat',
      targetBranch: 'main',
      sourceConfig: config,
    });
    const state = createNativeSupervisorState({
      parent: 'compat',
      targetBranch: 'main',
      targetCommit: git('rev-parse', 'HEAD'),
      integrationBranch: prepared.binding.changeBranch!,
      integrationWorktree: prepared.projectRoot,
      contract: parseNativeChildrenContract(
        'schema: comet.native.children.v2\nchildren:\n' +
          ['api', 'ui', 'worker-a', 'worker-b', 'worker-c']
            .map(
              (name) => `  - name: ${name}\n    summary: Implement ${name}\n    depends_on: []\n`,
            )
            .join(''),
      ),
    });
    const paths = await nativeProjectPaths(root, 'docs');
    await writeNativeSupervisorState(paths, state);
    const dispatched = await dispatchNativeSupervisorReadyTasks({
      paths,
      parent: 'compat',
      maxParallel: override,
    });
    expect(dispatched.tasks).toHaveLength(override ?? 4);
    config.native.max_parallel_children = 1;
    await writeProjectConfig(root, config);
    const lowered = await dispatchNativeSupervisorReadyTasks({ paths, parent: 'compat' });
    expect(lowered.tasks).toEqual([]);
    expect(lowered.state.children.filter((child) => child.task !== null)).toHaveLength(
      override ?? 4,
    );
  },
  120000,
);

it.each([
  { before: 2, after: 4, totalPrepared: 5 },
  { before: 4, after: 1, totalPrepared: 4 },
])(
  'applies the parent limit at the next dispatch without replacing active children ($before to $after)',
  async ({ before, after, totalPrepared }) => {
    const f = await supervisor(before, 'multi-session');
    const originalChildren = f.run.actions.filter(
      (action) => action.stepId === 'supervisor.child.prepare',
    );
    const run = await archiveFirstChild(f, after);
    expect(run.outputs['supervisor.child.archive'].value).toMatchObject({
      maxParallelChildren: after,
      child: 'api',
    });
    const dispatched = run.actions.filter((action) => action.stepId === 'supervisor.child.prepare');
    expect(dispatched).toHaveLength(totalPrepared);
    expect(
      dispatched.map(
        (action) => (action.input as { activation: { child: string } }).activation.child,
      ),
    ).not.toContain('dependent');
    for (const action of originalChildren.slice(1))
      expect(run.actions.find((current) => current.id === action.id)).toEqual(action);
    expect(run.waits).toEqual(f.run.waits);
    const restored = await f.dispatch({ operation: 'inspect', runId: run.runId });
    expect(restored.actions).toEqual(run.actions);
    expect(restored.outputs['supervisor.child.archive']).toEqual(
      run.outputs['supervisor.child.archive'],
    );
  },
  120000,
);
