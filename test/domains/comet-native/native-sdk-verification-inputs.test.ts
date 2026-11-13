import '../../helpers/isolated-agent-home.js';
import { projectNativeSdkContinuation } from '../../../domains/comet-native/native-sdk-continuation.js';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import type { NativePortableState } from '../../../domains/comet-native/native-portable-types.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
} from '../../../domains/comet-native/native-sdk-application.js';
import {
  createRuntime,
  createMemoryRuntimeStore,
  type WorkflowRun,
  type RuntimeValue,
} from '../../../domains/engine/runtime.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import {
  registerSdkChangeOwner,
  COMET_CHANGE_OWNER_SCHEMA,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import { refreshNativeSdkVerificationReport } from '../../../domains/comet-native/native-sdk-report.js';
import { upgradeNativeRun } from '../../../domains/comet-native/native-sdk-run-upgrade.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
type FixtureCommand = {
  id: string;
  name: string;
  executable: string;
  argv: string[];
  cwdRef: string;
  timeoutMs: number;
  repeatable: boolean;
};
type Report = {
  name: string;
  result: 'passed' | 'failed' | 'not-run';
  note: string;
};
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function writeProjectFile(root: string, ref: string, text: string) {
  await fs.mkdir(path.dirname(path.join(root, ref)), { recursive: true });
  await fs.writeFile(path.join(root, ref), text);
}
function observe(root: string, plans: FixtureCommand[]) {
  return plans.map((plan) => {
    const actual = spawnSync(plan.executable, plan.argv, {
      cwd: path.resolve(root, plan.cwdRef),
      windowsHide: true,
      timeout: plan.timeoutMs,
    });
    return {
      name: plan.name,
      result: actual.status === 0 ? 'passed' : 'failed',
      note: 'Actual platform exit ' + actual.status + '; ' + String(actual.stdout ?? ''),
      exitCode: actual.status,
    };
  });
}
async function report(
  runtime: ReturnType<typeof createRuntime>,
  run: WorkflowRun,
  root: string,
  output: unknown,
  session: string,
  receipt: string,
) {
  let action = run.actions.at(-1)!;
  if (action.status === 'pending') {
    run = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId: session,
      claimToken: receipt,
      context: { projectRoot: root, requestId: 'claim-' + receipt },
    });
    action = run.actions.at(-1)!;
  }
  return runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim!.token,
      outcomeId: receipt,
      status: 'succeeded',
      output: output as RuntimeValue,
    },
    context: { projectRoot: root, requestId: receipt },
  });
}
async function candidate(
  options: {
    artifactRootRef?: string;
    checkSource?: string;
    executeChecks?: boolean;
    verificationChecks?: FixtureCommand[];
    files?: Record<string, string>;
    prepareProject?: (root: string) => Promise<void>;
    builderOverrides?: Record<string, unknown>;
    documentWrites?: 'allow' | 'revert';
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-verification-inputs-'));
  roots.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  await writeProjectFile(root, '.gitignore', '.next/\n');
  await writeProjectFile(root, 'value.ts', 'export const value = 1;\n');
  for (const [file, content] of Object.entries(options.files ?? {}))
    await writeProjectFile(root, file, content);
  await writeProjectFile(root, '.next/types/routes.d.ts', 'export type Route = "/";\n');
  await writeProjectFile(root, '.next/dev/types/routes.d.ts', 'export type DevRoute = "/";\n');
  await writeProjectFile(root, '.next/server/app/page.js', 'good');
  await writeProjectFile(root, '.next/static/chunks/main.js', 'good');
  await writeProjectFile(root, '.next/BUILD_ID', 'build-one');
  await writeProjectFile(root, '.next/routes-manifest.json', '{}');
  execFileSync('git', ['add', '.gitignore', 'value.ts'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
    { cwd: root },
  );
  const artifactRootRef = options.artifactRootRef ?? 'docs';
  const config = defaultProjectConfig(artifactRootRef, 'en');
  await writeProjectConfig(root, {
    ...config,
    native: {
      ...config.native,
      ...(options.documentWrites ? { document_writes: options.documentWrites } : {}),
    },
  });
  await options.prepareProject?.(root);
  const paths = await nativeProjectPaths(root, artifactRootRef);
  await ensureNativeDirectories(paths);
  const changeDir = path.join(paths.changesDir, 'verification-inputs');
  await fs.mkdir(changeDir);
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    `# Outcome
Preserve the verified application.
# Scope
Preserve the selected workflow.
## Directory structure
### Modified
- value.ts: preserve the selected value.
# Non-goals
None.
# Acceptance examples
- The selected value is available.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run focused Native checks.
`,
  );
  await writeProjectFile(
    changeDir,
    'specs/workflow/spec.md',
    '# Workflow\nThe selected value remains available.\n',
  );
  const initialState = createNativePortableState({
    name: 'verification-inputs',
    language: 'en',
    createdAt: '2026-10-23T00:00:00.000Z',
    nextAction: 'prepare-shape-confirmation',
  });
  const application = defineNativeWorkflowApplication('4'),
    store = createNativeSdkStateStore(root),
    runtime = createRuntime({
      ...application,
      store,
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
    });
  let run = await runtime.start({
    runId: 'verification-inputs',
    workflow: { id: application.workflow.id, version: '4' },
    input: { name: 'verification-inputs', artifactRootRef },
    initialState,
  });
  await registerSdkChangeOwner(root, {
    schema: COMET_CHANGE_OWNER_SCHEMA,
    workflow: 'native',
    change: run.runId,
    format: 'sdk',
    application: 'native',
    runId: run.runId,
  });
  run = await report(
    runtime,
    run,
    root,
    await collectNativeSdkShapeProposal({ paths, state: initialState }),
    'SIMULATED-shape-Agent',
    'shape-proposal',
  );
  const shape = run.waits.at(-1)!;
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: shape.id,
    proposalHash: shape.proposalHash,
    choice: 'approved',
    decisionId: 'SIMULATED-USER-original-Shape-approved',
  });
  const check: FixtureCommand = {
    id: 'application-inputs',
    name: 'Read actual application and generated types',
    executable: process.execPath,
    argv: [
      '-e',
      options.checkSource ??
        'for(const file of ["value.ts",".next/types/routes.d.ts",".next/dev/types/routes.d.ts",".next/server/app/page.js",".next/static/chunks/main.js",".next/BUILD_ID",".next/routes-manifest.json"])require("node:fs").readFileSync(file,"utf8");process.stdout.write("verified");',
    ],
    cwdRef: '.',
    timeoutMs: 5000,
    repeatable: true,
  };
  const plans = options.verificationChecks ?? [check],
    observations = options.executeChecks === false ? [] : observe(root, plans);
  run = await report(
    runtime,
    run,
    root,
    {
      summary: 'SIMULATED Agent implements the approved candidate.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: observations.map(({ name, result, note }) => ({
        name,
        result,
        note,
      })),
      requireIndependentReview: true,
      knownLimits: [],
      ...options.builderOverrides,
    },
    'builder-session',
    'builder-candidate',
  );
  return {
    root,
    paths,
    changeDir,
    runtime,
    store,
    run,
    check,
    plans,
    observations,
  };
}
type Fixture = Awaited<ReturnType<typeof candidate>>;
async function verify(
  f: Fixture,
  run = f.run,
  verdict: 'pass' | 'fail' = 'pass',
  checks: Report[] = f.observations as Report[],
  receipt = 'verifier-final',
) {
  const state = run.state as NativePortableState,
    session = run.actions.at(-1)!.claim?.sessionId ?? 'verifier-session';
  return report(
    f.runtime,
    run,
    f.root,
    {
      candidateId: state.builder_handoff!.candidate_id,
      verifierExecutionRef: session,
      checks: checks.map(({ name, result, note }) => ({ name, result, note })),
      response: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict,
          acceptance: [
            {
              id: 'A1',
              result: verdict === 'pass' ? 'passed' : 'failed',
              reason: 'SIMULATED independent report based on actual platform observations.',
            },
          ],
          risks: [],
          summary: 'SIMULATED independent acceptance report.',
        },
      },
    },
    session,
    receipt,
  );
}
async function approve(f: Fixture, run: WorkflowRun, id = 'SIMULATED-USER-result-approved') {
  const wait = run.waits.at(-1)!;
  expect(wait).toMatchObject({ stepId: 'verify.confirm', status: 'pending' });
  return f.runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    choice: 'approved',
    decisionId: id,
  });
}
async function archive(f: Fixture, run: WorkflowRun) {
  if (run.waits.at(-1)?.status === 'pending') run = await approve(f, run);
  for (const executorId of [
    'comet-native-archive-preflight',
    'comet-native-archive-apply',
    'comet-native-archive-finalize',
  ])
    run = await f.runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId,
      context: { projectRoot: f.root, requestId: executorId },
    });
  expect(run).toMatchObject({
    status: 'completed',
    state: { archived: true, status: 'done' },
  });
  expect(run.actions.at(-1)).toMatchObject({
    stepId: 'archive.finalize',
    status: 'succeeded',
  });
  const archived = run.outputs['archive.execute'].value as {
    archiveRef: string;
  };
  expect(await fs.stat(path.join(f.paths.archiveDir, archived.archiveRef))).toBeDefined();
  await expect(fs.access(f.changeDir)).rejects.toMatchObject({
    code: 'ENOENT',
  });
  expect(await fs.readFile(path.join(f.paths.specsDir, 'workflow/spec.md'), 'utf8')).toContain(
    'The selected value remains available.',
  );
  return run;
}
async function revise(
  f: Fixture,
  run: WorkflowRun,
  oldWait: WorkflowRun['waits'][number],
  phase: 'verify' | 'archive',
) {
  if (phase === 'verify')
    return f.runtime.resolveWait({
      runId: run.runId,
      waitId: oldWait.id,
      proposalHash: oldWait.proposalHash,
      choice: 'rejected',
      decisionId: 'SIMULATED-USER-implementation-revision',
    });
  const state = run.state as NativePortableState;
  run = await f.runtime.dispatchCommand({
    runId: run.runId,
    expectedRevision: run.revision,
    commandId: 'authorized-implementation-revision',
    name: 'revise-implementation',
    input: {
      reason: 'SIMULATED USER explicitly requests original implementation revision.',
      expectedStateVersion: state.state_version,
      proposalHash: oldWait.proposalHash,
      archiveActionId: run.actions.at(-1)!.id,
    },
    context: { projectRoot: f.root, requestId: 'revision-command' },
  });
  return f.runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-native-revise-implementation',
    context: { projectRoot: f.root, requestId: 'revision-execute' },
  });
}
async function builder(f: Fixture, run: WorkflowRun, checks: Report[], receipt: string) {
  const action = run.actions.at(-1)!,
    previous = (run.state as NativePortableState).builder_handoff?.candidate_id;
  expect(action).toMatchObject({ stepId: 'build.builder', status: 'pending' });
  const project = (value: WorkflowRun) =>
    projectNativeSdkContinuation({
      run: value,
      state: value.state as NativePortableState,
      projectRoot: f.root,
    });
  expect((await project(run)).continuation.action).toBe('builder-handoff');
  run = await f.runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'native-host',
    sessionId: 'repair-builder',
    claimToken: receipt + '-claim',
  });
  const active = await project(run);
  expect(active.continuation.mode).toBe('wait');
  expect(active.continuation.action).not.toBe('review-edit');
  expect(active.activeActions?.[0]).toMatchObject({
    id: action.id,
    status: 'running',
  });
  run = await report(
    f.runtime,
    run,
    f.root,
    {
      summary: 'SIMULATED Agent repairs the same approved requirement.',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: checks.map(({ name, result, note }) => ({ name, result, note })),
      requireIndependentReview: true,
      knownLimits: [],
    },
    'repair-builder',
    receipt,
  );
  expect((run.state as NativePortableState).builder_handoff!.candidate_id).not.toBe(previous);
  expect((await project(run)).continuation.action).toBe('dispatch-verifier');
  return run;
}

