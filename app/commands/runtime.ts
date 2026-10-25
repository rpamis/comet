import {
  resolveWorkspaceRuntimeRoot,
  resolveWorkspaceRuntimeRootSync,
} from '../../domains/workflow-contract/workspace-runtime.js';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withCometRuntimeProgress } from '../../platform/process/runtime-metrics.js';
import {
  createFileRuntimeStore,
  createRuntime,
  RuntimeProtocolError,
  type DefineWorkflowOptions,
  type RuntimeInvocationContext,
  type RuntimeStore,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../../domains/engine/runtime.js';
import { parseRuntimeOutcome } from '../../domains/engine/runtime-action.js';
import {
  readSdkChangeOwner,
  SDK_APPLICATIONS,
  type SdkApplication,
} from '../../domains/workflow-contract/change-runtime-owner.js';
import type { CometProjectWorkflow } from '../../domains/workflow-contract/types.js';
import type { ApplicationIdentity } from '../../domains/workflow-application/index.js';
import { projectCliAgentObservation } from '../../domains/workflow-contract/output-envelope.js';

export interface RuntimeCommandOptions {
  request?: string;
  workflow?: string[];
  application?: string;
  applicationFile?: string;
  rootDir?: string;
  projectRoot?: string;
  json?: boolean;
  details?: boolean;
}

export interface RuntimeCommandHost {
  invocationCwd?: string;
  environment?: Readonly<Record<string, string | undefined>>;
  /** 仅 CLI 使用紧凑展示；response.data 始终保留完整 SDK Run。 */
  output?: 'full' | 'compact';
  /** CLI 可在内置 Native 独立验收回报后生成报告，仍保留用户接受步骤。 */
  completeNativeReport?: boolean;
}

export type RuntimeCommandResponse = {
  protocolVersion: 1;
  requestId: string;
  recovery?: unknown;
} & (
  | {
      status: 'succeeded';
      data: WorkflowRun;
      warning?: { code: string; message: string };
      application?: ApplicationIdentity;
      skillWork?: unknown[];
      waitSkillWork?: unknown[];
    }
  | { status: 'failed'; error: { code: string; message: string } }
);

export interface RuntimeCommandResult {
  exitCode: number;
  response: RuntimeCommandResponse;
  cliResponse?: unknown;
}

type JsonObject = { [key: string]: RuntimeValue };

const operationFields = {
  start: ['runId', 'workflow', 'input', 'initialState'],
  inspect: ['runId'],
  query: ['runId', 'view', 'limit', 'cursor', 'actionId', 'filter', 'artifactId'],
  'acknowledge-stopped': ['runId', 'expectedRevision', 'stoppedActions'],
  'inspect-storage-index': [],
  'audit-storage-index': ['expectedEpoch'],
  'rebuild-storage-index': ['expectedEpoch'],
  next: ['runId', 'expectedRevision'],
  execute: ['runId', 'expectedRevision', 'actionId', 'executorId'],
  'dispatch-command': ['runId', 'expectedRevision', 'commandId', 'name', 'input'],
  claim: [
    'runId',
    'expectedRevision',
    'actionId',
    'attempt',
    'inputHash',
    'executorId',
    'sessionId',
    'claimToken',
    'capabilities',
  ],
  'record-outcome': ['runId', 'expectedRevision', 'outcome'],
  'record-evidence': [
    'runId',
    'expectedRevision',
    'evidenceId',
    'kind',
    'ref',
    'contentHash',
    'submissionId',
  ],
  'invalidate-evidence': [
    'runId',
    'expectedRevision',
    'evidenceId',
    'kind',
    'ref',
    'contentHash',
    'submissionId',
  ],
  'resolve-wait': [
    'runId',
    'expectedRevision',
    'waitId',
    'proposalHash',
    'decisionId',
    'choice',
    'reason',
  ],
  'revise-wait': ['runId', 'expectedRevision', 'waitId', 'proposalHash', 'proposal'],
  'mark-unknown': ['runId', 'expectedRevision', 'actionId', 'attempt', 'reason'],
  retry: ['runId', 'expectedRevision', 'actionId', 'attempt', 'proposalHash', 'reconciliation'],
  cancel: ['runId', 'expectedRevision', 'reason', 'stoppedActions'],
} as const;

function invalid(message: string): never {
  throw new RuntimeProtocolError('INVALID_REQUEST', message);
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) {
    invalid(`${label} 必须是非空字符串且不超过 4096 字符`);
  }
  return value;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid(`${label} 必须是 JSON 对象`);
  return value as JsonObject;
}

function positiveInteger(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    invalid(`${label} 必须是正安全整数`);
  }
}

function onlyFields(value: JsonObject, fields: readonly string[], label: string): void {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) invalid(`${label} 包含不支持的字段：${field}`);
  }
}

function validateOutcome(value: RuntimeValue): void {
  try {
    parseRuntimeOutcome(value);
  } catch (error) {
    if (error instanceof RuntimeProtocolError) invalid(`outcome 无效：${error.message}`);
    throw error;
  }
}

