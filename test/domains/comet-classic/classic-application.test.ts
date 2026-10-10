import { getCurrentVersion } from '../../../platform/version/version.js';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as classic from '../../../domains/comet-classic/index.js';
import { writeClassicSdkDesignContext } from '../../../domains/comet-classic/classic-handoff.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import {
  createRuntime,
  createFileRuntimeStore,
  hashRuntimeValue,
  type WorkflowRun,
  type RuntimeValue,
} from '../../../domains/engine/runtime.js';
import {
  adaptApplicationSkill,
  inspectApplicationSkill,
  createApplicationSkillExecutor,
  type WorkflowApplicationFactoryContext,
  type ApplicationSkillBinding,
  type SkillAdapterContract,
} from '../../../domains/workflow-application/index.js';
import type { ClassicProfile } from '../../../domains/comet-classic/classic-state.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const git = (root: string, args: string[]) =>
  execFileSync(
    'git',
    ['-c', 'user.name=Comet Test', '-c', 'user.email=comet@example.invalid', ...args],
    { cwd: root, encoding: 'utf8', stdio: 'pipe' },
  ).trim();

async function fixture(
  profile: ClassicProfile,
  extensionNames = ['review'],
  checkpoint?: string,
  checkCommands: Record<string, unknown> | false | undefined = undefined,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-composition-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  const packageRoot = path.join(root, 'package');
  const changeRef = 'docs/openspec/changes/example';
  const changeDir = path.join(projectRoot, changeRef);
  await fs.mkdir(changeDir, { recursive: true });
  await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'docs/superpowers/specs'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'docs/superpowers/plans'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'docs/superpowers/reports'), { recursive: true });
  await fs.mkdir(path.join(packageRoot, 'worker/scripts'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, '.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
  );
  await fs.writeFile(path.join(projectRoot, 'docs/openspec/config.yaml'), 'schema: spec-driven\n');
  await fs.writeFile(path.join(projectRoot, 'source.js'), 'export const ready = true;\n');
  await fs.writeFile(
    path.join(projectRoot, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'proposal.md'),
    '# Proposal\nKeep the existing source usable.\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'design.md'),
    '# Design\nUse the existing source and check it.\n',
  );
  const tasks = '- [x] 1.1 Validate source <!-- comet-task:T1 -->\n';
  await fs.writeFile(path.join(changeDir, 'tasks.md'), tasks);
  git(projectRoot, ['init', '-b', 'main']);
  git(projectRoot, ['add', '.']);
  git(projectRoot, ['commit', '-m', 'initial']);
  await fs.writeFile(
    path.join(packageRoot, 'worker/SKILL.md'),
    '# Classic worker\nPerform domain-work within the approved project.\nCheck the source with [review](scripts/review.mjs).\n',
  );
  await fs.writeFile(
    path.join(packageRoot, 'worker/scripts/review.mjs'),
    `import {readFileSync} from 'node:fs'; import {createHash} from 'node:crypto'; const text=readFileSync(process.argv[2],'utf8'); console.log(JSON.stringify({accepted:text.includes('ready = true'),hash:createHash('sha256').update(text).digest('hex')}));`,
  );
  const inspected = await inspectApplicationSkill(path.join(packageRoot, 'worker'));
  const adapter: SkillAdapterContract = {
    kind: 'action',
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' },
    scope: ['.'],
    requiredCapabilities: ['domain-work'],
    interaction: 'none',
    sideEffect: 'write',
    controlsApproval: false,
    completion: 'self-report',
    failure: 'repair',
    recovery: 'reconcile',
    review: {
      status: 'accepted',
      reviewedBy: 'test-fixture',
      contentHash: inspected.contentHash,
      capabilities: [
        {
          id: 'domain-work',
          file: 'SKILL.md',
          excerpt: 'Perform domain-work within the approved project.',
        },
      ],
      effects: [{ file: 'SKILL.md', excerpt: 'Perform domain-work within the approved project.' }],
    },
  };
  const dependency = {
    id: 'classic-worker',
    root: 'worker',
    contentHash: inspected.contentHash,
    adapter,
  };
  const skill = await adaptApplicationSkill(dependency, packageRoot);
  const base = classic.defineClassicWorkflowApplication(profile);
  const skills = new Map([[skill.id, skill]]);
  const dependencies = [dependency];
  const replacements = [];
  for (const [stepId, step] of Object.entries(base.workflow.steps)) {
    if (step.type !== 'invoke_skill') continue;
    const dep = {
      ...dependency,
      id: 'classic-work-' + replacements.length,
      adapter: { ...adapter, outputSchema: step.outputSchema ?? { type: 'object' } },
    };
    dependencies.push(dep);
    const adapted = await adaptApplicationSkill(dep, packageRoot);
    skills.set(dep.id, adapted);
    replacements.push({ stepId, skillId: dep.id });
  }
  const bindings: ApplicationSkillBinding[] = [
    ...replacements.map((entry) => ({
      ...entry,
      workflowId: base.workflow.id,
      capability: 'domain-work',
      usage: 'action' as const,
      authorizationFrom: 'classic.composition.confirm',
      workspaceFrom: 'input.workspaceRoot',
    })),
    ...extensionNames.map((id) => ({
      workflowId: base.workflow.id,
      stepId: classic.classicExtensionStepId(id),
      skillId: skill.id,
      capability: 'domain-work',
      usage: 'action' as const,
      authorizationFrom: 'classic.composition.confirm',
      workspaceFrom: 'input.workspaceRoot',
    })),
  ];
  const manifest = {
    schema: 'comet.workflow.application.v1' as const,
    id: `custom-classic-${profile}`,
    version: '1',
    base: `classic-${profile}` as const,
    runtimeVersion: getCurrentVersion(),
    entrySkill: 'entry/SKILL.md',
    module: 'application.mjs',
    skills: dependencies,
    bindings,
  };
  const identity = {
    id: manifest.id,
    version: '1',
    base: manifest.base,
    contentHash: 'a'.repeat(64),
    packageRoot,
    projectRoot,
    runtimeVersion: getCurrentVersion(),
  };
  const context: WorkflowApplicationFactoryContext = {
    manifest,
    identity,
    projectRoot,
    packageRoot,
    skills,
    createSkillExecutor(host) {
      return createApplicationSkillExecutor({ manifest, skills: context.skills }, host);
    },
  };
  let nextOutput: RuntimeValue = { event: 'open-complete' };
  const executor = context.createSkillExecutor({
    id: 'fixture-host',
    capabilities: ['domain-work'],
    async authorize() {
      return true;
    },
    async invokeSkill() {
      return { status: 'succeeded', output: nextOutput };
    },
  });
  const validator = {
    id: 'real-source-review',
    version: '1',
    async validate() {
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [
            path.join(packageRoot, 'worker/scripts/review.mjs'),
            path.join(projectRoot, 'source.js'),
          ],
          { encoding: 'utf8' },
        ),
      );
      return { accepted: result.accepted, reason: 'Source is not ready' };
    },
  };
  const options = {
    profile,
    replacements,
    extensions: extensionNames.map((id) => ({
      id,
      afterStep: checkpoint ?? `${profile}.build.check.evidence`,
      skillId: skill.id,
      artifactRefs: ['source.js'],
      validator,
    })),
    executors: [executor],
  };
  const implementation = classic.createClassicApplication(context, options);
  const store = createFileRuntimeStore<WorkflowRun>({
    rootDir: path.join(projectRoot, '.comet/runtime/applications', manifest.id),
  });
  const runtimeFactory = () =>
    createRuntime({ ...implementation, store: implementation.wrapStore!(store, identity) });
  let runtime = runtimeFactory();
  const initial = classic.parseClassicStateDocument({
    workflow: profile,
    language: 'en',
    phase: 'open',
    design_doc: null,
    plan: null,
    build_mode: profile === 'full' ? null : 'direct',
    tdd_mode: 'direct',
    review_mode: 'off',
    isolation: 'current',
    bound_branch: 'main',
    verify_mode: null,
    verify_result: 'pending',
    verified_at: null,
    archived: false,
    check_epoch: 0,
  }).classic!;
  let run = await runtime.start({
    runId: 'example',
    workflow: { id: base.workflow.id, version: '1' },
    input: {
      change: 'example',
      changeDir: changeRef,
      workspaceRoot: projectRoot,
      ...(checkCommands === false
        ? {}
        : {
            checkCommands: checkCommands ?? {
              build: {
                argv: [
                  process.execPath,
                  '-e',
                  'if (!require("fs").readFileSync("source.js","utf8").includes("ready = true")) process.exit(1)',
                ],
                cwd: '.',
                timeoutMs: 10000,
              },
              verify: {
                argv: [
                  process.execPath,
                  '-e',
                  'if (!require("fs").readFileSync("source.js","utf8").includes("ready = true")) process.exit(1)',
                ],
                cwd: '.',
                timeoutMs: 10000,
              },
            },
          }),
    },
    initialState: initial,
  });
  let counter = 0;
  const refresh = async () => (run = await runtime.inspect('example'));
  const work = async (output: RuntimeValue) => {
    nextOutput = output;
    const action = run.actions.find((entry) => entry.status === 'pending')!;
    run = await runtime.execute({
      runId: 'example',
      actionId: action.id,
      executorId: 'fixture-host',
      context: { requestId: `work-${++counter}`, projectRoot },
    });
    return run;
  };
  const approve = async (choice = 'approved') => {
    const wait = run.waits.find((entry) => entry.status === 'pending')!;
    run = await runtime.resolveWait({
      runId: 'example',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: `decision-${++counter}`,
      choice,
    });
  };
  const evidence = async () => {
    const wait = run.evidenceWaits!.find((entry) => entry.status === 'pending')!;
    let receipt: { ref: string; contentHash: string };
    if (wait.kind === 'classic-open-artifacts')
      receipt = await classic.classicOpenEvidenceReceipt(projectRoot, changeRef);
    else if (wait.kind === 'classic-design-document')
      receipt = await classic.classicDesignEvidenceReceipt(
        projectRoot,
        (run.state as { designDoc: string }).designDoc,
      );
    else if (wait.kind === 'classic-build-plan')
      receipt = await classic.classicPlanEvidenceReceipt(
        projectRoot,
        (run.state as { plan: string }).plan,
        changeRef,
      );
    else if (wait.kind === 'classic-verification-report') {
      const ref = (run.state as { verificationReport: string }).verificationReport;
      receipt = {
        ref,
        contentHash: digest(await fs.readFile(path.join(projectRoot, ref), 'utf8')),
      };
    } else {
      const output = run.actions.findLast(
        (action) => action.stepId === wait.stepId.replace('.evidence', ''),
      )!.outcome!.output as { receiptRef: string; contentHash: string };
      receipt = { ref: output.receiptRef, contentHash: output.contentHash };
    }
    run = await runtime.recordEvidence({
      runId: 'example',
      evidenceId: wait.id,
      kind: wait.kind,
      ...receipt,
      submissionId: `evidence-${++counter}`,
      context: { requestId: 'evidence', projectRoot },
    });
  };
  const reachReview = async (escalate = false, beforeCheck = false) => {
    run = await runtime.execute({
      runId: 'example',
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-classic-composition-prepare',
    });
    await approve();
    await work({ event: 'open-complete' });
    await evidence();
    if (profile === 'full') {
      await approve();
      run = await runtime.execute({
        runId: 'example',
        actionId: run.actions.at(-1)!.id,
        executorId: 'comet-classic-open-revalidate',
        context: { requestId: 'open-check', projectRoot },
      });
    } else if (escalate) {
      await work({ event: 'escalation-requested', proposal: 'The task now needs a full design' });
      await approve('upgrade');
    }
    if (profile === 'full' || escalate) {
      const handoff = await writeClassicSdkDesignContext({
        projectRoot,
        changeDir,
        change: 'example',
        contextCompression: null,
      });
      await work({ proposal: 'Use the existing source', ...handoff });
      await approve();
      const designDoc = 'docs/superpowers/specs/example-design.md';
      await fs.writeFile(
        path.join(projectRoot, designDoc),
        '---\ncomet_change: example\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\nUse the existing source.\n',
      );
      await work({ designDoc });
      await evidence();
      await work({
        buildMode: 'direct',
        tddMode: 'direct',
        reviewMode: 'off',
        isolation: 'current',
        boundBranch: 'main',
        subagentDispatch: null,
        directOverride: true,
      });
      await approve();
      const plan = 'docs/superpowers/plans/example-plan.md';
      await fs.writeFile(
        path.join(projectRoot, plan),
        '# Plan\n<!-- comet-task-authority: ' +
          changeRef +
          '/tasks.md -->\n<!-- comet-task-ref:T1 -->\n',
      );
      await work({ plan });
      await evidence();
    }
    await work({ event: 'build-complete' });
    if (beforeCheck) return run;
    run = await runtime.execute({
      runId: 'example',
      actionId: run.actions.find((action) => action.status === 'pending')!.id,
      executorId: 'comet-classic-check',
      context: { requestId: 'real-build-check', projectRoot },
    });
    await evidence();
    return run;
  };
  const reviewOutput = async (verdict = 'pass') => {
    const action = run.actions.find(
      (entry) =>
        entry.status === 'pending' || entry.status === 'running' || entry.status === 'unknown',
    )!;
    return {
      verdict,
      sourceHash: hashRuntimeValue(
        (action.input as { activation: { source: RuntimeValue } }).activation.source,
      ),
      artifactHashes: {
        'source.js': digest(await fs.readFile(path.join(projectRoot, 'source.js'), 'utf8')),
      },
    };
  };
  return {
    root,
    projectRoot,
    context,
    options,
    implementation,
    runtimeFactory,
    get runtime() {
      return runtime;
    },
    set runtime(value) {
      runtime = value;
    },
    get run() {
      return run;
    },
    set run(value) {
      run = value;
    },
    work,
    approve,
    evidence,
    reachReview,
    reviewOutput,
    refresh,
    store,
  };
}

