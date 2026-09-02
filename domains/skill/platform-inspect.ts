import path from 'path';
import { readFile } from 'fs/promises';

import {
  getPlatformConfigDir,
  getPlatformConfigDirs,
  getPlatformRuleBaseDirs,
  getPlatformSkillsDir,
  getPlatformSkillsDirs,
  type Platform,
} from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';
import { fileExists } from '../../platform/fs/file-system.js';
import {
  buildHookCommand,
  computeRuleDestPath,
  isManagedHookCommand,
  buildHookInvocation,
  OMP_HOOK_MARKER,
  OMP_HOOK_RELATIVE_PATH,
  readManifest,
  renderOmpHookModule,
  resolveInstalledHookMatcher,
} from './platform-install.js';
import { readJsonObjectFile } from './json-object.js';
import type { InitWorkflowSelection } from '../comet-entry/types.js';
import { dshInstructionPath, hasDshCordisPatch } from './dsh-adapter.js';

export interface HookInspectionResult {
  present: boolean;
  /** A Comet-owned Hook exists even when its command is stale or relocated. */
  managedPresent?: boolean;
  legacyPresent?: boolean;
  duplicatePresent?: boolean;
  /** dsh has the config/patch, but the active profile still needs the bridge loaded. */
  activationRequired?: boolean;
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
  return path.join(baseDir, getPlatformRuleBaseDirs(platform, scope)[0]!);
}

export async function getPlatformRuleDestinations(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  _workflowSelection: InitWorkflowSelection = 'classic',
): Promise<string[]> {
  if (platform.rulesFormat === 'dsh') {
    return [dshInstructionPath(baseDir, platform, scope)];
  }
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

export async function getLegacyPlatformRuleDestinations(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
): Promise<string[]> {
  if (platform.rulesFormat === 'dsh') return [];
  if (!platform.rulesDir || !platform.rulesFormat) return [];

  const manifest = await readManifest();
  const managedRuleFileNames = new Set(
    [...(manifest.rules ?? []), ...(manifest.nativeRules ?? []), ...LEGACY_RULE_FILE_NAMES].map(
      (rulePath) => path.basename(rulePath).replace(/\.en\.md$/u, '.md'),
    ),
  );
  const ruleBaseDirs = [
    ...new Set(
      getPlatformRuleBaseDirs(platform, scope).map((rulesBase) => path.resolve(baseDir, rulesBase)),
    ),
  ];
  const [canonicalRulesBase, ...legacyRulesBases] = ruleBaseDirs;
  const destinations = new Set<string>();
  if (canonicalRulesBase) {
    const rulesDestDir = path.join(canonicalRulesBase, platform.rulesDir);
    for (const fileName of LEGACY_RULE_FILE_NAMES) {
      destinations.add(computeRuleDestPath(rulesDestDir, fileName, platform.rulesFormat));
    }
  }
  for (const rulesBase of legacyRulesBases) {
    const rulesDestDir = path.join(rulesBase, platform.rulesDir);
    for (const fileName of managedRuleFileNames) {
      destinations.add(computeRuleDestPath(rulesDestDir, fileName, platform.rulesFormat));
    }
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

interface ExpectedHookDescriptor {
  scriptRelPath: string;
  command: string;
  args?: string[];
  matcher: string;
}

interface CollectedHookCommand {
  command: unknown;
  args?: unknown;
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
    return handlers.map((handler): CollectedHookCommand => {
      if (!handler || typeof handler !== 'object' || Array.isArray(handler)) {
        return { command: undefined };
      }
      const record = handler as Record<string, unknown>;
      return { command: record.command, args: record.args };
    });
  });
}

function equalStringArray(actual: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function countGroupedHookMatches(
  config: Record<string, unknown>,
  groupName: string,
  expected: ExpectedHookDescriptor,
  expectedMatcher: (matcher: string) => string = (matcher) => matcher,
  isExpectedHandler: (
    handler: Record<string, unknown>,
    expected: ExpectedHookDescriptor,
  ) => boolean = (handler, descriptor) =>
    handler.type === 'command' &&
    handler.command === descriptor.command &&
    (descriptor.args === undefined || equalStringArray(handler.args, descriptor.args)),
): number {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return 0;
  const groups = (hooks as Record<string, unknown>)[groupName];
  if (!Array.isArray(groups)) return 0;
  return groups.reduce((count, group) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return count;
    const record = group as Record<string, unknown>;
    if (record.matcher !== expectedMatcher(expected.matcher) || !Array.isArray(record.hooks)) {
      return count;
    }
    return (
      count +
      record.hooks.filter(
        (handler) =>
          handler !== null &&
          typeof handler === 'object' &&
          !Array.isArray(handler) &&
          isExpectedHandler(handler as Record<string, unknown>, expected),
      ).length
    );
  }, 0);
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

function countWindsurfHookMatches(
  config: Record<string, unknown>,
  expected: ExpectedHookDescriptor,
): number {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return 0;
  const entries = (hooks as Record<string, unknown>).pre_write_code;
  if (!Array.isArray(entries)) return 0;
  return entries.filter(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).command === expected.command &&
      (entry as Record<string, unknown>).show_output === true,
  ).length;
}

function collectCopilotCommandFields(config: Record<string, unknown>): unknown[] {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const entries = (hooks as Record<string, unknown>).preToolUse;
  if (!Array.isArray(entries)) return [];
  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    return [record.command, record.bash, record.powershell];
  });
}