function parseRequest(value: unknown): JsonObject & { operation: keyof typeof operationFields } {
  const request = object(value, '请求');
  const operation = text(request.operation, 'operation');
  if (!Object.hasOwn(operationFields, operation)) invalid(`不支持的 Runtime 操作：${operation}`);
  const name = operation as keyof typeof operationFields;
  onlyFields(
    request,
    ['operation', 'requestId', 'protocolVersion', ...operationFields[name]],
    '请求',
  );
  if (request.protocolVersion !== undefined && request.protocolVersion !== 1) {
    throw new RuntimeProtocolError('UNSUPPORTED_PROTOCOL', '当前命令仅支持 protocolVersion: 1');
  }
  if (request.requestId !== undefined) text(request.requestId, 'requestId');
  if (!name.endsWith('storage-index') && (name !== 'start' || request.runId !== undefined))
    text(request.runId, 'runId');
  if (name.endsWith('storage-index') && name !== 'inspect-storage-index')
    text(request.expectedEpoch, 'expectedEpoch');
  if (name === 'query') {
    if (!['current', 'summary', 'history', 'action', 'artifact'].includes(String(request.view)))
      invalid('query.view 无效');
    if (
      request.limit !== undefined &&
      (!Number.isSafeInteger(request.limit) ||
        Number(request.limit) < 1 ||
        Number(request.limit) > 100)
    )
      invalid('query.limit 必须在 1–100 之间');
    for (const field of ['cursor', 'actionId', 'filter', 'artifactId'])
      if (request[field] !== undefined) text(request[field], field);
  }
  if (request.expectedRevision !== undefined)
    positiveInteger(request.expectedRevision, 'expectedRevision');
  if (name === 'start') {
    const workflow = object(request.workflow, 'workflow');
    onlyFields(workflow, ['id', 'version'], 'workflow');
    text(workflow.id, 'workflow.id');
    text(workflow.version, 'workflow.version');
    if (!Object.hasOwn(request, 'input')) invalid('input 必须显式提供，可使用 null');
  }
  if (name === 'claim') {
    for (const field of ['actionId', 'inputHash', 'executorId']) text(request[field], field);
    positiveInteger(request.attempt, 'attempt');
    for (const field of ['claimToken', 'sessionId'])
      if (request[field] !== undefined) text(request[field], field);
    if (request.capabilities !== undefined) {
      if (!Array.isArray(request.capabilities)) invalid('capabilities 必须是字符串数组');
      request.capabilities.forEach((capability) => text(capability, 'capabilities'));
    }
  }
  if (name === 'execute') {
    text(request.actionId, 'actionId');
    text(request.executorId, 'executorId');
  }
  if (name === 'dispatch-command') {
    positiveInteger(request.expectedRevision, 'expectedRevision');
    text(request.commandId, 'commandId');
    text(request.name, 'name');
    if (!Object.hasOwn(request, 'input')) invalid('input 必须显式提供，可使用 null');
  }
  if (
    (name === 'cancel' || name === 'acknowledge-stopped') &&
    request.stoppedActions !== undefined
  ) {
    if (!Array.isArray(request.stoppedActions)) invalid('stoppedActions 必须是停止确认数组');
    const seen = new Set<string>();
    for (const value of request.stoppedActions) {
      const stopped = object(value, 'stoppedActions');
      onlyFields(
        stopped,
        ['actionId', 'attempt', 'inputHash', 'claimToken', 'evidence'],
        '停止确认',
      );
      for (const field of ['actionId', 'inputHash', 'claimToken', 'evidence'])
        text(stopped[field], field);
      positiveInteger(stopped.attempt, 'attempt');
      const id = stopped.actionId as string;
      if (seen.has(id)) invalid('stoppedActions 不得重复同一 Action');
      seen.add(id);
    }
  }
  if (name === 'record-outcome') validateOutcome(request.outcome);
  if (name === 'record-evidence' || name === 'invalidate-evidence') {
    for (const field of ['evidenceId', 'kind', 'ref', 'contentHash', 'submissionId']) {
      text(request[field], field);
    }
    positiveInteger(request.expectedRevision, 'expectedRevision');
  }
  if (name === 'mark-unknown' || name === 'retry') {
    text(request.actionId, 'actionId');
    positiveInteger(request.attempt, 'attempt');
    if (name === 'retry' && request.proposalHash !== undefined)
      text(request.proposalHash, 'proposalHash');
    if (name === 'mark-unknown') {
      text(request.reason, 'reason');
    } else if (request.reconciliation !== undefined) {
      const reconciliation = object(request.reconciliation, 'reconciliation');
      onlyFields(reconciliation, ['resolution', 'evidence'], 'reconciliation');
      if (
        !Object.hasOwn(reconciliation, 'resolution') ||
        !Object.hasOwn(reconciliation, 'evidence')
      ) {
        invalid('reconciliation 必须包含 resolution 和 evidence');
      }
    }
  }
  if (name === 'resolve-wait' || name === 'revise-wait') {
    text(request.waitId, 'waitId');
    text(request.proposalHash, 'proposalHash');
    if (name === 'resolve-wait') {
      text(request.decisionId, 'decisionId');
      text(request.choice, 'choice');
      if (request.reason !== undefined) text(request.reason, 'reason');
    } else if (!Object.hasOwn(request, 'proposal')) invalid('proposal 必须显式提供，可使用 null');
  }
  if (name === 'cancel') text(request.reason, 'reason');
  return request as JsonObject & { operation: keyof typeof operationFields };
}