it('executes the real check through the public composed factory', async () => {
  const f = await fixture('tweak');
  await f.reachReview(false, true);
  const action = f.run.actions.find((entry) => entry.status === 'pending')!;
  expect(action).toMatchObject({ stepId: 'tweak.build.check', ref: 'classic-check' });
  f.run = await f.runtime.execute({
    runId: 'example',
    actionId: action.id,
    executorId: 'comet-classic-check',
    context: { requestId: 'public-check', projectRoot: f.projectRoot },
  });
  const actual = f.run.actions.find((entry) => entry.id === action.id)!;
  expect(actual).toMatchObject({
    status: 'succeeded',
    claim: { executorId: 'comet-classic-check' },
  });
  expect(actual.outcome!.output).toMatchObject({ exitCode: 0, scope: 'build', tier: 'full' });
  await f.evidence();
  expect(f.run.actions.at(-1)).toMatchObject({ stepId: 'classic.extension.review' });
});

it('keeps a composed read-only store free of projection and ownership writes', async () => {
  const f = await fixture('tweak');
  await f.refresh();
  const readonly = f.implementation.wrapStore!(f.store, f.context.identity, { readOnly: true });
  const mkdir = vi.spyOn(fs, 'mkdir');
  const rename = vi.spyOn(fs, 'rename');
  const cas = vi.spyOn(f.store, 'compareAndSwap');
  const opened = vi.spyOn(fs, 'open');
  expect(await readonly.read('example')).toEqual(f.run);
  await expect(
    readonly.compareAndSwap('example', f.run.revision, { ...f.run, revision: f.run.revision + 1 }),
  ).rejects.toThrow(/read-only store/u);
  expect(mkdir).not.toHaveBeenCalled();
  expect(rename).not.toHaveBeenCalled();
  expect(cas).not.toHaveBeenCalled();
  expect(opened.mock.calls.some(([file]) => String(file).endsWith('.lock'))).toBe(false);
});