function countCopilotHookMatches(
  config: Record<string, unknown>,
  expected: ExpectedHookDescriptor,
): number {
  const hooks = config.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return 0;
  const entries = (hooks as Record<string, unknown>).preToolUse;
  if (!Array.isArray(entries)) return 0;
  const matcher =
    expected.matcher === 'Write|Edit'
      ? 'create|edit|str_replace_editor|apply_patch'
      : expected.matcher;
  return entries.filter(
    (entry) =>
      entry !== null &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).matcher === matcher &&
      (entry as Record<string, unknown>).bash === expected.command &&
      (entry as Record<string, unknown>).powershell === expected.command,
  ).length;
}

function containsDuplicateManagedHook(
  config: Record<string, unknown>,
  expectedHooks: ExpectedHookDescriptor[],
  countMatches: (config: Record<string, unknown>, expected: ExpectedHookDescriptor) => number,
): boolean {
  return expectedHooks.some((expected) => countMatches(config, expected) > 1);
}

function containsExtraManagedCommandCopies(
  commands: unknown[],
  expectedHooks: ExpectedHookDescriptor[],
  expectedCopiesPerHook: number,
): boolean {
  return expectedHooks.some(
    (expected) =>
      commands.filter((candidate) => {
        const record =
          candidate && typeof candidate === 'object' && !Array.isArray(candidate)
            ? (candidate as CollectedHookCommand)
            : { command: candidate };
        return (
          record.command === expected.command &&
          (expected.args === undefined || equalStringArray(record.args, expected.args))
        );
      }).length > expectedCopiesPerHook,
  );
}

function containsAllManagedHooks(
  config: Record<string, unknown>,
  expectedHooks: ExpectedHookDescriptor[],
  countMatches: (config: Record<string, unknown>, expected: ExpectedHookDescriptor) => number,
): boolean {
  return expectedHooks.every((expected) => countMatches(config, expected) > 0);
}

function containsLegacyManagedCommand(commands: unknown[]): boolean {
  return commands.some((candidate) => {
    const record =
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? (candidate as CollectedHookCommand)
        : { command: candidate };
    const commandText = [record.command, ...(Array.isArray(record.args) ? record.args : [])].filter(
      (value): value is string => typeof value === 'string',
    );
    return (
      isManagedHookCommand(record.command, [...LEGACY_HOOK_SCRIPT_PATHS], record.args) &&
      LEGACY_HOOK_SCRIPT_NAMES.some((scriptName) =>
        commandText.some((value) => value.includes(scriptName)),
      )
    );
  });
}

