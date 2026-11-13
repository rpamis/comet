import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createMemoryRuntimeStore,
  createRuntime,
  hashRuntimeValue,
  type RuntimeOutcome,
  type RuntimeValue,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  createClassicApplication,
  type ClassicApplicationOptions,
} from '../../../domains/comet-classic/classic-application.js';
import { upgradeClassicRun } from '../../../domains/comet-classic/classic-sdk-run-upgrade.js';
import {
  adaptApplicationSkill,
  createApplicationSkillExecutor,
  type WorkflowApplicationFactoryContext,
  type WorkflowApplicationManifest,
} from '../../../domains/workflow-application/index.js';

const fixtureRoot = 'test/fixtures/classic-052-fixed-application';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture(
  name: string,
  options: {
    currentCheckpoint?: boolean;
    withoutExistingRun?: boolean;
    scope?: 'build' | 'verify';
  } = {},
) {
  const directory = options.scope === 'verify' ? path.join(fixtureRoot, 'verify') : fixtureRoot;
  const original = JSON.parse(
    await fs.readFile(path.join(directory, `${name}.run.json`), 'utf8'),
  ) as WorkflowRun;
  const outcome = JSON.parse(
    await fs.readFile(path.join(directory, 'original-claimed-result.json'), 'utf8'),
  ) as RuntimeOutcome;
  const bundle = JSON.parse(
    await fs.readFile(path.join(directory, 'package-files.json'), 'utf8'),
  ) as { files: { ref: string; bytesBase64: string }[] };
  const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-published-extension-'));
  roots.push(packageRoot);
  for (const entry of bundle.files) {
    const file = path.join(packageRoot, entry.ref);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(entry.bytesBase64, 'base64'));
  }
  const manifest = JSON.parse(
    await fs.readFile(path.join(packageRoot, 'application.json'), 'utf8'),
  ) as WorkflowApplicationManifest;
  const skills = new Map(
    await Promise.all(
      manifest.skills.map(
        async (skill) => [skill.id, await adaptApplicationSkill(skill, packageRoot)] as const,
      ),
    ),
  );
  const projectRoot = (original.input as { projectRoot: string }).projectRoot;
  const context: WorkflowApplicationFactoryContext = {
    manifest,
    skills,
    projectRoot,
    packageRoot,
    existingRun: options.withoutExistingRun ? undefined : original,
    identity: {
      id: manifest.id,
      version: manifest.version,
      base: manifest.base,
      runtimeVersion: manifest.runtimeVersion,
      contentHash: 'a'.repeat(64),
      projectRoot,
      packageRoot,
    },
    createSkillExecutor: (host) =>
      createApplicationSkillExecutor({ manifest, skills, projectRoot }, host),
  };
  const source = await fs.readFile(path.join(packageRoot, 'application.mjs'), 'utf8');
  const composition = JSON.parse(source.match(/const composition = (.+);/u)![1]);
  const validate = vi.fn(({ outcome: result }: { outcome: RuntimeOutcome }) => ({
    accepted: isDeepStrictEqual(
      (result.output as { artifactHashes?: RuntimeValue }).artifactHashes,
      (outcome.output as { artifactHashes?: RuntimeValue }).artifactHashes,
    ),
  }));
  const configuration: ClassicApplicationOptions = {
    ...composition,
    extensions: composition.extensions.map((extension: { afterStep: string }) => ({
      ...extension,
      // Isolate routing tests from the separately tested old factory-option boundary.
      afterStep: options.currentCheckpoint
        ? options.scope === 'verify'
          ? 'hotfix.verify.report.evidence'
          : 'hotfix.build.execute'
        : extension.afterStep,
      validator: { id: 'example-actual-artifact', version: '1', validate },
    })),
    executors: [],
  };
  const implementation = createClassicApplication(context, configuration);
  const workflow = implementation.workflows[0];
  const handler = implementation.transitionHandlers![0];
  return { original, outcome, context, configuration, implementation, workflow, handler, validate };
}

it('loads published extension options before the original Portable Run is materialized', async () => {
  const f = await fixture('build-check-pending', { withoutExistingRun: true });
  expect(f.workflow.steps).not.toHaveProperty('hotfix.build.check');
  expect(f.workflow.steps).not.toHaveProperty('hotfix.verify.check');
  expect(f.workflow.steps).toHaveProperty('classic.extension.artifact-review');
  expect(f.workflow.transitions).toContainEqual({
    from: 'hotfix.build.execute',
    to: 'classic.extension.artifact-review',
  });
  for (const runtimeVersion of ['0.5.2', '0.5.3']) {
    const context = { ...f.context, manifest: { ...f.context.manifest, runtimeVersion } };
    expect(() =>
      createClassicApplication(context, {
        ...f.configuration,
        extensions: f.configuration.extensions!.map((extension) => ({
          ...extension,
          afterStep: 'hotfix.build.unknown.evidence',
        })),
      }),
    ).toThrow(/检查点/u);
  }
  expect(() =>
    createClassicApplication(
      { ...f.context, manifest: { ...f.context.manifest, runtimeVersion: '0.5.3' } },
      f.configuration,
    ),
  ).toThrow(/检查点/u);
});

