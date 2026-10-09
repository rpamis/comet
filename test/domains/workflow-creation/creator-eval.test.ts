import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { createCreatorRuntime, creatorSummary } from '../../../domains/workflow-creation/index.js';
import { previewWorkflowApplicationInstall } from '../../../domains/workflow-application/index.js';

const { runExternalCommandAsync } = vi.hoisted(() => ({ runExternalCommandAsync: vi.fn() }));
vi.mock('../../../platform/process/external-command.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../platform/process/external-command.js')>()),
  runExternalCommandAsync,
}));

let root: string;
beforeAll(() => ensureCliBuilt(process.cwd()));
beforeEach(async () => {
  runExternalCommandAsync.mockReset();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-creator-eval-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});

function fakeEval(status: 'passed' | 'failed' | 'incomplete') {
  runExternalCommandAsync.mockImplementation(async (_command, _args, options) => {
    const prepared = JSON.parse(options.env.COMET_APPLICATION_EVAL_CONTEXT);
    const manifestPath = path.join(root, '.comet/eval/generated/frozen-cases/eval.yaml');
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    const manifest =
      'evaluation:\n  tasks:\n    - {name: normal, prompt: Run the SDK, expect: {files: [report.md]}}\n    - {name: rejected, prompt: Reject approval, expect: {files: [draft.md]}}\n';
    await fs.writeFile(manifestPath, manifest);
    const result = {
      schema: 'comet.workflow.application.eval.result.v1',
      experimentId: prepared.experimentId,
      confirmationHash: prepared.preview.confirmationHash,
      snapshotHash: prepared.snapshotHash,
      application: prepared.preview.application,
      settings: prepared.preview.settings,
      status,
      taskNames: ['normal', 'rejected'],
      passed: status === 'passed' ? 2 : 1,
      total: 2,
      report: 'summary.md',
      limitations: prepared.preview.limitations,
      failures: status === 'passed' ? [] : ['approval branch failed'],
      taskSet: {
        manifestPath,
        manifestHash: `sha256:${createHash('sha256').update(manifest).digest('hex')}`,
      },
    };
    await fs.writeFile(prepared.resultFile, JSON.stringify(result));
    await fs.writeFile(
      path.join(path.dirname(prepared.resultFile), 'summary.md'),
      'Actual test driver result',
    );
    return '';
  });
}

async function choose(run: Awaited<ReturnType<typeof compile>>, choice: string) {
  const runtime = createCreatorRuntime(root);
  const wait = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: `${wait.id}-${choice}`,
    choice,
  });
  return (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
}

it('runs the optional Eval once, cold-resumes its result and binds it to the installation preview', async () => {
  fakeEval('passed');
  let run = await choose(await compile(), 'evaluate');
  expect(run.waits.at(-1)?.stepId).toBe('confirm-install');
  expect(creatorSummary(run).evaluation).toMatchObject({ status: 'passed', passed: 2, total: 2 });
  expect(runExternalCommandAsync).toHaveBeenCalledTimes(1);
  const distribution = await previewWorkflowApplicationInstall({
    file: (run.outputs.compile.value as { file: string }).file,
    projectRoot: root,
    scope: 'project',
  });
  expect(distribution.evaluation).toMatchObject({
    status: 'passed',
    agent: 'codex',
    taskNames: ['normal', 'rejected'],
  });
  run = (
    await createCreatorRuntime(root).runUntilBlocked({
      runId: run.runId,
      executorId: 'creator-local',
    })
  ).run;
  expect(runExternalCommandAsync).toHaveBeenCalledTimes(1);
  await choose(run, 'approved');
  expect(await fs.readFile(path.join(root, 'result/application.json'), 'utf8')).toContain(
    'reports',
  );
});

it('keeps failed Eval visible, retries the original frozen cases and permits an explicit skip', async () => {
  fakeEval('failed');
  let run = await choose(await compile(), 'evaluate');
  expect(run.waits.at(-1)?.stepId).toBe('review-eval');
  expect(creatorSummary(run).evaluation).toMatchObject({ status: 'failed' });
  run = await choose(run, 'retry');
  expect(run.waits.at(-1)?.stepId).toBe('review-eval');
  expect(runExternalCommandAsync).toHaveBeenCalledTimes(2);
  run = await choose(run, 'skip');
  expect(run.waits.at(-1)?.stepId).toBe('confirm-install');
  expect(run.outputs.preview.value).toMatchObject({
    evaluation: { status: 'failed', skipped: true },
  });
});

