import path from 'path';
import { lstat, writeFile } from 'fs/promises';

import {
  fileExists,
  readDir,
  removeFile,
  removeDir,
  isDirEmpty,
} from '../../platform/fs/file-system.js';
import {
  getPlatformConfigDir,
  getPlatformSkillsDir,
  getPlatformSkillsDirs,
  type Platform,
} from '../../platform/install/platforms.js';
import type { InstallScope } from '../../platform/install/types.js';
import {
  readManifest,
  getManagedSkillPaths,
  computeRuleDestPath,
  isManagedHookCommand,
  removeManagedHooksFromJsonFile,
} from './platform-install.js';
import { removeCometProjectInstructions } from './project-instructions.js';
import { readJsonObjectFile } from './json-object.js';

interface RemovalResult {
  removed: number;
  failed: number;
}

const OPENCODE_STYLE_PLATFORM_IDS = new Set(['opencode', 'mimocode']);
const LEGACY_RULE_PATHS = [
  'comet/rules/comet-phase-guard.md',
  'comet-native/rules/comet-native-phase-guard.md',
] as const;
const LEGACY_HOOK_SCRIPT_PATHS = [
  'comet/scripts/comet-hook-guard.mjs',
  'comet-native/scripts/comet-native-hook-guard.mjs',
] as const;

async function removeManagedSkillsFromDirs(
  baseDir: string,
  skillsDirs: string[],
  managedSkills: string[],
): Promise<RemovalResult> {
  let removed = 0;
  let failed = 0;
  const parentDirs = new Set<string>();
  for (const skillsDir of skillsDirs) {
    const platformRoot = path.join(baseDir, skillsDir);
    const skillsRoot = path.join(baseDir, skillsDir, 'skills');
    let sharedBoundary = false;
    for (const boundary of [platformRoot, skillsRoot]) {
      try {
        if ((await lstat(boundary)).isSymbolicLink()) {
          failed++;
          sharedBoundary = true;
          break;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          failed++;
          sharedBoundary = true;
          break;
        }
      }
    }
    if (sharedBoundary) continue;

    for (const skillRelPath of managedSkills) {
      try {
        const parts = skillRelPath.split('/');
        let current = baseDir;
        let linkedAncestor = false;
        const ancestorParts = [
          ...skillsDir.split(/[\\/]/u).filter(Boolean),
          'skills',
          ...parts.slice(0, -1),
        ];
        for (const part of ancestorParts) {
          current = path.join(current, part);
          if ((await lstat(current)).isSymbolicLink()) {
            if (await removeFile(current)) removed++;
            linkedAncestor = true;
            break;
          }
        }
        if (linkedAncestor) continue;

        if (await removeFile(path.join(skillsRoot, ...parts))) removed++;
        current = skillsRoot;
        for (const part of parts.slice(0, -1)) {
          current = path.join(current, part);
          parentDirs.add(current);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed++;
      }
    }
  }

  for (const dir of [...parentDirs].sort(
    (left, right) => right.split(path.sep).length - left.split(path.sep).length,
  )) {
    try {
      if (await isDirEmpty(dir)) await removeDir(dir);
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}

export async function removeLegacyCometSkillsForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  const canonicalDir = getPlatformSkillsDir(platform, scope);
  const legacyDirs = getPlatformSkillsDirs(platform, scope).filter((dir) => dir !== canonicalDir);
  if (legacyDirs.length === 0) return { removed: 0, failed: 0 };

  const managedSkills = getManagedSkillPaths(await readManifest());
  return removeManagedSkillsFromDirs(baseDir, legacyDirs, managedSkills);
}

async function removeCometSkillsForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  const manifest = await readManifest();
  const managedSkills = getManagedSkillPaths(manifest);
  const skillsDir = getPlatformSkillsDir(platform, scope);
  const uniqueSkillsDirs = [
    ...new Set([
      ...getPlatformSkillsDirs(platform, scope),
      ...(scope === 'global' && platform.id === 'pi' ? [platform.skillsDir] : []),
    ]),
  ];
  const skillsRemoval = await removeManagedSkillsFromDirs(baseDir, uniqueSkillsDirs, managedSkills);
  let removed = skillsRemoval.removed;
  let failed = skillsRemoval.failed;

  if (OPENCODE_STYLE_PLATFORM_IDS.has(platform.id)) {
    const commandsDir = path.join(baseDir, skillsDir, 'commands');
    for (const skillRelPath of manifest.skills) {
      const parts = skillRelPath.split('/');
      if (parts.length !== 2 || parts[1] !== 'SKILL.md') continue;

      const skillName = parts[0];
      const commandFile = path.join(commandsDir, `${skillName}.md`);
      try {
        const result = await removeFile(commandFile);
        if (result) {
          removed++;
        }
      } catch {
        failed++;
      }
    }
  }

  if (platform.id === 'pi') {
    const extensionsDir = path.join(baseDir, skillsDir, 'extensions');
    try {
      if (await removeFile(path.join(extensionsDir, 'comet-commands.ts'))) {
        removed++;
      }
    } catch {
      failed++;
    }
    try {
      if (await isDirEmpty(extensionsDir)) {
        await removeDir(extensionsDir);
      }
    } catch {
      failed++;
    }
  }

  return { removed, failed };
}

async function removeCometRulesForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  if (!platform.rulesDir || !platform.rulesFormat) {
    return { removed: 0, failed: 0 };
  }

  const manifest = await readManifest();
  const rulePaths = [
    ...(manifest.rules ?? []),
    ...(manifest.nativeRules ?? []),
    ...LEGACY_RULE_PATHS,
  ];
  if (!rulePaths || rulePaths.length === 0) {
    return { removed: 0, failed: 0 };
  }

  const skillsDir = getPlatformSkillsDir(platform, scope);
  const rulesBase =
    platform.rulesBaseDir !== undefined
      ? platform.rulesBaseDir === ''
        ? baseDir
        : path.join(baseDir, platform.rulesBaseDir)
      : path.join(baseDir, skillsDir);

  let removed = 0;
  let failed = 0;

  for (const ruleRelPath of rulePaths) {
    const ruleFileName = path.basename(ruleRelPath);
    const rulesDestDir = path.join(rulesBase, platform.rulesDir);
    const dest = computeRuleDestPath(rulesDestDir, ruleFileName, platform.rulesFormat);

    try {
      const result = await removeFile(dest);
      if (result) {
        removed++;
      }
    } catch {
      failed++;
    }
  }

  const rulesDestDir = path.join(rulesBase, platform.rulesDir);
  try {
    if (await isDirEmpty(rulesDestDir)) {
      await removeDir(rulesDestDir);
    }
  } catch {
    failed++;
  }

  return { removed, failed };
}