it('keeps the published retired Build frontier at the required extension without replaying work', async () => {
  const f = await fixture('build-check-pending', { currentCheckpoint: true });
  const before = structuredClone(f.original);
  const converted = upgradeClassicRun(f.original, f.workflow, f.handler);
  expect(f.original).toEqual(before);
  expect(converted.input).toEqual(f.original.input);
  expect(converted.waits).toEqual(f.original.waits);
  expect(converted.state).toMatchObject({ phase: 'build' });
  expect(converted.ready.map((token) => token.to)).toEqual(['classic.extension.artifact-review']);
  expect(converted.ready[0].activation).toMatchObject({
    source: { event: { kind: 'action-outcome', stepId: 'hotfix.build.execute' } },
  });
  const store = createMemoryRuntimeStore<WorkflowRun>();
  await store.restoreCheckpoint!(converted.runId, null, converted);
  const runtime = createRuntime({ ...f.implementation, store });
  const resumed = await runtime.next({ runId: converted.runId });
  expect(resumed.actions.at(-1)?.stepId).toBe('classic.extension.artifact-review');
  expect(resumed.actions.at(-1)?.status).toBe('pending');
  expect(resumed.actions.filter((action) => action.stepId === 'hotfix.build.execute')).toHaveLength(
    1,
  );
  expect(resumed.actions.find((action) => action.stepId === 'hotfix.build.check')).toMatchObject({
    status: 'cancelled',
  });
  expect(
    resumed.actions.find((action) => action.stepId === 'hotfix.build.check')?.outcome,
  ).toBeUndefined();
  const action = resumed.actions.at(-1)!;
  const claimed = await runtime.claim({
    runId: resumed.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'example-artifact-host',
    capabilities: ['skill-script'],
    claimToken: 'simulated-platform-extension',
    expectedRevision: resumed.revision,
  });
  const completed = await runtime.recordOutcome({
    runId: resumed.runId,
    expectedRevision: claimed.revision,
    outcome: {
      ...f.outcome,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'simulated-platform-extension',
      outcomeId: 'simulated-platform-extension-result',
      output: {
        ...(f.outcome.output as object),
        sourceHash: hashRuntimeValue(
          (action.input as { activation: { source: RuntimeValue } }).activation.source,
        ),
      },
    },
  });
  expect(completed.actions.at(-1)?.stepId).toBe('hotfix.verify.run');
  expect(completed.state).toMatchObject({ phase: 'verify' });
  expect(completed.waits).toEqual(f.original.waits);
});

it.each(['build', 'verify'] as const)(
  'submits the original published %s extension claim without rewriting its source or repeating approved work',
  async (scope) => {
    const f = await fixture('extension-claimed', { scope });
    const before = structuredClone(f.original);
    const converted = upgradeClassicRun(f.original, f.workflow, f.handler);
    const originalAction = f.original.actions.find((action) => action.id === f.outcome.actionId)!;
    const store = createMemoryRuntimeStore<WorkflowRun>();
    await store.restoreCheckpoint!(converted.runId, null, converted);
    const runtime = createRuntime({ ...f.implementation, store });
    const submitted = await runtime.recordOutcome({
      runId: converted.runId,
      expectedRevision: converted.revision,
      outcome: f.outcome,
      context: { requestId: 'original-result', projectRoot: f.context.projectRoot },
    });
    expect(f.original).toEqual(before);
    const accepted = submitted.actions.find((action) => action.id === originalAction.id)!;
    expect(accepted.input).toEqual(originalAction.input);
    expect(accepted.inputHash).toBe(originalAction.inputHash);
    expect(accepted.claim).toEqual(originalAction.claim);
    expect(accepted.outcome).toEqual(f.outcome);
    expect(submitted.waits).toEqual(f.original.waits);
    expect(submitted.evidenceWaits).toEqual(f.original.evidenceWaits);
    expect(submitted.actions.at(-1)?.stepId).toBe(
      scope === 'build' ? 'hotfix.verify.run' : 'hotfix.archive.prepare',
    );
    expect(submitted.state).toMatchObject({ phase: scope === 'build' ? 'verify' : 'archive' });
    expect(
      submitted.actions.filter((action) => action.stepId === 'hotfix.build.execute'),
    ).toHaveLength(1);
    expect(
      submitted.actions.filter((action) => action.stepId === 'hotfix.build.check'),
    ).toHaveLength(1);
    expect(f.validate).toHaveBeenCalled();
  },
);

