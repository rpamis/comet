import path from 'path';

import {
  getPlatformConfigDir,
  getPlatformSkillsDir,
  type Platform,
} from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';
import { fileExists } from '../../platform/fs/file-system.js';
import {
  buildHookCommand,
  computeRuleDestPath,
  isManagedHookCommand,
  readManifest,
} from './platform-install.js';
import { readJsonObjectFile } from './json-object.js';
import type { InitWorkflowSelection } from '../comet-entry/types.js';

export interface HookInspectionResult {
  present: boolean;
  legacyPresent?: boolean;
  duplicatePresent?: boolean;
  error?: string;
}

const LEGACY_HOOK_SCRIPT_NAMES = ['comet-hook-guard.mjs', 'comet-native-hook-guard.mjs'] as const;
const LEGACY_HOOK_SCRIPT_PATHS = [
  'comet/scripts/comet-hook-guard.mjs',
  'comet-native/scripts/comet-native-hook-guard.mjs',
] as const;

const LEGACY_RULE_FILE_NAMES = ['comet-phase-guard.md', 'comet-native-phase-guard.md'] as const;

type JsonReadResult =
  | { status: 'missing' }
  | { status: 'error'; error: string }
  | { status: 'present'; value: Record<string, unknown> };

function getRulesBaseDir(baseDir: string, platform: Platform, scope: InstallScope): string {
  if (platform.rulesBaseDir === '') return baseDir;
  if (platform.rulesBaseDir !== undefined) {
    return path.join(baseDir, platform.rulesBaseDir);
  }
  return path.join(baseDir, getPlatformSkillsDir(platform, scope));
}

export async function getPlatformRuleDestinations(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  _workflowSelection: InitWorkflowSelection = 'classic',
): Promise<string[]> {
  if (!platform.rulesDir || !platform.rulesFormat) return [];

  const manifest = await readManifest();
  const rulesDestDir = path.join(getRulesBaseDir(baseDir, platform, scope), platform.rulesDir);
  const destinations = new Set<string>();

  const rulePaths = manifest.rules ?? [];
  for (const ruleRelPath of rulePaths) {
    const installedName = path.basename(ruleRelPath).replace(/\.en\.md$/u, '.md');
    destinations.add(computeRuleDestPath(rulesDestDir, installedName, platform.rulesFormat));
  }

  return [...destinations];
}

export function getLegacyPlatformRuleDestinations(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): string[] {
  if (!platform.rulesDir || !platform.rulesFormat) return [];
  const rulesDestDir = path.join(getRulesBaseDir(baseDir, platform, scope), platform.rulesDir);
  return LEGACY_RULE_FILE_NAMES.map((fileName) =>
    computeRuleDestPath(rulesDestDir, fileName, platform.rulesFormat!),
  );
}

async function readHookJson(filePath: string): Promise<JsonReadResult> {
  const result = await readJsonObjectFile(filePath);
  if (result.status !== 'error') return result;
  return {
    status: 'error',
    error: `${result.kind === 'invalid' ? 'Invalid' : 'Unable to read'} Hook JSON at ${filePath}: ${result.error.message}`,
  };
}

function collectGroupedCommands(config: Record<string, unknown>, groupName: string): unknown[] {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const groups = (hooks as Record<string, unknown>)[groupName];
  if (!Array.isArray(groups)) return [];

  return groups.flatMap((group) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return [];
    const handlers = (group as Record<string, unknown>).hooks;
    if (!Array.isArray(handlers)) return [];
    return handlers.map((handler) =>
      handler && typeof handler === 'object' && !Array.isArray(handler)
        ? (handler as Record<string, unknown>).command
        : undefined,
    );
  });
}

function collectCommandArray(config: Record<string, unknown>, groupName: string): unknown[] {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const entries = (hooks as Record<string, unknown>)[groupName];
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return [record.command, record.bash, record.powershell];
  });
}

function collectCopilotCommands(config: Record<string, unknown>): unknown[] {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const entries = (hooks as Record<string, unknown>).preToolUse;
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
    const record = entry as Record<string, unknown>;
    return record.command ?? record.bash ?? record.powershell;
  });
}

function containsAllManagedCommands(commands: unknown[], expectedCommands: string[]): boolean {
  return expectedCommands.every((expected) => commands.some((command) => command === expected));
}

function containsDuplicateManagedCommand(commands: unknown[], expectedCommands: string[]): boolean {
  return expectedCommands.some(
    (expected) => commands.filter((command) => command === expected).length > 1,
  );
}