async function removeCometHooksForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  if (!platform.supportsHooks || !platform.hookFormat) {
    return { removed: 0, failed: 0 };
  }

  const manifest = await readManifest();
  const hooksConfig = { ...(manifest.hooks ?? {}), ...(manifest.nativeHooks ?? {}) };
  if (!hooksConfig || Object.keys(hooksConfig).length === 0) {
    return { removed: 0, failed: 0 };
  }

  const hookFormat = platform.hookFormat;
  const platformBase = path.join(baseDir, getPlatformConfigDir(platform, scope));
  const scriptRelPaths = [...new Set([...Object.keys(hooksConfig), ...LEGACY_HOOK_SCRIPT_PATHS])];

  try {
    switch (hookFormat) {
      case 'claude-code': {
        const canonicalFile = platform.hookConfigFile ?? 'settings.local.json';
        const files = [canonicalFile, ...(platform.legacyHookConfigFiles ?? [])];
        let removed = 0;
        let failed = 0;
        for (const file of new Set(files)) {
          let result: RemovalResult;
          try {
            result = await removeManagedHooksFromJsonFile(
              path.join(platformBase, file),
              scriptRelPaths,
            );
          } catch {
            if (file === canonicalFile) failed++;
            continue;
          }
          removed += result.removed;
          if (file === canonicalFile) failed += result.failed;
        }
        return { removed, failed };
      }
      case 'qwen':
      case 'qoder':
      case 'codebuddy':
        return await removeQwenStyleHooks(platformBase, scriptRelPaths);
      case 'gemini':
        return await removeGeminiHooks(platformBase, scriptRelPaths);
      case 'windsurf':
        return await removeWindsurfHooks(platformBase, scriptRelPaths);
      case 'copilot':
        return await removeCopilotHooks(platformBase);
      case 'kiro':
        return await removeKiroHooks(platformBase, scriptRelPaths);
      default:
        return { removed: 0, failed: 0 };
    }
  } catch {
    return { removed: 0, failed: 1 };
  }
}