it.each(['build', 'verify'] as const)(
  'claims the original pending %s extension on its original input',
  async (scope) => {
    const f = await fixture('extension-pending', { scope });
    const converted = upgradeClassicRun(f.original, f.workflow, f.handler);
    const action = converted.actions.at(-1)!;
    const store = createMemoryRuntimeStore<WorkflowRun>();
    await store.restoreCheckpoint!(converted.runId, null, converted);
    const runtime = createRuntime({ ...f.implementation, store });
    const claimed = await runtime.claim({
      runId: converted.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'example-artifact-host',
      capabilities: ['skill-script'],
      sessionId: 'simulated-continuation-session',
      claimToken: 'simulated-continuation-claim',
      expectedRevision: converted.revision,
    });
    expect(claimed.actions.at(-1)?.input).toEqual(action.input);
    expect(claimed.actions.at(-1)?.id).toBe(action.id);
    const accepted = await runtime.recordOutcome({
      runId: converted.runId,
      expectedRevision: claimed.revision,
      outcome: {
        ...f.outcome,
        claimToken: 'simulated-continuation-claim',
        outcomeId: 'pending-result',
      },
    });
    expect(accepted.waits).toEqual(f.original.waits);
    expect(accepted.actions.at(-1)?.stepId).toBe(
      scope === 'build' ? 'hotfix.verify.run' : 'hotfix.archive.prepare',
    );
  },
);

it.each(['claim', 'input', 'source'] as const)(
  'rejects a detached published extension %s without accepting its result',
  async (kind) => {
    const f = await fixture('extension-claimed');
    const converted = upgradeClassicRun(f.original, f.workflow, f.handler);
    const store = createMemoryRuntimeStore<WorkflowRun>();
    await store.restoreCheckpoint!(converted.runId, null, converted);
    const runtime = createRuntime({ ...f.implementation, store });
    const outcome = {
      ...f.outcome,
      ...(kind === 'claim' ? { claimToken: 'another-claim' } : {}),
      ...(kind === 'input' ? { inputHash: '0'.repeat(64) } : {}),
      ...(kind === 'source'
        ? { output: { ...(f.outcome.output as object), sourceHash: '0'.repeat(64) } }
        : {}),
    };
    await expect(
      runtime.recordOutcome({
        runId: converted.runId,
        outcome,
        expectedRevision: converted.revision,
      }),
    ).rejects.toThrow();
    const after = await store.read(converted.runId);
    expect(after?.state).toEqual(converted.state);
    expect(after?.waits).toEqual(converted.waits);
    const action = after?.actions.find((entry) => entry.id === f.outcome.actionId);
    expect(action?.input).toEqual(converted.actions.at(-1)?.input);
    expect(action?.claim).toEqual(converted.actions.at(-1)?.claim);
    expect(action?.status).toBe('running');
    expect(action?.outcome).toBeUndefined();
  },
);

it('requires actual reports for the first result of a published already-claimed Builder', async () => {
  const f = await fixture('builder-claimed');
  const converted = upgradeClassicRun(f.original, f.workflow, f.handler);
  const action = converted.actions.find((entry) => entry.stepId === 'hotfix.build.execute')!;
  expect(action.status).toBe('running');
  expect(action.executionOrigin?.workflow.version).toBe('1');
  const store = createMemoryRuntimeStore<WorkflowRun>();
  await store.restoreCheckpoint!(converted.runId, null, converted);
  const runtime = createRuntime({ ...f.implementation, store });
  const outcome = {
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    claimToken: action.claim!.token,
    outcomeId: 'simulated-first-build-result-without-reports',
    status: 'succeeded' as const,
    output: { event: 'build-complete' },
  };
  await expect(
    runtime.recordOutcome({
      runId: converted.runId,
      outcome,
      expectedRevision: converted.revision,
    }),
  ).rejects.toThrow(/actual check reports/u);
  const rejected = (await store.read(converted.runId))!;
  expect(rejected.state).toEqual(converted.state);
  expect(rejected.actions.find((entry) => entry.id === action.id)?.status).toBe('running');
  expect(rejected.outputs[action.stepId]).toBeUndefined();

  execFileSync(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore', timeout: 5_000 });
  const accepted = await runtime.recordOutcome({
    runId: converted.runId,
    expectedRevision: rejected.revision,
    outcome: {
      ...outcome,
      outcomeId: 'simulated-first-build-result-with-real-node-report',
      output: {
        event: 'build-complete',
        checks: [{ name: 'actual isolated Node exit 0', result: 'passed' }],
      },
    },
  });
  expect(accepted.actions.find((entry) => entry.id === action.id)?.claim).toEqual(action.claim);
  expect(accepted.waits).toEqual(f.original.waits);
  expect(accepted.actions.at(-1)?.stepId).toBe('classic.extension.artifact-review');
});