it.each([
  ['missing', false],
  ['empty argv', { build: { argv: [] } }],
  ['nonliteral argv', { build: { argv: [process.execPath, null] } }],
  ['outside cwd', { build: { argv: [process.execPath, '-e', 'process.exit(0)'], cwd: '..' } }],
  [
    'invalid timeout',
    { build: { argv: [process.execPath, '-e', 'process.exit(0)'], timeoutMs: 0 } },
  ],
] as const)('rejects a %s fixed command before claiming', async (_label, command) => {
  const f = await fixture('tweak', [], undefined, command as Record<string, unknown> | false);
  await f.reachReview(false, true);
  const action = f.run.actions.find((entry) => entry.status === 'pending')!;
  await expect(
    f.runtime.execute({
      runId: 'example',
      actionId: action.id,
      executorId: 'comet-classic-check',
      context: { requestId: 'invalid-command', projectRoot: f.projectRoot },
    }),
  ).rejects.toThrow();
  const current = await f.runtime.inspect('example');
  expect(current.actions.find((entry) => entry.id === action.id)).toMatchObject({
    status: 'pending',
  });
  expect(current.actions.find((entry) => entry.id === action.id)!.claim).toBeUndefined();
});

it('binds the fixed command to Action inputHash and rejects a different command receipt', async () => {
  const f = await fixture('tweak', []);
  await f.reachReview(false, true);
  const action = f.run.actions.find((entry) => entry.status === 'pending')!;
  const changed = structuredClone(action.input) as {
    input: { checkCommands: { build: { argv: string[] } } };
  };
  changed.input.checkCommands.build.argv = ['node', 'another-command.mjs'];
  await expect(
    f.runtime.claim({
      runId: 'example',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: hashRuntimeValue(changed),
      executorId: 'comet-classic-check',
      claimToken: 'wrong-plan',
      context: { requestId: 'wrong-plan', projectRoot: f.projectRoot },
    }),
  ).rejects.toMatchObject({ code: 'STALE_ACTION' });
  f.run = await f.runtime.claim({
    runId: 'example',
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-check',
    claimToken: 'real-plan',
    context: { requestId: 'real-plan', projectRoot: f.projectRoot },
  });
  const claimed = f.run.actions.find((entry) => entry.id === action.id)!;
  const actual = await classic.runClassicSdkCommandCheck(f.run, claimed, {
    runId: 'example',
    projectRoot: f.projectRoot,
    argv: [process.execPath, '-e', 'console.log("actual different command")'],
    cwd: '.',
    timeoutMs: 10000,
  });
  await expect(
    f.runtime.recordOutcome({
      runId: 'example',
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: claimed.claim!.token,
        outcomeId: 'wrong-command-receipt',
        ...actual,
      },
      context: { requestId: 'wrong-receipt', projectRoot: f.projectRoot },
    }),
  ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
  expect(
    (await f.runtime.inspect('example')).actions.find((entry) => entry.id === action.id)!.status,
  ).toBe('running');
});

