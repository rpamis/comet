import path from 'path';
import { promises as fs } from 'fs';
import type {
  BundleCapability,
  BundleCompilerIr,
  ExecutableDisclosure,
  PlatformInstallFile,
} from './types.js';
import { copyFile, ensureDir, fileExists, writeFile } from '../../platform/fs/file-system.js';
import { computeRuleDestPath, formatRuleContent } from '../skill/platform-install.js';
import {
  getPlatformConfigDir,
  getPlatformSkillsDir,
  PLATFORMS,
  type Platform,
} from '../../platform/install/platforms.js';

export interface PlatformBundleLayout {
  platform: string;
  scope: 'project' | 'global';
  baseDir: string;
  configRoot: string;
  skillsRoot: string;
  rulesRoot: string | null;
  hooksSupported: boolean;
  scriptsRoot: string | null;
  agentsRoot: string | null;
}

export interface BundlePlatformTarget {
  id: string;
  name: string;
  platform: Platform;
  layout: PlatformBundleLayout;
  capabilities: ReadonlySet<BundleCapability>;
}

function rulesRoot(
  platform: Platform,
  baseDir: string,
  scope: 'project' | 'global',
): string | null {
  if (!platform.rulesDir || !platform.rulesFormat) return null;
  const rulesBase =
    platform.rulesBaseDir !== undefined
      ? platform.rulesBaseDir === ''
        ? baseDir
        : path.join(baseDir, platform.rulesBaseDir)
      : path.join(baseDir, getPlatformSkillsDir(platform, scope));
  return path.join(rulesBase, platform.rulesDir);
}

export function listBundlePlatformTargets(options: {
  projectRoot: string;
  homeDir: string;
  scope: 'project' | 'global';
}): BundlePlatformTarget[] {
  const baseDir = options.scope === 'global' ? options.homeDir : options.projectRoot;
  return PLATFORMS.map((platform) => {
    const platformRoot = path.join(baseDir, getPlatformSkillsDir(platform, options.scope));
    const capabilities = new Set<BundleCapability>(['skills', 'scripts', 'references', 'assets']);
    if (platform.rulesDir && platform.rulesFormat) capabilities.add('rules');
    if (platform.supportsHooks && platform.hookFormat) capabilities.add('hooks');
    if (platform.id === 'claude') capabilities.add('agents');
    return {
      id: platform.id,
      name: platform.name,
      platform,
      layout: {
        platform: platform.id,
        scope: options.scope,
        baseDir,
        configRoot: path.join(baseDir, getPlatformConfigDir(platform, options.scope)),
        skillsRoot: path.join(platformRoot, 'skills'),
        rulesRoot: rulesRoot(platform, baseDir, options.scope),
        hooksSupported: capabilities.has('hooks'),
        scriptsRoot: path.join(platformRoot, 'skills', '.comet-bundles'),
        agentsRoot: platform.id === 'claude' ? path.join(platformRoot, 'agents') : null,
      },
      capabilities,
    };
  });
}

export function planBundleRule(
  target: BundlePlatformTarget,
  rule: BundleCompilerIr['rules'][number],
): PlatformInstallFile[] {
  const format = target.platform.rulesFormat;
  if (!target.layout.rulesRoot || !format) return [];
  if (rule.mode === 'matched' && format === 'md') return [];
  return [
    {
      source: rule.source,
      destination: computeRuleDestPath(target.layout.rulesRoot, path.basename(rule.path), format),
      kind: 'rule',
      operation: {
        type: 'rule',
        format,
        mode: rule.mode,
        ...(rule.match ? { match: rule.match } : {}),
      },
    },
  ];
}

function hookDestination(target: BundlePlatformTarget, hookId: string): string | null {
  const platformRoot = target.layout.configRoot;
  if (target.platform.hookConfigFile) {
    return path.join(platformRoot, target.platform.hookConfigFile);
  }
  switch (target.platform.hookFormat) {
    case 'claude-code':
      return path.join(platformRoot, 'settings.local.json');
    case 'qwen':
    case 'qoder':
    case 'codebuddy':
    case 'gemini':
      return path.join(platformRoot, 'settings.json');
    case 'windsurf':
      return path.join(platformRoot, 'hooks.json');
    case 'copilot':
      return path.join(platformRoot, 'hooks', `${hookId}.json`);
    case 'kiro':
      return path.join(platformRoot, 'hooks', `${hookId}.kiro.hook`);
    default:
      return null;
  }
}

