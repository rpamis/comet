import path from 'node:path';

import {
  createDefaultCometPluginBridge,
  type CometLifecycleObservation,
} from '../../domains/comet-plugin/index.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

export interface PersonalMemoryCommandOptions {
  readonly json?: boolean;
  readonly task?: string;
  readonly path?: string;
  readonly query?: string;
  readonly text?: string;
  readonly category?: string;
  readonly scope?: 'global' | 'project';
  readonly workflow?: string;
  readonly change?: string;
  readonly candidateKey?: string;
  readonly success?: boolean;
  readonly project?: string;
  readonly learning?: boolean;
  readonly retrieval?: boolean;
  readonly resume?: boolean;
  readonly memoryRoot?: string;
  readonly stateRoot?: string;
  readonly set?: string;
}

export async function personalMemoryStatusCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const status = await bridge.status();
  print(status, options);
  return status;
}

export async function personalMemoryRetrieveCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const retrieval = await bridge.retrieve({
    task: options.task,
    path: options.path,
    query: options.query,
  });
  print(retrieval, options);
  return retrieval;
}

export async function personalMemoryRememberCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const record = await bridge.remember({
    scope: options.scope ?? 'project',
    ...(options.scope === 'global' ? {} : { projectKey: bridge.currentProjectId }),
    category: options.category ?? 'preference',
    text: requireText(options.text, '--text'),
  });
  print(record, options);
  return record;
}

export async function personalMemoryObserveCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const observation: CometLifecycleObservation = {
    name: 'change.completed',
    workflow: requireText(options.workflow, '--workflow'),
    changeId: requireText(options.change, '--change'),
    candidateKey: requireText(options.candidateKey, '--candidate-key'),
    success: options.success !== false,
    category: options.category ?? 'preference',
    text: requireText(options.text, '--text'),
  };
  await bridge.dispatchLifecycle(observation);
  const status = await bridge.status();
  print(status, options);
  return status;
}

export async function personalMemoryContextCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const context = await bridge.collectContext({
    task: requireText(options.task, '--task'),
    path: options.path,
  });
  print(context, options);
  return context;
}

export async function personalMemorySyncCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const result = await bridge.syncMemory();
  print(result, options);
  return result;
}

export async function personalMemoryRemoteCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  if (options.set) await bridge.configureMemoryRemote(options.set);
  const result = await bridge.memoryRemote();
  print(result, options);
  return result;
}

export async function personalMemoryPauseCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const projectKey = options.project ?? bridge.currentProjectId;
  if (options.resume) {
    await bridge.pauseProjectLearning(false, projectKey);
    await bridge.pauseProjectRetrieval(false, projectKey);
  } else {
    if (options.learning || (!options.learning && !options.retrieval))
      await bridge.pauseProjectLearning(true, projectKey);
    if (options.retrieval || (!options.learning && !options.retrieval))
      await bridge.pauseProjectRetrieval(true, projectKey);
  }
  const result = { projectKey, resumed: options.resume === true };
  print(result, options);
  return result;
}

async function createBridge(targetPath: string, options: PersonalMemoryCommandOptions) {
  const projectRoot = path.resolve(targetPath);
  return createDefaultCometPluginBridge({
    projectRoot,
    projectId: resolveStableProjectId(projectRoot),
    ...(options.memoryRoot ? { memoryRoot: options.memoryRoot } : {}),
    ...(options.stateRoot ? { stateRoot: options.stateRoot } : {}),
  });
}

function requireText(value: string | undefined, option: string): string {
  if (!value?.trim()) throw new Error(`${option} must not be empty`);
  return value.trim();
}

function print(value: unknown, options: PersonalMemoryCommandOptions): void {
  if (options.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) console.log(`- ${JSON.stringify(entry)}`);
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.text === 'string') console.log(record.text);
    else console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(String(value));
  }
}