describe('Native Agent platform verification reports', () => {
  it.each([
    [
      'checks.result',
      { checks: [{ name: 'check', result: 'pass' }] },
      /checks\[0\]\.result.*passed.*failed.*not-run.*pass/u,
    ],
    [
      'acceptanceReview.evidence',
      {
        acceptanceReview: [
          {
            id: 'A1',
            status: 'implemented-with-evidence',
            evidence: 'proof',
            note: 'Done.',
          },
        ],
      },
      /acceptanceReview\[0\].*A1.*evidence.*array.*string/u,
    ],
    [
      'acceptanceReview.note',
      {
        acceptanceReview: [
          {
            id: 'A1',
            status: 'implemented-with-evidence',
            evidence: ['proof'],
            note: '',
          },
        ],
      },
      /acceptanceReview\[0\].*A1.*note.*concrete/u,
    ],
  ])(
    'reports the exact invalid Builder field without misleading claim diagnostics: %s',
    async (_field, overrides, expected) => {
      await expect(
        candidate({ builderOverrides: overrides as Record<string, unknown> }),
      ).rejects.toThrow(expected as RegExp);
    },
  );
  it('retains only the Agent-selected arbitrary check across a repaired candidate without language detection', async () => {
    const plans = ['left.unknown', 'right.py'].map((file, index) => ({
      id: index === 0 ? 'left' : 'right',
      name: 'Read ' + file,
      executable: process.execPath,
      argv: [
        '-e',
        "const fs=require('node:fs');fs.appendFileSync('.git/read-" +
          index +
          "','x');process.stdout.write(fs.readFileSync('" +
          file +
          "','utf8'));",
      ],
      cwdRef: '.',
      timeoutMs: 5000,
      repeatable: true,
    }));
    const f = await candidate({
        files: {
          'left.unknown': 'original left',
          'right.py': 'uncompiled right',
        },
        verificationChecks: plans,
      }),
      original = f.run.actions.find((a) => a.stepId === 'build.builder')!,
      shape = structuredClone(f.run.waits);
    let run = await verify(f, f.run, 'fail');
    await writeProjectFile(f.root, 'left.unknown', 'changed selected left');
    const left = observe(f.root, [plans[0]])[0],
      right = f.observations[1];
    run = await builder(f, run, [left, right] as Report[], 'selective-repair');
    expect(await fs.readFile(path.join(f.root, '.git/read-0'), 'utf8')).toBe('xx');
    expect(await fs.readFile(path.join(f.root, '.git/read-1'), 'utf8')).toBe('x');
    expect(run.actions.find((a) => a.id === original.id)).toEqual(original);
    expect(
      (
        run.actions.findLast((a) => a.stepId === 'build.builder')!.outcome!.output as {
          checks: Report[];
        }
      ).checks[1],
    ).toEqual({ name: right.name, result: right.result, note: right.note });
    expect(run.waits).toEqual(shape);
    await verify(f, run, 'pass', [left, right] as Report[], 'repaired-independent-review');
  });
  it('completes Archive after the Builder, platform checks and Verifier finish normally', async () => {
    const f = await candidate();
    await archive(f, await verify(f));
  });
  it.each(['HTTP_PROXY', 'PATH', 'TEMP'])(
    'accepts a final result from another shell with a different %s and unchanged inputs',
    async (variable) => {
      const f = await candidate(),
        old = process.env[variable];
      vi.stubEnv(
        variable,
        variable === 'PATH'
          ? (old ?? '') + path.delimiter + path.join(f.root, 'other-bin')
          : variable === 'HTTP_PROXY'
            ? 'http://different-proxy.invalid:3128'
            : path.join(f.root, 'other-temp'),
      );
      const run = await verify(f);
      expect(run.waits.at(-1)).toMatchObject({
        stepId: 'verify.confirm',
        status: 'pending',
      });
      await archive(f, run);
    },
  );
  it('records an actual nonzero source-changing platform check as failed and returns to Build', async () => {
    const f = await candidate({
        executeChecks: false,
        checkSource:
          'require("node:fs").writeFileSync("value.ts","export const value=2;\\n");process.exit(7);',
      }),
      actual = observe(f.root, [f.check]);
    expect(actual[0].exitCode).toBe(7);
    const verifier = f.run.actions.at(-1)!,
      run = await verify(f, f.run, 'fail', actual as Report[]);
    expect(run.actions.find((a) => a.id === verifier.id)).toMatchObject({
      outcome: {
        output: {
          checks: [{ result: 'failed' }],
          response: { result: { verdict: 'fail' } },
        },
      },
    });
    expect(run.state).toMatchObject({ phase: 'build', status: 'active' });
    expect(run.actions.at(-1)?.stepId).toBe('build.builder');
    expect(await fs.readFile(path.join(f.root, 'value.ts'), 'utf8')).toContain('value=2');
  });
  it('rejects a retired checker alias request without replaying a one-shot platform operation', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'actual-platform-once-'));
    roots.push(directory);
    const counter = path.join(directory, 'counter'),
      plan: FixtureCommand = {
        id: 'once',
        name: 'One-shot actual operation',
        executable: process.execPath,
        argv: ['-e', "require('node:fs').appendFileSync(" + JSON.stringify(counter) + ",'x')"],
        cwdRef: '.',
        timeoutMs: 5000,
        repeatable: false,
      },
      f = await candidate({ verificationChecks: [plan] }),
      state = f.run.state as NativePortableState,
      original = f.run.actions.find((a) => a.stepId === 'build.builder')!;
    await expect(
      report(
        f.runtime,
        f.run,
        f.root,
        {
          candidateId: state.builder_handoff!.candidate_id,
          verifierExecutionRef: 'alias-verifier',
          refreshChecks: true,
          response: {
            kind: 'request-checks',
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            checks: [{ ...plan, id: 'alias', repeatable: true }],
          },
        },
        'alias-verifier',
        'retired-alias-request',
      ),
    ).rejects.toThrow();
    const current = await f.runtime.inspect(f.run.runId);
    expect(current.actions.find((a) => a.id === original.id)).toEqual(original);
    expect(current.actions.some((a) => a.stepId === 'verify.requested-checks')).toBe(false);
    expect((current.state as NativePortableState).builder_handoff!.candidate_id).toBe(
      state.builder_handoff!.candidate_id,
    );
    expect(await fs.readFile(counter, 'utf8')).toBe('x');
    await archive(
      f,
      await verify(
        f,
        current,
        'pass',
        f.observations as Report[],
        'alias-original-corrected-result',
      ),
    );
    expect(await fs.readFile(counter, 'utf8')).toBe('x');
  });
});
async function publishedHistory() {
  const frozen = JSON.parse(
      await fs.readFile(
        path.resolve('test/fixtures/native-052-sdk-archive-upgrade/archive-prepare-pending.json'),
        'utf8',
      ),
    ),
    original = frozen.run as WorkflowRun,
    app = defineNativeWorkflowApplication(),
    converted = upgradeNativeRun(original, app.workflow, app.transitionHandler),
    store = createMemoryRuntimeStore<WorkflowRun>();
  await store.restoreCheckpoint(original.runId, null, converted);
  const runtime = createRuntime({
    ...app,
    store,
    workflows: [app.workflow],
    transitionHandlers: [app.transitionHandler],
  });
  return {
    original,
    converted,
    runtime,
    check: original.actions.find((a) => a.stepId === 'verify.checks' && a.status === 'succeeded')!,
  };
}
it('keeps a persisted published check result as read-only history after business adaptation', async () => {
  const f = await publishedHistory(),
    run = await f.runtime.inspect(f.original.runId),
    old = run.actions.find((a) => a.id === f.check.id)!;
  expect(old.outcome).toEqual(f.check.outcome);
  expect(old.claim).toEqual(f.check.claim);
  expect(old.input).toEqual(f.check.input);
  expect(run.actions.filter((a) => a.stepId === 'verify.checks')).toHaveLength(1);
  expect(run.waits).toEqual(f.original.waits);
});
it('keeps original published check history across shells without re-execution or content-proof authority', async () => {
  const f = await publishedHistory();
  vi.stubEnv('HTTP_PROXY', 'http://another-shell.invalid:3128');
  vi.stubEnv('TEMP', path.join(os.tmpdir(), 'new-verifier-temp'));
  const run = await f.runtime.next({ runId: f.original.runId });
  expect(run.actions.find((a) => a.id === f.check.id)?.outcome).toEqual(f.check.outcome);
  expect(run.actions.filter((a) => a.stepId === 'verify.checks')).toHaveLength(1);
  expect(run.runId).toBe(f.original.runId);
  expect(run.waits).toEqual(f.original.waits);
});
it.each(['verify', 'archive'] as const)(
  'A4 continues an Agent-reviewed behavior change from %s and retains only the unaffected one-shot check',
  async (phase) => {
    const plans: FixtureCommand[] = [
        {
          id: 'a',
          name: 'Selected behavior',
          executable: process.execPath,
          argv: [
            '-e',
            'const fs=require("node:fs"),v=Number(fs.readFileSync("value.ts","utf8"));if(![1,2].includes(v))process.exit(1);fs.appendFileSync(".git/a4-a",String(v));',
          ],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: true,
        },
        {
          id: 'b',
          name: 'Unrelated one-shot',
          executable: process.execPath,
          argv: [
            '-e',
            'const fs=require("node:fs");if(fs.readFileSync("right.unknown","utf8")!=="stable")process.exit(1);fs.writeFileSync(".git/a4-b","once",{flag:"wx"});',
          ],
          cwdRef: '.',
          timeoutMs: 5000,
          repeatable: false,
        },
      ],
      f = await candidate({
        verificationChecks: plans,
        files: { 'right.unknown': 'stable' },
        prepareProject: (root) => writeProjectFile(root, 'value.ts', '1\n'),
      }),
      originalBuilder = f.run.actions.find((a) => a.stepId === 'build.builder')!,
      shape = structuredClone(f.run.waits);
    let run = await verify(f);
    await refreshNativeSdkVerificationReport(f.root, run);
    const originalVerifier = run.actions.findLast((a) => a.stepId === 'verify.verifier')!,
      oldReport = await fs.readFile(path.join(f.changeDir, 'verification.md'), 'utf8'),
      oldWait = run.waits.at(-1)!;
    if (phase === 'archive') run = await approve(f, run, 'SIMULATED-USER-original-result-approved');
    const approvedHistory = structuredClone(run.waits.find((w) => w.id === oldWait.id));
    await writeProjectFile(f.root, 'value.ts', '2\n');
    run = await revise(f, run, oldWait, phase);
    expect(run.state).toMatchObject({ phase: 'build' });
    expect(run.waits.filter((w) => w.stepId === 'shape.confirm')).toEqual(shape);
    expect(await fs.readFile(path.join(f.changeDir, 'verification.md'), 'utf8')).toBe(oldReport);
    const selected = observe(f.root, [plans[0]])[0],
      checks = [selected, f.observations[1]] as Report[];
    run = await builder(f, run, checks, 'a4-successor-builder');
    run = await verify(f, run, 'pass', checks, 'a4-successor-verifier');
    const nextWait = run.waits.at(-1)!;
    expect(nextWait.id).not.toBe(oldWait.id);
    expect(nextWait.proposalHash).not.toBe(oldWait.proposalHash);
    expect(run.actions.find((a) => a.id === originalBuilder.id)).toEqual(originalBuilder);
    if (phase === 'archive')
      expect(run.waits.find((w) => w.id === oldWait.id)).toEqual(approvedHistory);
    run = await archive(f, run);
    expect(run.actions.find((a) => a.id === originalVerifier.id)).toEqual(originalVerifier);
    expect(run.waits.find((w) => w.id === nextWait.id)).toMatchObject({
      status: 'resolved',
      decision: { choice: 'approved' },
    });
    expect(
      run.actions.filter((a) => a.stepId === 'build.builder' && a.status === 'succeeded'),
    ).toHaveLength(2);
    expect(
      run.actions.filter((a) => a.stepId === 'verify.verifier' && a.status === 'succeeded'),
    ).toHaveLength(2);
    expect(run.actions.filter((a) => a.stepId === 'archive.execute')).toHaveLength(1);
    expect(run.waits.filter((w) => w.stepId === 'shape.confirm')).toEqual(shape);
    expect(await fs.readFile(path.join(f.root, '.git/a4-a'), 'utf8')).toBe('12');
    expect(await fs.readFile(path.join(f.root, '.git/a4-b'), 'utf8')).toBe('once');
  },
);
it('observes a selected Git-index failure after byte-identical staging and preserves one-time history through explicit repair', async () => {
  const gitCheck: FixtureCommand = {
      id: 'git-index',
      name: 'Git index empty',
      executable: 'git',
      argv: ['diff', '--cached', '--quiet'],
      cwdRef: '.',
      timeoutMs: 5000,
      repeatable: true,
    },
    once: FixtureCommand = {
      id: 'b',
      name: 'One-shot unrelated operation',
      executable: process.execPath,
      argv: ['-e', 'require("node:fs").writeFileSync(".git/a9-once","once",{flag:"wx"});'],
      cwdRef: '.',
      timeoutMs: 5000,
      repeatable: false,
    };
  const f = await candidate({
    verificationChecks: [gitCheck, once],
    prepareProject: async (root) => {
      await writeProjectFile(root, 'value.ts', 'export const value=0;\n');
      execFileSync('git', ['add', 'value.ts'], { cwd: root });
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          'commit',
          '--quiet',
          '-m',
          'original index',
        ],
        { cwd: root },
      );
      await writeProjectFile(root, 'value.ts', 'export const value=1;\n');
    },
  });
  let run = await verify(f);
  const oldWait = run.waits.at(-1)!;
  run = await approve(f, run);
  const original = structuredClone(run),
    bytes = await fs.readFile(path.join(f.root, 'value.ts')),
    head = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: f.root,
      encoding: 'utf8',
    });
  execFileSync('git', ['add', 'value.ts'], { cwd: f.root });
  const failed = observe(f.root, [gitCheck])[0];
  expect(failed.exitCode).toBe(1);
  expect(await fs.readFile(path.join(f.root, 'value.ts'))).toEqual(bytes);
  expect(
    execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: f.root,
      encoding: 'utf8',
    }),
  ).toBe(head);
  expect(await f.runtime.inspect(run.runId)).toEqual(original);
  run = await revise(f, run, oldWait, 'archive');
  const failedChecks = [failed, f.observations[1]] as Report[];
  run = await builder(f, run, failedChecks, 'git-index-failed-builder');
  run = await verify(f, run, 'fail', failedChecks, 'git-index-failed-review');
  const rejected = await runNativeCli(['archive', run.runId, '--project-root', f.root, '--json']);
  expect(rejected.exitCode).not.toBe(0);
  expect(run.state).toMatchObject({ phase: 'build', archived: false });
  expect(run.actions.some((a) => a.stepId === 'archive.execute')).toBe(false);
  expect(await fs.readFile(path.join(f.root, '.git/a9-once'), 'utf8')).toBe('once');
  execFileSync('git', ['restore', '--staged', 'value.ts'], { cwd: f.root });
  const passed = observe(f.root, [gitCheck])[0];
  expect(passed.exitCode).toBe(0);
  const checks = [passed, f.observations[1]] as Report[];
  run = await builder(f, run, checks, 'git-index-repaired-builder');
  run = await verify(f, run, 'pass', checks, 'git-index-repaired-review');
  run = await archive(f, run);
  expect(run.waits.find((w) => w.id === oldWait.id)).toEqual(
    original.waits.find((w) => w.id === oldWait.id),
  );
  expect(await fs.readFile(path.join(f.root, '.git/a9-once'), 'utf8')).toBe('once');
  expect(await fs.readFile(path.join(f.root, 'value.ts'))).toEqual(bytes);
  expect(run.actions.filter((a) => a.stepId === 'archive.execute')).toHaveLength(1);
});
