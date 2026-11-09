import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  RuntimeProtocolError,
  createMemoryRuntimeStore,
  createRuntime,
  defineWorkflow,
  hashRuntimeValue,
  preserveRuntimeExecutionOrigins,
  type WorkflowRun,
} from '../engine/runtime.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import type { ClassicCommandHandler } from './classic-cli.js';
import {
  executeCommandCheck,
  latestCommandCheck,
  latestInterruptedCommandCheck,
  type RecordedCommandCheck,
} from './classic-command-checks.js';
import {
  classicCommandInvocationCwd,
  classicCommandProjectRoot,
  withProjectContext,
} from './classic-command-context.js';
import { assertClassicLayoutWritable } from './classic-layout.js';
import { resolveClassicChangeDirectory } from './classic-paths.js';
import { resolveClassicCheckTimeout } from './classic-project-config.js';
import { resolveClassicChangeRuntimeOwner } from './classic-runtime-ownership.js';
import { ensureClassicRuntimeRun } from './classic-runtime-run.js';
import {
  classicSdkCheckPreparationInput,
  withClassicCheckPreparation,
} from './classic-sdk-check-preparation.js';
import { executeClassicSdkCommandCheck } from './classic-sdk-check.js';
import { classicSdkEntryData } from './classic-sdk-output.js';
import {
  canReopenClassicVerification,
  classicSdkApplicationForRun,
} from './classic-sdk-revision-application.js';
import { createClassicSdkStateStore } from './classic-sdk-state-store.js';
import { findClassicSdkWorkspace, inspectClassicSdkRun } from './classic-sdk-status.js';
import type { ClassicProfile } from './classic-state.js';

function unstableInputDiagnostic(record: RecordedCommandCheck): string {
  const changed = record.changedDuringExecution ?? [];
  if (changed.length === 0) {
    return 'Inputs changed during check; rerun after the workspace is stable.';
  }
  const shown = changed.slice(0, 20);
  const remainder = changed.length - shown.length;
  return [
    'Inputs changed during check.',
    `Changed inputs: ${shown.join(', ')}${remainder > 0 ? ` (+${remainder} more)` : ''}.`,
    'If these paths are generated artifacts, add them to the matching command outputs in .comet/check-policy.json; otherwise stabilize the inputs before rerunning.',
  ].join('\n');
}

async function prepareSdkCheck(
  inspected: Awaited<ReturnType<typeof inspectClassicSdkRun>>,
  projectRoot: string,
  scope: 'build' | 'verify',
  command: {
    argv: string[];
    cwd: string;
    timeoutMs: number;
    reusable: boolean;
    reportRef?: string;
  },
) {
  const { run, state } = inspected;
  if (
    run.evidenceWaits?.some(
      (wait) =>
        wait.status === 'pending' && wait.stepId === `${state.workflow}.${scope}.check.evidence`,
    )
  )
    return inspected;
  if (
    run.actions.some(
      (action) =>
        action.status === 'pending' && action.stepId === `${state.workflow}.${scope}.check`,
    )
  )
    return inspected;
  const source = run.actions.find(
    (action) =>
      action.status === 'pending' &&
      action.stepId === `${state.workflow}.${scope === 'build' ? 'build.execute' : 'verify.run'}`,
  );
  if (!source)
    throw new Error('Current Classic SDK Run has no pending check or implementation/review Action');
  if (scope === 'verify' && !command.reportRef)
    throw new Error('First Verify check requires --report <report-ref> before writing the report');
  if (command.reportRef) {
    if (scope !== 'verify') throw new Error('--report is only valid for a first Verify check');
    await inspectProtectedProjectPath(projectRoot, command.reportRef, {
      label: 'Classic planned verification report',
      expected: 'file',
    });
  }
  const originalProfile = run.workflow.id.slice('comet-classic-'.length) as ClassicProfile;
  const original = classicSdkApplicationForRun(originalProfile, run);
  const application = Object.hasOwn(original.workflow.commands ?? {}, 'prepare-build-check')
    ? original
    : withClassicCheckPreparation(original, state.workflow);
  const definition = defineWorkflow(application.workflow);
  const nextHash = hashRuntimeValue(definition);
  const upgraded =
    nextHash === run.workflow.hash ? structuredClone(run) : preserveRuntimeExecutionOrigins(run);
  upgraded.workflow.hash = nextHash;
  upgraded.definitionHashes[JSON.stringify([definition.id, definition.version])] = nextHash;
  const memory = createMemoryRuntimeStore<WorkflowRun>();
  await memory.restoreCheckpoint!(run.runId, null, upgraded);
  const runtime = createRuntime({
    store: memory,
    workflows: [application.workflow],
    transitionHandlers: [application.transitionHandler],
    commandValidators: application.commandValidators,
    validators: application.validators,
    evidenceValidators: application.evidenceValidators,
    executors: application.executors,
  });
  const input = { scope, sourceActionId: source.id, command };
  const prepared = await runtime.dispatchCommand({
    runId: run.runId,
    expectedRevision: run.revision,
    name: `prepare-${scope}-check`,
    commandId: hashRuntimeValue(input),
    input,
    context: { requestId: randomUUID(), projectRoot },
  });
  if (
    !(await createClassicSdkStateStore(projectRoot).compareAndSwap(
      run.runId,
      run.revision,
      prepared,
    ))
  )
    throw new RuntimeProtocolError(
      'REVISION_CONFLICT',
      'Run 已变化，首次检查尚未执行；读取当前任务后继续。',
    );
  return inspectClassicSdkRun(projectRoot, run.runId);
}

