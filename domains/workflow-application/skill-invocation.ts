import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import {
  createRuntime,
  hashRuntimeValue,
  RuntimeProtocolError,
  type RuntimeOutcome,
  type RuntimeValue,
  type WorkflowRun,
  type RuntimeInvocationContext,
} from '../engine/runtime.js';
import {
  loadWorkflowApplication,
  parseWorkflowApplicationManifest,
  resolveWorkflowApplicationFile,
  selectWorkflowApplication,
} from './application.js';
import { applicationSkillWork, applicationWaitSkillWork } from './skill-work.js';
import { projectWorkflowApplicationRun } from './run-view.js';
import {
  applicationArtifactWorkspace,
  collectApplicationArtifactEvidence,
} from './artifact-contract.js';
import { listWorkflowApplicationRunRecords } from './run-observation.js';
import type { ApplicationIdentity } from './types.js';

export interface ApplicationSkillActionReceipt {
  kind: 'action';
  applicationId: string;
  runId: string;
  actionId: string;
  attempt: number;
  inputHash: string;
  claimToken: string;
}

export interface ApplicationSkillWaitReceipt {
  kind: 'wait';
  applicationId: string;
  runId: string;
  waitId: string;
  proposalHash: string;
}

export type ApplicationSkillInvocationRequest =
  | {
      operation: 'start';
      input: RuntimeValue;
      runId?: string;
      workflowId?: string;
      initialState?: RuntimeValue;
    }
  | { operation: 'inspect' | 'resume'; runId?: string }
  | { operation: 'next'; runId: string }
  | {
      operation: 'claim';
      runId: string;
      actionId: string;
      sessionId?: string;
      capabilities?: string[];
    }
  | { operation: 'execute'; runId: string; actionId: string; executorId: string }
  | {
      operation: 'record-outcome';
      receipt: ApplicationSkillActionReceipt;
      result: Pick<RuntimeOutcome, 'status' | 'output' | 'summary' | 'artifacts' | 'event'>;
    }
  | {
      operation: 'resolve-wait';
      receipt: ApplicationSkillWaitReceipt;
      choice: string;
      decisionId: string;
    };

export interface ApplicationSkillInvocationResult {
  schema: 'comet.application.skill-invocation.v1';
  application: Pick<ApplicationIdentity, 'id' | 'version' | 'packageRoot'>;
  run: ReturnType<typeof projectWorkflowApplicationRun>;
  skillWork: ReturnType<typeof applicationSkillWork>;
  waitSkillWork: ReturnType<typeof applicationWaitSkillWork>;
  receipts: { actions: string[]; waits: string[] };
}

