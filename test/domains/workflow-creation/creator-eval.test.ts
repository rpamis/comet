import { writeApplicationCaseEvidence } from '../../helpers/application-evaluation-evidence.js';
import { getCurrentVersion } from '../../../platform/version/version.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ensureCliBuilt } from '../../helpers/ensure-cli-built.js';
import { createHash } from 'node:crypto';
import { parse } from 'yaml';
import { createCreatorRuntime, creatorSummary } from '../../../domains/workflow-creation/index.js';
import { previewWorkflowApplicationInstall } from '../../../domains/workflow-application/index.js';
import type { ExternalCommandOptions } from '../../../platform/process/external-command.js';

function isProcessId(value: string | undefined): boolean {
  return (
    typeof value === 'string' && /^[1-9]\d*$/u.test(value) && Number.isSafeInteger(Number(value))
  );
}

function isWindowsProcessIdentityProbe(
  command: string,
  parameters: readonly string[],
  options: ExternalCommandOptions | undefined,
): boolean {
  if (options?.maxBufferBytes !== 4096) return false;
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const systemCommand = (...parts: string[]) =>
    path.win32.normalize(command).toLowerCase() ===
    path.win32.normalize(path.join(systemRoot, ...parts)).toLowerCase();
  const probeFile = (file: string, extension: 'cs' | 'exe') => {
    const relative = path
      .relative(path.join(os.tmpdir(), 'comet-process-identity'), file)
      .split(path.sep)
      .join('/');
    return new RegExp(
      `^[a-f0-9]{64}/probe-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\\.${extension}$`,
      'u',
    ).test(relative);
  };
  if (
    ['Framework64', 'Framework'].some((framework) =>
      systemCommand('Microsoft.NET', framework, 'v4.0.30319', 'csc.exe'),
    )
  ) {
    const source = parameters[4];
    return (
      options.timeoutMs === 1500 &&
      parameters.length === 5 &&
      parameters[0] === '/nologo' &&
      parameters[1] === '/target:exe' &&
      parameters[2] === '/platform:anycpu' &&
      probeFile(source, 'cs') &&
      parameters[3] === `/out:${source.slice(0, -3)}.exe`
    );
  }
  if (systemCommand('System32', 'wbem', 'WMIC.exe')) {
    return (
      options.timeoutMs === 300 &&
      parameters.length === 6 &&
      parameters[0] === 'process' &&
      parameters[1] === 'where' &&
      parameters[2]?.startsWith('processid=') &&
      isProcessId(parameters[2].slice('processid='.length)) &&
      parameters[3] === 'get' &&
      parameters[4] === 'creationdate' &&
      parameters[5] === '/value'
    );
  }
  if (systemCommand('System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')) {
    const pid =
      /^\(Get-Process -Id ([1-9]\d*) -ErrorAction Stop\)\.StartTime\.ToUniversalTime\(\)\.Ticks\.ToString\(\)$/u.exec(
        parameters[4] ?? '',
      )?.[1];
    return (
      options.timeoutMs === 1000 &&
      parameters.length === 5 &&
      parameters[0] === '-NoLogo' &&
      parameters[1] === '-NoProfile' &&
      parameters[2] === '-NonInteractive' &&
      parameters[3] === '-Command' &&
      isProcessId(pid)
    );
  }
  return (
    options.timeoutMs === 1000 &&
    probeFile(command, 'exe') &&
    parameters.length === 1 &&
    isProcessId(parameters[0])
  );
}

const { runExternalCommandAsync, processIdentityProbe, dockerCommand } = vi.hoisted(() => ({
  runExternalCommandAsync: vi.fn(),
  processIdentityProbe: vi.fn(),
  dockerCommand: vi.fn(),
}));
vi.mock('../../../platform/process/external-command.js', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../../../platform/process/external-command.js')>();
  processIdentityProbe.mockImplementation(original.runExternalCommandAsync);
  return {
    ...original,
    runExternalCommandAsync: (...args: Parameters<typeof original.runExternalCommandAsync>) => {
      const [command, parameters, options] = args;
      // 仅固定的锁身份探测保持真实；模型、Docker 与其它命令仍由测试替身接管。
      if (
        command === '/bin/ps' &&
        parameters.length === 4 &&
        parameters[0] === '-p' &&
        isProcessId(parameters[1]) &&
        parameters[2] === '-o' &&
        parameters[3] === 'lstart=' &&
        options?.timeoutMs === 5000 &&
        options.maxBufferBytes === 4096
      ) {
        return processIdentityProbe(...args);
      }
      if (
        process.platform === 'win32' &&
        isWindowsProcessIdentityProbe(command, parameters, options)
      ) {
        return processIdentityProbe(...args);
      }
      if (
        command === 'docker' &&
        options?.maxBufferBytes === undefined &&
        ['ps', 'inspect', 'stop', 'rm'].includes(parameters[0])
      )
        return dockerCommand(...args);
      return runExternalCommandAsync(...args);
    },
  };
});

