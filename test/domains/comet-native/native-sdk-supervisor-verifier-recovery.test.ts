import { sourceHooks } from '../../helpers/native-source-loader.mjs';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { prepareNativeApplication } from '../../helpers/native-application.js';
import {
  loadOwnedNativeSdkRuntime as sourceLoadOwnedNativeSdkRuntime,
  inspectNativeSdkDefinitionUpgrade as sourceInspectNativeSdkDefinitionUpgrade,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { parseNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { projectNativeSdkContinuation as sourceProjectNativeSdkContinuation } from '../../../domains/comet-native/native-sdk-continuation.js';
import { nativeDoctorCommand as sourceNativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { runNativeCli as sourceRunNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeSdkBeforeVerifierRecovery } from '../../../domains/comet-native/native-sdk-definition.js';
import {
  defineWorkflow,
  hashRuntimeValue,
  createPortableRunCheckpoint,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import { readWorkflowApplicationRun as sourceReadWorkflowApplicationRun } from '../../../domains/workflow-application/index.js';

const packageRoot = process.env.COMET_NATIVE_TEST_PACKAGE_ROOT;
const { loadOwnedNativeSdkRuntime, inspectNativeSdkDefinitionUpgrade } = packageRoot
  ? ((await import(
      pathToFileURL(path.join(packageRoot, 'dist/domains/comet-native/native-runtime-ownership.js'))
        .href
    )) as typeof import('../../../domains/comet-native/native-runtime-ownership.js'))
  : {
      loadOwnedNativeSdkRuntime: sourceLoadOwnedNativeSdkRuntime,
      inspectNativeSdkDefinitionUpgrade: sourceInspectNativeSdkDefinitionUpgrade,
    };
const { projectNativeSdkContinuation } = packageRoot
  ? ((await import(
      pathToFileURL(path.join(packageRoot, 'dist/domains/comet-native/native-sdk-continuation.js'))
        .href
    )) as typeof import('../../../domains/comet-native/native-sdk-continuation.js'))
  : { projectNativeSdkContinuation: sourceProjectNativeSdkContinuation };
const { nativeDoctorCommand } = packageRoot
  ? ((await import(
      pathToFileURL(path.join(packageRoot, 'dist/domains/comet-native/native-doctor-command.js'))
        .href
    )) as typeof import('../../../domains/comet-native/native-doctor-command.js'))
  : { nativeDoctorCommand: sourceNativeDoctorCommand };
const { readWorkflowApplicationRun } = packageRoot
  ? ((await import(
      pathToFileURL(path.join(packageRoot, 'dist/domains/workflow-application/index.js')).href
    )) as typeof import('../../../domains/workflow-application/index.js'))
  : { readWorkflowApplicationRun: sourceReadWorkflowApplicationRun };

const { runNativeCli } = packageRoot
  ? ((await import(
      pathToFileURL(path.join(packageRoot, 'dist/domains/comet-native/native-cli.js')).href
    )) as typeof import('../../../domains/comet-native/native-cli.js'))
  : { runNativeCli: sourceRunNativeCli };

type Fixture = Awaited<ReturnType<typeof prepareNativeApplication>>;
const roots: string[] = [];
afterAll(() => sourceHooks.deregister());
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function fixture(kind: 'custom' | 'native' = 'custom') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-child-verifier-recovery-'));
  roots.push(root);
  const f = await prepareNativeApplication(root, true, kind);
  f.git(f.projectRoot, ['config', 'user.name', 'Comet Test']);
  f.git(f.projectRoot, ['config', 'user.email', 'comet-test@example.com']);
  let run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: f.pending(f.run, 'supervisor.prepare').id,
    executorId: 'native-supervisor-prepare',
  });
  for (let count = 0; count < 2; count++)
    run = await f.dispatch({
      operation: 'execute',
      runId: f.name,
      actionId: f.pending(run, 'supervisor.child.prepare').id,
      executorId: 'native-supervisor-child-prepare',
    });
  const sibling = run.actions.filter((action) => action.stepId === 'supervisor.child.builder')[1];
  run = await f.submitBuilder(
    f.pending(run, 'supervisor.child.builder'),
    'approved\n',
    'left-builder',
  );
  run = await f.dispatch({
    operation: 'execute',
    runId: f.name,
    actionId: f.pending(run, 'supervisor.child.checks').id,
    executorId: 'comet-native-checks',
  });
  if (kind === 'custom')
    run = await f.dispatch({
      operation: 'execute',
      runId: f.name,
      actionId: f.pending(run, 'native.extension.child.candidate-review').id,
      executorId: 'native-review-script',
    });
  const verifier = f.pending(run, 'supervisor.child.verifier');
  run = await f.claim(verifier, 'left-verifier');
  return { ...f, run, verifier: run.actions.find((action) => action.id === verifier.id)!, sibling };
}
async function failVerifier(f: Awaited<ReturnType<typeof fixture>>) {
  return f.record(
    f.verifier,
    { summary: 'The original host executed and failed after starting the review' },
    'failed',
  );
}
async function decide(
  f: Fixture,
  run: WorkflowRun,
  action: 'retry-verifier' | 'revise-implementation',
  proposalHash?: string,
) {
  const wait = run.waits.findLast((wait) => wait.stepId === 'supervisor.child.verifier-retry')!;
  return f.native([
    'next',
    f.name,
    `--${action}`,
    '--summary',
    'The original failed host has stopped; use a new session',
    '--proposal-hash',
    proposalHash ?? wait.proposalHash,
    '--expected-state-version',
    String((run.state as { state_version: number }).state_version),
    '--expected-action',
    action,
  ]);
}

describe('Supervisor Child Verifier execution failure', () => {
  it('preserves a real custom application failure and receipts, advances its sibling, and retries only its review', async () => {
    const f = await fixture();
    const identity = (await loadOwnedNativeSdkRuntime(f.projectRoot, f.name)).application!.identity;
    let run = await failVerifier(f);
    expect(run.status).toBe('running');
    const original = run.actions.find((action) => action.id === f.verifier.id)!;
    expect(original).toMatchObject({
      status: 'failed',
      attempt: 1,
      claim: f.verifier.claim,
      outcome: { status: 'failed' },
      reconciliations: [],
    });
    expect(run.actions.find((action) => action.id === f.sibling.id)).toEqual(f.sibling);
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'supervisor.child.verifier-retry',
      status: 'pending',
      choices: ['retry', 'repair'],
    });
    const status = await f.native(['status', f.name]);
    expect(status).toMatchObject({
      continuation: { disposition: 'await-user', action: 'retry-verifier' },
    });
    expect(
      (status as { continuation: { commandAlternatives: unknown[] } }).continuation
        .commandAlternatives,
    ).toHaveLength(2);
    await expect(decide(f, run, 'retry-verifier', '0'.repeat(64))).rejects.toThrow('stale');
    await expect(
      f.dispatch({
        operation: 'retry',
        runId: f.name,
        actionId: original.id,
        attempt: original.attempt,
      }),
    ).rejects.toThrow('ACTION_ALREADY_ADVANCED');
    run = await f.submitBuilder(f.sibling, 'approved sibling\n', 'right-builder');
    const completedSibling = run.actions.find((action) => action.id === f.sibling.id)!;
    await decide(f, run, 'retry-verifier');
    const resumed = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    expect(resumed.application!.identity).toEqual(identity);
    run = await resumed.runtime.inspect(f.name);
    const retry = f.pending(run, 'supervisor.child.verifier');
    expect(retry.id).not.toBe(original.id);
    expect(retry).toMatchObject({
      attempt: 1,
      input: {
        activation: {
          ...(original.input as { activation: Record<string, string> }).activation,
          failedVerifierActionId: original.id,
        },
      },
    });
    expect(run.actions.find((action) => action.id === original.id)).toEqual(original);
    expect(run.actions.find((action) => action.id === f.sibling.id)).toEqual(completedSibling);
    expect(
      run.actions.filter(
        (action) =>
          ['supervisor.child.checks', 'native.extension.child.candidate-review'].includes(
            action.stepId,
          ) && action.status === 'succeeded',
      ),
    ).toHaveLength(2);
    run = await f.claim(retry, 'replacement-verifier');
    const claimed = run.actions.find((action) => action.id === retry.id)!;
    run = await f.record(claimed, {
      verdict: 'pass',
      candidateCommit: (retry.input as { activation: { candidateCommit: string } }).activation
        .candidateCommit,
      evidence: {
        summary: 'Independent replacement reviewed the retained candidate',
        checks: ['candidate-process'],
        acceptance: [
          { id: 'A1', result: 'passed', reason: 'Reviewed original candidate independently' },
        ],
      },
      integrationChecks: f.checks,
    });
    expect(f.pending(run, 'supervisor.child.integrate')).toBeTruthy();
    expect(run.actions.find((action) => action.id === original.id)).toEqual(original);
  });

  it('uses the same recovery Wait for the built-in Native Supervisor', async () => {
    const f = await fixture('native');
    const run = await failVerifier(f);
    expect(run.status).toBe('running');
    const original = run.actions.find((action) => action.id === f.verifier.id)!;
    expect(run.waits.at(-1)).toMatchObject({
      stepId: 'supervisor.child.verifier-retry',
      status: 'pending',
    });
    await decide(f, run, 'retry-verifier');
    const next = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(next.actions.find((action) => action.id === f.sibling.id)).toEqual(f.sibling);
    expect(next.actions.find((action) => action.id === original.id)).toEqual(original);
    expect(f.pending(next, 'supervisor.child.verifier').id).not.toBe(original.id);
  });

  it('offers a new Builder repair without changing the original execution failure', async () => {
    const f = await fixture();
    const run = await failVerifier(f);
    const original = run.actions.find((action) => action.id === f.verifier.id)!;
    await decide(f, run, 'revise-implementation');
    const next = await f.dispatch({ operation: 'inspect', runId: f.name });
    expect(next.actions.find((action) => action.id === original.id)).toEqual(original);
    expect(next.actions.at(-1)).toMatchObject({
      stepId: 'supervisor.child.builder',
      status: 'pending',
      input: { activation: { child: 'left', failedVerifierActionId: original.id } },
    });
    expect(next.actions.find((action) => action.id === f.sibling.id)).toEqual(f.sibling);
  });

  it('refuses a verifier retry after its successful check log has changed', async () => {
    const f = await fixture();
    const run = await failVerifier(f);
    const check = run.actions.find((action) => action.stepId === 'supervisor.child.checks')!;
    const log = (check.outcome!.output as { checks: Array<{ logRef: string }> }).checks[0].logRef;
    await fs.appendFile(path.join(f.projectRoot, log), 'tampered');
    await expect(decide(f, run, 'retry-verifier')).rejects.toThrow('log changed');
    expect(await f.dispatch({ operation: 'inspect', runId: f.name })).toEqual(run);
  });

  it('keeps an unknown verifier bound to its original task and creates no retry Wait', async () => {
    const f = await fixture();
    const { runtime } = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    const run = await runtime.markUnknown({
      runId: f.name,
      actionId: f.verifier.id,
      attempt: f.verifier.attempt,
      inputHash: f.verifier.inputHash,
      claimToken: f.verifier.claim!.token,
      reason: 'Original task result unavailable',
    });
    expect(run.waits.some((wait) => wait.stepId === 'supervisor.child.verifier-retry')).toBe(false);
    const status = await f.native(['status', f.name]);
    expect(status).toMatchObject({
      continuation: { disposition: 'blocked', requiredInputs: ['original-execution-result'] },
    });
    await expect(
      f.dispatch({
        operation: 'retry',
        runId: f.name,
        actionId: f.verifier.id,
        attempt: f.verifier.attempt,
      }),
    ).rejects.toThrow('RECONCILIATION_REQUIRED');
  });

  it('never advertises a pending claim for a failed or completed Run', async () => {
    const f = await fixture();
    const failed = await failVerifier(f);
    for (const status of ['failed', 'completed'] as const) {
      const run = { ...failed, status, reason: 'ACTION_FAILED: supervisor.child.verifier' };
      const projected = await projectNativeSdkContinuation({
        run,
        state: parseNativePortableState(run.state),
        projectRoot: f.projectRoot,
      });
      expect(projected.continuation).toMatchObject({ disposition: 'blocked', action: 'none' });
      expect(projected).not.toHaveProperty('pendingAction');
      expect(projected).not.toHaveProperty('pendingActions');
    }
  });
});