async function removeQwenStyleHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const settingsPath = path.join(platformBase, 'settings.json');
  if (!(await fileExists(settingsPath))) return { removed: 0, failed: 0 };
  let removed = 0;
  const readResult = await readJsonObjectFile(settingsPath);
  if (readResult.status === 'missing') return { removed: 0, failed: 0 };
  if (readResult.status === 'error') return { removed: 0, failed: 1 };
  const settings = readResult.value;

  const existingHooks = settings.hooks as Record<string, unknown> | undefined;
  if (!existingHooks) {
    return { removed: 0, failed: 0 };
  }

  const existingPreToolUse = existingHooks.PreToolUse as Array<Record<string, unknown>> | undefined;
  if (!existingPreToolUse || !Array.isArray(existingPreToolUse)) {
    return { removed: 0, failed: 0 };
  }

  const filtered = existingPreToolUse.flatMap((group) => {
    if (!Array.isArray(group.hooks)) return [group];

    const hooksBefore = (group.hooks as Array<Record<string, unknown>>).length;
    const hooks = (group.hooks as Array<Record<string, unknown>>).filter(
      (hook) => !isManagedHookCommand(hook.command, scriptRelPaths),
    );
    removed += hooksBefore - hooks.length;

    const hasUnknownMetadata = Object.keys(group).some(
      (key) => key !== 'matcher' && key !== 'hooks',
    );
    if (hooks.length === 0) return hasUnknownMetadata ? [{ ...group, hooks: [] }] : [];
    return [{ ...group, hooks }];
  });

  if (filtered.length === 0) {
    delete existingHooks.PreToolUse;
  } else {
    existingHooks.PreToolUse = filtered;
  }

  if (Object.keys(existingHooks).length === 0) {
    delete settings.hooks;
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { removed, failed: 0 };
}

async function removeGeminiHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const settingsPath = path.join(platformBase, 'settings.json');
  if (!(await fileExists(settingsPath))) return { removed: 0, failed: 0 };
  let removed = 0;
  const readResult = await readJsonObjectFile(settingsPath);
  if (readResult.status === 'missing') return { removed: 0, failed: 0 };
  if (readResult.status === 'error') return { removed: 0, failed: 1 };
  const settings = readResult.value;

  const existingHooks = settings.hooks as Record<string, unknown> | undefined;
  if (!existingHooks) {
    return { removed: 0, failed: 0 };
  }

  const existingBeforeTool = existingHooks.BeforeTool as Array<Record<string, unknown>> | undefined;
  if (!existingBeforeTool || !Array.isArray(existingBeforeTool)) {
    return { removed: 0, failed: 0 };
  }

  const filtered = existingBeforeTool.flatMap((group) => {
    if (!Array.isArray(group.hooks)) return [group];

    const hooksBefore = (group.hooks as Array<Record<string, unknown>>).length;
    const hooks = (group.hooks as Array<Record<string, unknown>>).filter(
      (hook) => !isManagedHookCommand(hook.command, scriptRelPaths),
    );
    removed += hooksBefore - hooks.length;

    const hasUnknownMetadata = Object.keys(group).some(
      (key) => key !== 'matcher' && key !== 'hooks',
    );
    if (hooks.length === 0) return hasUnknownMetadata ? [{ ...group, hooks: [] }] : [];
    return [{ ...group, hooks }];
  });

  if (filtered.length === 0) {
    delete existingHooks.BeforeTool;
  } else {
    existingHooks.BeforeTool = filtered;
  }

  if (Object.keys(existingHooks).length === 0) {
    delete settings.hooks;
  }

  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { removed, failed: 0 };
}

