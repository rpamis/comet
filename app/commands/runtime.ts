import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createFileRuntimeStore,
  createRuntime,
  RuntimeProtocolError,
  type DefineWorkflowOptions,
  type RuntimeInvocationContext,
  type RuntimeValue,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../../domains/engine/runtime.js';
import { parseRuntimeOutcome } from '../../domains/engine/runtime-action.js';

export interface RuntimeCommandOptions {
  request?: string;
  workflow?: string[];
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
  | { status: 'succeeded'; data: WorkflowRun }
  | { status: 'failed'; error: { code: string; message: string } }
);

export interface RuntimeCommandResult {
  exitCode: number;
  response: RuntimeCommandResponse;
}

type JsonObject = { [key: string]: RuntimeValue };

const operationFields = {
  start: ['runId', 'workflow', 'input'],
  inspect: ['runId'],
  next: ['runId', 'expectedRevision'],
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
  'resolve-wait': ['runId', 'expectedRevision', 'waitId', 'proposalHash', 'decisionId', 'choice'],
  'revise-wait': ['runId', 'expectedRevision', 'waitId', 'proposalHash', 'proposal'],
  'mark-unknown': ['runId', 'expectedRevision', 'actionId', 'attempt', 'reason'],
  retry: ['runId', 'expectedRevision', 'actionId', 'attempt', 'reconciliation'],
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
  if (name === 'record-outcome') validateOutcome(request.outcome);
  if (name === 'mark-unknown' || name === 'retry') {
    text(request.actionId, 'actionId');
    positiveInteger(request.attempt, 'attempt');
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
    case 'claim':
      return runtime.claim(command as unknown as Parameters<WorkflowRuntime['claim']>[0]);
    case 'record-outcome':
      return runtime.recordOutcome(
        command as unknown as Parameters<WorkflowRuntime['recordOutcome']>[0],
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
    const projectRoot = path.resolve(invocationCwd, options.projectRoot ?? '.');
    const environment = Object.freeze(
      Object.fromEntries(
        Object.entries(host.environment ?? process.env).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      ),
    );
    const requestFile = path.resolve(invocationCwd, text(options.request, '--request'));
    const rootDir = path.resolve(invocationCwd, text(options.rootDir, '--root-dir'));
    const request = parseRequest(await readJson(requestFile, 'REQUEST'));
    requestId = (request.requestId as string | undefined) ?? requestId;
    const workflows = await Promise.all(
      (options.workflow ?? []).map(
        async (file) =>
          (await readJson(
            path.resolve(invocationCwd, text(file, '--workflow')),
            'WORKFLOW',
          )) as DefineWorkflowOptions,
      ),
    );
    const runtime = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({ rootDir }),
      workflows,
    });
    const context = { requestId, projectRoot, invocationCwd, environment };
    const data = await dispatch(runtime, request, context);
    return { exitCode: 0, response: { protocolVersion: 1, requestId, status: 'succeeded', data } };
  } catch (error) {
    return runtimeCommandFailure(error, requestId);
  }
}