async function oldCustomFixture(
  mode: 'pending' | 'running-builder' | 'two-verifiers' | 'transfer-builder' = 'pending',
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-old-child-verifier-'));
  roots.push(root);
  const script = `
    import { prepareNativeApplication } from ${JSON.stringify(path.resolve('test/helpers/native-application.ts'))};
    const f = await prepareNativeApplication(${JSON.stringify(root)}, true, 'custom', process.env.COMET_NATIVE_BASELINE_PACKAGE);
    let run = await f.dispatch({operation:'execute',runId:f.name,actionId:f.pending(f.run,'supervisor.prepare').id,executorId:'native-supervisor-prepare'});
    for(let i=0;i<2;i++) run=await f.dispatch({operation:'execute',runId:f.name,actionId:f.pending(run,'supervisor.child.prepare').id,executorId:'native-supervisor-child-prepare'});
    const sibling=run.actions.filter(a=>a.stepId==='supervisor.child.builder')[1];
    if (${JSON.stringify(mode)} === 'transfer-builder') {
      const builder=f.pending(run,'supervisor.child.builder');
      await (await import('node:fs/promises')).writeFile(builder.input.activation.worktree+'/draft.txt','retained original draft');
      process.stdout.write(JSON.stringify({projectRoot:f.projectRoot,name:f.name,file:f.file,run,sibling}));
      process.exit(0);
    }
    run=await f.submitBuilder(f.pending(run,'supervisor.child.builder'),'approved\\n','original-builder');
    run=await f.dispatch({operation:'execute',runId:f.name,actionId:f.pending(run,'supervisor.child.checks').id,executorId:'comet-native-checks'});
    run=await f.dispatch({operation:'execute',runId:f.name,actionId:f.pending(run,'native.extension.child.candidate-review').id,executorId:'native-review-script'});
    if (${JSON.stringify(mode)} === 'running-builder') run=await f.claim(sibling,'original-sibling');
    if (${JSON.stringify(mode)} === 'two-verifiers') {
      run=await f.submitBuilder(sibling,'approved sibling\\n','right-builder');
      run=await f.dispatch({operation:'execute',runId:f.name,actionId:f.pending(run,'supervisor.child.checks').id,executorId:'comet-native-checks'});
      run=await f.dispatch({operation:'execute',runId:f.name,actionId:f.pending(run,'native.extension.child.candidate-review').id,executorId:'native-review-script'});
    }
    const verifiers=run.actions.filter(a=>a.stepId==='supervisor.child.verifier' && a.status==='pending');
    for (const verifier of verifiers) run=await f.claim(verifier,'original-verifier-'+verifier.id);
    for (const verifier of verifiers) run=await f.record(run.actions.find(a=>a.id===verifier.id),{summary:'Known failed host execution'},'failed');
    process.stdout.write(JSON.stringify({projectRoot:f.projectRoot,name:f.name,file:f.file,run,sibling}));
  `;
  const output = execFileSync(
    process.execPath,
    [
      '--import',
      path.resolve('test/helpers/native-source-loader.mjs'),
      '--input-type=module',
      '-e',
      script,
    ],
    {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: {
        ...process.env,
        ...(process.env.COMET_NATIVE_BASELINE_PACKAGE
          ? { COMET_TEST_SOURCE_APPLICATION: '0' }
          : { COMET_TEST_LEGACY_NATIVE: '1' }),
      },
      timeout: 120000,
    },
  );
  return JSON.parse(output) as {
    projectRoot: string;
    name: string;
    file: string;
    run: WorkflowRun;
    sibling: WorkflowRun['actions'][number];
  };
}

