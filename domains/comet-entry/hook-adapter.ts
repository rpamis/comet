import { readFileSync } from 'fs';

import type { CometHookDecision, CometHookProcessOutput, CometHookRequest } from './hook-types.js';

const WRITE_TOOL_NAMES = new Set([
  'applypatch',
  'create',
  'createfile',
  'deletefile',
  'edit',
  'editfile',
  'patch',
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
  'qoder',
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
  return [...new Set(targets)];
}

export function parseCometHookRequest(source: string, filePath?: string): CometHookRequest {
  if (filePath?.trim()) {
    return { intent: 'write', targets: [filePath.trim()], toolName: null };
  }
  if (!source.trim()) return { intent: 'unknown', targets: [], toolName: null };

  let input: unknown;
  try {
    input = JSON.parse(source) as unknown;
  } catch {
    return { intent: 'unknown', targets: [], toolName: null };
  }
  if (!isRecord(input)) return { intent: 'unknown', targets: [], toolName: null };

  const toolName = readToolName(input);
  const targets = collectTargets(input, readToolArguments(input));
  if (toolName && WRITE_TOOL_NAMES.has(normalizedToolName(toolName))) {
    return {
      intent: targets.length > 0 ? 'write' : 'unknown',
      targets,
      toolName,
    };
  }
  if (toolName && NON_WRITE_TOOL_NAMES.has(normalizedToolName(toolName))) {
    return { intent: 'non-write', targets: [], toolName };
  }
  if (toolName) return { intent: 'unknown', targets, toolName };
  return {
    intent: targets.length > 0 ? 'write' : 'unknown',
    targets,
    toolName: null,
  };
}

export function readCometHookRequest(): CometHookRequest {
  const filePath = process.env.FILE_PATH;
  if (filePath?.trim()) return parseCometHookRequest('', filePath);
  if (process.stdin.isTTY) return parseCometHookRequest('', filePath);
  try {
    return parseCometHookRequest(readFileSync(0, 'utf8'), filePath);
  } catch {
    return parseCometHookRequest('', filePath);
  }
}

export function renderCometHookDecision(
  platformId: string,
  decision: CometHookDecision,
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
        ? '{}\n'
        : `${JSON.stringify({
            permissionDecision: 'deny',
            permissionDecisionReason: decision.reason,
          })}\n`,
      stderr: '',
    };
  }
  if (decision.allowed) return { exitCode: 0, stdout: '', stderr: '' };
  return { exitCode: 2, stdout: '', stderr: `${decision.reason}\n` };
}
