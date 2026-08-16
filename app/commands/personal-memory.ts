import path from 'node:path';

import {
  createDefaultCometPluginBridge,
  type CometLifecycleObservation,
} from '../../domains/comet-plugin/index.js';
import type { MemoryLanguage } from '../../domains/comet-memory/index.js';
import { readWorkflowProjectConfig } from '../../domains/workflow-contract/project-config-reader.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

export interface PersonalMemoryCommandOptions {
  readonly json?: boolean;
  readonly task?: string;
  readonly path?: string;
  readonly phase?: string;
  readonly query?: string;
  readonly operation?: string;
  readonly tags?: readonly string[];
  readonly maxEntries?: number | string;
  readonly maxBytes?: number | string;
  readonly text?: string;
  readonly category?: string;
  readonly language?: MemoryLanguage;
  readonly id?: string;
  readonly permanent?: boolean;
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
    scope: options.scope,
    projectKey: options.project,
    task: options.task,
    path: options.path,
    operation: options.operation,
    category: options.category,
    tags: options.tags,
    query: options.query,
    maxEntries: positiveInteger(options.maxEntries),
    maxBytes: positiveInteger(options.maxBytes),
  });
  if (options.json) print(retrieval, options);
  else printRetrieval(retrieval, await resolveDisplayLanguage(targetPath, options));
  return retrieval;
}

export async function personalMemoryRememberCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const language = await resolveDisplayLanguage(targetPath, options);
  const record = await bridge.remember({
    scope: options.scope ?? 'project',
    ...(options.scope === 'global' ? {} : { projectKey: bridge.currentProjectId }),
    category: options.category ?? 'preference',
    text: requireText(options.text, '--text'),
    language,
  });
  printAction(
    localizedMessage(
      language,
      `已记录个人记忆：${record?.text ?? ''}`,
      `Memory saved: ${record?.text ?? ''}`,
    ),
    record,
    options,
  );
  return record;
}

export async function personalMemoryManageCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const language = await resolveDisplayLanguage(targetPath, options);
  const view = await bridge.manage({
    query: options.query,
    category: options.category,
    scope: options.scope,
  });
  if (options.json) print(view, options);
  else printManagement(view, language);
  return view;
}

export async function personalMemoryCorrectCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const language = await resolveDisplayLanguage(targetPath, options);
  const correction = {
    ...(options.text === undefined ? {} : { text: requireText(options.text, '--text') }),
    ...(options.category === undefined
      ? {}
      : { category: requireText(options.category, '--category') }),
  };
  if (Object.keys(correction).length === 0) {
    throw new Error('At least one of --text or --category is required');
  }
  const record = await bridge.correct(requireId(options.id), correction);
  printAction(
    localizedMessage(
      language,
      `已纠正个人记忆：${record.text}`,
      `Memory corrected: ${record.text}`,
    ),
    record,
    options,
  );
  return record;
}

export async function personalMemoryForgetCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const language = await resolveDisplayLanguage(targetPath, options);
  await bridge.forget(requireId(options.id), options.permanent === true);
  const message = options.permanent
    ? localizedMessage(language, '已永久删除个人记忆。', 'Memory permanently deleted.')
    : localizedMessage(
        language,
        '已忘记个人记忆（可回滚）。',
        'Memory forgotten (you can roll it back).',
      );
  printAction(
    message,
    { id: requireId(options.id), permanent: options.permanent === true },
    options,
  );
  return { id: requireId(options.id), permanent: options.permanent === true };
}

