import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripUtf8Bom } from '../fs/strip-bom.js';
import { readStdinTextWithTimeoutAsync, type StdinReadResult } from './stdin-read.js';

export type CometHookIntent = 'context' | 'write' | 'non-write' | 'unknown';

export interface CometHookRequest {
  intent: CometHookIntent;
  targets: string[];
  toolName: string | null;
  task?: string;
  cwd?: string;
  /** 原始绝对路径仅供物理归属检查，cwd 保持既有规范化契约。 */
  rawCwd?: string;
  sessionId?: string;
  writes?: CometHookWriteProposal[];
}

export interface CometHookWriteProposal {
  path: string;
  content?: string;
  replacements?: { oldText: string; newText: string; replaceAll: boolean }[];
  patch?: string;
}

export interface CometHookAdapterDecision {
  allowed: boolean;
  reason: string;
  context?: string;
  diagnostic?: string;
}

export interface CometHookProcessOutput {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const WRITE_TOOL_NAMES = new Set([
  'applypatch',
  'create',
  'createfile',
  'deletefile',
  'edit',
  'editfile',
  'multiedit',
  'patch',
  'searchreplace',
  'strreplaceeditor',
  'write',
  'writefile',
  'writefiletool',
]);

const NON_WRITE_TOOL_NAMES = new Set([
  'glob',
  'grep',
  'listfiles',
  'read',
  'readfile',
  'search',
  'view',
]);

const SINGULAR_PATH_KEYS = ['file_path', 'filePath', 'path', 'target_file', 'targetFile'] as const;
const PLURAL_PATH_KEYS = ['file_paths', 'filePaths', 'paths', 'files', 'targets'] as const;
const NESTED_TARGET_KEYS = ['operations', 'edits'] as const;
const PATCH_KEYS = ['patch', 'diff', 'patchText', 'patch_text', 'changes'] as const;

export const COMET_HOOK_PLATFORM_IDS = new Set([
  'claude',
  'codex',
  'windsurf',
  'github-copilot',
  'gemini',
  'amazon-q',
  'qwen',
  'kiro',
  'codebuddy',
  'workbuddy',
  'oh-my-pi',
  'qoder',
  'trae',
  'trae-cn',
  'grok',
  'dsh',
  'zcode',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '');
}

function readToolName(input: Record<string, unknown>): string | null {
  for (const key of ['tool_name', 'toolName', 'tool', 'name'] as const) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function readWorkingDirectory(input: Record<string, unknown>): string | undefined {
  for (const key of ['cwd', 'working_directory', 'workspaceRoot'] as const) {
    const value = input[key];
    if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value.trim())) continue;
    return value.trim();
  }
  return undefined;
}

function readSessionId(input: Record<string, unknown>): string | undefined {
  for (const key of ['session_id', 'sessionId', 'conversation_id', 'conversationId'] as const) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim().slice(0, 256);
  }
  return undefined;
}

function readHookEventName(input: Record<string, unknown>): string | undefined {
  for (const key of ['hook_event_name', 'hookEventName', 'event_name', 'eventName'] as const) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return normalizedToolName(value);
  }
  return undefined;
}

function readTask(input: Record<string, unknown>): string | undefined {
  for (const key of ['task', 'prompt', 'user_prompt', 'userPrompt'] as const) {
    const value = input[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const source = value.trim();
  if (!source.startsWith('{') && !source.startsWith('[')) return value;
  try {
    return JSON.parse(source) as unknown;
  } catch {
    return value;
  }
}

function readToolArguments(input: Record<string, unknown>): unknown {
  for (const key of ['tool_input', 'toolInput', 'toolArgs', 'tool_args', 'arguments'] as const) {
    if (input[key] !== undefined) return parseJsonValue(input[key]);
  }
  return input;
}

function patchTargets(source: string): string[] {
  const targets: string[] = [];
  const patterns = [
    /^\*\*\* (?:Add|Update|Delete) File:\s+(.+?)\s*$/gmu,
    /^\+\+\+\s+(?:b\/)?(.+?)\s*$/gmu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const target = match[1]?.trim();
      if (target && target !== '/dev/null') targets.push(target);
    }
  }
  return targets;
}

/** Resource addresses are not filesystem writes. Drive paths remain file targets. */
export function normalizeCometHookTargets(targets: readonly string[]): string[] {
  return [
    ...new Set(
      targets.flatMap((value) => {
        const target = value.trim();
        if (!target) return [];
        if (/^file:/iu.test(target)) {
          try {
            return [fileURLToPath(target)];
          } catch {
            // 保留无效文件地址，继续让 Guard 检查同一请求中的其他文件。
            return [target];
          }
        }
        if (/^[A-Za-z]:/u.test(target)) return [target];
        return /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target) ? [] : [target];
      }),
    ),
  ];
}