/** 生成 Skill 的宿主入口；只组合现有 SDK 操作，不另存进度、领取或批准状态。 */
export async function invokeWorkflowApplicationSkill(options: {
  file: string;
  projectRoot: string;
  request: ApplicationSkillInvocationRequest;
  context?: Pick<RuntimeInvocationContext, 'environment' | 'signal'>;
}): Promise<ApplicationSkillInvocationResult> {
  const request = options.request;
  const fail = (message: string): never => {
    throw new RuntimeProtocolError('INVALID_REQUEST', message);
  };
  const projectRoot = await fs.realpath(options.projectRoot);
  const manifest = parseWorkflowApplicationManifest(
    JSON.parse(await fs.readFile(options.file, 'utf8')),
  );
  const receipt = 'receipt' in request ? request.receipt : undefined;
  if (receipt && (!receipt.runId || receipt.applicationId !== manifest.id))
    fail('执行回执与当前应用不一致');
  if (request.operation === 'record-outcome' && receipt?.kind !== 'action')
    fail('结果回报需要原 Action 回执');
  if (request.operation === 'resolve-wait' && receipt?.kind !== 'wait')
    fail('用户决定需要当前 Wait 回执');
  let runId = receipt?.runId ?? ('runId' in request ? request.runId : undefined);
  if (['inspect', 'resume'].includes(request.operation) && !runId) {
    const observations = (await listWorkflowApplicationRunRecords(projectRoot)).filter(
      (item) => item.applicationId === manifest.id,
    );
    if (observations.some((item) => item.error))
      fail('当前应用存在无法读取的运行记录，请先核对原记录或明确原 Run ID');
    const candidates = observations.filter(
      (item) =>
        item.record &&
        !item.record.run.lineage.length &&
        !['completed', 'cancelled'].includes(item.record.run.status),
    );
    if (candidates.length !== 1)
      fail(
        candidates.length
          ? `存在多个未结束任务，请向用户确认要继续哪项，再指定 --run-id：${candidates.map((item) => `${item.runId} ${JSON.stringify(item.record!.run.input)}`).join('；')}`
          : '当前应用没有未结束任务；新任务使用 start，查看已结束任务请指定 --run-id',
      );
    runId = candidates[0]!.runId!;
  }
  const file =
    request.operation === 'start'
      ? options.file
      : await resolveWorkflowApplicationFile(projectRoot, manifest.id, runId!);
  const loaded = await loadWorkflowApplication({
    file,
    projectRoot,
    runId,
    readOnly: ['inspect', 'resume'].includes(request.operation),
  });
  const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
  const context: RuntimeInvocationContext = {
    ...options.context,
    projectRoot,
    invocationCwd: process.cwd(),
    requestId: randomUUID(),
  };
  let run: WorkflowRun;
  if (request.operation === 'start') {
    const childIds = new Set(
      loaded.implementation.workflows.flatMap((workflow) =>
        Object.values(workflow.steps).flatMap((step) =>
          step.type === 'child_workflow'
            ? [JSON.stringify([step.workflow.id, step.workflow.version])]
            : [],
        ),
      ),
    );
    const roots = loaded.implementation.workflows.filter((workflow) =>
      request.workflowId
        ? workflow.id === request.workflowId
        : !childIds.has(JSON.stringify([workflow.id, workflow.version])),
    );
    if (roots.length !== 1) fail('存在多个入口流程，请明确 workflowId；不能从名称猜测');
    const workflow = roots[0]!;
    run = await runtime.start({
      ...(runId === undefined ? {} : { runId }),
      workflow: { id: workflow.id, version: workflow.version },
      input: request.input,
      ...(request.initialState === undefined ? {} : { initialState: request.initialState }),
      context,
    });
    await selectWorkflowApplication(loaded, run.runId);
  } else {
    run = await runtime.inspect(runId!);
    const command = { runId: run.runId, expectedRevision: run.revision, context };
    if (request.operation === 'next') run = await runtime.next(command);
    if (request.operation === 'claim') {
      const action = run.actions.find((item) => item.id === request.actionId);
      if (!action || action.status !== 'pending')
        throw new RuntimeProtocolError(
          'INVALID_REQUEST',
          '仅能领取当前 pending Action；恢复时先核对原执行结果',
        );
      run = await runtime.claim({
        ...command,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'skill-host',
        ...(request.sessionId === undefined ? {} : { sessionId: request.sessionId }),
        capabilities: request.capabilities ?? [],
      });
    }
    if (request.operation === 'execute')
      run = await runtime.execute({
        ...command,
        actionId: request.actionId,
        executorId: request.executorId,
      });
    if (request.operation === 'record-outcome') {
      const original = request.receipt;
      const result = request.result;
      if (
        !result ||
        !['succeeded', 'failed'].includes(result.status) ||
        !Object.hasOwn(result, 'output') ||
        Object.keys(result).some(
          (key) => !['status', 'output', 'summary', 'artifacts', 'event'].includes(key),
        )
      )
        fail('结果只填写真实 status、output 及可选 summary、artifacts、event');
      let reported = result;
      const action = run.actions.find((item) => item.id === original.actionId);
      const contract = loaded.manifest.artifactContracts?.find(
        (item) => item.workflowId === run.workflow.id && item.stepId === action?.stepId,
      );
      if (
        action &&
        contract?.artifacts.length &&
        result.status === 'succeeded' &&
        result.artifacts === undefined
      ) {
        try {
          const actual = await collectApplicationArtifactEvidence(
            applicationArtifactWorkspace(projectRoot, loaded.manifest, run, action),
            contract,
            result.output,
          );
          reported = { ...result, artifacts: actual.artifacts };
        } catch {
          // 让原 SDK 验收记录拒绝原因，保留同一 Action 和实际文件供修正。
        }
      }
      run = await runtime.recordOutcome({
        ...command,
        outcome: {
          ...reported,
          actionId: original.actionId,
          attempt: original.attempt,
          inputHash: original.inputHash,
          claimToken: original.claimToken,
          outcomeId: `skill-${hashRuntimeValue({ receipt: original, result: reported })}`,
        },
      });
    }
    if (request.operation === 'resolve-wait')
      run = await runtime.resolveWait({
        ...command,
        waitId: request.receipt.waitId,
        proposalHash: request.receipt.proposalHash,
        choice: request.choice,
        decisionId: request.decisionId,
      });
    if (
      ['resume', 'claim', 'execute'].includes(request.operation) &&
      !['completed', 'cancelled'].includes(run.status)
    )
      await selectWorkflowApplication(loaded, run.runId);
  }
  const actionReceipts: ApplicationSkillActionReceipt[] = run.actions
    .filter((action) => action.claim && ['running', 'unknown'].includes(action.status))
    .map((action) => ({
      kind: 'action',
      applicationId: loaded.identity.id,
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim!.token,
    }));
  const waitReceipts: ApplicationSkillWaitReceipt[] = run.waits
    .filter((wait) => wait.status === 'pending')
    .map((wait) => ({
      kind: 'wait',
      applicationId: loaded.identity.id,
      runId: run.runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
    }));
  return {
    schema: 'comet.application.skill-invocation.v1' as const,
    application: {
      id: loaded.identity.id,
      version: loaded.identity.version,
      packageRoot: loaded.identity.packageRoot,
    },
    run: projectWorkflowApplicationRun(loaded, run),
    skillWork: applicationSkillWork(loaded, run),
    waitSkillWork: applicationWaitSkillWork(loaded, run),
    receipts: {
      actions: actionReceipts.map((value) =>
        Buffer.from(JSON.stringify(value)).toString('base64url'),
      ),
      waits: waitReceipts.map((value) => Buffer.from(JSON.stringify(value)).toString('base64url')),
    },
  };
}