describe('fixed older custom Supervisor Runs', () => {
  it('transfers an old fixed custom definition without changing its hash or losing dirty Child work', async () => {
    const f = await oldCustomFixture('transfer-builder');
    const original = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    const identity = original.application!.identity;
    const transfer = path.join(path.dirname(f.projectRoot), 'transfer');
    const exported = await runNativeCli([
      'transfer',
      'export',
      f.name,
      '--output',
      transfer,
      '--confirmed-stopped',
      '--project-root',
      f.projectRoot,
      '--json',
    ]);
    expect(exported.exitCode, exported.stdout).toBe(0);
    const target = path.join(path.dirname(f.projectRoot), 'target');
    execFileSync('git', ['clone', '--no-local', f.projectRoot, target], { stdio: 'pipe' });
    await writeProjectConfig(target, defaultProjectConfig('docs', 'en'));
    const imported = await runNativeCli([
      'transfer',
      'import',
      '--input',
      transfer,
      '--project-root',
      target,
      '--json',
    ]);
    expect(imported.exitCode, imported.stdout).toBe(0);
    const relocated = await loadOwnedNativeSdkRuntime(target, f.name);
    const run = await relocated.runtime.inspect(f.name);
    expect(run.workflow).toEqual(f.run.workflow);
    expect(run.definitionHashes).toEqual(f.run.definitionHashes);
    expect(relocated.application!.identity).toEqual({
      ...identity,
      projectRoot: await fs.realpath(target),
    });
    expect(run.actions.map(({ id, stepId, status }) => ({ id, stepId, status }))).toEqual(
      f.run.actions.map(({ id, stepId, status }) => ({ id, stepId, status })),
    );
    const builder = run.actions.find(
      (action) => action.stepId === 'supervisor.child.builder' && action.status === 'pending',
    )!;
    expect(
      await fs.readFile(
        path.join(
          (builder.input as { activation: { worktree: string } }).activation.worktree,
          'draft.txt',
        ),
        'utf8',
      ),
    ).toBe('retained original draft');
  });

  it('diagnoses without writing and explicitly migrates the known failed definition while retaining identity and sibling work', async () => {
    const f = await oldCustomFixture();
    expect(f.run.status).toBe('failed');
    const before = await readWorkflowApplicationRun(
      f.projectRoot,
      'native-candidate-review',
      f.name,
    );
    const loaded = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name, { readOnly: true });
    expect(await loaded.runtime.inspect(f.name)).toEqual(before);
    const identity = loaded.application!.identity;
    const old = loaded.application!.implementation.workflows[0];
    expect(hashRuntimeValue(defineWorkflow(old))).toBe(f.run.workflow.hash);
    expect(old.steps).not.toHaveProperty('supervisor.child.verifier-retry');
    const diagnostic = await nativeDoctorCommand([f.name], f.projectRoot);
    expect(diagnostic).toMatchObject({
      exitCode: 65,
      data: { findings: [{ code: 'sdk-definition-upgrade-required', ready: true }] },
    });
    expect(
      await readWorkflowApplicationRun(f.projectRoot, 'native-candidate-review', f.name),
    ).toEqual(before);
    const repaired = await nativeDoctorCommand([f.name, '--repair'], f.projectRoot);
    expect(repaired, JSON.stringify(repaired)).toMatchObject({
      exitCode: 0,
      data: { repaired: true },
    });
    const current = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    expect(current.application!.identity).toEqual(identity);
    let run = await current.runtime.inspect(f.name);
    expect(run.actions).toEqual(f.run.actions);
    expect(run.waits).toEqual(f.run.waits);
    expect(run.outputs).toEqual(f.run.outputs);
    expect(run.reason).toBeUndefined();
    expect(run.ready).toMatchObject([
      { from: 'supervisor.child.verifier', to: 'supervisor.child.verifier-retry' },
    ]);
    expect(
      hashRuntimeValue(
        defineWorkflow(
          nativeSdkBeforeVerifierRecovery(current.application!.implementation.workflows[0]),
        ),
      ),
    ).toBe(f.run.workflow.hash);
    run = await current.runtime.next({ runId: f.name });
    const wait = run.waits.at(-1)!;
    expect(wait).toMatchObject({ stepId: 'supervisor.child.verifier-retry', status: 'pending' });
    run = await current.runtime.resolveWait({
      runId: f.name,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'approved-new-verifier-session',
      choice: 'retry',
    });
    expect(run.actions.at(-1)).toMatchObject({
      stepId: 'supervisor.child.verifier',
      status: 'pending',
    });
    expect(run.actions.find((action) => action.id === f.sibling.id)).toEqual(f.sibling);
    expect(run.actions.slice(0, -1)).toEqual(f.run.actions);
    expect(await inspectNativeSdkDefinitionUpgrade(f.projectRoot, f.name, true)).toBeNull();
  });

  it('preserves a sibling ready token after the original running Builder truthfully reports failure', async () => {
    const f = await oldCustomFixture('running-builder');
    const loaded = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    const sibling = f.run.actions.find((action) => action.id === f.sibling.id)!;
    const stopped = await loaded.runtime.recordOutcome({
      runId: f.name,
      outcome: {
        actionId: sibling.id,
        attempt: sibling.attempt,
        inputHash: sibling.inputHash,
        claimToken: sibling.claim!.token,
        outcomeId: 'original-sibling-stopped',
        status: 'failed',
        output: { summary: 'The original Builder actually failed and stopped' },
      },
      context: { requestId: 'original-sibling-stopped', projectRoot: f.projectRoot },
    });
    expect(stopped.ready).toHaveLength(1);
    expect(stopped.ready[0]).toMatchObject({
      from: 'supervisor.child.builder',
      to: 'supervisor.child.resume',
    });
    expect(await inspectNativeSdkDefinitionUpgrade(f.projectRoot, f.name, true)).toMatchObject({
      repaired: true,
    });
    const current = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    let run = await current.runtime.inspect(f.name);
    expect(run.actions).toEqual(stopped.actions);
    expect(run.ready[0]).toEqual(stopped.ready[0]);
    expect(run.ready).toHaveLength(2);
    run = await current.runtime.next({ runId: f.name });
    expect(
      run.waits
        .filter((wait) => wait.status === 'pending')
        .map((wait) => wait.stepId)
        .sort(),
    ).toEqual(['supervisor.child.resume', 'supervisor.child.verifier-retry']);
    expect(run.actions).toEqual(stopped.actions);
  });

  it('creates one recovery Wait per original failed Verifier when both independent children failed', async () => {
    const f = await oldCustomFixture('two-verifiers');
    const failed = f.run.actions.filter(
      (action) => action.stepId === 'supervisor.child.verifier' && action.status === 'failed',
    );
    expect(failed).toHaveLength(2);
    expect(await inspectNativeSdkDefinitionUpgrade(f.projectRoot, f.name, true)).toMatchObject({
      repaired: true,
    });
    const { runtime } = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    const run = await runtime.next({ runId: f.name });
    expect(run.actions).toEqual(f.run.actions);
    const waits = run.waits.filter(
      (wait) => wait.status === 'pending' && wait.stepId === 'supervisor.child.verifier-retry',
    );
    expect(waits).toHaveLength(2);
    expect(
      waits
        .map(
          (wait) =>
            (wait.proposal as { activation: { failedVerifierActionId: string } }).activation
              .failedVerifierActionId,
        )
        .sort(),
    ).toEqual(failed.map((action) => action.id).sort());
    expect(await inspectNativeSdkDefinitionUpgrade(f.projectRoot, f.name, true)).toBeNull();
    expect((await runtime.inspect(f.name)).waits).toEqual(run.waits);
  });

  it('restores a checkpoint-only old fixed application on the first writable load while read-only inspection stays unchanged', async () => {
    const f = await oldCustomFixture();
    await fs.rm(path.join(f.projectRoot, '.comet/runtime/applications'), { recursive: true });
    await expect(
      (async () => {
        const loaded = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name, { readOnly: true });
        await loaded.runtime.inspect(f.name);
      })(),
    ).rejects.toThrow('checkpoint recovery');
    expect(
      await readWorkflowApplicationRun(f.projectRoot, 'native-candidate-review', f.name),
    ).toBeNull();
    const restored = await loadOwnedNativeSdkRuntime(f.projectRoot, f.name);
    const run = await restored.runtime.inspect(f.name);
    expect(run.workflow).toEqual(f.run.workflow);
    expect(run.actions).toEqual(createPortableRunCheckpoint(f.run).run.actions);
    expect(run.status).toBe('failed');
    expect(restored.application!.implementation.workflows[0].steps).not.toHaveProperty(
      'supervisor.child.verifier-retry',
    );
  });

  it.each(['check-log', 'fixed-package', 'running-sibling'] as const)(
    'refuses unsafe old-run migration with %s and preserves its Run',
    async (caseName) => {
      const f = await oldCustomFixture(
        caseName === 'running-sibling' ? 'running-builder' : 'pending',
      );
      const before = await readWorkflowApplicationRun(
        f.projectRoot,
        'native-candidate-review',
        f.name,
      );
      if (caseName === 'check-log') {
        const check = f.run.actions.find((action) => action.stepId === 'supervisor.child.checks')!;
        await fs.appendFile(
          path.join(
            f.projectRoot,
            (check.outcome!.output as { checks: Array<{ logRef: string }> }).checks[0].logRef,
          ),
          'tampered',
        );
      } else if (caseName === 'fixed-package') {
        await fs.appendFile(
          path.join(path.dirname(f.file), 'application.mjs'),
          '\n// changed fixed package\n',
        );
      }
      await expect(inspectNativeSdkDefinitionUpgrade(f.projectRoot, f.name, true)).rejects.toThrow(
        caseName === 'check-log'
          ? 'log changed'
          : caseName === 'running-sibling'
            ? 'running or unknown'
            : '固定应用',
      );
      expect(
        await readWorkflowApplicationRun(f.projectRoot, 'native-candidate-review', f.name),
      ).toEqual(before);
    },
  );
});