function addTarget(targets: string[], value: unknown): void {
  if (typeof value === 'string') {
    const target = value.trim();
    if (target) targets.push(target);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) addTarget(targets, entry);
    return;
  }
  if (!isRecord(value)) return;
  for (const key of SINGULAR_PATH_KEYS) addTarget(targets, value[key]);
  for (const key of PLURAL_PATH_KEYS) addTarget(targets, value[key]);
  for (const key of NESTED_TARGET_KEYS) addTarget(targets, value[key]);
}

function collectTargets(input: Record<string, unknown>, args: unknown): string[] {
  const targets: string[] = [];
  const records = [args, input].filter(isRecord);
  for (const record of records) {
    for (const key of SINGULAR_PATH_KEYS) addTarget(targets, record[key]);
    for (const key of PLURAL_PATH_KEYS) addTarget(targets, record[key]);
    for (const key of NESTED_TARGET_KEYS) addTarget(targets, record[key]);
    for (const key of PATCH_KEYS) {
      const value = record[key];
      if (typeof value === 'string') targets.push(...patchTargets(value));
    }
  }
  if (typeof args === 'string') targets.push(...patchTargets(args));
  return normalizeCometHookTargets(targets);
}

function collectWriteProposals(args: unknown): CometHookWriteProposal[] {
  if (typeof args === 'string' && args.startsWith('*** Begin Patch') && /^[- +].+/mu.test(args))
    return patchTargets(args).map((file) => ({ path: file, patch: args }));
  if (!isRecord(args)) return [];
  for (const key of PATCH_KEYS) {
    if (typeof args[key] === 'string') return collectWriteProposals(args[key]);
  }
  const file = SINGULAR_PATH_KEYS.map((key) => args[key]).find(
    (value) => typeof value === 'string',
  );
  if (typeof file !== 'string') return [];
  if (typeof args.content === 'string') return [{ path: file, content: args.content }];
  const edits = Array.isArray(args.edits) ? args.edits : [args];
  const replacements: NonNullable<CometHookWriteProposal['replacements']> = [];
  for (const edit of edits) {
    if (!isRecord(edit)) return [];
    const oldText = edit.old_string ?? edit.oldString;
    const newText = edit.new_string ?? edit.newString;
    if (typeof oldText !== 'string' || !oldText || typeof newText !== 'string') return [];
    replacements.push({ oldText, newText, replaceAll: edit.replace_all === true });
  }
  return replacements.length ? [{ path: file, replacements }] : [];
}

/** 无完整、唯一匹配的编辑内容时返回 null，不推测工具实际会写什么。 */
export function proposedCometHookFileContent(
  proposal: CometHookWriteProposal,
  before: string,
): string | null {
  if (proposal.content !== undefined) return proposal.content;
  let after = before;
  if (proposal.replacements) {
    for (const edit of proposal.replacements) {
      const first = after.indexOf(edit.oldText);
      if (
        first < 0 ||
        (!edit.replaceAll && after.indexOf(edit.oldText, first + edit.oldText.length) >= 0)
      )
        return null;
      after = edit.replaceAll
        ? after.split(edit.oldText).join(edit.newText)
        : after.slice(0, first) + edit.newText + after.slice(first + edit.oldText.length);
    }
    return after;
  }
  if (!proposal.patch?.startsWith('*** Begin Patch')) return null;
  const lines = proposal.patch.replaceAll('\r\n', '\n').split('\n');
  const start = lines.indexOf(`*** Update File: ${proposal.path}`);
  if (start < 0) return null;
  let oldLines: string[] = [],
    newLines: string[] = [];
  const apply = (): boolean => {
    if (!oldLines.length) return false;
    const oldText = oldLines.join('\n');
    const index = after.indexOf(oldText);
    if (index < 0 || after.indexOf(oldText, index + oldText.length) >= 0) return false;
    after = after.slice(0, index) + newLines.join('\n') + after.slice(index + oldText.length);
    oldLines = [];
    newLines = [];
    return true;
  };
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('***')) return oldLines.length && apply() ? after : null;
    if (line.startsWith('@@')) {
      if (oldLines.length && !apply()) return null;
      continue;
    }
    if (line.startsWith(' ')) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    } else if (line.startsWith('-')) oldLines.push(line.slice(1));
    else if (line.startsWith('+')) newLines.push(line.slice(1));
    else return null;
  }
  return null;
}