it('keeps an actual failed command from satisfying domain evidence', async () => {
  const f = await fixture('tweak', [], undefined, {
    build: { argv: [process.execPath, '-e', 'process.exit(7)'], cwd: '.', timeoutMs: 10000 },
  });
  await f.reachReview(false, true);
  const action = f.run.actions.find((entry) => entry.status === 'pending')!;
  f.run = await f.runtime.execute({
    runId: 'example',
    actionId: action.id,
    executorId: 'comet-classic-check',
    context: { requestId: 'failed-command', projectRoot: f.projectRoot },
  });
  expect(f.run.actions.find((entry) => entry.id === action.id)).toMatchObject({
    status: 'failed',
    outcome: { status: 'failed', output: { exitCode: 7 } },
  });
  expect(f.run.state).toMatchObject({ phase: 'build' });
});

it('rejects missing Archive approval and stale preflight before filesystem work', async () => {
  const f = await fixture('tweak', []);
  await f.reachReview();
  const report = 'docs/superpowers/reports/boundary-verify.md';
  await fs.writeFile(
    path.join(f.projectRoot, report),
    '# Verification\nPASS: actual source command succeeds.\n',
  );
  await f.work({ event: 'verification-ready', verificationReport: report });
  await f.evidence();
  const execute = async (id: string) => {
    f.run = await f.runtime.execute({
      runId: 'example',
      actionId: f.run.actions.find((entry) => entry.status === 'pending')!.id,
      executorId: id,
      context: { requestId: id, projectRoot: f.projectRoot },
    });
  };
  await execute('comet-classic-check');
  await f.evidence();
  await f.work({ targetBranch: 'main', summary: 'Local filesystem archive only' });
  await f.approve('local');
  const action = f.run.actions.find((entry) => entry.status === 'pending')!;
  const unapproved = structuredClone(f.run);
  const wait = unapproved.waits.find((entry) => entry.stepId === 'tweak.archive.confirm')!;
  wait.status = 'pending';
  delete wait.decision;
  const port = f.implementation.executors!.find(
    (entry) => entry.id === 'comet-classic-archive-preflight',
  )!;
  await expect(
    port.preflight!(action, { requestId: 'unapproved', projectRoot: f.projectRoot }, unapproved),
  ).rejects.toThrow(/approval/);
  expect(
    await fs.readFile(
      path.join(f.projectRoot, 'docs/openspec/changes/example/proposal.md'),
      'utf8',
    ),
  ).toContain('Proposal');
  await execute('comet-classic-archive-preflight');
  const archive = f.run.actions.find((entry) => entry.status === 'pending')!;
  await fs.writeFile(
    path.join(f.projectRoot, 'changed.txt'),
    'actual new candidate after preflight\n',
  );
  git(f.projectRoot, ['add', 'changed.txt']);
  git(f.projectRoot, ['commit', '-m', 'test: change candidate after archive preflight']);
  await expect(
    f.runtime.execute({
      runId: 'example',
      actionId: archive.id,
      executorId: 'comet-classic-archive',
      context: { requestId: 'stale-archive', projectRoot: f.projectRoot },
    }),
  ).rejects.toThrow();
  expect(
    (await f.runtime.inspect('example')).actions.find((entry) => entry.id === archive.id),
  ).toMatchObject({ status: 'pending' });
  expect(
    await fs.readFile(
      path.join(f.projectRoot, 'docs/openspec/changes/example/proposal.md'),
      'utf8',
    ),
  ).toContain('Proposal');
}, 90000);