async function removeWindsurfHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const hooksPath = path.join(platformBase, 'hooks.json');
  if (!(await fileExists(hooksPath))) return { removed: 0, failed: 0 };
  let removed = 0;
  const readResult = await readJsonObjectFile(hooksPath);
  if (readResult.status === 'missing') return { removed: 0, failed: 0 };
  if (readResult.status === 'error') return { removed: 0, failed: 1 };
  const hooksFile = readResult.value;

  const existingHooks = hooksFile.hooks as Record<string, unknown> | undefined;
  if (!existingHooks) {
    return { removed: 0, failed: 0 };
  }

  const existingPreWrite = existingHooks.pre_write_code as
    | Array<Record<string, unknown>>
    | undefined;
  if (!existingPreWrite || !Array.isArray(existingPreWrite)) {
    return { removed: 0, failed: 0 };
  }

  const filtered = existingPreWrite.filter((entry) => {
    if (isManagedHookCommand(entry.command, scriptRelPaths)) {
      removed++;
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    delete existingHooks.pre_write_code;
  } else {
    existingHooks.pre_write_code = filtered;
  }

  if (Object.keys(existingHooks).length === 0) {
    delete hooksFile.hooks;
  }

  await writeFile(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n', 'utf-8');
  return { removed, failed: 0 };
}

async function removeCopilotHooks(platformBase: string): Promise<RemovalResult> {
  const hookFilePath = path.join(platformBase, 'hooks', 'comet-guard.json');
  let removed = 0;
  let failed = 0;
  try {
    if (await removeFile(hookFilePath)) removed++;
  } catch {
    failed++;
  }

  const hooksDir = path.join(platformBase, 'hooks');
  try {
    if (await isDirEmpty(hooksDir)) {
      await removeDir(hooksDir);
    }
  } catch {
    failed++;
  }

  return { removed, failed };
}

async function removeKiroHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const hooksDir = path.join(platformBase, 'hooks');
  try {
    if (!(await lstat(hooksDir)).isDirectory()) {
      return { removed: 0, failed: 1 };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { removed: 0, failed: 0 };
    }
    return { removed: 0, failed: 1 };
  }

  let removed = 0;
  let failed = 0;
  const entries = await readDir(hooksDir);

  for (const entry of entries) {
    if (!entry.endsWith('.kiro.hook')) continue;
    const baseName = entry.replace('.kiro.hook', '');
    const isCometHook = scriptRelPaths.some((scriptPath) => {
      const scriptBase = path.basename(scriptPath).replace(/\.mjs$/u, '');
      return scriptBase === baseName;
    });

    if (isCometHook) {
      const hookPath = path.join(hooksDir, entry);
      try {
        if (await removeFile(hookPath)) {
          removed++;
        }
      } catch {
        failed++;
      }
    }
  }

  try {
    if (await isDirEmpty(hooksDir)) {
      await removeDir(hooksDir);
    }
  } catch {
    failed++;
  }

  return { removed, failed };
}

async function removeWorkingDirs(projectPath: string): Promise<RemovalResult> {
  let removed = 0;
  let failed = 0;

  const cometDir = path.join(projectPath, '.comet');
  try {
    if (await removeDir(cometDir)) {
      removed++;
    }
  } catch {
    failed++;
  }

  const specsDir = path.join(projectPath, 'docs', 'superpowers', 'specs');
  try {
    if (await isDirEmpty(specsDir)) {
      await removeDir(specsDir);
    }
  } catch {
    failed++;
  }

  const plansDir = path.join(projectPath, 'docs', 'superpowers', 'plans');
  try {
    if (await isDirEmpty(plansDir)) {
      await removeDir(plansDir);
    }
  } catch {
    failed++;
  }

  const superpowersDir = path.join(projectPath, 'docs', 'superpowers');
  try {
    if (await isDirEmpty(superpowersDir)) {
      await removeDir(superpowersDir);
    }
  } catch {
    failed++;
  }

  const docsDir = path.join(projectPath, 'docs');
  try {
    if (await isDirEmpty(docsDir)) {
      await removeDir(docsDir);
    }
  } catch {
    failed++;
  }

  return { removed, failed };
}

export {
  removeCometSkillsForPlatform,
  removeCometRulesForPlatform,
  removeCometHooksForPlatform,
  removeWorkingDirs,
  removeCometProjectInstructions,
};