async function inspectSingleHookJson(
  configPath: string,
  expectedHooks: ExpectedHookDescriptor[],
  collectManagedCommands: (config: Record<string, unknown>) => unknown[],
  countMatches: (config: Record<string, unknown>, expected: ExpectedHookDescriptor) => number,
  expectedCommandCopiesPerHook = 1,
): Promise<HookInspectionResult> {
  const result = await readHookJson(configPath);
  if (result.status === 'missing') return { present: false };
  if (result.status === 'error') return { present: false, error: result.error };
  const managedCommands = collectManagedCommands(result.value);
  const managedScriptPaths = [
    ...new Set([
      ...expectedHooks.map(({ scriptRelPath }) => scriptRelPath),
      ...LEGACY_HOOK_SCRIPT_PATHS,
    ]),
  ];
  const managedPresent = managedCommands.some((candidate) => {
    const record =
      candidate && typeof candidate === 'object' && !Array.isArray(candidate)
        ? (candidate as CollectedHookCommand)
        : { command: candidate };
    return isManagedHookCommand(record.command, managedScriptPaths, record.args);
  });
  const legacyPresent = containsLegacyManagedCommand(managedCommands);
  const duplicatePresent =
    containsDuplicateManagedHook(result.value, expectedHooks, countMatches) ||
    containsExtraManagedCommandCopies(managedCommands, expectedHooks, expectedCommandCopiesPerHook);
  const present = containsAllManagedHooks(result.value, expectedHooks, countMatches);
  return {
    present,
    ...(!present && managedPresent ? { managedPresent: true } : {}),
    ...(legacyPresent ? { legacyPresent: true } : {}),
    ...(duplicatePresent ? { duplicatePresent: true } : {}),
  };
}

async function inspectKiroHooks(
  platformBase: string,
  expectedHooks: ExpectedHookDescriptor[],
): Promise<HookInspectionResult> {
  const scriptRelPaths = expectedHooks.map(({ scriptRelPath }) => scriptRelPath);
  const managedScriptPaths = [...new Set([...scriptRelPaths, ...LEGACY_HOOK_SCRIPT_PATHS])];
  let present = true;
  let managedPresent = false;
  let legacyPresent = false;

  for (const expected of expectedHooks) {
    const { scriptRelPath } = expected;
    const fileName = path.basename(scriptRelPath).replace(/\.mjs$/u, '.kiro.hook');
    const configPath = path.join(platformBase, 'hooks', fileName);
    const result = await readHookJson(configPath);
    if (result.status === 'missing') {
      present = false;
      continue;
    }
    if (result.status === 'error') return { present: false, error: result.error };

    const when = result.value.when;
    const then = result.value.then;
    const command =
      then && typeof then === 'object' && !Array.isArray(then)
        ? (then as Record<string, unknown>).command
        : undefined;
    if (isManagedHookCommand(command, managedScriptPaths)) {
      managedPresent = true;
      if (
        typeof command === 'string' &&
        LEGACY_HOOK_SCRIPT_NAMES.some((scriptName) => command.includes(scriptName))
      ) {
        legacyPresent = true;
      }
    }
    const expectedToolName = expected.matcher === 'Write|Edit' ? 'write' : '*';
    if (
      result.value.enabled !== true ||
      !when ||
      typeof when !== 'object' ||
      Array.isArray(when) ||
      (when as Record<string, unknown>).type !== 'preToolUse' ||
      (when as Record<string, unknown>).toolName !== expectedToolName ||
      !then ||
      typeof then !== 'object' ||
      Array.isArray(then) ||
      (then as Record<string, unknown>).type !== 'runCommand' ||
      command !== expected.command
    ) {
      present = false;
    }
  }

  for (const scriptName of LEGACY_HOOK_SCRIPT_NAMES) {
    const result = await readHookJson(
      path.join(platformBase, 'hooks', scriptName.replace(/\.mjs$/u, '.kiro.hook')),
    );
    if (result.status === 'error') return { present: false, error: result.error };
    if (result.status !== 'present') continue;
    const then = result.value.then;
    const command =
      then && typeof then === 'object' && !Array.isArray(then)
        ? (then as Record<string, unknown>).command
        : undefined;
    if (isManagedHookCommand(command, managedScriptPaths)) {
      managedPresent = true;
      legacyPresent = true;
    }
  }

  return {
    present: present && scriptRelPaths.length > 0,
    ...(!present && managedPresent ? { managedPresent: true } : {}),
    ...(legacyPresent ? { legacyPresent: true } : {}),
  };
}