it('exposes a Classic composition factory while preserving the default application', () => {
  expect(classic.createClassicApplication).toBeTypeOf('function');
  expect(
    classic.defineClassicWorkflowApplication('hotfix').workflow.steps['hotfix.build.execute'],
  ).toMatchObject({ type: 'invoke_skill', ref: 'comet-build' });
});
it('rejects unsafe replacement and order changes and allows reordering additions at one checkpoint', async () => {
  const f = await fixture('hotfix', ['left', 'right']);
  expect(() =>
    classic.createClassicApplication(f.context, {
      ...f.options,
      replacements: [{ stepId: 'hotfix.build.check', skillId: 'classic-worker' }],
    }),
  ).toThrow(/领域检查/);
  expect(() =>
    classic.createClassicApplication(f.context, {
      ...f.options,
      order: ['hotfix.verify.run', 'left'],
    }),
  ).toThrow(/领域步骤/);
  const valid = classic.createClassicApplication(f.context, {
    ...f.options,
    order: ['right', 'left'],
  });
  expect(valid.workflows![0].transitions).toContainEqual({
    from: 'hotfix.build.check.evidence',
    to: 'classic.extension.right',
  });
});
it.each(['full', 'hotfix', 'tweak'] as const)(
  'runs actual %s domain checks, rejects text completion and preserves the current extension on cold restart',
  async (profile) => {
    const f = await fixture(profile);
    await f.reachReview();
    expect(f.run.state).toMatchObject({ phase: 'build' });
    await expect(f.work({ verdict: 'pass' })).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    f.runtime = f.runtimeFactory();
    await f.refresh();
    expect(f.run.actions.at(-1)).toMatchObject({
      stepId: 'classic.extension.review',
      status: 'running',
    });
    const action = f.run.actions.at(-1)!;
    f.run = await f.runtime.recordOutcome({
      runId: 'example',
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        outcomeId: 'real-review',
        status: 'succeeded',
        output: await f.reviewOutput(),
      },
      context: { requestId: 'review', projectRoot: f.projectRoot },
    });
    expect(f.run.state).toMatchObject({ phase: 'verify' });
    const reportRef = 'docs/superpowers/reports/example-verify.md';
    await fs.writeFile(path.join(f.projectRoot, reportRef), '# Verification\nPASS\n');
    await f.work({ event: 'verification-ready', verificationReport: reportRef });
    await f.evidence();
    f.run = await f.runtime.execute({
      runId: 'example',
      actionId: f.run.actions.find((action) => action.status === 'pending')!.id,
      executorId: 'comet-classic-check',
      context: { requestId: 'public-verify-check', projectRoot: f.projectRoot },
    });
    await f.evidence();
    await f.work({ targetBranch: 'main', summary: 'Archive the checked change' });
    await f.approve('local');
    f.run = await f.runtime.execute({
      runId: 'example',
      actionId: f.run.actions.find((action) => action.status === 'pending')!.id,
      executorId: 'comet-classic-archive-preflight',
      context: { requestId: 'public-archive-preflight', projectRoot: f.projectRoot },
    });
    f.run = await f.runtime.execute({
      runId: 'example',
      actionId: f.run.actions.find((action) => action.status === 'pending')!.id,
      executorId: 'comet-classic-archive',
      context: { requestId: 'public-archive', projectRoot: f.projectRoot },
    });
    expect(f.run.state).toMatchObject({ archived: true });
    const archiveRef = (
      f.run.actions.findLast((action) => action.stepId.endsWith('.archive.execute'))!.outcome!
        .output as { archiveDirectory: string }
    ).archiveDirectory;
    const paths = [
      'docs/openspec/changes/example',
      archiveRef,
      ...(profile === 'full'
        ? ['docs/superpowers/specs/example-design.md', 'docs/superpowers/plans/example-plan.md']
        : []),
    ];
    git(f.projectRoot, ['add', '--', ...paths]);
    git(f.projectRoot, ['commit', '-m', 'chore: archive example']);
    await f.work({
      action: 'local',
      targetBranch: 'main',
      commit: git(f.projectRoot, ['rev-parse', 'HEAD']),
    });
    expect(f.run.status).toBe('completed');

    await expect(inspectClassicSdkRun(f.projectRoot, 'example')).rejects.toThrow();
    const file = path.join(f.projectRoot, archiveRef, '.comet.yaml');
    expect(await fs.readFile(file, 'utf8')).toContain('application_checkpoint:');
    await expect(createClassicSdkStateStore(f.projectRoot).read('example')).rejects.toThrow(
      /original fixed Application/,
    );
  },
  90000,
);
it('retains the interrupted Action and rejects artifact drift before a downstream claim, while repair remains available', async () => {
  const f = await fixture('tweak');
  await f.reachReview();
  const action = f.run.actions.at(-1)!;
  f.run = await f.runtime.claim({
    runId: 'example',
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'fixture-host',
    claimToken: 'interrupted-review',
    capabilities: ['domain-work'],
  });
  const output = await f.reviewOutput();
  f.run = await f.runtime.markUnknown({
    runId: 'example',
    actionId: action.id,
    attempt: action.attempt,
    reason: 'Host interrupted',
  });
  f.runtime = f.runtimeFactory();
  await f.refresh();
  expect(f.run.actions.at(-1)).toMatchObject({
    id: action.id,
    status: 'unknown',
    claim: { token: 'interrupted-review' },
  });
  f.run = await f.runtime.recordOutcome({
    runId: 'example',
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'interrupted-review',
      outcomeId: 'reconciled-review',
      status: 'succeeded',
      output,
    },
    context: { requestId: 'review', projectRoot: f.projectRoot },
  });
  await fs.writeFile(path.join(f.projectRoot, 'source.js'), 'export const ready = false;\n');
  await expect(
    f.work({
      event: 'verification-ready',
      verificationReport: 'docs/superpowers/reports/example.md',
    }),
  ).rejects.toThrow(/工件已变化/);
  expect((await f.runtime.inspect('example')).actions.at(-1)?.status).toBe('pending');
  await fs.writeFile(path.join(f.projectRoot, 'source.js'), 'export const ready = true;\n');
  await f.work({ event: 'verify-fail', reason: 'Domain assessment requires repair' });
  expect(f.run.state).toMatchObject({ phase: 'build', verifyResult: 'fail' });
}, 90000);
it('routes extension failure and requirement revision through declared domain repair and new approval', async () => {
  const f = await fixture('hotfix');
  await f.reachReview();
  const beforeEpoch = (f.run.state as { checkEpoch: number }).checkEpoch;
  await f.work(await f.reviewOutput('repair'));
  expect(f.run.state).toMatchObject({ phase: 'build', checkEpoch: beforeEpoch + 1 });
  expect(f.run.actions.at(-1)).toMatchObject({ stepId: 'hotfix.build.execute', status: 'pending' });
  await f.work({ event: 'build-complete' });
  f.run = await f.runtime.execute({
    runId: 'example',
    actionId: f.run.actions.find((action) => action.status === 'pending')!.id,
    executorId: 'comet-classic-check',
    context: { requestId: 'repair-check', projectRoot: f.projectRoot },
  });
  await f.evidence();
  await f.work(await f.reviewOutput('revise-requirements'));
  expect(f.run.state).toMatchObject({ phase: 'open', checkEpoch: beforeEpoch + 2 });
  expect(f.run.actions.at(-1)).toMatchObject({
    stepId: 'classic.composition.prepare',
    status: 'pending',
  });
}, 90000);
it('recovers the fixed Classic Application through public CLI across processes and rejects changed Skill bytes', async () => {
  const f = await fixture('tweak');
  const clone = path.join(f.root, 'consumer');
  git(f.root, ['clone', f.projectRoot, clone]);
  await fs.mkdir(path.join(f.root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(path.resolve('.'), path.join(f.root, 'node_modules/@rpamis/comet'), 'junction');
  const module = path.join(f.context.packageRoot, 'application.mjs');
  await fs.writeFile(
    module,
    `import {createClassicApplication} from '@rpamis/comet/applications/classic';
  export function createApplication(context) { const host=context.createSkillExecutor({id:'fixture-host',capabilities:['domain-work'],authorize:async()=>true,invokeSkill:async()=>({status:'succeeded',output:{event:'open-complete'}})});return createClassicApplication(context,{profile:'tweak',replacements:${JSON.stringify(f.options.replacements)},extensions:[{id:'review',afterStep:'tweak.build.check.evidence',skillId:'classic-worker',artifactRefs:['source.js'],validator:{id:'review',version:'1',validate:()=>({accepted:true})}}],executors:[host]});}`,
  );
  await fs.mkdir(path.join(f.context.packageRoot, 'entry'), { recursive: true });
  await fs.writeFile(
    path.join(f.context.packageRoot, 'entry/SKILL.md'),
    '# Entry\nContinue the Classic Application through comet runtime dispatch.\n',
  );
  const applicationFile = path.join(f.context.packageRoot, 'application.json');
  await fs.writeFile(applicationFile, JSON.stringify(f.context.manifest));
  let count = 0;
  const dispatch = async (request: Record<string, unknown>) => {
    const file = path.join(f.root, `cli-request-${++count}.json`);
    await fs.writeFile(file, JSON.stringify(request));
    const result = spawnSync(
      process.execPath,
      [
        path.resolve('bin/comet.js'),
        'runtime',
        'dispatch',
        '--application-file',
        applicationFile,
        '--project-root',
        clone,
        '--request',
        file,
        // 兼容测试逐项核对完整 Run 历史；普通宿主使用默认紧凑续行响应。
        '--details',
        '--json',
      ],
      { encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(result.stdout + result.stderr);
    return JSON.parse(result.stdout).data as WorkflowRun;
  };
  let run = await dispatch({
    operation: 'start',
    runId: 'example',
    workflow: { id: 'comet-classic-tweak', version: '1' },
    input: { change: 'example', changeDir: 'docs/openspec/changes/example', workspaceRoot: clone },
    initialState: f.run.state,
  });
  run = await dispatch({
    operation: 'execute',
    runId: 'example',
    actionId: run.actions.at(-1)!.id,
    executorId: 'comet-classic-composition-prepare',
  });
  const wait = run.waits.at(-1)!;
  run = await dispatch({
    operation: 'resolve-wait',
    runId: 'example',
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'work-authorized',
    choice: 'approved',
  });
  const action = run.actions.at(-1)!;
  run = await dispatch({
    operation: 'claim',
    runId: 'example',
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'fixture-host',
    capabilities: ['domain-work'],
    claimToken: 'original-host-claim',
    sessionId: 'original-process',
  });
  run = await dispatch({
    operation: 'mark-unknown',
    runId: 'example',
    actionId: action.id,
    attempt: action.attempt,
    reason: 'Process stopped',
  });
  await fs.rm(path.join(clone, '.comet/runtime'), { recursive: true, force: true });
  run = await dispatch({ operation: 'inspect', runId: 'example' });
  expect(run.actions.at(-1)).toMatchObject({
    id: action.id,
    status: 'unknown',
    claim: {
      token: `portable-${hashRuntimeValue('original-host-claim')}`,
      sessionId: 'original-process',
    },
  });
  await expect(inspectClassicSdkRun(clone, 'example')).rejects.toThrow(/belongs to application/);
  const skillFile = path.join(f.context.packageRoot, 'worker/SKILL.md');
  const original = await fs.readFile(skillFile, 'utf8');
  await fs.writeFile(skillFile, original + '\nChanged dependency.\n');
  await expect(dispatch({ operation: 'inspect', runId: 'example' })).rejects.toThrow();
  await fs.writeFile(skillFile, original);
  run = await dispatch({
    operation: 'record-outcome',
    runId: 'example',
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: run.actions.at(-1)!.claim!.token,
      outcomeId: 'reconciled-open',
      status: 'succeeded',
      output: { event: 'open-complete' },
    },
  });
  expect(run.runId).toBe('example');
  expect(run.evidenceWaits?.at(-1)).toMatchObject({
    stepId: 'tweak.open.evidence',
    status: 'pending',
  });
}, 90000);
it('requires fresh original domain evidence after artifact changes even when a new review reports current hashes', async () => {
  const f = await fixture('tweak');
  await f.reachReview();
  await fs.writeFile(
    path.join(f.projectRoot, 'source.js'),
    'export const ready = true; // changed after original check\n',
  );
  await expect(f.work(await f.reviewOutput())).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
  await f.refresh();
  const action = f.run.actions.at(-1)!;
  f.run = await f.runtime.recordOutcome({
    runId: 'example',
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim!.token,
      outcomeId: 'repair-current-source',
      status: 'succeeded',
      output: await f.reviewOutput('repair'),
    },
  });
  expect(f.run.actions.at(-1)).toMatchObject({ stepId: 'tweak.build.execute', status: 'pending' });
}, 90000);
it('repairs a drifted accepted candidate in the same Run through an explicit composition command', async () => {
  const f = await fixture('hotfix');
  await f.reachReview();
  await f.work(await f.reviewOutput());
  await fs.writeFile(path.join(f.projectRoot, 'source.js'), 'export const ready = false;\n');
  f.run = await f.runtime.dispatchCommand({
    runId: 'example',
    expectedRevision: f.run.revision,
    commandId: 'repair-drift',
    name: 'repair-composition',
    input: { reason: 'Candidate changed after review' },
  });
  const action = f.run.actions.at(-1)!;
  f.run = await f.runtime.execute({
    runId: 'example',
    actionId: action.id,
    executorId: 'comet-classic-composition-recovery',
  });
  expect(f.run.runId).toBe('example');
  expect(f.run.actions.at(-1)).toMatchObject({ stepId: 'hotfix.build.execute', status: 'pending' });
  expect(f.run.state).toMatchObject({
    phase: 'build',
    verifyResult: 'pending',
    archiveConfirmation: null,
  });
}, 90000);

it('keeps action-sourced extension receipts valid after portable recovery without embedding live claim tokens', async () => {
  const f = await fixture('full', ['review'], 'full.open.revalidate');
  f.run = await f.runtime.execute({
    runId: 'example',
    actionId: f.run.actions.at(-1)!.id,
    executorId: 'comet-classic-composition-prepare',
  });
  await f.approve();
  await f.work({ event: 'open-complete' });
  await f.evidence();
  await f.approve();
  f.run = await f.runtime.execute({
    runId: 'example',
    actionId: f.run.actions.at(-1)!.id,
    executorId: 'comet-classic-open-revalidate',
    context: { requestId: 'open-check', projectRoot: f.projectRoot },
  });
  const source = (
    f.run.actions.at(-1)!.input as {
      activation: { source: { event: { outcome: { claimToken: string } } } };
    }
  ).activation.source;
  expect(source.event.outcome.claimToken).toBe('source-reference');
  await fs.rm(path.join(f.projectRoot, '.comet/runtime'), { recursive: true, force: true });
  f.runtime = f.runtimeFactory();
  await f.refresh();
  await f.work(await f.reviewOutput());
  expect(f.run.actions.at(-1)).toMatchObject({ stepId: 'full.design.handoff', status: 'pending' });
}, 90000);

it.each(['hotfix', 'tweak'] as const)(
  'keeps mandatory %s checks after an approved upgrade to full',
  async (profile) => {
    const f = await fixture(profile);
    await f.reachReview(true);
    expect(f.run.state).toMatchObject({ workflow: 'full', phase: 'build' });
    expect(f.run.actions.at(-1)).toMatchObject({
      stepId: 'classic.extension.review',
      status: 'pending',
    });
    expect(
      (f.run.actions.at(-1)!.input as { activation: { source: { event: { stepId: string } } } })
        .activation.source.event.stepId,
    ).toBe('full.build.check.evidence');
    await f.work(await f.reviewOutput());
    expect(f.run.actions.at(-1)).toMatchObject({ stepId: 'full.verify.run', status: 'pending' });
    const report = 'docs/superpowers/reports/upgraded-verify.md';
    await fs.writeFile(path.join(f.projectRoot, report), '# Verification\nPASS\n');
    await f.work({ event: 'verification-ready', verificationReport: report });
    await f.evidence();
    f.run = await f.runtime.execute({
      runId: 'example',
      actionId: f.run.actions.find((action) => action.status === 'pending')!.id,
      executorId: 'comet-classic-check',
      context: { requestId: 'upgrade-verify-check', projectRoot: f.projectRoot },
    });
    await f.evidence();
    await f.work({ targetBranch: 'main', summary: 'Deliver the approved full upgrade' });
    await f.approve('local');
    f.run = await f.runtime.execute({
      runId: 'example',
      actionId: f.run.actions.find((action) => action.status === 'pending')!.id,
      executorId: 'comet-classic-archive-preflight',
      context: { requestId: 'upgrade-preflight', projectRoot: f.projectRoot },
    });
    f.run = await f.runtime.execute({
      runId: 'example',
      actionId: f.run.actions.find((action) => action.status === 'pending')!.id,
      executorId: 'comet-classic-archive',
      context: { requestId: 'upgrade-archive', projectRoot: f.projectRoot },
    });
    const archiveRef = (
      f.run.actions.findLast((action) => action.stepId === 'full.archive.execute')!.outcome!
        .output as { archiveDirectory: string }
    ).archiveDirectory;
    git(f.projectRoot, [
      'add',
      '--',
      'docs/openspec/changes/example',
      archiveRef,
      'docs/superpowers/specs/example-design.md',
      'docs/superpowers/plans/example-plan.md',
    ]);
    git(f.projectRoot, ['commit', '-m', 'chore: archive upgraded example']);
    await f.work({
      action: 'local',
      targetBranch: 'main',
      commit: git(f.projectRoot, ['rev-parse', 'HEAD']),
    });
    expect(f.run.status).toBe('completed');
  },
  90000,
);
it('rejects changed full Design sources before continuation and renews the confirmation in the same Run', async () => {
  const f = await fixture('full');
  await f.reachReview();
  await f.work(await f.reviewOutput());
  await fs.writeFile(
    path.join(f.projectRoot, 'docs/openspec/changes/example/proposal.md'),
    '# Proposal\nThe accepted requirement has changed.\n',
  );
  await expect(
    f.work({
      event: 'verification-ready',
      verificationReport: 'docs/superpowers/reports/stale.md',
    }),
  ).rejects.toThrow(/设计来源已变化/);
  f.run = await f.runtime.inspect('example');
  f.run = await f.runtime.dispatchCommand({
    runId: 'example',
    expectedRevision: f.run.revision,
    commandId: 'revise-full-source',
    name: 'revise-requirements',
    input: { reason: 'Design sources changed' },
  });
  f.run = await f.runtime.execute({
    runId: 'example',
    actionId: f.run.actions.at(-1)!.id,
    executorId: 'comet-classic-composition-recovery',
  });
  expect(f.run.state).toMatchObject({
    phase: 'open',
    handoffContext: null,
    handoffHash: null,
    plan: null,
    verifyResult: 'pending',
  });
  f.run = await f.runtime.execute({
    runId: 'example',
    actionId: f.run.actions.at(-1)!.id,
    executorId: 'comet-classic-composition-prepare',
  });
  expect(f.run.waits.at(-1)).toMatchObject({
    stepId: 'classic.composition.confirm',
    status: 'pending',
  });
}, 90000);