function containsLegacyManagedCommand(commands: unknown[]): boolean {
  return commands.some(
    (command) =>
      typeof command === 'string' &&
      isManagedHookCommand(command, [...LEGACY_HOOK_SCRIPT_PATHS]) &&
      LEGACY_HOOK_SCRIPT_NAMES.some((scriptName) => command.includes(scriptName)),
  );
}

async function inspectSingleHookJson(
  configPath: string,
  expectedCommands: string[],
  collectCommands: (config: Record<string, unknown>) => unknown[],
): Promise<HookInspectionResult> {
  const result = await readHookJson(configPath);
  if (result.status === 'missing') return { present: false };
  if (result.status === 'error') return { present: false, error: result.error };
  const commands = collectCommands(result.value);
  const legacyPresent = containsLegacyManagedCommand(commands);
  const duplicatePresent = containsDuplicateManagedCommand(commands, expectedCommands);
  return {
    present: containsAllManagedCommands(commands, expectedCommands),
    ...(legacyPresent ? { legacyPresent: true } : {}),
    ...(duplicatePresent ? { duplicatePresent: true } : {}),
  };
}

async function inspectKiroHooks(
  platformBase: string,
  scriptRelPaths: string[],
  expectedCommands: string[],
): Promise<HookInspectionResult> {
  for (const [index, scriptRelPath] of scriptRelPaths.entries()) {
    const fileName = path.basename(scriptRelPath).replace(/\.mjs$/u, '.kiro.hook');
    const configPath = path.join(platformBase, 'hooks', fileName);
    const result = await readHookJson(configPath);
    if (result.status === 'missing') return { present: false };
    if (result.status === 'error') return { present: false, error: result.error };

    const then = result.value.then;
    const command =
      then && typeof then === 'object' && !Array.isArray(then)
        ? (then as Record<string, unknown>).command
        : undefined;
    if (command !== expectedCommands[index]) return { present: false };
  }

  const legacyPresent = (
    await Promise.all(
      LEGACY_HOOK_SCRIPT_NAMES.map((scriptName) =>
        fileExists(path.join(platformBase, 'hooks', scriptName.replace(/\.mjs$/u, '.kiro.hook'))),
      ),
    )
  ).some(Boolean);
  return { present: scriptRelPaths.length > 0, ...(legacyPresent ? { legacyPresent: true } : {}) };
}

export async function inspectCometHooksForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  _workflowSelection: InitWorkflowSelection = 'classic',
): Promise<HookInspectionResult> {
  if (!platform.supportsHooks || !platform.hookFormat) return { present: false };

  const manifest = await readManifest();
  const scriptRelPaths = Object.keys(manifest.hooks ?? {});
  if (scriptRelPaths.length === 0) return { present: false };

  const skillsDir = getPlatformSkillsDir(platform, scope);
  const expectedCommands = scriptRelPaths.map((scriptRelPath) =>
    buildHookCommand(baseDir, skillsDir, scriptRelPath, {
      platformId: platform.id,
      scope,
    }),
  );

  const platformBase = path.join(baseDir, getPlatformConfigDir(platform, scope));
  let inspection: HookInspectionResult;
  switch (platform.hookFormat) {
    case 'claude-code':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, platform.hookConfigFile ?? 'settings.local.json'),
        expectedCommands,
        (config) => collectGroupedCommands(config, 'PreToolUse'),
      );
      break;
    case 'qwen':
    case 'qoder':
    case 'codebuddy':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, 'settings.json'),
        expectedCommands,
        (config) => collectGroupedCommands(config, 'PreToolUse'),
      );
      break;
    case 'gemini':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, 'settings.json'),
        expectedCommands,
        (config) => collectGroupedCommands(config, 'BeforeTool'),
      );
      break;
    case 'windsurf':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, 'hooks.json'),
        expectedCommands,
        (config) => collectCommandArray(config, 'pre_write_code'),
      );
      break;
    case 'copilot':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, 'hooks', 'comet-guard.json'),
        expectedCommands,
        collectCopilotCommands,
      );
      break;
    case 'kiro':
      inspection = await inspectKiroHooks(platformBase, scriptRelPaths, expectedCommands);
      break;
  }

  if (!inspection.present) return inspection;
  for (const scriptRelPath of scriptRelPaths) {
    const scriptPath = path.join(baseDir, skillsDir, 'skills', ...scriptRelPath.split('/'));
    try {
      if (!(await fileExists(scriptPath))) {
        return { present: false, error: `managed Hook script missing at ${scriptPath}` };
      }
    } catch (error) {
      return {
        present: false,
        error: `Unable to inspect managed Hook script at ${scriptPath}: ${(error as Error).message}`,
      };
    }
  }
  return inspection;
}