async function readJson(file: string, kind: 'REQUEST' | 'WORKFLOW'): Promise<unknown> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(file);
  } catch {
    throw new RuntimeProtocolError(`${kind}_FILE_UNAVAILABLE`, `无法读取 JSON 文件：${file}`);
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new RuntimeProtocolError(`${kind}_JSON_INVALID`, `文件必须是有效的 UTF-8 JSON：${file}`);
  }
}

function dispatch(
  runtime: WorkflowRuntime,
  request: ReturnType<typeof parseRequest>,
  context: RuntimeInvocationContext,
): Promise<WorkflowRun> {
  const parameters = Object.fromEntries(
    Object.entries(request).filter(
      ([key]) => !['operation', 'requestId', 'protocolVersion'].includes(key),
    ),
  );
  const command = { ...parameters, context };
  switch (request.operation) {
    case 'query':
    case 'inspect-storage-index':
    case 'audit-storage-index':
    case 'rebuild-storage-index':
      throw new RuntimeProtocolError('INVALID_REQUEST', '只读查询和存储索引操作应通过独立入口');
    case 'acknowledge-stopped':
      return runtime.acknowledgeStopped(
        command as unknown as Parameters<WorkflowRuntime['acknowledgeStopped']>[0],
      );
    case 'start':
      return runtime.start(command as unknown as Parameters<WorkflowRuntime['start']>[0]);
    case 'inspect':
      return runtime.inspect(request.runId as string);
    case 'next':
      return runtime.next(command as unknown as Parameters<WorkflowRuntime['next']>[0]);
    case 'execute':
      return runtime.execute(command as unknown as Parameters<WorkflowRuntime['execute']>[0]);
    case 'dispatch-command':
      return runtime.dispatchCommand(
        command as unknown as Parameters<WorkflowRuntime['dispatchCommand']>[0],
      );
    case 'claim':
      return runtime.claim(command as unknown as Parameters<WorkflowRuntime['claim']>[0]);
    case 'record-outcome':
      return runtime.recordOutcome(
        command as unknown as Parameters<WorkflowRuntime['recordOutcome']>[0],
      );
    case 'record-evidence':
      return runtime.recordEvidence(
        command as unknown as Parameters<WorkflowRuntime['recordEvidence']>[0],
      );
    case 'invalidate-evidence':
      return runtime.invalidateEvidence(
        command as unknown as Parameters<WorkflowRuntime['invalidateEvidence']>[0],
      );
    case 'resolve-wait':
      return runtime.resolveWait(
        command as unknown as Parameters<WorkflowRuntime['resolveWait']>[0],
      );
    case 'revise-wait':
      return runtime.reviseWait(command as unknown as Parameters<WorkflowRuntime['reviseWait']>[0]);
    case 'mark-unknown':
      return runtime.markUnknown(
        command as unknown as Parameters<WorkflowRuntime['markUnknown']>[0],
      );
    case 'retry':
      return runtime.retry(command as unknown as Parameters<WorkflowRuntime['retry']>[0]);
    case 'cancel':
      return runtime.cancel(command as unknown as Parameters<WorkflowRuntime['cancel']>[0]);
  }
}

async function nativeCliResponse(
  response: Extract<RuntimeCommandResponse, { status: 'succeeded' }>,
  request: ReturnType<typeof parseRequest>,
  projectRoot: string,
  applicationId: string,
  executors?: readonly import('../../domains/engine/runtime.js').RuntimeExecutor[],
) {
  // inspect 保持完整 SDK Run；所有推进响应均使用同一当前续行投影。
  if (request.operation === 'inspect') return response;
  try {
    if (!['claim', 'record-outcome'].includes(request.operation)) {
      const { projectNativeSdkContinuation } =
        await import('../../domains/comet-native/native-sdk-continuation.js');
      const { parseNativePortableState } =
        await import('../../domains/comet-native/native-portable-state.js');
      const projection = await projectNativeSdkContinuation({
        run: response.data,
        state: parseNativePortableState(response.data.state),
        projectRoot,
        applicationId,
        skillExecutors: executors,
      });
      const data = {
        // 这些操作原来公开完整 Run；新增续行字段，不删除已有 SDK/CLI 字段。
        ...response.data,
        schema: 'comet.native.run-view.v1' as const,
        runId: response.data.runId,
        revision: response.data.revision,
        workflow: response.data.workflow,
        status: response.data.status,
        state: parseNativePortableState(response.data.state),
        ...projection,
        inspection: {
          commandArgs: [
            'comet',
            'runtime',
            'dispatch',
            '--application',
            applicationId,
            '--project-root',
            projectRoot,
            '--request',
            '<inspect-request-json-file>',
            '--details',
          ],
          request: { operation: 'inspect', runId: response.data.runId },
        },
      };
      return {
        ...response,
        data,
        agent: projectCliAgentObservation(data, projectRoot),
        cancellation: 'cancellation' in projection ? projection.cancellation : null,
        continuation: projection.continuation,
      };
    }
    const { projectNativeSdkDispatchResult } =
      await import('../../domains/comet-native/native-sdk-continuation.js');
    const { parseNativePortableState } =
      await import('../../domains/comet-native/native-portable-state.js');
    const actionId =
      request.operation === 'claim'
        ? (request.actionId as string)
        : (request.outcome as { actionId: string }).actionId;
    const data = await projectNativeSdkDispatchResult({
      run: response.data,
      state: parseNativePortableState(response.data.state),
      actionId,
      projectRoot,
      applicationId,
      skillExecutors: executors,
    });
    return {
      ...response,
      data,
      agent: projectCliAgentObservation(data, projectRoot),
    };
  } catch (error) {
    // 展示失败不能把已经提交的操作误报为失败，也不能丢失原 Run。
    return {
      ...response,
      warning: {
        code: 'COMPACT_VIEW_UNAVAILABLE',
        message: error instanceof Error ? error.message : '返回完整 Run。',
      },
    };
  }
}