it('rejects an altered report before approving installation', async () => {
  fakeEval('passed');
  const run = await choose(await compile(), 'evaluate');
  const result = run.outputs.evaluate.value as { experimentId: string };
  await fs.writeFile(
    path.join(root, '.comet/eval/runs', result.experimentId, 'application-result.json'),
    '{}',
  );
  const distribution = await previewWorkflowApplicationInstall({
    file: (run.outputs.compile.value as { file: string }).file,
    projectRoot: root,
    scope: 'project',
  });
  expect(distribution.evaluation.status).toBe('stale');
  await expect(choose(run, 'approved')).rejects.toThrow(/报告|变化/);
});

it('retains the generation failure cause and original HTML report without exposing credentials', async () => {
  vi.stubEnv('BENCH_API_KEY', 'private-fixture-key');
  runExternalCommandAsync.mockImplementation(async (_command, _args, options) => {
    const prepared = JSON.parse(options.env.COMET_APPLICATION_EVAL_CONTEXT);
    const directory = path.dirname(prepared.resultFile);
    await fs.writeFile(
      path.join(directory, 'metadata.json'),
      JSON.stringify({
        schema: 'comet.eval.generation.failure.v1',
        error: '[WinError 206] 参数过长 private-fixture-key',
        report_output: 'summary.html',
      }),
    );
    await fs.writeFile(path.join(directory, 'summary.html'), '<h1>Generation stopped</h1>');
    throw new Error('harness stopped');
  });
  const run = await choose(await compile(), 'evaluate');
  const result = creatorSummary(run).evaluation as {
    status: string;
    total: number;
    report: string;
    failures: string[];
  };
  expect(result).toMatchObject({ status: 'incomplete', total: 0, report: 'summary.html' });
  expect(result.failures[0]).toContain('WinError 206');
  expect(result.failures[0]).not.toContain('private-fixture-key');
  expect(run.waits.at(-1)?.stepId).toBe('review-eval');
});

it('keeps an abnormal harness exit incomplete even when its case report says passed', async () => {
  fakeEval('passed');
  const launch = runExternalCommandAsync.getMockImplementation()!;
  runExternalCommandAsync.mockImplementation(async (...args) => {
    await launch(...args);
    throw new Error('harness stopped unexpectedly');
  });
  let run = await choose(await compile(), 'evaluate');
  expect(run.waits.at(-1)?.stepId).toBe('review-eval');
  expect(creatorSummary(run).evaluation).toMatchObject({ status: 'incomplete', passed: 2 });
  const outcome = run.outputs.evaluate.value as { experimentId: string };
  expect(
    JSON.parse(
      await fs.readFile(
        path.join(root, '.comet/eval/runs', outcome.experimentId, 'model-result.json'),
        'utf8',
      ),
    ).status,
  ).toBe('passed');
  run = await choose(run, 'skip');
  expect(run.outputs.preview.value).toMatchObject({
    evaluation: { status: 'incomplete', skipped: true },
  });
});

it('does not start another model session while a previous incomplete experiment still has a live container', async () => {
  fakeEval('incomplete');
  let run = await choose(await compile(), 'evaluate');
  const launch = runExternalCommandAsync.getMockImplementation()!;
  runExternalCommandAsync.mockImplementation(async (...args) =>
    args[0] === 'docker' ? 'active-container-id' : launch(...args),
  );
  run = await choose(run, 'retry');
  expect(run.actions.at(-1)?.status).toBe('unknown');
  expect(
    runExternalCommandAsync.mock.calls.filter((call) => call[0] === process.execPath),
  ).toHaveLength(1);
});

it('rejects changed frozen cases before approving installation', async () => {
  fakeEval('passed');
  const run = await choose(await compile(), 'evaluate');
  const result = run.outputs.evaluate.value as { taskSet: { manifestPath: string } };
  await fs.appendFile(result.taskSet.manifestPath, '\n# changed');
  await expect(choose(run, 'approved')).rejects.toThrow(/用例|变化/);
});

it('reuses the original generated cases after revising and recompiling the application', async () => {
  fakeEval('failed');
  let run = await choose(await compile(), 'evaluate');
  const original = run.outputs.evaluate.value as {
    taskSet: { manifestPath: string; manifestHash: string };
  };
  run = await choose(run, 'revise');
  const runtime = createCreatorRuntime(root);
  const action = run.actions.at(-1)!;
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'creator-host',
    claimToken: 'revision',
    capabilities: ['skill-load', 'handoff'],
  });
  const previous = JSON.parse(JSON.stringify(run.outputs.analyze.value));
  previous.proposal.manifest.version = '2';
  await runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'revision',
      outcomeId: 'revision',
      status: 'succeeded',
      output: previous,
    },
  });
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  run = await choose(run, 'approved');
  expect(run.outputs['eval-preview'].value).toMatchObject({
    taskSet: original.taskSet,
    application: { version: '2' },
  });
  await choose(run, 'evaluate');
  const prepared = JSON.parse(
    runExternalCommandAsync.mock.calls.at(-1)![2].env.COMET_APPLICATION_EVAL_CONTEXT,
  );
  expect(
    parse(
      await fs.readFile(path.join(prepared.skillRoot, 'comet/eval.yaml'), 'utf8'),
    ).evaluation.tasks.map((task: { name: string }) => task.name),
  ).toEqual(['normal', 'rejected']);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