function scriptDestination(
  target: BundlePlatformTarget,
  bundleName: string,
  script: BundleCompilerIr['scripts'][number],
): string {
  return path.join(target.layout.scriptsRoot!, bundleName, ...script.path.split('/'));
}

function scriptCommand(script: BundleCompilerIr['scripts'][number], destination: string): string {
  const executable =
    script.runtime === 'node' ? 'node' : script.runtime === 'python' ? 'python' : 'bash';
  return `${executable} ${quoteCommandPath(destination)}`;
}

function quoteCommandPath(destination: string): string {
  const normalized = destination.replaceAll('\\', '/');
  if (/^[A-Za-z0-9_./:-]+$/u.test(normalized)) return normalized;
  return `"${normalized.replaceAll('"', '\\"')}"`;
}

export function planBundleHook(
  target: BundlePlatformTarget,
  hook: BundleCompilerIr['hooks'][number],
  scripts: BundleCompilerIr['scripts'],
  bundleName = 'bundle',
  installedScriptDestination?: string,
  commandScriptPath?: string,
): {
  files: PlatformInstallFile[];
  disclosure: ExecutableDisclosure;
} | null {
  const format = target.platform.hookFormat;
  const destination = hookDestination(target, hook.id);
  if (!target.layout.hooksSupported || !format || !destination) return null;
  if (!['before_tool', 'before_write'].includes(hook.event)) return null;
  const script = scripts.find((item) => item.id === hook.script);
  if (!script || !target.layout.scriptsRoot) return null;
  const installedScript =
    installedScriptDestination ?? scriptDestination(target, bundleName, script);
  const command = scriptCommand(script, commandScriptPath ?? installedScript);
  return {
    files: [
      {
        source: hook.source,
        destination,
        kind: 'hook',
        operation: {
          type: 'hook',
          format,
          event: hook.event,
          ...(hook.matcher ? { matcher: hook.matcher } : {}),
          command,
          failure: hook.failure,
          requiresConfirmation: hook.requiresConfirmation,
        },
      },
    ],
    disclosure: {
      id: hook.id,
      command,
      sideEffect: script.sideEffect,
      destination,
    },
  };
}

export function planBundleOverride(
  target: BundlePlatformTarget,
  override: BundleCompilerIr['overrides'][number],
  kind: PlatformInstallFile['kind'],
): PlatformInstallFile {
  const prefix = `overrides/${target.id}/`;
  const relative = override.path.startsWith(prefix)
    ? override.path.slice(prefix.length)
    : path.basename(override.path);
  return {
    source: override.source,
    destination: path.join(path.dirname(target.layout.skillsRoot), ...relative.split('/')),
    kind,
  };
}

function hookMatcher(file: PlatformInstallFile): string {
  if (file.operation?.type !== 'hook') return '*';
  if (file.operation.matcher) return file.operation.matcher;
  return file.operation.event === 'before_write' ? 'Write|Edit' : '*';
}

