import path from 'path';
import { readFile, writeFile } from 'fs/promises';

import { fileExists, readDir, removeFile, removeDir, isDirEmpty } from '../utils/file-system.js';
import { getPlatformSkillsDir, type Platform } from './platforms.js';
import { readManifest, computeRuleDestPath, isManagedHookCommand } from './skills.js';
import type { InstallScope } from './types.js';

interface RemovalResult {
  removed: number;
  failed: number;
}

/**
 * Remove Comet skill files for a specific platform.
 * Reads the manifest to determine which skill paths to remove.
 */
async function removeCometSkillsForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  const manifest = await readManifest();
  const skillsDir = getPlatformSkillsDir(platform, scope);
  const skillsDirs = [skillsDir];
  if (scope === 'global' && platform.id === 'pi') {
    skillsDirs.push(platform.skillsDir);
  }
  const uniqueSkillsDirs = [...new Set(skillsDirs)];
  let removed = 0;
  const failed = 0;

  for (const targetSkillsDir of uniqueSkillsDirs) {
    for (const skillRelPath of manifest.skills) {
      const dest = path.join(baseDir, targetSkillsDir, 'skills', skillRelPath);
      const result = await removeFile(dest);
      if (result) {
        removed++;
      }
    }
  }

  // OpenCode: also remove generated command files
  if (platform.id === 'opencode') {
    const commandsDir = path.join(baseDir, skillsDir, 'commands');
    for (const skillRelPath of manifest.skills) {
      const parts = skillRelPath.split('/');
      if (parts.length !== 2 || parts[1] !== 'SKILL.md') continue;

      const skillName = parts[0];
      const commandFile = path.join(commandsDir, `${skillName}.md`);
      const result = await removeFile(commandFile);
      if (result) {
        removed++;
      }
    }
  }

  if (platform.id === 'pi') {
    const extensionsDir = path.join(baseDir, skillsDir, 'extensions');
    if (await removeFile(path.join(extensionsDir, 'comet-commands.ts'))) {
      removed++;
    }
    if (await isDirEmpty(extensionsDir)) {
      await removeDir(extensionsDir);
    }
  }

  // Clean up empty subdirectories and then empty comet skill directories
  // Collect all unique parent directories of removed files (bottom-up cleanup)
  const parentDirs = new Set<string>();
  for (const targetSkillsDir of uniqueSkillsDirs) {
    for (const skillRelPath of manifest.skills) {
      const parts = skillRelPath.split('/');
      if (parts[0].startsWith('comet')) {
        // Add all intermediate directories for nested paths
        let current = path.join(baseDir, targetSkillsDir, 'skills', parts[0]);
        parentDirs.add(current);
        for (let i = 1; i < parts.length - 1; i++) {
          current = path.join(current, parts[i]);
          parentDirs.add(current);
        }
      }
    }
  }

  // Sort by depth (deepest first) so we clean bottom-up
  const sortedDirs = [...parentDirs].sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length,
  );
  for (const dir of sortedDirs) {
    if (await isDirEmpty(dir)) {
      await removeDir(dir);
    }
  }

  return { removed, failed };
}

/**
 * Remove Comet rule files for a specific platform.
 * Reuses computeRuleDestPath for consistent path computation.
 */
async function removeCometRulesForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  if (!platform.rulesDir || !platform.rulesFormat) {
    return { removed: 0, failed: 0 };
  }

  const manifest = await readManifest();
  const rulePaths = manifest.rules;
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
  const failed = 0;

  for (const ruleRelPath of rulePaths) {
    const ruleFileName = path.basename(ruleRelPath);
    const rulesDestDir = path.join(rulesBase, platform.rulesDir);
    const dest = computeRuleDestPath(rulesDestDir, ruleFileName, platform.rulesFormat);

    const result = await removeFile(dest);
    if (result) {
      removed++;
    }
  }

  // Clean up empty rules directory
  const rulesDestDir = path.join(rulesBase, platform.rulesDir);
  if (await isDirEmpty(rulesDestDir)) {
    await removeDir(rulesDestDir);
  }

  return { removed, failed };
}

/**
 * Remove Comet hooks for platforms that support them.
 * Preserves non-Comet hooks in configuration files.
 */
async function removeCometHooksForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<RemovalResult> {
  if (!platform.supportsHooks || !platform.hookFormat) {
    return { removed: 0, failed: 0 };
  }

  const manifest = await readManifest();
  const hooksConfig = manifest.hooks;
  if (!hooksConfig || Object.keys(hooksConfig).length === 0) {
    return { removed: 0, failed: 0 };
  }

  const hookFormat = platform.hookFormat;
  const skillsDir = getPlatformSkillsDir(platform, scope);
  const platformBase = path.join(baseDir, skillsDir);
  const scriptRelPaths = Object.keys(hooksConfig);

  try {
    switch (hookFormat) {
      case 'claude-code':
        return removeClaudeCodeHooks(platformBase, scriptRelPaths);
      case 'qwen':
      case 'qoder':
        return removeQwenStyleHooks(platformBase, scriptRelPaths);
      case 'gemini':
        return removeGeminiHooks(platformBase, scriptRelPaths);
      case 'windsurf':
        return removeWindsurfHooks(platformBase, scriptRelPaths);
      case 'copilot':
        return removeCopilotHooks(platformBase, scriptRelPaths);
      case 'kiro':
        return removeKiroHooks(platformBase, scriptRelPaths);
      default:
        return { removed: 0, failed: 0 };
    }
  } catch {
    return { removed: 0, failed: 1 };
  }
}

/**
 * Claude Code, Codex, Amazon Q: settings.local.json with PreToolUse hooks.
 */
