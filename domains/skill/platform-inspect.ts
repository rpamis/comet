import path from 'path';
import { readFile } from 'fs/promises';

import {
  getPlatformConfigDir,
  getPlatformSkillsDir,
  type Platform,
} from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';
import { computeRuleDestPath, isManagedHookCommand, readManifest } from './platform-install.js';

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
  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' };
    return {
      status: 'error',
      error: `Unable to read Hook JSON at ${filePath}: ${(error as Error).message}`,
    };
  }

  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('expected a JSON object');
    }
    return { status: 'present', value: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      status: 'error',
      error: `Invalid Hook JSON at ${filePath}: ${(error as Error).message}`,
    };
  }
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

function containsAllManagedCommands(commands: unknown[], scriptRelPaths: string[]): boolean {
  return scriptRelPaths.every((scriptRelPath) =>
    commands.some((command) => isManagedHookCommand(command, [scriptRelPath])),
  );
}

async function inspectSingleHookJson(
  configPath: string,
  scriptRelPaths: string[],
  collectCommands: (config: Record<string, unknown>) => unknown[],
): Promise<HookInspectionResult> {
  const result = await readHookJson(configPath);
  if (result.status === 'missing') return { present: false };
  if (result.status === 'error') return { present: false, error: result.error };
  return {
    present: containsAllManagedCommands(collectCommands(result.value), scriptRelPaths),
  };
}

async function inspectKiroHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<HookInspectionResult> {
  for (const scriptRelPath of scriptRelPaths) {
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
    if (!isManagedHookCommand(command, [scriptRelPath])) return { present: false };
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

  const platformBase = path.join(baseDir, getPlatformConfigDir(platform, scope));
  switch (platform.hookFormat) {
    case 'claude-code':
      return inspectSingleHookJson(
        path.join(platformBase, platform.hookConfigFile ?? 'settings.local.json'),
        scriptRelPaths,
        (config) => collectGroupedCommands(config, 'PreToolUse'),
      );
    case 'qwen':
    case 'qoder':
    case 'codebuddy':
      return inspectSingleHookJson(
        path.join(platformBase, 'settings.json'),
        scriptRelPaths,
        (config) => collectGroupedCommands(config, 'PreToolUse'),
      );
    case 'gemini':
      return inspectSingleHookJson(
        path.join(platformBase, 'settings.json'),
        scriptRelPaths,
        (config) => collectGroupedCommands(config, 'BeforeTool'),
      );
    case 'windsurf':
      return inspectSingleHookJson(
        path.join(platformBase, 'hooks.json'),
        scriptRelPaths,
        (config) => collectCommandArray(config, 'pre_write_code'),
      );
    case 'copilot':
      return inspectSingleHookJson(
        path.join(platformBase, 'hooks', 'comet-guard.json'),
        scriptRelPaths,
        (config) => collectCommandArray(config, 'preToolUse'),
      );
    case 'kiro':
      return inspectKiroHooks(platformBase, scriptRelPaths);
  }
}