function readJsonObject(value: string, file: string): Record<string, unknown> {
  if (value.trim() === '') return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid JSON object at ${file}`);
  }
  return parsed as Record<string, unknown>;
}

async function readExistingJson(file: string): Promise<Record<string, unknown>> {
  if (!(await fileExists(file))) return {};
  return readJsonObject(await fs.readFile(file, 'utf8'), file);
}

function asHookGroups(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

function mergeCommandHookGroup(
  existingGroups: Array<Record<string, unknown>>,
  matcher: string,
  hook: Record<string, unknown>,
  command: string,
): Array<Record<string, unknown>> {
  const groups = existingGroups
    .map((group) => {
      if (!Array.isArray(group.hooks)) return group;
      return {
        ...group,
        hooks: group.hooks.filter(
          (entry) =>
            !entry ||
            typeof entry !== 'object' ||
            (entry as Record<string, unknown>).command !== command,
        ),
      };
    })
    .filter((group) => !Array.isArray(group.hooks) || group.hooks.length > 0);
  const group = groups.find(
    (candidate) => candidate.matcher === matcher && Array.isArray(candidate.hooks),
  );
  if (group) {
    group.hooks = [...(group.hooks as unknown[]), hook];
  } else {
    groups.push({ matcher, hooks: [hook] });
  }
  return groups;
}

async function applyHookInstallFile(file: PlatformInstallFile): Promise<void> {
  const operation = file.operation;
  if (operation?.type !== 'hook') {
    throw new Error(`Install file ${file.destination} is not a hook operation`);
  }

  const matcher = hookMatcher(file);
  const settings = await readExistingJson(file.destination);
  const hooks = (settings.hooks as Record<string, unknown> | undefined) ?? {};
  const commandHook = { type: 'command', command: operation.command };

  switch (operation.format) {
    case 'claude-code':
    case 'qwen':
    case 'qoder':
    case 'codebuddy': {
      hooks.PreToolUse = mergeCommandHookGroup(
        asHookGroups(hooks.PreToolUse),
        matcher,
        commandHook,
        operation.command,
      );
      settings.hooks = hooks;
      await writeFile(file.destination, JSON.stringify(settings, null, 2) + '\n');
      return;
    }
    case 'gemini': {
      const geminiMatcher = matcher === 'Write|Edit' ? 'write_file|edit_file' : matcher;
      hooks.BeforeTool = mergeCommandHookGroup(
        asHookGroups(hooks.BeforeTool),
        geminiMatcher,
        { ...commandHook, name: file.kind },
        operation.command,
      );
      settings.hooks = hooks;
      await writeFile(file.destination, JSON.stringify(settings, null, 2) + '\n');
      return;
    }
    case 'windsurf': {
      const existing = asHookGroups(hooks.pre_write_code).filter(
        (entry) => entry.command !== operation.command,
      );
      hooks.pre_write_code = [...existing, { command: operation.command, show_output: true }];
      settings.hooks = hooks;
      await writeFile(file.destination, JSON.stringify(settings, null, 2) + '\n');
      return;
    }
    case 'copilot': {
      const hookFile = await readExistingJson(file.destination);
      const existingHooks = (hookFile.hooks as Record<string, unknown> | undefined) ?? {};
      const preToolUse = Array.isArray(existingHooks.preToolUse)
        ? existingHooks.preToolUse.filter((entry) => {
            if (!entry || typeof entry !== 'object') return true;
            const value = entry as Record<string, unknown>;
            return value.bash !== operation.command && value.powershell !== operation.command;
          })
        : [];
      hookFile.version = hookFile.version ?? 1;
      hookFile.hooks = {
        ...existingHooks,
        preToolUse: [...preToolUse, { bash: operation.command, powershell: operation.command }],
      };
      await writeFile(file.destination, JSON.stringify(hookFile, null, 2) + '\n');
      return;
    }
    case 'kiro': {
      const hookFile = await readExistingJson(file.destination);
      const toolName = matcher === 'Write|Edit' ? 'write' : matcher;
      await writeFile(
        file.destination,
        JSON.stringify(
          {
            ...hookFile,
            enabled: true,
            name: hookFile.name ?? path.basename(file.destination),
            description: hookFile.description ?? path.basename(file.destination),
            version: hookFile.version ?? '1',
            when: { type: 'preToolUse', toolName },
            then: { type: 'runCommand', command: operation.command },
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }
  }
}

async function applyInstallFile(
  file: PlatformInstallFile,
  overwrite: boolean,
): Promise<'written' | 'skipped'> {
  if (file.operation?.type === 'hook') {
    await applyHookInstallFile(file);
    return 'written';
  }
  if (!overwrite && (await fileExists(file.destination))) {
    return 'skipped';
  }
  await ensureDir(path.dirname(file.destination));
  if (file.operation?.type === 'rule') {
    const content = await fs.readFile(file.source, 'utf8');
    await writeFile(
      file.destination,
      formatRuleContent(content, path.basename(file.source), file.operation.format),
    );
    return 'written';
  }
  await copyFile(file.source, file.destination);
  return 'written';
}

export async function applyPlatformInstallPlan(options: {
  target: BundlePlatformTarget;
  files: PlatformInstallFile[];
  overwrite: boolean;
}): Promise<{ written: string[]; skipped: string[] }> {
  const written: string[] = [];
  const skipped: string[] = [];
  for (const file of options.files) {
    const result = await applyInstallFile(file, options.overwrite);
    if (result === 'written') written.push(file.destination);
    else skipped.push(file.destination);
  }
  return { written, skipped };
}