async function removeClaudeCodeHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const settingsPath = path.join(platformBase, 'settings.local.json');
  if (!(await fileExists(settingsPath))) {
    return { removed: 0, failed: 0 };
  }

  let removed = 0;
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return { removed: 0, failed: 0 };
  }

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

    if (hooks.length === 0) return [];
    return [{ ...group, hooks }];
  });

  if (filtered.length === 0) {
    delete existingHooks.PreToolUse;
  } else {
    existingHooks.PreToolUse = filtered;
  }

  // Clean up empty hooks section
  if (Object.keys(existingHooks).length === 0) {
    delete settings.hooks;
  }

  const content = JSON.stringify(settings, null, 2) + '\n';
  await writeFile(settingsPath, content, 'utf-8');

  return { removed, failed: 0 };
}

/**
 * Qwen / Qoder: settings.json with PreToolUse hooks.
 */
async function removeQwenStyleHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const settingsPath = path.join(platformBase, 'settings.json');
  if (!(await fileExists(settingsPath))) {
    return { removed: 0, failed: 0 };
  }

  let removed = 0;
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return { removed: 0, failed: 0 };
  }

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

    if (hooks.length === 0) return [];
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

  const content = JSON.stringify(settings, null, 2) + '\n';
  await writeFile(settingsPath, content, 'utf-8');

  return { removed, failed: 0 };
}

/**
 * Gemini CLI: settings.json with BeforeTool hooks.
 */
async function removeGeminiHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const settingsPath = path.join(platformBase, 'settings.json');
  if (!(await fileExists(settingsPath))) {
    return { removed: 0, failed: 0 };
  }

  let removed = 0;
  let settings: Record<string, unknown>;
  try {
    settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return { removed: 0, failed: 0 };
  }

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

    if (hooks.length === 0) return [];
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

  const content = JSON.stringify(settings, null, 2) + '\n';
  await writeFile(settingsPath, content, 'utf-8');

  return { removed, failed: 0 };
}

/**
 * Windsurf: hooks.json with pre_write_code hooks.
 */
async function removeWindsurfHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const hooksPath = path.join(platformBase, 'hooks.json');
  if (!(await fileExists(hooksPath))) {
    return { removed: 0, failed: 0 };
  }

  let removed = 0;
  let hooksFile: Record<string, unknown>;
  try {
    hooksFile = JSON.parse(await readFile(hooksPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return { removed: 0, failed: 0 };
  }

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

  const content = JSON.stringify(hooksFile, null, 2) + '\n';
  await writeFile(hooksPath, content, 'utf-8');

  return { removed, failed: 0 };
}

/**
 * GitHub Copilot: hooks/comet-guard.json file (delete the entire file).
 */
async function removeCopilotHooks(
  platformBase: string,
  _scriptRelPaths: string[],
): Promise<RemovalResult> {
  const hookFilePath = path.join(platformBase, 'hooks', 'comet-guard.json');
  const removed = (await removeFile(hookFilePath)) ? 1 : 0;

  // Clean up empty hooks directory
  const hooksDir = path.join(platformBase, 'hooks');
  if (await isDirEmpty(hooksDir)) {
    await removeDir(hooksDir);
  }

  return { removed, failed: 0 };
}

/**
 * Kiro: hooks/*.kiro.hook files matching comet patterns.
 */
async function removeKiroHooks(
  platformBase: string,
  scriptRelPaths: string[],
): Promise<RemovalResult> {
  const hooksDir = path.join(platformBase, 'hooks');
  if (!(await fileExists(hooksDir))) {
    return { removed: 0, failed: 0 };
  }

  let removed = 0;
  const entries = await readDir(hooksDir);

  for (const entry of entries) {
    if (!entry.endsWith('.kiro.hook')) continue;
    // Match files that correspond to comet scripts
    const baseName = entry.replace('.kiro.hook', '');
    const isCometHook = scriptRelPaths.some((scriptPath) => {
      const scriptBase = path.basename(scriptPath).replace('.sh', '');
      return scriptBase === baseName;
    });

    if (isCometHook) {
      const hookPath = path.join(hooksDir, entry);
      if (await removeFile(hookPath)) {
        removed++;
      }
    }
  }

  // Clean up empty hooks directory
  if (await isDirEmpty(hooksDir)) {
    await removeDir(hooksDir);
  }

  return { removed, failed: 0 };
}

/**
 * Remove Comet working directories from a project.
 * Only applies to project scope.
 */
async function removeWorkingDirs(projectPath: string): Promise<RemovalResult> {
  let removed = 0;

  // Remove .comet/ directory
  const cometDir = path.join(projectPath, '.comet');
  if (await removeDir(cometDir)) {
    removed++;
  }

  // Remove docs/superpowers/specs/ if empty
  const specsDir = path.join(projectPath, 'docs', 'superpowers', 'specs');
  if (await isDirEmpty(specsDir)) {
    await removeDir(specsDir);
  }

  // Remove docs/superpowers/plans/ if empty
  const plansDir = path.join(projectPath, 'docs', 'superpowers', 'plans');
  if (await isDirEmpty(plansDir)) {
    await removeDir(plansDir);
  }

  // Remove docs/superpowers/ if empty
  const superpowersDir = path.join(projectPath, 'docs', 'superpowers');
  if (await isDirEmpty(superpowersDir)) {
    await removeDir(superpowersDir);
  }

  // Remove docs/ if empty
  const docsDir = path.join(projectPath, 'docs');
  if (await isDirEmpty(docsDir)) {
    await removeDir(docsDir);
  }

  return { removed, failed: 0 };
}

export {
  removeCometSkillsForPlatform,
  removeCometRulesForPlatform,
  removeCometHooksForPlatform,
  removeWorkingDirs,
};
