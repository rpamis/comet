import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  nativePortableChangeDir,
  prepareNativePortableShapeConfirmation,
  confirmNativePortableShape,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { applyNativeRunnerInput } from '../../../domains/comet-native/native-runner-input.js';
import {
  dispatchNativeSupervisorReadyTasks,
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor.js';
import { executeNativeSupervisorChecks } from '../../../domains/comet-native/native-supervisor-evidence.js';
import { withNativeMutationLock } from '../../../domains/comet-native/native-mutation-lock.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-supervisor-process-'));
  roots.push(root);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.test');
  git(root, 'config', 'user.name', 'Test');
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  await fs.writeFile(
    path.join(root, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n.worktrees/\n',
  );
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'seed');
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  await createNativePortableChange({
    paths,
    name: 'change',
    language: 'en',
    workspaceBinding: { isolation: 'current', changeBranch: 'main', targetBranch: 'main' },
  });
  const changeDir = nativePortableChangeDir(paths, 'change');
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Acceptance examples\n- The behavior works.\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'children.yaml'),
    'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: The behavior works.\nchildren:\n  - name: core\n    depends_on: []\n    covers: [A1]\n',
  );
  await prepareNativePortableShapeConfirmation({ paths, name: 'change' });
  await confirmNativePortableShape({ paths, name: 'change' });
  const builder = (await dispatchNativeSupervisorReadyTasks({ paths, parent: 'change' })).tasks[0];
  await fs.writeFile(path.join(builder.projectRoot, 'feature.txt'), 'implemented');
  git(builder.projectRoot, 'add', 'feature.txt');
  git(builder.projectRoot, 'commit', '-m', 'implement');
  const result = await applyNativeRunnerInput({
    paths,
    name: 'change',
    maxVerifyFailures: 5,
    input: {
      kind: 'supervisor-builder-result',
      child: 'core',
      runId: builder.runId,
      candidateCommit: git(builder.projectRoot, 'rev-parse', 'HEAD'),
    },
  });
  const marker = path.join(root, 'starts.txt');
  const release = path.join(root, 'release');
  const code =
    "require('fs').appendFileSync(process.argv[1],String(process.pid)+'\\n');setInterval(()=>{if(require('fs').existsSync(process.argv[2]))process.exit(0)},25)";
  const options = {
    paths,
    parent: 'change',
    child: 'core',
    runId: result.supervisorTask!.runId,
    plans: [
      {
        id: 'slow',
        name: 'Slow check',
        executable: process.execPath,
        argv: ['-e', code, marker, release],
        cwdRef: '.',
        timeoutMs: 10000,
        repeatable: true,
      },
    ],
    materials: [],
  };
  return { root, paths, marker, release, options };
}