async function assertBuiltInChangeInput(
  projectRoot: string,
  application: SdkApplication,
  change: string,
  input: JsonObject,
  allowExistingStateFile = false,
): Promise<void> {
  if (application === 'native') {
    if (input.name !== change) invalid('Native Run ID 必须与 change name 一致');
    const { assertNativeSdkStartAvailable } =
      await import('../../domains/comet-native/native-sdk-application.js');
    const artifactRootRef = text(input.artifactRootRef, 'input.artifactRootRef');
    if (!allowExistingStateFile) {
      await assertNativeSdkStartAvailable({ projectRoot, name: change, artifactRootRef });
    }
  } else {
    const changeDir = text(input.changeDir, 'input.changeDir').replaceAll('\\', '/');
    if (
      changeDir.startsWith('/') ||
      changeDir.split('/').includes('..') ||
      path.posix.basename(changeDir) !== change ||
      (input.change !== undefined && input.change !== change)
    ) {
      invalid('Classic Run ID 必须与 change directory 和 change name 一致');
    }
    const { assertClassicSdkStartAvailable } =
      await import('../../domains/comet-classic/classic-runtime-ownership.js');
    if (!allowExistingStateFile) {
      await assertClassicSdkStartAvailable({ projectRoot, changeDirRef: changeDir });
    }
  }
}

async function bindBuiltInApplication(
  projectRoot: string,
  application: SdkApplication,
  workflow: DefineWorkflowOptions,
  request: ReturnType<typeof parseRequest>,
  runtime: WorkflowRuntime,
): Promise<WorkflowRun | undefined> {
  const change = text(request.runId, 'runId');
  const ownerWorkflow: CometProjectWorkflow = application === 'native' ? 'native' : 'classic';
  if (request.operation === 'start') {
    const requestedWorkflow = request.workflow as { id: string; version: string };
    if (requestedWorkflow.id !== workflow.id || requestedWorkflow.version !== workflow.version) {
      invalid(`--application ${application} 与请求的 workflow 不匹配`);
    }
    const input = object(request.input, 'input');
    await assertBuiltInChangeInput(projectRoot, application, change, input);
    return;
  }
  const owner = await readSdkChangeOwner(projectRoot, ownerWorkflow, change);
  if (!owner || owner.application !== application || owner.runId !== change) {
    invalid(`Change ${ownerWorkflow}/${change} 未绑定到 ${application} SDK Run`);
  }
  const run = await runtime.inspect(change);
  if (run.workflow.id !== workflow.id || run.workflow.version !== workflow.version) {
    invalid(`Change ${ownerWorkflow}/${change} 的 SDK Workflow 与 ${application} 不匹配`);
  }
  await assertBuiltInChangeInput(
    projectRoot,
    application,
    change,
    object(run.input, 'Run input'),
    true,
  );
  return run;
}

async function registerBuiltInStartOwner(
  projectRoot: string,
  application: SdkApplication,
  change: string,
  input: JsonObject,
): Promise<void> {
  if (application === 'native') {
    const { registerNativeSdkStartOwner } =
      await import('../../domains/comet-native/native-sdk-application.js');
    await registerNativeSdkStartOwner({
      projectRoot,
      name: change,
      artifactRootRef: text(input.artifactRootRef, 'input.artifactRootRef'),
    });
  } else {
    const { registerClassicSdkStartOwner } =
      await import('../../domains/comet-classic/classic-runtime-ownership.js');
    await registerClassicSdkStartOwner({
      projectRoot,
      change,
      changeDirRef: text(input.changeDir, 'input.changeDir'),
      application,
    });
  }
}

export function runtimeCommandFailure(
  error: unknown,
  requestId: string = randomUUID(),
): RuntimeCommandResult {
  const code = error instanceof RuntimeProtocolError ? error.code : 'RUNTIME_ERROR';
  const message = error instanceof Error ? error.message : 'Runtime 命令执行失败';
  const usageCodes = [
    'INVALID_REQUEST',
    'REQUEST_JSON_INVALID',
    'REQUEST_FILE_UNAVAILABLE',
    'WORKFLOW_JSON_INVALID',
    'WORKFLOW_FILE_UNAVAILABLE',
  ];
  return {
    exitCode: usageCodes.includes(code) ? 64 : error instanceof RuntimeProtocolError ? 65 : 70,
    response: { protocolVersion: 1, requestId, status: 'failed', error: { code, message } },
  };
}

