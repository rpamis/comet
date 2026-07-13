import path from 'path';

import {
  getPlatformConfigDir,
  getPlatformSkillsDir,
  type Platform,
} from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';
import { fileExists } from '../../platform/fs/file-system.js';
import { buildHookCommand, computeRuleDestPath, readManifest } from './platform-install.js';
import { readJsonObjectFile } from './json-object.js';

export interface HookInspectionResult {
  present: boolean;
  error?: string;
}

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
): Promise<string[]> {
  if (!platform.rulesDir || !platform.rulesFormat) return [];

  const manifest = await readManifest();
  const rulesDestDir = path.join(getRulesBaseDir(baseDir, platform, scope), platform.rulesDir);
  const destinations = new Set<string>();

  for (const ruleRelPath of manifest.rules ?? []) {
    const installedName = path.basename(ruleRelPath).replace(/\.en\.md$/u, '.md');
    destinations.add(computeRuleDestPath(rulesDestDir, installedName, platform.rulesFormat));
  }

  return [...destinations];
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

function containsAllManagedCommands(commands: unknown[], expectedCommands: string[]): boolean {
  return expectedCommands.every((expected) => commands.some((command) => command === expected));
}

async function inspectSingleHookJson(
  configPath: string,
  expectedCommands: string[],
  collectCommands: (config: Record<string, unknown>) => unknown[],
): Promise<HookInspectionResult> {
  const result = await readHookJson(configPath);
  if (result.status === 'missing') return { present: false };
  if (result.status === 'error') return { present: false, error: result.error };
  return {
    present: containsAllManagedCommands(collectCommands(result.value), expectedCommands),
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

  return { present: scriptRelPaths.length > 0 };
}

export async function inspectCometHooksForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<HookInspectionResult> {
  if (!platform.supportsHooks || !platform.hookFormat) return { present: false };

  const manifest = await readManifest();
  const scriptRelPaths = Object.keys(manifest.hooks ?? {});
  if (scriptRelPaths.length === 0) return { present: false };

  const skillsDir = getPlatformSkillsDir(platform, scope);
  const expectedCommands = scriptRelPaths.map((scriptRelPath) =>
    buildHookCommand(baseDir, skillsDir, scriptRelPath),
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
        (config) => collectCommandArray(config, 'preToolUse'),
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