describe('Supervisor check process recovery', () => {
  it('does not start another check while the registered process outlives its recorded owner', async () => {
    const { paths, marker, release, options } = await setup();
    const running = executeNativeSupervisorChecks(options);
    try {
      let registered = false;
      for (let index = 0; index < 100; index += 1) {
        const state = await readNativeSupervisorState(paths, 'change');
        if (state!.children[0].task!.checkExecution?.activeProcess?.status === 'running') {
          registered = true;
          break;
        }
        await delay(50);
      }
      expect(registered).toBe(true);
      const stoppedPid = Number(
        execFileSync(process.execPath, ['-p', 'process.pid'], { encoding: 'utf8' }).trim(),
      );
      expect(() => process.kill(stoppedPid, 0)).toThrow();
      await withNativeMutationLock(paths, 'simulate exited Supervisor owner', async () => {
        const state = await readNativeSupervisorState(paths, 'change');
        state!.children[0].task!.checkExecution!.ownerPid = stoppedPid;
        await writeNativeSupervisorState(paths, state!);
      });
      const resumed = await executeNativeSupervisorChecks(options);
      expect(resumed.status).toBe('running');
      expect((await fs.readFile(marker, 'utf8')).trim().split(/\r?\n/u)).toHaveLength(1);
    } finally {
      await fs.writeFile(release, 'done');
      await running;
    }
    const completed = await executeNativeSupervisorChecks(options);
    expect(completed.status).toBe('completed');
    // A stopped owner and a finished child provide a safe boundary for a fresh attempt.
    await withNativeMutationLock(paths, 'simulate lost completion write', async () => {
      const state = await readNativeSupervisorState(paths, 'change');
      state!.children[0].task!.checkExecution!.status = 'running';
      await writeNativeSupervisorState(paths, state!);
    });
    const recovered = await executeNativeSupervisorChecks(options);
    expect(recovered.status).toBe('completed');
    expect(recovered.operationId).toBe(completed.operationId);
  }, 60000);

  it('does not replay an unregistered process and provides a candidate-preserving recovery route', async () => {
    const { paths, release, options } = await setup();
    await fs.writeFile(release, 'done');
    await executeNativeSupervisorChecks(options);
    const stoppedPid = Number(
      execFileSync(process.execPath, ['-p', 'process.pid'], { encoding: 'utf8' }).trim(),
    );
    expect(() => process.kill(stoppedPid, 0)).toThrow();
    await withNativeMutationLock(
      paths,
      'simulate interruption during process registration',
      async () => {
        const state = await readNativeSupervisorState(paths, 'change');
        const execution = state!.children[0].task!.checkExecution!;
        execution.status = 'running';
        execution.ownerPid = stoppedPid;
        execution.activeProcess = { status: 'starting', checkId: 'slow' };
        await writeNativeSupervisorState(paths, state!);
      },
    );
    await expect(executeNativeSupervisorChecks(options)).rejects.toThrow('supervisor-cancel');
    const before = await readNativeSupervisorState(paths, 'change');
    const cancelled = await applyNativeRunnerInput({
      paths,
      name: 'change',
      maxVerifyFailures: 5,
      input: {
        kind: 'supervisor-cancel',
        child: 'core',
        runId: options.runId,
        reason: 'Confirmed original check exited',
      },
    });
    expect(cancelled.supervisorState!.children[0].candidateCommit).toBe(
      before!.children[0].candidateCommit,
    );
    expect(cancelled.supervisorState!.children[0].status).toBe('needs-reverify');
  }, 60000);

  it('requires explicit retry for interrupted checks and preserves passed checks', async () => {
    const { paths, release, options } = await setup();
    const plans = [
      {
        ...options.plans[0],
        id: 'passed',
        name: 'Passed check',
        argv: ['-e', 'process.exit(0)'],
      },
      {
        ...options.plans[0],
        id: 'interrupted',
        name: 'Interrupted check',
        timeoutMs: 1000,
        argv: [
          '-e',
          "const fs=require('node:fs');const f=process.argv[1];if(fs.existsSync(f))process.exit(0);setInterval(()=>{},25)",
          release,
        ],
      },
    ];
    await expect(executeNativeSupervisorChecks({ ...options, plans })).rejects.toThrow(
      'was interrupted',
    );
    const interrupted = (await readNativeSupervisorState(paths, 'change'))!;
    const firstExecution = interrupted.children[0].task!.checkExecution!;
    expect(firstExecution.status).toBe('interrupted');
    expect(firstExecution.checkStates).toMatchObject([
      { id: 'passed', status: 'passed', executionCount: 1 },
      { id: 'interrupted', status: 'interrupted', executionCount: 1 },
    ]);

    const awaitingRetry = await executeNativeSupervisorChecks({ ...options, plans });
    expect(awaitingRetry).toMatchObject({
      status: 'interrupted',
      operationId: firstExecution.operationId,
    });
    await fs.writeFile(release, 'retry');
    const completed = await executeNativeSupervisorChecks({
      ...options,
      plans,
      retryCheckIds: ['interrupted'],
    });
    expect(completed.status).toBe('completed');
    const finalState = (await readNativeSupervisorState(paths, 'change'))!;
    expect(finalState.children[0].task!.checkExecution!.checkStates).toMatchObject([
      { id: 'passed', status: 'passed', executionCount: 1 },
      { id: 'interrupted', status: 'passed', executionCount: 2 },
    ]);
  }, 60000);
});