async function compile() {
  const runtime = createCreatorRuntime(root);
  let run = await runtime.start({
    runId: 'eval-creation',
    workflow: { id: 'comet-creator', version: '3' },
    input: {
      goal: '报告审批后发布',
      host: 'codex',
      installTarget: 'result',
      evaluation: { agent: 'codex', model: 'test-model', timeoutSeconds: 30 },
    },
  });
  const action = run.actions[0];
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'creator-host',
    claimToken: 'analyze',
    capabilities: ['skill-load', 'handoff'],
  });
  await runtime.recordOutcome({
    runId: run.runId,
    outcome: {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: 'analyze',
      outcomeId: 'analysis',
      status: 'succeeded',
      output: {
        summary: '报告审批',
        limitations: ['本地报告'],
        failurePaths: ['拒绝保留草稿'],
        proposal: {
          schema: 'comet.workflow.application.plan.v1',
          manifest: {
            schema: 'comet.workflow.application.v1',
            id: 'reports',
            version: '1',
            base: 'standalone',
            runtimeVersion: '0.4.5',
            entrySkill: 'SKILL.md',
            module: 'application.mjs',
            skills: [],
            bindings: [],
          },
          composition: { kind: 'report' },
          modules: {},
          documents: {
            'SKILL.md':
              '---\nname: reports\ndescription: Prepare a source-backed report, ask for approval, and publish the approved draft.\n---\n\n# Report workflow\n\nUse this application when a report needs review before publication. Draft from the supplied sources, show the current report and ask for approval, then publish only the approved content. A rejection retains the draft. Revise and ask again when the content changes. Check actual report and publication artifacts before completing.\n',
            'rules/workflow-guard.md':
              '# Report business rules\n\nAll claims must identify their supplied source. Keep rejected drafts and their review history. Do not publish until the current report is approved; changed content requires a new review.\n',
          },
        },
      },
    },
  });
  run = (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
  const wait = run.waits.at(-1)!;
  expect(creatorSummary(run).plan).toMatchObject({
    evaluation: { agent: 'codex', model: 'test-model' },
  });
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'plan-approved',
    choice: 'approved',
  });
  return (await runtime.runUntilBlocked({ runId: run.runId, executorId: 'creator-local' })).run;
}

it('offers evaluation after compiling and keeps skipped evidence visible in the installation proposal', async () => {
  let run = await compile();
  const runtime = createCreatorRuntime(root);
  const wait = run.waits.at(-1)!;
  expect(wait.stepId).toBe('confirm-eval');
  expect(wait.choices).toEqual(['evaluate', 'skip', 'revise']);
  expect(await fs.stat(path.join(root, '.comet/eval')).catch(() => null)).toBeNull();
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'skip-eval',
    choice: 'skip',
  });
  run = (
    await createCreatorRuntime(root).runUntilBlocked({
      runId: run.runId,
      executorId: 'creator-local',
    })
  ).run;
  expect(run.waits.at(-1)?.stepId).toBe('confirm-install');
  expect(run.outputs.preview.value).toMatchObject({
    evaluation: { status: 'skipped', confirmationHash: wait.proposalHash },
  });
  expect(creatorSummary(run).evaluation).toMatchObject({ status: 'skipped' });
});

it('rejects stale evaluation approval if the compiled package changed and preserves the current wait', async () => {
  const run = await compile();
  const wait = run.waits.at(-1)!;
  await fs.appendFile((run.outputs.compile.value as { file: string }).file, ' ');
  const runtime = createCreatorRuntime(root);
  await expect(
    runtime.resolveWait({
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'stale-eval',
      choice: 'evaluate',
    }),
  ).rejects.toThrow(/变化|漂移/);
  expect((await runtime.inspect(run.runId)).waits.at(-1)?.status).toBe('pending');
});

it('does not let a host forge a passed Eval result', async () => {
  let run = await compile();
  const runtime = createCreatorRuntime(root);
  const wait = run.waits.at(-1)!;
  await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'run-eval',
    choice: 'evaluate',
  });
  run = await runtime.next({ runId: run.runId });
  const action = run.actions.at(-1)!;
  expect(action.stepId).toBe('evaluate');
  await runtime.claim({
    runId: run.runId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'forged',
    claimToken: 'forged',
  });
  await expect(
    runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'forged',
        outcomeId: 'fake',
        status: 'succeeded',
        output: { status: 'passed', passed: 4, total: 4 },
      },
    }),
  ).rejects.toThrow(/OUTCOME_REJECTED/);
});
