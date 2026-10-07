import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
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

export interface RuntimeCommandOptions {
  request?: string;
  workflow?: string[];
  application?: string;
  applicationFile?: string;
  rootDir?: string;
  projectRoot?: string;
  json?: boolean;
}

export interface RuntimeCommandHost {
  invocationCwd?: string;
  environment?: Readonly<Record<string, string | undefined>>;
}

export type RuntimeCommandResponse = {
  protocolVersion: 1;
  requestId: string;
} & (
  | {
      status: 'succeeded';
      data: WorkflowRun;
      application?: ApplicationIdentity;
      skillWork?: unknown[];
      waitSkillWork?: unknown[];
    }
  | { status: 'failed'; error: { code: string; message: string } }
);

export interface RuntimeCommandResult {
  exitCode: number;
  response: RuntimeCommandResponse;
}

type JsonObject = { [key: string]: RuntimeValue };

const operationFields = {
  start: ['runId', 'workflow', 'input', 'initialState'],
  inspect: ['runId'],
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
  'resolve-wait': ['runId', 'expectedRevision', 'waitId', 'proposalHash', 'decisionId', 'choice'],
  'revise-wait': ['runId', 'expectedRevision', 'waitId', 'proposalHash', 'proposal'],
  'mark-unknown': ['runId', 'expectedRevision', 'actionId', 'attempt', 'reason'],
  retry: ['runId', 'expectedRevision', 'actionId', 'attempt', 'proposalHash', 'reconciliation'],
  cancel: ['runId', 'expectedRevision', 'reason'],
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
  if (name !== 'start' || request.runId !== undefined) text(request.runId, 'runId');
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
    requestId = (request.requestId as string | undefined) ?? requestId;
    const application = options.application;
    const builtIn = (SDK_APPLICATIONS as readonly string[]).includes(application ?? '');
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
      });
      const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
      const context = { requestId, projectRoot, invocationCwd, environment };
      const data = await dispatch(runtime, request, context);
      if (request.operation === 'start') await selectWorkflowApplication(loaded, data.runId);
      const skillWork = applicationSkillWork(loaded, data);
      const waitSkillWork = applicationWaitSkillWork(loaded, data);
      return {
        exitCode: 0,
        response: {
          protocolVersion: 1,
          requestId,
          status: 'succeeded',
          data,
          application: loaded.identity,
          skillWork,
          waitSkillWork,
        },
      };
    }
    if (application !== undefined && (options.workflow?.length ?? 0) > 0) {
      invalid('--application 与 --workflow 不能同时使用');
    }
    if (application?.startsWith('classic-') && request.operation !== 'start') {
      const { resolveClassicSdkCommandRoot } =
        await import('../../domains/comet-classic/classic-sdk-status.js');
      projectRoot = await resolveClassicSdkCommandRoot(projectRoot, text(request.runId, 'runId'));
    }
    if (application === 'native' && request.operation !== 'start') {
      const { resolveNativeSdkCommandRoot } =
        await import('../../domains/comet-native/native-runtime-ownership.js');
      projectRoot = await resolveNativeSdkCommandRoot(projectRoot, text(request.runId, 'runId'));
      const owner = await readSdkChangeOwner(projectRoot, 'native', text(request.runId, 'runId'));
      if (owner && owner.application !== 'native')
        return runtimeDispatchCommand(
          { ...options, projectRoot, application: owner.application },
          host,
        );
    }
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
    const builtInRootDir = path.join(
      projectRoot,
      '.comet',
      'runtime',
      'sdk-runs',
      application === 'native' ? 'native' : 'classic',
    );
    const rootDir =
      application === undefined
        ? path.resolve(invocationCwd, text(options.rootDir, '--root-dir'))
        : builtInRootDir;
    if (
      application !== undefined &&
      options.rootDir !== undefined &&
      path.resolve(invocationCwd, options.rootDir) !== builtInRootDir
    ) {
      invalid('内置应用必须使用项目中对应 workflow 的 .comet/runtime/sdk-runs 目录');
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
          ).createNativeSdkStateStore(projectRoot)
        : application !== undefined
          ? (
              await import('../../domains/comet-classic/classic-sdk-state-store.js')
            ).createClassicSdkStateStore(projectRoot)
          : createFileRuntimeStore<WorkflowRun>({ rootDir });
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
    const data =
      request.operation === 'inspect' && boundRun
        ? boundRun
        : await dispatch(runtime, request, context);
    return { exitCode: 0, response: { protocolVersion: 1, requestId, status: 'succeeded', data } };
  } catch (error) {
    return runtimeCommandFailure(error, requestId);
  }
}