export async function inspectCometHooksForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  _workflowSelection: InitWorkflowSelection = 'classic',
): Promise<HookInspectionResult> {
  if (!platform.supportsHooks || !platform.hookFormat) return { present: false };

  const manifest = await readManifest();
  const hooksConfig = manifest.hooks ?? {};
  const scriptRelPaths = Object.keys(hooksConfig);
  if (scriptRelPaths.length === 0) return { present: false };

  const skillsDir = getPlatformSkillsDir(platform, scope);
  const expectedHooks: ExpectedHookDescriptor[] = Object.entries(hooksConfig).map(
    ([scriptRelPath, config]) => {
      const context = { platformId: platform.id, scope };
      const invocation =
        platform.id === 'claude'
          ? buildHookInvocation(baseDir, skillsDir, scriptRelPath, context)
          : undefined;
      return {
        scriptRelPath,
        command:
          invocation?.command ?? buildHookCommand(baseDir, skillsDir, scriptRelPath, context),
        ...(invocation ? { args: invocation.args } : {}),
        matcher: config.matcher,
      };
    },
  );

  const platformBase = path.join(baseDir, getPlatformConfigDir(platform, scope));
  let inspection: HookInspectionResult;
  switch (platform.hookFormat) {
    case 'claude-code':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, platform.hookConfigFile ?? 'settings.local.json'),
        expectedHooks,
        (config) => collectGroupedCommands(config, 'PreToolUse'),
        (config, expected) =>
          countGroupedHookMatches(config, 'PreToolUse', expected, (matcher) =>
            resolveInstalledHookMatcher(platform, matcher),
          ),
      );
      for (const legacyFile of platform.legacyHookConfigFiles ?? []) {
        const legacy = await inspectSingleHookJson(
          path.join(platformBase, legacyFile),
          expectedHooks,
          (config) => collectGroupedCommands(config, 'PreToolUse'),
          (config, expected) =>
            countGroupedHookMatches(config, 'PreToolUse', expected, (matcher) =>
              resolveInstalledHookMatcher(platform, matcher),
            ),
        );
        if (legacy.error) {
          inspection = { ...inspection, present: false, error: legacy.error };
          break;
        }
        if (legacy.present || legacy.managedPresent || legacy.legacyPresent) {
          inspection = {
            ...inspection,
            ...(!inspection.present ? { managedPresent: true } : {}),
            legacyPresent: true,
            ...(legacy.duplicatePresent ? { duplicatePresent: true } : {}),
          };
        }
      }
      break;
    case 'dsh': {
      inspection = await inspectSingleHookJson(
        path.join(platformBase, platform.hookConfigFile ?? 'hooks.json'),
        expectedHooks,
        (config) => collectGroupedCommands(config, 'PreToolUse'),
        (config, expected) => countGroupedHookMatches(config, 'PreToolUse', expected),
      );
      if (inspection.present && !(await hasDshCordisPatch(baseDir, platform, scope))) {
        inspection = {
          ...inspection,
          present: false,
          managedPresent: true,
          error: 'dsh Cordis patch is missing the Comet Hook bridge row',
        };
      } else if (inspection.present) {
        inspection = {
          ...inspection,
          activationRequired: true,
        };
      }
      break;
    }
    case 'qwen':
    case 'qoder':
    case 'codebuddy':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, 'settings.json'),
        expectedHooks,
        (config) => collectGroupedCommands(config, 'PreToolUse'),
        (config, expected) => countGroupedHookMatches(config, 'PreToolUse', expected),
      );
      break;
    case 'gemini':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, 'settings.json'),
        expectedHooks,
        (config) => collectGroupedCommands(config, 'BeforeTool'),
        (config, expected) =>
          countGroupedHookMatches(config, 'BeforeTool', expected, (matcher) =>
            matcher === 'Write|Edit' ? 'write_file|edit_file' : matcher,
          ),
      );
      break;
    case 'windsurf':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, 'hooks.json'),
        expectedHooks,
        (config) => collectCommandArray(config, 'pre_write_code'),
        countWindsurfHookMatches,
      );
      {
        const legacyConfigDirs = getPlatformConfigDirs(platform, scope).slice(1);
        const legacySkillsDirs = getPlatformSkillsDirs(platform, scope).slice(1);
        for (const [index, configDir] of legacyConfigDirs.entries()) {
          const legacySkillsDir = legacySkillsDirs[index] ?? skillsDir;
          const legacyExpectedHooks = expectedHooks.map((expected) => ({
            ...expected,
            command: buildHookCommand(baseDir, legacySkillsDir, expected.scriptRelPath, {
              platformId: platform.id,
              scope,
            }),
          }));
          const legacy = await inspectSingleHookJson(
            path.join(baseDir, configDir, 'hooks.json'),
            legacyExpectedHooks,
            (config) => collectCommandArray(config, 'pre_write_code'),
            countWindsurfHookMatches,
          );
          if (legacy.error) {
            inspection = { ...inspection, present: false, error: legacy.error };
            break;
          }
          if (legacy.present || legacy.managedPresent || legacy.legacyPresent) {
            inspection = {
              ...inspection,
              ...(!inspection.present ? { managedPresent: true } : {}),
              legacyPresent: true,
              ...(legacy.duplicatePresent ? { duplicatePresent: true } : {}),
            };
          }
        }
      }
      break;
    case 'trae':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, 'hooks.json'),
        expectedHooks,
        (config) => collectGroupedCommands(config, 'PreToolUse'),
        (config, expected) =>
          countGroupedHookMatches(
            config,
            'PreToolUse',
            expected,
            undefined,
            (handler, descriptor) => {
              const timeout = handler.timeout;
              return (
                handler.type === 'command' &&
                handler.command === descriptor.command &&
                typeof timeout === 'number' &&
                timeout > 0
              );
            },
          ),
      );
      break;
    case 'copilot':
      inspection = await inspectSingleHookJson(
        path.join(platformBase, 'hooks', 'comet-guard.json'),
        expectedHooks,
        collectCopilotCommandFields,
        countCopilotHookMatches,
        2,
      );
      break;
    case 'kiro':
      inspection = await inspectKiroHooks(platformBase, expectedHooks);
      break;
    case 'omp': {
      const hookPath = path.join(platformBase, ...OMP_HOOK_RELATIVE_PATH);
      try {
        if (!(await fileExists(hookPath))) {
          inspection = { present: false };
          break;
        }
        const content = await readFile(hookPath, 'utf8');
        if (content === renderOmpHookModule()) {
          inspection = { present: true };
        } else if (content.includes(OMP_HOOK_MARKER)) {
          inspection = {
            present: false,
            managedPresent: true,
            error: `managed Oh My Pi Hook is outdated at ${hookPath}`,
          };
        } else {
          inspection = { present: false };
        }
      } catch (error) {
        inspection = {
          present: false,
          error: `Unable to inspect Oh My Pi Hook at ${hookPath}: ${(error as Error).message}`,
        };
      }
      break;
    }
  }

  if (!inspection.present) return inspection;
  for (const scriptRelPath of scriptRelPaths) {
    const scriptPath = path.join(baseDir, skillsDir, 'skills', ...scriptRelPath.split('/'));
    try {
      if (!(await fileExists(scriptPath))) {
        return {
          ...inspection,
          present: false,
          managedPresent: true,
          error: `managed Hook script missing at ${scriptPath}`,
        };
      }
    } catch (error) {
      return {
        ...inspection,
        present: false,
        managedPresent: true,
        error: `Unable to inspect managed Hook script at ${scriptPath}: ${(error as Error).message}`,
      };
    }
  }
  return inspection;
}