// Creator 现在通过监管器运行模型命令；模型替身与 Docker 收尾探测分别计数。
vi.mock('../../../platform/process/run-owned-command.js', () => ({
  runOwnedCommand: vi.fn((command, args, options) =>
    runExternalCommandAsync(command, args, options),
  ),
}));

let root: string;
beforeAll(() => ensureCliBuilt(process.cwd()));
beforeEach(async () => {
  runExternalCommandAsync.mockReset();
  dockerCommand.mockReset().mockResolvedValue('');
  processIdentityProbe.mockClear();
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-creator-eval-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});

function fakeEval(status: 'passed' | 'failed' | 'incomplete') {
  runExternalCommandAsync.mockImplementation(async (command, args, options) => {
    expect(command).toBe(process.execPath);
    expect(args[1]).toBe('eval');
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
    await writeApplicationCaseEvidence(prepared.resultFile, result);
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

it.runIf(process.platform === 'darwin')(
  'keeps an expired macOS process identity probe outside the Eval mock',
  async () => {
    fakeEval('failed');
    const { readProcessIdentity } = await import('../../../platform/process/process-identity.js');
    const missingPid = 2_147_483_647;
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      await expect(readProcessIdentity(missingPid)).resolves.toBeNull();
      expect(processIdentityProbe).toHaveBeenCalledTimes(1);
      now += 10_000;
      await expect(readProcessIdentity(missingPid)).resolves.toBeNull();
      expect(processIdentityProbe).toHaveBeenCalledTimes(1);
      now += 1;
      await expect(readProcessIdentity(missingPid)).resolves.toBeNull();
      expect(processIdentityProbe).toHaveBeenCalledTimes(2);
      expect(runExternalCommandAsync).not.toHaveBeenCalled();
    } finally {
      clock.mockRestore();
    }
  },
);

it.runIf(process.platform === 'win32')(
  'routes only the declared Windows identity signatures outside the Eval mock',
  async () => {
    const { runExternalCommandAsync: execute } =
      await import('../../../platform/process/external-command.js');
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const executable = path.join(
      os.tmpdir(),
      'comet-process-identity',
      'a'.repeat(64),
      'probe-00000000-0000-4000-8000-000000000001.exe',
    );
    const source = executable.slice(0, -4) + '.cs';
    const pid = String(process.pid);
    type Command = Parameters<typeof execute>;
    const compileArgs = [
      '/nologo',
      '/target:exe',
      '/platform:anycpu',
      `/out:${executable}`,
      source,
    ];
    const compiler = path.join(systemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
    const wmic = path.join(systemRoot, 'System32', 'wbem', 'WMIC.exe');
    const powershell = path.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    const powershellArgs = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks.ToString()`,
    ];
    const nativeOptions = { timeoutMs: 1000, maxBufferBytes: 4096 };
    const commands: Command[] = [
      [compiler, compileArgs, { timeoutMs: 1500, maxBufferBytes: 4096 }],
      [
        path.join(systemRoot, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
        compileArgs,
        { timeoutMs: 1500, maxBufferBytes: 4096 },
      ],
      [
        wmic,
        ['process', 'where', `processid=${pid}`, 'get', 'creationdate', '/value'],
        { timeoutMs: 300, maxBufferBytes: 4096 },
      ],
      [powershell, powershellArgs, nativeOptions],
      [executable, [pid], nativeOptions],
    ];
    const rejected: Command[] = [
      ...commands.map(([command, args, options]): Command => [
        command,
        args,
        { ...options, timeoutMs: options!.timeoutMs! + 1 },
      ]),
      [path.join(root, 'csc.exe'), compileArgs, commands[0][2]],
      [compiler, [...compileArgs.slice(0, 3), `/out:${source}.exe`, source], commands[0][2]],
      [
        powershell,
        [...powershellArgs.slice(0, 4), powershellArgs[4] + '; Get-Process'],
        nativeOptions,
      ],
      [path.join(root, path.basename(executable)), [pid], nativeOptions],
      [executable, [pid, 'extra'], nativeOptions],
      [wmic, ['process', 'where', 'processid=-1', 'get', 'creationdate', '/value'], commands[2][2]],
      [process.execPath, ['unrelated-command'], nativeOptions],
      ['docker', ['ps'], nativeOptions],
    ];
    const realProbe = processIdentityProbe.getMockImplementation()!;
    // 此用例仅验证路由；真实平台探测仍由原 Creator 集成测试覆盖。
    processIdentityProbe.mockResolvedValue('identity-routing-fixture');
    fakeEval('failed');
    try {
      for (const command of commands) {
        await expect(execute(...command)).resolves.toBe('identity-routing-fixture');
        expect(processIdentityProbe).toHaveBeenLastCalledWith(...command);
      }
      expect(runExternalCommandAsync).not.toHaveBeenCalled();
      const allowedCalls = processIdentityProbe.mock.calls.length;
      for (const command of rejected) {
        await expect(execute(...command)).rejects.toThrow();
        expect(runExternalCommandAsync).toHaveBeenLastCalledWith(...command);
      }
      expect(processIdentityProbe).toHaveBeenCalledTimes(allowedCalls);
      expect(runExternalCommandAsync).toHaveBeenCalledTimes(rejected.length);
    } finally {
      processIdentityProbe.mockImplementation(realProbe);
    }
  },
);

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
  expect(run.waits.at(-1)?.stepId).toBe('confirm-eval');
  expect(runExternalCommandAsync).toHaveBeenCalledTimes(1);
  run = await choose(run, 'evaluate');
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
  runExternalCommandAsync.mockImplementation(async (command, args, options) => {
    expect(command).toBe(process.execPath);
    expect(args[1]).toBe('eval');
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
  dockerCommand.mockClear().mockResolvedValue('abcdef123456');
  run = await choose(run, 'retry');
  expect(run.waits.at(-1)?.stepId).toBe('confirm-eval');
  run = await choose(run, 'evaluate');
  expect(run.actions.at(-1)?.status).toBe('unknown');
  expect(run.actions.at(-1)?.reason).toMatch(/容器/);
  expect(dockerCommand).toHaveBeenCalled();
  expect(
    runExternalCommandAsync.mock.calls.filter((call) => call[0] === process.execPath),
  ).toHaveLength(1);
});

it('keeps an incomplete legacy Run pending with explicit recovery guidance', async () => {
  fakeEval('incomplete');
  const run = await choose(await compile('3'), 'evaluate');
  await expect(choose(run, 'retry')).rejects.toThrow(/保留原 Run.*v6 Run/);
  const resumed = await createCreatorRuntime(root).inspect(run.runId);
  expect(resumed.waits.at(-1)?.status).toBe('pending');
  expect(resumed.workflow.hash).toBe(run.workflow.hash);
  expect(
    runExternalCommandAsync.mock.calls.filter((call) => call[0] === process.execPath),
  ).toHaveLength(1);
});

it('reconfirms collected cases after incomplete Eval and resumes when old containers stopped', async () => {
  fakeEval('incomplete');
  let run = await choose(await compile(), 'evaluate');
  const original = run.outputs.evaluate.value as {
    taskSet: unknown;
    confirmationHash: string;
    experimentId: string;
  };
  fakeEval('passed');
  dockerCommand.mockClear().mockResolvedValue('');
  run = await choose(run, 'retry');
  expect(run.waits.at(-1)?.stepId).toBe('confirm-eval');
  expect(run.outputs['eval-preview'].value).toMatchObject({ taskSet: original.taskSet });
  expect(
    (run.outputs['eval-preview'].value as { confirmationHash: string }).confirmationHash,
  ).not.toBe(original.confirmationHash);
  expect(
    runExternalCommandAsync.mock.calls.filter((call) => call[0] === process.execPath),
  ).toHaveLength(1);
  run = await choose(run, 'evaluate');
  expect(run.waits.at(-1)?.stepId).toBe('confirm-install');
  expect(creatorSummary(run).evaluation).toMatchObject({ status: 'passed', passed: 2, total: 2 });
  expect(dockerCommand).toHaveBeenCalledWith(
    'docker',
    expect.arrayContaining(['--filter', `label=comet.eval.experiment=${original.experimentId}`]),
    { timeoutMs: 5000 },
  );
  expect(
    runExternalCommandAsync.mock.calls.filter((call) => call[0] === process.execPath),
  ).toHaveLength(2);
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
async function compile(version = '6') {
  const runtime = createCreatorRuntime(root);
  let run = await runtime.start({
    runId: 'eval-creation',
    workflow: { id: 'comet-creator', version },
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
            runtimeVersion: getCurrentVersion(),
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