export function parseCometHookRequest(source: string, filePath?: string): CometHookRequest {
  if (filePath?.trim()) {
    const targets = normalizeCometHookTargets([filePath]);
    return { intent: targets.length > 0 ? 'write' : 'non-write', targets, toolName: null };
  }
  if (!source.trim()) return { intent: 'unknown', targets: [], toolName: null };

  let input: unknown;
  try {
    input = JSON.parse(stripUtf8Bom(source)) as unknown;
  } catch {
    const targets = patchTargets(source);
    if (targets.length > 0) {
      const files = normalizeCometHookTargets(targets);
      return {
        intent: files.length > 0 ? 'write' : 'non-write',
        targets: files,
        toolName: 'apply_patch',
        ...(collectWriteProposals(source).length ? { writes: collectWriteProposals(source) } : {}),
      };
    }
    return { intent: 'unknown', targets: [], toolName: null };
  }
  if (!isRecord(input)) return { intent: 'unknown', targets: [], toolName: null };

  const toolName = readToolName(input);
  const args = readToolArguments(input);
  const targets = collectTargets(input, args);
  const writes = collectWriteProposals(args);
  const rawWorkingDirectory = readWorkingDirectory(input);
  const cwd = rawWorkingDirectory ? path.resolve(rawWorkingDirectory) : undefined;
  const rawCwd = rawWorkingDirectory !== cwd ? rawWorkingDirectory : undefined;
  const sessionId = readSessionId(input);
  if (readHookEventName(input) === 'beforeagentstart') {
    const task = readTask(input);
    return {
      intent: 'context',
      targets: [],
      toolName: null,
      ...(task ? { task } : {}),
      ...(cwd ? { cwd } : {}),
      ...(rawCwd ? { rawCwd } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
  }
  if (toolName && WRITE_TOOL_NAMES.has(normalizedToolName(toolName))) {
    return {
      intent: targets.length > 0 ? 'write' : 'unknown',
      targets,
      toolName,
      ...(writes.length ? { writes } : {}),
      ...(cwd ? { cwd } : {}),
      ...(rawCwd ? { rawCwd } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
  }
  if (toolName && NON_WRITE_TOOL_NAMES.has(normalizedToolName(toolName))) {
    return {
      intent: 'non-write',
      targets: [],
      toolName,
      ...(cwd ? { cwd } : {}),
      ...(rawCwd ? { rawCwd } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
  }
  if (toolName)
    return {
      intent: 'unknown',
      targets,
      toolName,
      ...(cwd ? { cwd } : {}),
      ...(rawCwd ? { rawCwd } : {}),
      ...(sessionId ? { sessionId } : {}),
    };
  return {
    intent: targets.length > 0 ? 'write' : 'unknown',
    targets,
    toolName: null,
    ...(cwd ? { cwd } : {}),
    ...(rawCwd ? { rawCwd } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export async function readCometHookRequest(
  options: {
    readStdin?: () => StdinReadResult | Promise<StdinReadResult>;
  } = {},
): Promise<CometHookRequest> {
  const filePath = process.env.FILE_PATH;
  if (filePath?.trim()) return parseCometHookRequest('', filePath);
  if (process.stdin.isTTY) return parseCometHookRequest('', filePath);
  const stdin = await (options.readStdin ?? readStdinTextWithTimeoutAsync)();
  if (stdin.text === null) {
    // A host that neither writes nor closes the hook's stdin is broken; failing
    // fast with a diagnostic beats hanging on every tool call. Not injectable as
    // a plain return because every consumer is a short-lived hook entry point.
    process.stderr.write(
      '[COMET-HOOK] stdin timeout: the host did not provide hook input within the expected window\n',
    );
    process.exit(1);
  }
  try {
    return parseCometHookRequest(stdin.text, filePath);
  } catch {
    return parseCometHookRequest('', filePath);
  }
}

export function renderCometHookDecision(
  platformId: string,
  decision: CometHookAdapterDecision,
): CometHookProcessOutput {
  if (!COMET_HOOK_PLATFORM_IDS.has(platformId)) {
    return {
      exitCode: 64,
      stdout: '',
      stderr: `Unsupported Comet Hook platform: ${platformId}\n`,
    };
  }
  if (platformId === 'github-copilot') {
    return {
      exitCode: 0,
      stdout: decision.allowed
        ? `${JSON.stringify(decision.context ? { additionalContext: decision.context } : {})}\n`
        : `${JSON.stringify({
            permissionDecision: 'deny',
            permissionDecisionReason: decision.reason,
          })}\n`,
      stderr: decision.diagnostic ? `${decision.diagnostic}\n` : '',
    };
  }
  if (platformId === 'dsh' && !decision.allowed) {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: decision.reason,
        },
      })}\n`,
      stderr: decision.diagnostic ? `${decision.diagnostic}\n` : '',
    };
  }
  if (decision.allowed && decision.context) {
    return {
      exitCode: 0,
      stdout: `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          additionalContext: decision.context,
        },
      })}\n`,
      stderr: decision.diagnostic ? `${decision.diagnostic}\n` : '',
    };
  }
  if (decision.allowed)
    return {
      exitCode: 0,
      stdout: '',
      stderr: decision.diagnostic ? `${decision.diagnostic}\n` : '',
    };
  return { exitCode: 2, stdout: '', stderr: `${decision.reason}\n` };
}