export async function runtimeDispatchCommand(
  options: RuntimeCommandOptions,
  host: RuntimeCommandHost = {},
): Promise<RuntimeCommandResult> {
  let requestId: string = randomUUID();
  let recoveryRequest: { operation: 'inspect'; runId: string } | undefined;
  let rejectedOutcome:
    { actionId: string; attempt: number; inputHash: string; claimToken: string } | undefined;
  let recoveryCwd = path.resolve(host.invocationCwd ?? process.cwd(), options.projectRoot ?? '.');
  try {
    const invocationCwd = path.resolve(host.invocationCwd ?? process.cwd());
    let projectRoot = path.resolve(invocationCwd, options.projectRoot ?? '.');
    const environment = Object.freeze(
      Object.fromEntries(
        Object.entries(host.environment ?? process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    );
    const requestFile = path.resolve(invocationCwd, text(options.request, '--request'));
    const request = parseRequest(await readJson(requestFile, 'REQUEST'));
    if (
      request.operation === 'record-outcome' &&
      request.outcome &&
      typeof request.outcome === 'object' &&
      !Array.isArray(request.outcome)
    ) {
      const outcome = request.outcome as Record<string, unknown>;
      if (
        typeof outcome.actionId === 'string' &&
        typeof outcome.attempt === 'number' &&
        typeof outcome.inputHash === 'string' &&
        typeof outcome.claimToken === 'string'
      )
        rejectedOutcome = {
          actionId: outcome.actionId,
          attempt: outcome.attempt,
          inputHash: outcome.inputHash,
          claimToken: outcome.claimToken,
        };
    }
    if (typeof request.runId === 'string' && request.operation !== 'inspect') {
      recoveryRequest = { operation: 'inspect', runId: request.runId };
      recoveryCwd = projectRoot;
    }
    requestId = (request.requestId as string | undefined) ?? requestId;
    const application = options.application;
    const builtIn = (SDK_APPLICATIONS as readonly string[]).includes(application ?? '');
    if (request.operation.endsWith('storage-index')) {
      if (
        !application ||
        builtIn ||
        options.applicationFile ||
        options.workflow?.length ||
        options.rootDir
      )
        invalid('存储索引操作仅接受固定应用 --application');
      const { inspectWorkflowApplicationStorageIndex, repairWorkflowApplicationStorageIndex } =
        await import('../../domains/workflow-application/index.js');
      const data =
        request.operation === 'inspect-storage-index'
          ? await inspectWorkflowApplicationStorageIndex(projectRoot, application)
          : await repairWorkflowApplicationStorageIndex({
              projectRoot,
              applicationId: application,
              operation: request.operation === 'audit-storage-index' ? 'audit' : 'rebuild',
              expectedEpoch: request.expectedEpoch as string,
            });
      return {
        exitCode: 0,
        response: {
          protocolVersion: 1,
          requestId,
          status: 'succeeded',
          data: data as unknown as WorkflowRun,
        },
      };
    }
    if (request.operation === 'query') {
      if (options.applicationFile || (application && (options.workflow?.length || options.rootDir)))
        invalid('query 使用固定应用身份，不能同时指定应用文件或覆盖存储');
      const { readRuntimeProjection, queryRuntimeProjection } =
        await import('../../domains/engine/runtime-compact-query.js');
      let projection;
      if (application && !builtIn) {
        const { readWorkflowApplicationRunProjection } =
          await import('../../domains/workflow-application/index.js');
        const observed = await readWorkflowApplicationRunProjection(
          projectRoot,
          application,
          request.runId as string,
        );
        if (!observed) throw new RuntimeProtocolError('RUN_NOT_FOUND', '找不到固定应用 Run');
        projection = observed.projection;
      } else {
        let store: RuntimeStore<WorkflowRun>;
        if (application) {
          if (application === 'native') {
            const { resolveNativeSdkCommandRoot } =
              await import('../../domains/comet-native/native-runtime-ownership.js');
            projectRoot = await resolveNativeSdkCommandRoot(projectRoot, request.runId as string, {
              readOnly: true,
            });
          } else {
            const { resolveClassicSdkCommandRoot } =
              await import('../../domains/comet-classic/classic-sdk-status.js');
            projectRoot = await resolveClassicSdkCommandRoot(projectRoot, request.runId as string);
          }
          const owner = await readSdkChangeOwner(
            projectRoot,
            application === 'native' ? 'native' : 'classic',
            request.runId as string,
          );
          if (!owner || owner.application !== application || owner.runId !== request.runId)
            invalid('query 应用归属不匹配');
          store =
            application === 'native'
              ? (
                  await import('../../domains/comet-native/native-sdk-state-store.js')
                ).createNativeSdkStateStore(projectRoot, { readOnly: true })
              : (
                  await import('../../domains/comet-classic/classic-sdk-state-store.js')
                ).createClassicSdkStateStore(projectRoot, { readOnly: true });
        } else
          store = createFileRuntimeStore<WorkflowRun>({
            rootDir: path.resolve(invocationCwd, text(options.rootDir, '--root-dir')),
          });
        projection = await readRuntimeProjection(store, request.runId as string);
      }
      const data = queryRuntimeProjection(
        projection,
        request as unknown as import('../../domains/engine/runtime-compact-query.js').RuntimeQuery,
      );
      return {
        exitCode: 0,
        response: { protocolVersion: 1, requestId, status: 'succeeded', data: data as WorkflowRun },
      };
    }

    if (options.applicationFile !== undefined || (application !== undefined && !builtIn)) {
      if (
        (options.workflow?.length ?? 0) > 0 ||
        options.rootDir !== undefined ||
        (options.applicationFile !== undefined && application !== undefined)
      )
        invalid(
          '定制应用使用 --application 或 --application-file，不能同时指定工作流、状态目录或另一应用',
        );
      const {
        loadWorkflowApplication,
        resolveWorkflowApplicationFile,
        selectWorkflowApplication,
        applicationSkillWork,
        applicationWaitSkillWork,
        projectWorkflowApplicationRun,
      } = await import('../../domains/workflow-application/index.js');
      const file = options.applicationFile
        ? path.resolve(invocationCwd, options.applicationFile)
        : await resolveWorkflowApplicationFile(
            projectRoot,
            application!,
            text(request.runId, 'runId'),
          );
      const loaded = await loadWorkflowApplication({
        file,
        projectRoot,
        runId: request.runId as string | undefined,
        readOnly: request.operation === 'inspect',
      });
      const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
      const context = { requestId, projectRoot, invocationCwd, environment };
      const data = await withCometRuntimeProgress(() => dispatch(runtime, request, context));
      if (request.operation === 'start') await selectWorkflowApplication(loaded, data.runId);
      const skillWork = applicationSkillWork(loaded, data);
      const waitSkillWork = applicationWaitSkillWork(loaded, data);
      const response: Extract<RuntimeCommandResponse, { status: 'succeeded' }> = {
        protocolVersion: 1,
        requestId,
        status: 'succeeded',
        data,
        application: loaded.identity,
        skillWork,
        waitSkillWork,
      };
      let cliResponse;
      if (host.output === 'compact' && !options.details) {
        try {
          cliResponse =
            loaded.identity.base === 'native'
              ? await nativeCliResponse(
                  response,
                  request,
                  projectRoot,
                  loaded.identity.id,
                  loaded.implementation.executors,
                )
              : (() => {
                  const view = projectWorkflowApplicationRun(loaded, data);
                  return {
                    ...response,
                    data:
                      request.operation === 'inspect'
                        ? {
                            ...data,
                            current: view.current,
                            continuation: view.continuation,
                            inspection: view.inspection,
                          }
                        : view,
                    agent: projectCliAgentObservation(view, projectRoot),
                  };
                })();
        } catch (error) {
          // 紧凑展示失败不能把已经提交的请求误报为失败。
          cliResponse = {
            ...response,
            warning: {
              code: 'COMPACT_VIEW_UNAVAILABLE',
              message: error instanceof Error ? error.message : '返回完整 Run。',
            },
          };
        }
      }
      return {
        exitCode: 0,
        response,
        ...(cliResponse === undefined ? {} : { cliResponse }),
      };
    }
    if (application !== undefined && (options.workflow?.length ?? 0) > 0) {
      invalid('--application 与 --workflow 不能同时使用');
    }
    if (application?.startsWith('classic-')) {
      const change = text(request.runId, 'runId');
      const { inspectClassicStateFileCandidates } =
        await import('../../domains/comet-classic/classic-paths.js');
      await inspectClassicStateFileCandidates(projectRoot, change);
      if (request.operation === 'start') {
        await assertBuiltInChangeInput(
          projectRoot,
          application as SdkApplication,
          change,
          object(request.input, 'input'),
        );
      } else {
        const { resolveClassicSdkCommandRoot } =
          await import('../../domains/comet-classic/classic-sdk-status.js');
        const commandRoot = await resolveClassicSdkCommandRoot(projectRoot, change);
        if (commandRoot !== projectRoot) {
          await inspectClassicStateFileCandidates(commandRoot, change);
        }
        projectRoot = commandRoot;
      }
    }
    if (application === 'native' && request.operation !== 'start') {
      const { resolveNativeSdkCommandRoot } =
        await import('../../domains/comet-native/native-runtime-ownership.js');
      projectRoot = await resolveNativeSdkCommandRoot(projectRoot, text(request.runId, 'runId'), {
        readOnly: request.operation === 'inspect',
      });
      const owner = await readSdkChangeOwner(projectRoot, 'native', text(request.runId, 'runId'));
      if (owner && owner.application !== 'native')
        return runtimeDispatchCommand(
          { ...options, projectRoot, application: owner.application },
          host,
        );
    }
    recoveryCwd = projectRoot;
    let transitionHandlers;
    let evidenceValidators;
    let validators;
    let stateValidators;
    let commandValidators;
    let validateRecovery;
    let executors;
    let builtInWorkflow: DefineWorkflowOptions | undefined;
    if (application === 'native') {
      const { defineNativeWorkflowApplication } =
        await import('../../domains/comet-native/native-sdk-application.js');
      const defined = defineNativeWorkflowApplication();
      builtInWorkflow = defined.workflow;
      transitionHandlers = [defined.transitionHandler];
      validators = defined.validators;
      stateValidators = defined.stateValidators;
      commandValidators = defined.commandValidators;
      validateRecovery = defined.validateRecovery;
      executors = defined.executors;
    } else if (
      application === 'classic-full' ||
      application === 'classic-hotfix' ||
      application === 'classic-tweak'
    ) {
      const { defineClassicWorkflowApplication } =
        await import('../../domains/comet-classic/classic-sdk-application.js');
      const profile = application.slice('classic-'.length) as 'full' | 'hotfix' | 'tweak';
      const defined = defineClassicWorkflowApplication(profile);
      builtInWorkflow = defined.workflow;
      transitionHandlers = [defined.transitionHandler];
      evidenceValidators = defined.evidenceValidators;
      validators = defined.validators;
      executors = defined.executors;
    } else if (application !== undefined) {
      invalid(`不支持的内置应用：${application}`);
    }
    const builtInRootDir =
      application === undefined
        ? undefined
        : path.join(
            request.operation === 'inspect'
              ? resolveWorkspaceRuntimeRootSync(projectRoot)
              : await resolveWorkspaceRuntimeRoot(projectRoot),
            'sdk-runs',
            application === 'native' ? 'native' : 'classic',
          );
    const rootDir =
      application === undefined
        ? path.resolve(invocationCwd, text(options.rootDir, '--root-dir'))
        : builtInRootDir!;
    if (
      application !== undefined &&
      options.rootDir !== undefined &&
      path.resolve(invocationCwd, options.rootDir) !== builtInRootDir
    ) {
      invalid('内置应用必须使用当前工作区用户级 Runtime 中对应 workflow 的 sdk-runs 目录');
    }
    const workflows = await Promise.all(
      (options.workflow ?? []).map(
        async (file) =>
          (await readJson(
            path.resolve(invocationCwd, text(file, '--workflow')),
            'WORKFLOW',
          )) as DefineWorkflowOptions,
      ),
    );
    const persistentStore: RuntimeStore<WorkflowRun> =
      application === 'native'
        ? (
            await import('../../domains/comet-native/native-sdk-state-store.js')
          ).createNativeSdkStateStore(projectRoot, { readOnly: request.operation === 'inspect' })
        : application !== undefined
          ? (
              await import('../../domains/comet-classic/classic-sdk-state-store.js')
            ).createClassicSdkStateStore(projectRoot, { readOnly: request.operation === 'inspect' })
          : createFileRuntimeStore<WorkflowRun>({ rootDir });
    let selectedBuiltInRun: WorkflowRun | null | undefined;
    if (application?.startsWith('classic-') && request.operation !== 'start') {
      selectedBuiltInRun = await persistentStore.read(text(request.runId, 'runId'));
      const { classicSdkApplicationForRun } =
        await import('../../domains/comet-classic/classic-sdk-revision-application.js');
      const defined = classicSdkApplicationForRun(
        application.slice('classic-'.length) as 'full' | 'hotfix' | 'tweak',
        selectedBuiltInRun,
      );
      builtInWorkflow = defined.workflow;
      transitionHandlers = [defined.transitionHandler];
      evidenceValidators = defined.evidenceValidators;
      validators = defined.validators;
      commandValidators = defined.commandValidators;
      executors = defined.executors;
    }
    if (application === 'native' && request.operation !== 'start') {
      selectedBuiltInRun = await persistentStore.read(text(request.runId, 'runId'));
      const { nativeSdkApplicationForRun } =
        await import('../../domains/comet-native/native-sdk-application.js');
      const defined = nativeSdkApplicationForRun(selectedBuiltInRun);
      builtInWorkflow = defined.workflow;
      transitionHandlers = [defined.transitionHandler];
      validators = defined.validators;
      stateValidators = defined.stateValidators;
      commandValidators = defined.commandValidators;
      validateRecovery = defined.validateRecovery;
      executors = defined.executors;
    }
    const store: RuntimeStore<WorkflowRun> =
      application !== undefined && request.operation === 'start'
        ? {
            async read(runId) {
              const current = await persistentStore.read(runId);
              if (current) {
                const owner = await readSdkChangeOwner(
                  projectRoot,
                  application === 'native' ? 'native' : 'classic',
                  runId,
                );
                if (!owner || owner.application !== application || owner.runId !== runId) {
                  throw new RuntimeProtocolError(
                    'RUN_OWNER_MISSING',
                    `SDK Run ${runId} 缺少匹配的 change 归属记录`,
                  );
                }
              }
              return current;
            },
            async compareAndSwap(runId, expectedRevision, next) {
              if (expectedRevision === null) {
                const change = text(request.runId, 'runId');
                if (runId !== change) invalid('SDK Run ID 与 change name 不一致');
                await registerBuiltInStartOwner(
                  projectRoot,
                  application as SdkApplication,
                  change,
                  object(request.input, 'input'),
                );
              }
              return persistentStore.compareAndSwap(runId, expectedRevision, next);
            },
          }
        : selectedBuiltInRun !== undefined
          ? {
              async read(runId) {
                // 仅复用选择定义的首个快照；后续写操作仍读取当前 CAS revision。
                if (selectedBuiltInRun !== undefined && runId === request.runId) {
                  const current = selectedBuiltInRun;
                  selectedBuiltInRun = undefined;
                  return current;
                }
                return persistentStore.read(runId);
              },
              compareAndSwap: persistentStore.compareAndSwap,
            }
          : persistentStore;
    const runtime = createRuntime({
      store,
      workflows: builtInWorkflow ? [builtInWorkflow] : workflows,
      ...(transitionHandlers ? { transitionHandlers } : {}),
      ...(evidenceValidators ? { evidenceValidators } : {}),
      ...(validators ? { validators } : {}),
      ...(stateValidators ? { stateValidators } : {}),
      ...(commandValidators ? { commandValidators } : {}),
      ...(validateRecovery ? { validateRecovery } : {}),
      ...(executors ? { executors } : {}),
    });
    let boundRun: WorkflowRun | undefined;
    if (application !== undefined && builtInWorkflow) {
      boundRun = await bindBuiltInApplication(
        projectRoot,
        application as SdkApplication,
        builtInWorkflow,
        request,
        runtime,
      );
    }
    const context = { requestId, projectRoot, invocationCwd, environment };
    if (application === 'native' && boundRun && request.operation !== 'inspect') {
      const { registerNativeSdkRequestInput } =
        await import('../../domains/comet-native/native-runtime-ownership.js');
      await registerNativeSdkRequestInput({
        projectRoot,
        artifactRootRef: (boundRun.input as { artifactRootRef: string }).artifactRootRef,
        file: requestFile,
        runId: String(request.runId),
        validateContent: (content) => {
          if (JSON.stringify(parseRequest(JSON.parse(content))) !== JSON.stringify(request))
            invalid('SDK 请求文件在读取后发生变化，请重新提交原请求');
        },
      });
    }
    let data =
      request.operation === 'inspect' && boundRun
        ? boundRun
        : await withCometRuntimeProgress(() => dispatch(runtime, request, context));
    let warning: { code: string; message: string } | undefined;
    if (
      host.completeNativeReport &&
      application === 'native' &&
      request.operation === 'record-outcome'
    ) {
      try {
        const { nativeSdkAutomaticReportAction } =
          await import('../../domains/comet-native/native-sdk-report.js');
        const action = nativeSdkAutomaticReportAction(
          data,
          request.outcome as { actionId: string; outcomeId: string },
        );
        if (action) {
          data = await withCometRuntimeProgress(() =>
            runtime.execute({
              runId: data.runId,
              expectedRevision: data.revision,
              actionId: action.id,
              executorId: 'comet-native-report',
              context,
            }),
          );
        }
      } catch (error) {
        // 回报已提交；报告生成失败不能让调用者重交原 Verifier 结果。
        warning = {
          code: 'NATIVE_REPORT_PENDING',
          message: `独立验收结果已保存；报告尚未完成，请读取当前状态后继续。${error instanceof Error ? ` ${error.message}` : ''}`,
        };
        try {
          data = await runtime.inspect(data.runId);
        } catch {
          // 保留最后确认的快照；调用者仍可使用 runId 重新读取。
        }
      }
    }
    const response: Extract<RuntimeCommandResponse, { status: 'succeeded' }> = {
      protocolVersion: 1,
      requestId,
      status: 'succeeded',
      data,
      ...(warning ? { warning } : {}),
    };
    if (
      host.output === 'compact' &&
      !options.details &&
      request.operation !== 'inspect' &&
      application?.startsWith('classic-')
    ) {
      try {
        const { classicSdkEntryData } =
          await import('../../domains/comet-classic/classic-sdk-output.js');
        const view = {
          ...data,
          ...(await classicSdkEntryData(data.runId, { run: data, projectRoot })),
        };
        return {
          exitCode: 0,
          response,
          cliResponse: {
            ...response,
            data: view,
            agent: projectCliAgentObservation(view, projectRoot),
          },
        };
      } catch (error) {
        return {
          exitCode: 0,
          response,
          cliResponse: {
            ...response,
            warning: {
              code: 'COMPACT_VIEW_UNAVAILABLE',
              message: error instanceof Error ? error.message : '返回完整 Run。',
            },
          },
        };
      }
    }
    return {
      exitCode: 0,
      response,
      ...(host.output === 'compact' && !options.details && application === 'native'
        ? { cliResponse: await nativeCliResponse(response, request, projectRoot, application) }
        : {}),
    };
  } catch (error) {
    const failure = runtimeCommandFailure(error, requestId);
    if (options.application && recoveryRequest) {
      try {
        const { withNativeCommandRecovery } =
          await import('../../domains/comet-native/native-command-recovery.js');
        const diagnosed = await withNativeCommandRecovery(
          {
            command: 'runtime',
            exitCode: failure.exitCode,
            error: {
              code: 'blocked',
              message: error instanceof Error ? error.message : String(error),
            },
          },
          {
            projectRoot: recoveryCwd,
            name: recoveryRequest.runId,
            error,
            onlyLocks: true,
            application: options.application,
            rejectedOutcome,
          },
        );
        const recovery = (diagnosed.data as { recovery?: unknown } | undefined)?.recovery;
        if (recovery) failure.response = { ...failure.response, recovery };
      } catch {
        // 恢复诊断不可掩盖原失败，也不能通过尝试写入来修复观测。
      }
    }
    if (
      host.output !== 'compact' ||
      !recoveryRequest ||
      (!options.application && !options.applicationFile)
    )
      return failure;
    const commandArgs = [
      'comet',
      'runtime',
      'dispatch',
      ...(options.applicationFile
        ? [
            '--application-file',
            path.resolve(host.invocationCwd ?? process.cwd(), options.applicationFile),
          ]
        : ['--application', options.application!]),
      '--project-root',
      recoveryCwd,
      '--request',
      '<inspect-request-json-file>',
      '--details',
    ];
    return {
      ...failure,
      cliResponse: {
        ...failure.response,
        continuation: {
          mode: 'reconcile',
          cwd: recoveryCwd,
          commandArgs,
          request: recoveryRequest,
          requiredInputs: ['inspect-request-json-file'],
          instruction:
            '请求被拒绝；保留原 Action 与批准记录，读取当前 Run 后按其合法续行处理，不盲目重试原写入。',
        },
      },
    };
  }
}