export async function personalMemoryRollbackCommand(
  targetPath = '.',
  options: PersonalMemoryCommandOptions = {},
): Promise<unknown> {
  const bridge = await createBridge(targetPath, options);
  const language = await resolveDisplayLanguage(targetPath, options);
  const record = await bridge.rollback(requireId(options.id));
  printAction(
    localizedMessage(
      language,
      `已回滚个人记忆：${record.text}`,
      `Memory rolled back: ${record.text}`,
    ),
    record,
    options,
  );
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
    phase: options.phase,
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
  if (options.json) print(result, options);
  else printSyncResult(result, await resolveDisplayLanguage(targetPath, options));
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
  if (options.json) print(result, options);
  else {
    const language = await resolveDisplayLanguage(targetPath, options);
    console.log(
      options.resume
        ? localizedMessage(language, '已恢复个人记忆。', 'Personal memory resumed.')
        : localizedMessage(language, '已暂停个人记忆。', 'Personal memory paused.'),
    );
  }
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

function requireId(value: string | undefined): string {
  return requireText(value, '--id');
}

function positiveInteger(value: number | string | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function printRetrieval(
  value: { readonly disabled: boolean; readonly text: string },
  language: MemoryLanguage,
): void {
  if (value.disabled) {
    console.log(
      localizedMessage(language, '个人记忆检索已暂停。', 'Personal memory retrieval is paused.'),
    );
    return;
  }
  if (value.text.trim().length === 0) {
    console.log(localizedMessage(language, '没有匹配的个人记忆。', 'No matching personal memory.'));
    return;
  }
  console.log(value.text);
}

function printSyncResult(value: unknown, language: MemoryLanguage): void {
  const result = value as { readonly status?: string; readonly message?: string };
  const message =
    result.status === 'synced'
      ? localizedMessage(language, '个人记忆已同步。', 'Personal memory synced.')
      : result.status === 'conflict'
        ? localizedMessage(
            language,
            '同步存在冲突；本地个人记忆仍可用。',
            'Memory sync has a conflict; local memory remains available.',
          )
        : result.status === 'failed'
          ? localizedMessage(
              language,
              '同步失败；本地个人记忆仍可用。',
              'Memory sync failed; local memory remains available.',
            )
          : localizedMessage(
              language,
              '本地个人记忆可用；尚未配置远程同步。',
              'Local memory is available; no remote is configured.',
            );
  console.log(message);
}

function printAction(message: string, value: unknown, options: PersonalMemoryCommandOptions): void {
  if (options.json) print(value, options);
  else console.log(message);
}

function printManagement(
  value: {
    readonly records: readonly {
      readonly id: string;
      readonly category: string;
      readonly text: string;
      readonly status: string;
      readonly evidenceCount: number;
      readonly canRollback: boolean;
    }[];
    readonly conflicts: readonly { readonly texts: readonly string[] }[];
  },
  language: MemoryLanguage,
): void {
  if (value.records.length === 0 && value.conflicts.length === 0) {
    console.log(
      language === 'zh-CN' ? '暂无符合条件的个人记忆。' : 'No matching personal memories.',
    );
    return;
  }
  for (const record of value.records) {
    const rollback = record.canRollback
      ? language === 'zh-CN'
        ? '可回滚'
        : 'rollback available'
      : language === 'zh-CN'
        ? '不可回滚'
        : 'no rollback';
    console.log(`- ${record.text}`);
    console.log(
      language === 'zh-CN'
        ? `  ${record.category} · ${memoryStatusLabel(record.status, language)} · 证据 ${record.evidenceCount} · ${rollback} · 标识 ${record.id}`
        : `  ${record.category} · ${memoryStatusLabel(record.status, language)} · evidence ${record.evidenceCount} · ${rollback} · id ${record.id}`,
    );
  }
  for (const conflict of value.conflicts) {
    console.log(
      language === 'zh-CN'
        ? `! 检测到记忆冲突：${conflict.texts.join(' / ')}`
        : `! Memory conflict detected: ${conflict.texts.join(' / ')}`,
    );
  }
}

function memoryStatusLabel(status: string, language: MemoryLanguage): string {
  return (
    (language === 'zh-CN'
      ? {
          active: '生效',
          inactive: '已停用',
          conflict: '待确认',
          tombstoned: '已忘记',
        }
      : {
          active: 'active',
          inactive: 'inactive',
          conflict: 'conflict',
          tombstoned: 'forgotten',
        })[status] ?? status
  );
}

function localizedMessage(language: MemoryLanguage, chinese: string, english: string): string {
  return language === 'zh-CN' ? chinese : english;
}

async function resolveDisplayLanguage(
  targetPath: string,
  options: PersonalMemoryCommandOptions,
): Promise<MemoryLanguage> {
  if (options.language !== undefined) return options.language;
  try {
    const config = await readWorkflowProjectConfig(path.resolve(targetPath));
    if (config?.default_workflow === 'classic') {
      return config?.classic?.language ?? config?.native?.language ?? 'zh-CN';
    }
    return config?.native?.language ?? config?.classic?.language ?? 'zh-CN';
  } catch {
    return 'zh-CN';
  }
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
