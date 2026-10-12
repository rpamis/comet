import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createRuntime,
  createFileRuntimeStore,
  hashRuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
  type RuntimeArtifactRef,
} from '../../domains/engine/runtime.js';
import { resolveWorkspaceRuntimeRootSync } from '../../domains/workflow-contract/workspace-runtime.js';
import {
  readApplicationFiles,
  applicationFilesHash,
} from '../../domains/workflow-application/skill-adapter.js';
import type { ApplicationIdentity } from '../../domains/workflow-application/index.js';

export async function completeFixtureAction(
  runtime: WorkflowRuntime,
  run: WorkflowRun,
  stepId: string,
  output: unknown,
  artifacts?: RuntimeArtifactRef[],
) {
  const action = run.actions.find((a) => a.stepId === stepId && a.status === 'pending')!;
  run = await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'fixture-host',
    claimToken: 'private-fixture-claim',
    capabilities: [],
    expectedRevision: run.revision,
  });
  return runtime.recordOutcome({
    runId: run.runId,
    expectedRevision: run.revision,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'private-fixture-claim',
      outcomeId: `outcome-${action.id}`,
      status: 'succeeded',
      output: output as never,
      ...(artifacts ? { artifacts } : {}),
    },
  });
}

export async function applicationObservationFixture(
  project: string,
  options: {
    id?: string;
    runId?: string;
    version?: string;
    parallel?: boolean;
    child?: boolean;
    deferChild?: boolean;
    claimParallel?: boolean;
  } = {},
) {
  const id = options.id ?? 'grill-suite',
    runId = options.runId ?? 'run-one',
    version = options.version ?? '1.1.0';
  const packageRoot = path.join(project, 'packages', id, version);
  await fs.mkdir(packageRoot, { recursive: true });
  await fs.writeFile(
    path.join(packageRoot, 'application.json'),
    JSON.stringify({
      schema: 'comet.workflow.application.v1',
      id,
      version,
      base: 'standalone',
      runtimeVersion: '0.5.0',
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    }),
  );
  await fs.writeFile(path.join(packageRoot, 'SKILL.md'), '# Fixed application\n');
  // 观测请求若误加载执行模块，这个哨兵会直接失败。
  await fs.writeFile(
    path.join(packageRoot, 'application.mjs'),
    'throw new Error("OBSERVATION_MUST_NOT_IMPORT");',
  );
  const packageHash = applicationFilesHash(await readApplicationFiles(packageRoot));
  const identity: ApplicationIdentity = {
    id,
    version,
    base: 'standalone',
    projectRoot: project,
    packageRoot,
    runtimeVersion: '0.5.0',
    contentHash: hashRuntimeValue({ package: packageHash, skills: [] }),
  };
  const rootDir = path.join(resolveWorkspaceRuntimeRootSync(project), 'applications', id);
  const outer = createFileRuntimeStore<{
    runId: string;
    revision: number;
    application: ApplicationIdentity;
    run: WorkflowRun;
  }>({ rootDir, mirroredRevisionPaths: ['run.revision'] });
  const store = {
    read: async (id: string) => (await outer.read(id))?.run ?? null,
    compareAndSwap: async (id: string, rev: number | null, run: WorkflowRun) =>
      outer.compareAndSwap(id, rev, {
        runId: id,
        revision: run.revision,
        application: identity,
        run,
      }),
  };
  const definition = {
    id: 'fixture',
    version: '1',
    entry: 'draft',
    steps: {
      draft: {
        type: 'handoff' as const,
        ref: 'draft',
        outputSchema: {
          type: 'object',
          properties: { scope: { type: 'string' }, apiKey: { type: 'string' } },
          required: ['scope'],
        },
      },
      implement: { type: 'handoff' as const, ref: 'implement' },
      regression: { type: 'handoff' as const, ref: 'regression' },
      approve: {
        type: 'ask_user' as const,
        proposalFrom: 'draft',
        choices: ['approved', 'rejected'],
      },
      review: { type: 'child_workflow' as const, workflow: { id: 'review', version: '1' } },
    },
    commands: { repeat: 'draft' },
    transitions: options.parallel
      ? [
          { from: 'draft', to: 'implement' },
          { from: 'draft', to: 'regression' },
          { from: 'draft', to: 'approve' },
          ...(options.child ? [{ from: 'draft', to: 'review' }] : []),
        ]
      : [],
  };
  const runtime = createRuntime({
    store,
    workflows: [
      definition,
      {
        id: 'review',
        version: '1',
        entry: 'proof',
        steps: {
          proof: {
            type: 'await_evidence',
            kind: 'host-proof',
            validator: { id: 'host-proof', version: '1' },
          },
        },
      },
    ],
    evidenceValidators: [{ id: 'host-proof', version: '1', validate: () => ({ accepted: true }) }],
  });
  let run = await runtime.start({
    runId,
    workflow: { id: 'fixture', version: '1' },
    input: { goal: '完成发布流程', password: 'private-fixture-password' },
  });
  if (options.parallel) {
    run = await completeFixtureAction(runtime, run, 'draft', {
      scope: 'current',
      apiKey: 'private-fixture-api-key',
    });
    if (options.claimParallel !== false)
      for (const stepId of ['implement', 'regression']) {
        const action = run.actions.find((a) => a.stepId === stepId)!;
        run = await runtime.claim({
          runId,
          expectedRevision: run.revision,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'fixture-host',
          claimToken: `private-${stepId}`,
          capabilities: [],
        });
      }
  }
  if (options.child && !options.deferChild)
    run = await runtime.next({ runId, expectedRevision: run.revision });
  return { identity, packageHash, runtime, run, outer, rootDir };
}

export async function creatorObservationFixture(
  project: string,
  runId = 'creator-draft',
  terminal?: 'stop' | 'install',
) {
  const rootDir = path.join(resolveWorkspaceRuntimeRootSync(project), 'creator');
  const store = createFileRuntimeStore<WorkflowRun>({ rootDir });
  const stepId = terminal ?? 'analyze';
  const runtime = createRuntime({
    store,
    workflows: [
      {
        id: 'comet-creator',
        version: '3',
        entry: stepId,
        steps: { [stepId]: { type: 'handoff', ref: stepId } },
      },
    ],
  });
  let run = await runtime.start({
    runId,
    workflow: { id: 'comet-creator', version: '3' },
    input: { goal: '让发布说明自动附带证据' },
  });
  if (terminal)
    run = await completeFixtureAction(
      runtime,
      run,
      stepId,
      terminal === 'stop'
        ? { stopped: true }
        : { target: 'exports/app', contentHash: 'a'.repeat(64) },
    );
  return { runtime, run, store, rootDir };
}