/** 共享检查执行与已提交的响应视图；返回的 Run 仅用于本次输出。 */
export async function executeClassicSdkCheckCommand(
  inspected: Awaited<ReturnType<typeof inspectClassicSdkRun>>,
  name: string,
  scope: 'build' | 'verify',
  options: {
    projectRoot: string;
    argv: string[];
    cwd?: string;
    timeoutMs?: number;
    reusable?: boolean;
    reportRef?: string;
  },
) {
  const {
    projectRoot,
    argv: requestedArgv,
    cwd = '.',
    timeoutMs: requestedTimeout,
    reusable = false,
  } = options;
  if (inspected.run.workflow.version === '2')
    throw new Error(
      'Run ordinary checks with Agent platform tools and submit --checks during Build or Verify; this Run has no managed check step',
    );
  const timeoutMs = await resolveClassicCheckTimeout(projectRoot, requestedTimeout);
  if (inspected.state.phase !== scope) {
    throw new Error(`Classic SDK change ${name} is in ${inspected.state.phase}, not ${scope}`);
  }
  inspected = await prepareSdkCheck(inspected, projectRoot, scope, {
    argv: requestedArgv,
    cwd,
    timeoutMs,
    reusable,
    ...(options.reportRef ? { reportRef: options.reportRef } : {}),
  });
  const pendingEvidence = inspected.run.evidenceWaits?.find(
    (candidate) =>
      candidate.stepId === `${inspected.profile}.${scope}.check.evidence` &&
      candidate.status === 'pending',
  );
  const checked = pendingEvidence
    ? inspected.run
    : await executeClassicSdkCommandCheck(
        inspected.runtime,
        {
          runId: inspected.run.runId,
          projectRoot,
          argv: requestedArgv,
          cwd,
          timeoutMs,
          reusable,
        },
        inspected.run,
      );
  const action = checked.actions
    .slice()
    .reverse()
    .find((candidate) => candidate.stepId === `${inspected.profile}.${scope}.check`);
  const result = action?.outcome?.output as
    | {
        argv?: string[];
        cwd?: string;
        timeoutMs?: number;
        reusable?: boolean;
        exitCode?: number;
        inputBefore?: string;
        inputAfter?: string;
        receiptRef?: string;
        contentHash?: string;
      }
    | undefined;
  if (!result || typeof result.exitCode !== 'number') {
    throw new Error('Classic SDK check did not record an outcome');
  }
  if (
    pendingEvidence &&
    (action?.status !== 'succeeded' ||
      JSON.stringify(result.argv) !== JSON.stringify(requestedArgv) ||
      result.cwd !== cwd ||
      result.timeoutMs !== timeoutMs ||
      (result.reusable === true) !== reusable)
  ) {
    throw new Error('Classic SDK check recovery does not match the recorded command');
  }
  let finished = checked;
  if (action?.status === 'succeeded' && !classicSdkCheckPreparationInput(checked, action)) {
    const evidence = checked.evidenceWaits?.find(
      (candidate) =>
        candidate.stepId === `${inspected.profile}.${scope}.check.evidence` &&
        candidate.status === 'pending',
    );
    if (!evidence || !result.receiptRef) {
      throw new Error('Classic SDK check has no verified receipt to submit');
    }
    const submission = {
      runId: checked.runId,
      expectedRevision: checked.revision,
      evidenceId: evidence.id,
      kind: evidence.kind,
      ref: result.receiptRef,
      // SDK 的通用证据字段沿用当前请求身份，不绑定日志或项目文件内容。
      contentHash: action.inputHash,
      submissionId: randomUUID(),
      context: { requestId: randomUUID(), projectRoot },
    };
    try {
      finished = await inspected.runtime.recordEvidence(submission);
    } catch (error) {
      if (
        error instanceof RuntimeProtocolError &&
        error.code === 'EVIDENCE_REJECTED' &&
        scope === 'verify' &&
        canReopenClassicVerification(checked)
      ) {
        const entry = await classicSdkEntryData(name, { run: checked, projectRoot });
        return {
          run: checked,
          entry,
          result: {
            exitCode: 1,
            stdout: '',
            stderr: error.message,
            data: {
              ...entry,
              issues: [{ code: 'CLASSIC_EVIDENCE_DRIFT', message: error.message }],
              continuation: {
                ...entry.continuation,
                mode: 'reconcile' as const,
                automatic: false,
                commandArgs: [
                  'comet',
                  'state',
                  'reopen-verification',
                  name,
                  '--expected-revision',
                  String(checked.revision),
                  '--json',
                ],
                requiredInputs: [],
                instruction:
                  '检查证据已失效。保留当前修改，重开 Verify 并重新验收；不得提交旧收据。',
                request: undefined,
              },
            },
          },
        };
      }
      if (
        error instanceof RuntimeProtocolError &&
        error.code === 'EVIDENCE_REJECTED' &&
        scope === 'build'
      ) {
        if (inspected.profile === 'full') {
          // Full already has this transition, including when a preset Run was
          // upgraded to full while retaining its original workflow identity.
          await inspected.runtime.invalidateEvidence(submission);
          throw error;
        }
        const application = classicSdkApplicationForRun(inspected.profile, checked, {
          upgradeBuildCheckRecovery: true,
        });
        const definition = defineWorkflow(application.workflow);
        const hash = hashRuntimeValue(definition);
        if (hash === checked.workflow.hash) {
          await inspected.runtime.invalidateEvidence(submission);
        } else {
          // 旧内置定义不含失效转移。在内存完成校验与状态迁移，再一次 CAS 发布。
          const upgraded = preserveRuntimeExecutionOrigins(checked);
          upgraded.workflow.hash = hash;
          upgraded.definitionHashes[JSON.stringify([definition.id, definition.version])] = hash;
          const store = createMemoryRuntimeStore<WorkflowRun>();
          await store.restoreCheckpoint!(checked.runId, null, upgraded);
          const runtime = createRuntime({
            store,
            workflows: [application.workflow],
            transitionHandlers: [application.transitionHandler],
            evidenceValidators: application.evidenceValidators,
            validators: application.validators,
            executors: application.executors,
            commandValidators: application.commandValidators,
          });
          const revised = await runtime.invalidateEvidence(submission);
          if (
            !(await createClassicSdkStateStore(projectRoot).compareAndSwap(
              checked.runId,
              checked.revision,
              revised,
            ))
          ) {
            throw new RuntimeProtocolError(
              'REVISION_CONFLICT',
              'Run 已变化，未提交检查恢复；重新读取当前状态',
            );
          }
        }
      }
      throw error;
    }
  }
  const entry = await classicSdkEntryData(name, { run: finished, projectRoot });
  return {
    run: finished,
    entry,
    result: {
      exitCode: result.exitCode || (result.inputBefore === result.inputAfter ? 0 : 1),
      data: {
        ...result,
        ...entry,
      },
      stdout: `Check ${scope}: exit=${result.exitCode}; tier=full; log=${result.receiptRef ?? 'unavailable'}\n`,
      ...(result.inputBefore !== result.inputAfter
        ? { stderr: 'Inputs changed during check; rerun after the workspace is stable.' }
        : {}),
    },
  };
}

export const classicCheckCommand: ClassicCommandHandler = withProjectContext(async (args) => {
  const [operation, name, scope] = args;
  const separator = args.indexOf('--');
  const rerun = operation === 'rerun';
  if (
    (operation !== 'run' && !rerun) ||
    !name ||
    !['build', 'verify'].includes(scope) ||
    (rerun ? args.length !== 3 : separator < 3 || !args[separator + 1])
  ) {
    throw new Error(
      'Usage: comet check run <change> <build|verify> [--report <report-ref>] [--local] [--incremental] [--cwd <path>] [--timeout-ms <ms>] -- <program> [args...] | comet check rerun <change> <build|verify>',
    );
  }
  const root = classicCommandProjectRoot();
  const owner = await resolveClassicChangeRuntimeOwner(root, name);
  const sdkWorkspace =
    owner?.format === 'compat' ? null : await findClassicSdkWorkspace(root, name);
  if (sdkWorkspace) {
    if (rerun) throw new Error('Classic SDK check rerun requires a new pending check Action');
    let cwd = '.';
    let timeoutMs: number | undefined;
    let reusable = false;
    let reportRef: string | undefined;
    for (let index = 3; index < separator; index += 1) {
      const option = args[index];
      if (option === '--cwd' && index + 1 < separator) cwd = args[++index];
      else if (option === '--timeout-ms' && index + 1 < separator)
        timeoutMs = Number(args[++index]);
      else if (option === '--local') reusable = true;
      else if (option === '--report' && index + 1 < separator) {
        const report = path.resolve(sdkWorkspace.projectRoot, args[++index]);
        reportRef = path.relative(sdkWorkspace.projectRoot, report).replaceAll('\\', '/');
      } else if (option === '--incremental')
        throw new Error(`Classic SDK checks require full execution; ${option} is not supported`);
      else throw new Error(`Unknown or incomplete check option: ${option}`);
    }
    return (
      await executeClassicSdkCheckCommand(sdkWorkspace, name, scope as 'build' | 'verify', {
        projectRoot: sdkWorkspace.projectRoot,
        argv: args.slice(separator + 1),
        cwd,
        timeoutMs,
        reusable,
        reportRef,
      })
    ).result;
  }
  const layout = await assertClassicLayoutWritable(root);
  const change = await resolveClassicChangeDirectory(name, root);
  if (path.dirname(change.directory) !== layout.changesDir)
    throw new Error('Checks require an active change');
  const context = await ensureClassicRuntimeRun(change.directory);
  if (rerun) {
    const previous = await latestCommandCheck(
      root,
      change.directory,
      context.run,
      scope as 'build' | 'verify',
    );
    const interrupted = previous
      ? null
      : await latestInterruptedCommandCheck(
          root,
          change.directory,
          context.run,
          scope as 'build' | 'verify',
        );
    const retry =
      previous?.argv?.length && previous.provenance === 'runtime' ? previous : interrupted;
    if (!retry) {
      throw new Error(`No Runtime ${scope} check is available to rerun`);
    }
    const retryArgv = retry.argv;
    if (!retryArgv?.length) {
      throw new Error(`No Runtime ${scope} check is available to rerun`);
    }
    const recorded = await executeCommandCheck(root, change.directory, context.run, {
      scope: scope as 'build' | 'verify',
      argv: retryArgv,
      cwd: retry.cwd,
      timeoutMs: retry.timeoutMs ?? 300_000,
      reusable: retry.reusable === true,
      tier: retry.tier ?? 'full',
    });
    return {
      exitCode: recorded.exitCode || (recorded.inputBefore === recorded.inputAfter ? 0 : 1),
      data: recorded,
      stdout: `Check ${recorded.scope}: exit=${recorded.exitCode}; reused=${recorded.reused === true}; tier=${recorded.tier ?? 'full'}; log=${recorded.logRef}\n`,
      ...(recorded.inputBefore !== recorded.inputAfter
        ? { stderr: unstableInputDiagnostic(recorded) }
        : {}),
    };
  }
  let cwd = path.relative(root, classicCommandInvocationCwd()) || '.';
  let timeoutMs: number | undefined;
  let reusable = false;
  let incremental = false;
  for (let index = 3; index < separator; index += 1) {
    const option = args[index];
    if (option === '--local') reusable = true;
    else if (option === '--incremental') incremental = true;
    else if (option === '--cwd' && index + 1 < separator) cwd = args[++index];
    else if (option === '--timeout-ms' && index + 1 < separator) timeoutMs = Number(args[++index]);
    else throw new Error(`Unknown or incomplete check option: ${option}`);
  }
  const recorded = await executeCommandCheck(root, change.directory, context.run, {
    scope: scope as 'build' | 'verify',
    argv: args.slice(separator + 1),
    cwd,
    timeoutMs,
    reusable,
    tier: incremental ? 'incremental' : 'full',
  });
  return {
    exitCode: recorded.exitCode || (recorded.inputBefore === recorded.inputAfter ? 0 : 1),
    data: recorded,
    stdout: `Check ${recorded.scope}: exit=${recorded.exitCode}; reused=${recorded.reused === true}; tier=${recorded.tier ?? 'full'}; log=${recorded.logRef}\n`,
    ...(recorded.inputBefore !== recorded.inputAfter
      ? { stderr: unstableInputDiagnostic(recorded) }
      : {}),
  };
});
