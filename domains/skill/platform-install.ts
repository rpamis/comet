import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, lstat, unlink, symlink, rm, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { parseDocument } from 'yaml';

import { fileExists, readJson, copyFile, ensureDir } from '../../platform/fs/file-system.js';
import { getPlatformSkillsDir, type Platform } from '../../platform/install/platforms.js';
import type { InstallScope, InstallMode } from '../../platform/install/types.js';
import { formatSupportedArtifactLanguages, resolveArtifactLanguage } from './languages.js';
import type { LanguageConfig } from './languages.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type HookConfig = {
  matcher: string;
  description: string;
};

type Manifest = {
  version: string;
  skills: string[];
  internalSkills?: string[];
  rules?: string[];
  hooks?: Record<string, HookConfig>;
  languages?: LanguageConfig[];
};

interface PlannedSkillSourceFile {
  relativePath: string;
  source: string;
}

interface PlannedSkillFile {
  source: string;
  destination: string;
}

function planSkillDirectoryCopy(
  files: readonly PlannedSkillSourceFile[],
  destinationRoot: string,
): PlannedSkillFile[] {
  return files
    .map((file) => ({
      source: file.source,
      destination: path.join(destinationRoot, ...file.relativePath.split('/')),
    }))
    .sort((left, right) =>
      left.destination < right.destination ? -1 : left.destination > right.destination ? 1 : 0,
    );
}

function getManagedSkillPaths(manifest: Manifest): string[] {
  return [...new Set([...manifest.skills, ...(manifest.internalSkills ?? [])])];
}

function getUserFacingSkillNames(manifest: Manifest): string[] {
  return getTopLevelSkillNames(manifest.skills);
}

function getManagedSkillReplacementPaths(manifest: Manifest): Set<string> {
  const allowed = new Set<string>();

  for (const skillPath of getManagedSkillPaths(manifest)) {
    const parts = skillPath.split('/').filter(Boolean);
    for (let depth = 1; depth <= parts.length; depth++) {
      allowed.add(parts.slice(0, depth).join('/'));
    }
  }

  return allowed;
}

async function collectDirectoryEntryPaths(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    const relativePath = path.relative(root, fullPath).split(path.sep).join('/');
    paths.push(relativePath);

    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      paths.push(...(await collectDirectoryEntryPaths(root, fullPath)));
    }
  }

  return paths;
}

async function assertDirectoryContainsOnlyManagedEntries(
  dirPath: string,
  managedEntries: Set<string>,
): Promise<void> {
  const entries = await collectDirectoryEntryPaths(dirPath);
  const unmanagedEntries = entries.filter((entry) => !managedEntries.has(entry));
  if (unmanagedEntries.length === 0) return;

  const preview = unmanagedEntries.slice(0, 5).join(', ');
  const suffix = unmanagedEntries.length > 5 ? `, and ${unmanagedEntries.length - 5} more` : '';
  throw new Error(
    `Refusing to replace ${dirPath} with a symlink because it contains unmanaged entries: ${preview}${suffix}. Move them aside or use copy install mode.`,
  );
}

const OPENCODE_COMMAND_HEADER = `---
description: Run the {skillName} Comet workflow
---
`;

const PI_COMMAND_EXTENSION_FILE = 'comet-commands.ts';
const OPENCODE_STYLE_PLATFORM_IDS = new Set(['opencode', 'mimocode']);

function getAssetsDir(): string {
  const directAssets = path.resolve(__dirname, '..', '..', 'assets');
  if (existsSync(path.join(directAssets, 'manifest.json'))) {
    return directAssets;
  }

  const packageRootAssets = path.resolve(__dirname, '..', '..', '..', 'assets');
  if (existsSync(path.join(packageRootAssets, 'manifest.json'))) {
    return packageRootAssets;
  }

  return directAssets;
}

/**
 * Get the central skills directory for symlink mode.
 * Project scope: <project>/.comet/skills/
 * Global scope: ~/.comet/skills/
 */
function getCentralSkillsDir(baseDir: string, _scope: InstallScope): string {
  return path.join(baseDir, '.comet', 'skills');
}

/**
 * Create a symlink from linkPath pointing to target.
 * On Windows, uses 'junction' type for directory symlinks (no admin required).
 */
async function createSymlink(
  target: string,
  linkPath: string,
  managedEntries: Set<string>,
): Promise<void> {
  await ensureDir(path.dirname(linkPath));

  // Remove existing link/directory if present
  let stat: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    stat = await lstat(linkPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  if (stat?.isSymbolicLink()) {
    await unlink(linkPath);
  } else if (stat?.isDirectory()) {
    // For directories, try unlink first (handles Windows junctions)
    try {
      await unlink(linkPath);
    } catch {
      await assertDirectoryContainsOnlyManagedEntries(linkPath, managedEntries);
      await rm(linkPath, { recursive: true, force: true });
    }
  }

  // Windows uses 'junction' for directory symlinks (no admin privileges required)
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  await symlink(target, linkPath, type);
}

/**
 * Install skills using symlink mode:
 * 1. Copy skills to central store (.comet/skills/)
 * 2. Create symlink from platform dir to central store
 */
async function installSkillsAsSymlink(
  baseDir: string,
  platform: Platform,
  overwrite: boolean,
  languageSkillsDir: string = 'skills',
  scope: InstallScope = 'project',
): Promise<{ copied: number; skipped: number; failed: number }> {
  const centralDir = getCentralSkillsDir(baseDir, scope);
  const assetsDir = getAssetsDir();
  const manifestPath = path.join(assetsDir, 'manifest.json');

  if (!(await fileExists(manifestPath))) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest = await readJson<Manifest>(manifestPath);
  if (!manifest || !Array.isArray(manifest.skills)) {
    throw new Error(`Invalid manifest at ${manifestPath}: "skills" must be an array`);
  }
  const managedSkillReplacementPaths = getManagedSkillReplacementPaths(manifest);

  // Step 1: Copy skills to central store
  let copied = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const skillRelPath of getManagedSkillPaths(manifest)) {
    const isScript = skillRelPath.includes('/scripts/');
    const sourceDir = isScript ? 'skills' : languageSkillsDir;
    const src = path.join(assetsDir, sourceDir, skillRelPath);
    const centralDest = path.join(centralDir, 'skills', skillRelPath);

    if (!overwrite && (await fileExists(centralDest))) {
      skippedCount++;
      continue;
    }

    try {
      await copyFile(src, centralDest);
      copied++;
    } catch (err) {
      failedCount++;
      console.error(
        `    Failed to copy ${skillRelPath} to central store: ${(err as Error).message}`,
      );
    }
  }

  // Step 2: Create symlink from platform dir to central store
  const platformSkillsDir = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills');
  const centralSkillsDir = path.join(centralDir, 'skills');

  try {
    await createSymlink(centralSkillsDir, platformSkillsDir, managedSkillReplacementPaths);
  } catch (err) {
    failedCount++;
    console.error(
      `    Failed to create symlink ${platformSkillsDir} -> ${centralSkillsDir}: ${(err as Error).message}`,
    );
  }

  // Handle OpenCode-style platform commands (still need copy, as command content may differ)
  if (OPENCODE_STYLE_PLATFORM_IDS.has(platform.id)) {
    const result = await createOpenCodeCommands(
      baseDir,
      platform,
      manifest.skills,
      overwrite,
      scope,
      languageSkillsDir,
    );
    copied += result.copied;
    skippedCount += result.skipped;
  }

  // Handle Pi platform command extension
  if (platform.id === 'pi') {
    const result = await createPiCommandExtension(
      baseDir,
      platform,
      manifest.skills,
      overwrite,
      scope,
    );
    copied += result.copied;
    skippedCount += result.skipped;
  }

  return { copied, skipped: skippedCount, failed: failedCount };
}

async function copyCometSkillsForPlatform(
  baseDir: string,
  platform: Platform,
  overwrite: boolean,
  languageSkillsDir: string = 'skills',
  scope: InstallScope = 'project',
  installMode: InstallMode = 'copy',
): Promise<{ copied: number; skipped: number; failed: number }> {
  if (installMode === 'symlink') {
    return installSkillsAsSymlink(baseDir, platform, overwrite, languageSkillsDir, scope);
  }

  const assetsDir = getAssetsDir();
  const manifestPath = path.join(assetsDir, 'manifest.json');

  if (!(await fileExists(manifestPath))) {
    throw new Error(`Manifest not found at ${manifestPath}`);
  }

  const manifest = await readJson<Manifest>(manifestPath);
  if (!manifest || !Array.isArray(manifest.skills)) {
    throw new Error(`Invalid manifest at ${manifestPath}: "skills" must be an array`);
  }
  let copied = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const skillRelPath of getManagedSkillPaths(manifest)) {
    const isScript = skillRelPath.includes('/scripts/');
    const sourceDir = isScript ? 'skills' : languageSkillsDir;

    const src = path.join(assetsDir, sourceDir, skillRelPath);
    const dest = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills', skillRelPath);

    if (!overwrite && (await fileExists(dest))) {
      skippedCount++;
      continue;
    }

    try {
      await copyFile(src, dest);
      copied++;
    } catch (err) {
      // Surface the failure via the returned `failed` count instead of
      // swallowing it, so a half-installed state (e.g. a missing
      // comet-hook-guard.mjs) is visible in the summary rather than silently
      // breaking phase guard downstream.
      failedCount++;
      console.error(`    Failed to copy ${skillRelPath}: ${(err as Error).message}`);
    }
  }

  if (OPENCODE_STYLE_PLATFORM_IDS.has(platform.id)) {
    const result = await createOpenCodeCommands(
      baseDir,
      platform,
      manifest.skills,
      overwrite,
      scope,
      languageSkillsDir,
    );
    copied += result.copied;
    skippedCount += result.skipped;
  }

  if (platform.id === 'pi') {
    const result = await createPiCommandExtension(
      baseDir,
      platform,
      manifest.skills,
      overwrite,
      scope,
    );
    copied += result.copied;
    skippedCount += result.skipped;
  }

  return { copied, skipped: skippedCount, failed: failedCount };
}

function getTopLevelSkillNames(skillPaths: string[]): string[] {
  return skillPaths.flatMap((skillPath) => {
    const parts = skillPath.split('/');
    return parts.length === 2 && parts[1] === 'SKILL.md' ? [parts[0]] : [];
  });
}

function renderPiCommandExtension(skillNames: string[]): string {
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const commands = ${JSON.stringify(skillNames, null, 2)} as const;

export default function registerCometCommands(pi: ExtensionAPI) {
  for (const name of commands) {
    pi.registerCommand(name, {
      description: \`Comet: /\${name}\`,
      handler: async (args) => {
        pi.sendUserMessage(args ? \`/skill:\${name} \${args}\` : \`/skill:\${name}\`);
      },
    });
  }
}
`;
}

async function createPiCommandExtension(
  baseDir: string,
  platform: Platform,
  skillPaths: string[],
  overwrite: boolean,
  scope: InstallScope,
): Promise<{ copied: number; skipped: number }> {
  const platformBase = path.join(baseDir, getPlatformSkillsDir(platform, scope));
  const settingsPath = path.join(platformBase, 'settings.json');
  const extensionPath = path.join(platformBase, 'extensions', PI_COMMAND_EXTENSION_FILE);

  let settings: Record<string, unknown> = {};
  if (await fileExists(settingsPath)) {
    try {
      const parsed = JSON.parse(await readFile(settingsPath, 'utf-8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('expected a JSON object');
      }
      settings = parsed as Record<string, unknown>;
    } catch (err) {
      throw new Error(`Invalid Pi settings at ${settingsPath}: ${(err as Error).message}`, {
        cause: err,
      });
    }
  }

  let copied = 0;
  let skipped = 0;

  if (settings.enableSkillCommands !== true) {
    settings.enableSkillCommands = true;
    await ensureDir(path.dirname(settingsPath));
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
    copied++;
  }

  if (!overwrite && (await fileExists(extensionPath))) {
    skipped++;
    return { copied, skipped };
  }

  await ensureDir(path.dirname(extensionPath));
  await writeFile(
    extensionPath,
    renderPiCommandExtension(getTopLevelSkillNames(skillPaths)),
    'utf-8',
  );
  copied++;

  return { copied, skipped };
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return content.trimStart();
  }

  const normalized = content.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return content.trimStart();

  return normalized.slice(end + '\n---\n'.length).trimStart();
}

async function createOpenCodeCommands(
  baseDir: string,
  platform: Platform,
  skillPaths: string[],
  overwrite: boolean,
  scope: InstallScope,
  languageSkillsDir: string,
): Promise<{ copied: number; skipped: number }> {
  let copied = 0;
  let skipped = 0;
  const assetsDir = getAssetsDir();
  const commandsDir = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'commands');

  for (const skillPath of skillPaths) {
    const parts = skillPath.split('/');
    if (parts.length !== 2 || parts[1] !== 'SKILL.md') continue;

    const skillName = parts[0];
    const dest = path.join(commandsDir, `${skillName}.md`);

    if (!overwrite && (await fileExists(dest))) {
      skipped++;
      continue;
    }

    await ensureDir(path.dirname(dest));
    let skillSourcePath = path.join(assetsDir, languageSkillsDir, skillPath);
    if (!(await fileExists(skillSourcePath))) {
      skillSourcePath = path.join(assetsDir, 'skills', skillPath);
    }
    const skillBody = stripFrontmatter(await readFile(skillSourcePath, 'utf-8'));
    const content = `${OPENCODE_COMMAND_HEADER.replace('{skillName}', skillName)}
Equivalent Comet skill: \`${skillName}\`
Command name: \`/${skillName}\`

Use the invocation arguments below as the user input for this workflow:

\`\`\`text
$ARGUMENTS
\`\`\`

${skillBody}
`;
    await writeFile(dest, content, 'utf-8');
    copied++;
  }

  return { copied, skipped };
}

async function readManifest(): Promise<Manifest> {
  const assetsDir = getAssetsDir();
  const manifestPath = path.join(assetsDir, 'manifest.json');
  return readJson<Manifest>(manifestPath);
}

async function getManifestSkills(): Promise<string[]> {
  const manifest = await readManifest();
  return getManagedSkillPaths(manifest);
}

/**
 * Copy Comet rule files to a platform's rules directory.
 * Formats:
 *   'md' = plain markdown copy
 *   'mdc' = Cursor MDC with frontmatter
 *   'copilot' = GitHub Copilot .instructions.md with applyTo frontmatter
 * Skips platforms without rulesDir.
 */
async function copyCometRulesForPlatform(
  baseDir: string,
  platform: Platform,
  overwrite: boolean,
  scope: InstallScope = 'project',
): Promise<{ copied: number; skipped: number }> {
  if (!platform.rulesDir || !platform.rulesFormat) {
    return { copied: 0, skipped: 0 };
  }

  const manifest = await readManifest();
  const rulePaths = manifest.rules;
  if (!rulePaths || rulePaths.length === 0) {
    return { copied: 0, skipped: 0 };
  }

  const assetsDir = getAssetsDir();
  // Support platforms whose rules live outside the skills config dir
  // (e.g., Cline: rules go to .clinerules/ at project root, not .cline/rules/)
  const rulesBase =
    platform.rulesBaseDir !== undefined
      ? platform.rulesBaseDir === ''
        ? baseDir
        : path.join(baseDir, platform.rulesBaseDir)
      : path.join(baseDir, getPlatformSkillsDir(platform, scope));
  let copied = 0;
  let skippedCount = 0;

  for (const ruleRelPath of rulePaths) {
    const src = path.join(assetsDir, 'skills', ruleRelPath);
    if (!(await fileExists(src))) {
      console.error(`    Rule source not found: ${ruleRelPath}`);
      continue;
    }

    const ruleFileName = path.basename(ruleRelPath);
    const rulesDestDir = path.join(rulesBase, platform.rulesDir);
    const dest = computeRuleDestPath(rulesDestDir, ruleFileName, platform.rulesFormat);

    if (!overwrite && (await fileExists(dest))) {
      skippedCount++;
      continue;
    }

    try {
      const content = await readFile(src, 'utf-8');
      await ensureDir(path.dirname(dest));
      const formatted = formatRuleContent(content, ruleFileName, platform.rulesFormat);
      await writeFile(dest, formatted, 'utf-8');
      copied++;
    } catch (err) {
      console.error(`    Failed to copy rule ${ruleRelPath}: ${(err as Error).message}`);
    }
  }

  return { copied, skipped: skippedCount };
}

function computeRuleDestPath(
  rulesDestDir: string,
  ruleFileName: string,
  rulesFormat: string,
): string {
  if (rulesFormat === 'mdc') {
    return path.join(rulesDestDir, ruleFileName.replace(/\.md$/, '.mdc'));
  }
  if (rulesFormat === 'copilot') {
    // GitHub Copilot: comet-phase-guard.md → comet-phase-guard.instructions.md
    return path.join(rulesDestDir, ruleFileName.replace(/\.md$/, '.instructions.md'));
  }
  return path.join(rulesDestDir, ruleFileName);
}

function formatRuleContent(content: string, ruleFileName: string, rulesFormat: string): string {
  if (rulesFormat === 'mdc') {
    // Cursor MDC: wrap in YAML frontmatter
    return `---
description: ${ruleFileName.replace(/\.md$/, '').replace(/-/g, ' ')}
globs:
alwaysApply: true
---

${content}`;
  }
  if (rulesFormat === 'copilot') {
    // GitHub Copilot: wrap in applyTo frontmatter (apply to all files)
    return `---
applyTo: "**"
---

${content}`;
  }
  // Plain markdown — no transformation
  return content;
}

/**
 * Install Comet hooks for platforms that support them.
 * Supports multiple hook formats:
 *   'claude-code' — settings.local.json with PreToolUse array (Claude Code, Codex, Amazon Q)
 *   'qwen' — settings.json with PreToolUse/hooks array (Qwen Code)
 *   'qoder' — settings.json with PreToolUse/hooks array (Qoder)
 *   'gemini' — settings.json with hooks.BeforeTool array (Gemini CLI)
 *   'windsurf' — hooks.json with pre_write_code array
 *   'copilot' — hooks/*.json with preToolUse
 *   'kiro' — hooks/*.kiro.hook JSON files
 */
async function installCometHooksForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
): Promise<{ installed: boolean; reason?: string }> {
  if (!platform.supportsHooks || !platform.hookFormat) {
    return { installed: false, reason: 'platform does not support hooks' };
  }

  const manifest = await readManifest();
  const hooksConfig = manifest.hooks;
  if (!hooksConfig || Object.keys(hooksConfig).length === 0) {
    return { installed: false, reason: 'no hooks defined in manifest' };
  }

  const hookFormat = platform.hookFormat;
  const skillsDir = getPlatformSkillsDir(platform, scope);
  const platformBase = path.join(baseDir, skillsDir);

  try {
    switch (hookFormat) {
      case 'claude-code':
        return installClaudeCodeHooks(baseDir, platformBase, skillsDir, hooksConfig);
      case 'qwen':
      case 'qoder':
        return installQwenStyleHooks(baseDir, platformBase, skillsDir, hooksConfig, hookFormat);
      case 'gemini':
        return installGeminiHooks(baseDir, platformBase, skillsDir, hooksConfig);
      case 'windsurf':
        return installWindsurfHooks(baseDir, platformBase, skillsDir, hooksConfig);
      case 'copilot':
        return installCopilotHooks(baseDir, platformBase, skillsDir, hooksConfig);
      case 'kiro':
        return installKiroHooks(baseDir, platformBase, skillsDir, hooksConfig);
      default:
        return { installed: false, reason: `unsupported hook format: ${hookFormat}` };
    }
  } catch (err) {
    return { installed: false, reason: (err as Error).message };
  }
}

function quoteCommandArg(value: string): string {
  return `"${value.replaceAll('\\', '/').replaceAll('"', '\\"')}"`;
}

/** Build a hook command that is stable even when the hook runner executes from a subdirectory. */
function buildHookCommand(baseDir: string, skillsDir: string, scriptRelPath: string): string {
  const projectRoot = path.resolve(baseDir);
  const scriptPath = path.join(projectRoot, skillsDir, 'skills', ...scriptRelPath.split('/'));
  return `node ${quoteCommandArg(scriptPath)} --project-root ${quoteCommandArg(projectRoot)}`;
}

function isManagedHookCommand(command: unknown, scriptRelPaths: string[]): boolean {
  if (typeof command !== 'string') return false;

  // Match both the current `node .../comet-hook-guard.mjs` form and the legacy
  // `bash .../comet-hook-guard.sh` form so uninstall also cleans up hooks
  // written by older Comet releases. Compare basenames without extension.
  const commandPath = command
    .trim()
    .match(/^(?:node|bash|sh)\s+["']?([^"'\s]+)["']?(?:\s|$)/)?.[1]
    ?.replace(/\\/g, '/');
  if (!commandPath) return false;
  const normalize = (value: string): string => value.replace(/\.(?:sh|mjs)$/u, '');

  return scriptRelPaths.some((scriptRelPath) =>
    normalize(commandPath).endsWith(`/skills/${normalize(scriptRelPath.replace(/\\/g, '/'))}`),
  );
}

function mergeHookGroups<T extends { command: string }>(
  existingGroups: Array<Record<string, unknown>>,
  newGroups: Array<{ matcher: string; hooks: T[] }>,
  scriptRelPaths: string[],
): Array<Record<string, unknown>> {
  const mergedGroups = existingGroups.flatMap((group) => {
    if (!Array.isArray(group.hooks)) return [group];

    const hooks = group.hooks.filter(
      (hook) => !isManagedHookCommand((hook as Record<string, unknown>).command, scriptRelPaths),
    );
    if (hooks.length === 0 && group.hooks.length > 0) return [];

    return [{ ...group, hooks }];
  });

  for (const newGroup of newGroups) {
    const existingGroup = mergedGroups.find(
      (group) => group.matcher === newGroup.matcher && Array.isArray(group.hooks),
    );
    if (existingGroup) {
      existingGroup.hooks = [...(existingGroup.hooks as unknown[]), ...newGroup.hooks];
    } else {
      mergedGroups.push(newGroup);
    }
  }

  return mergedGroups;
}

/**
 * Coerce a parsed hooks group into an array. Hand-edited settings files may
 * store a group as an object or scalar; treat anything non-array as empty so
 * downstream merge/filter logic cannot throw on malformed input.
 */
function asHookGroup(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
}

/**
 * Claude Code, Codex, Amazon Q format:
 * Writes to settings.local.json with { hooks: { PreToolUse: [...] } }
 */
async function installClaudeCodeHooks(
  baseDir: string,
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
): Promise<{ installed: boolean; reason?: string }> {
  const settingsPath = path.join(platformBase, 'settings.local.json');

  // Claude Code format: { matcher, hooks: [{ type: "command", command }] }
  interface ClaudeCodeHookEntry {
    matcher: string;
    hooks: Array<{ type: string; command: string }>;
  }

  // Group by matcher so hooks sharing the same matcher are merged
  const matcherGroups: Record<string, Array<{ type: string; command: string }>> = {};
  for (const [scriptRelPath, config] of Object.entries(hooksConfig)) {
    const command = buildHookCommand(baseDir, skillsDir, scriptRelPath);
    if (!matcherGroups[config.matcher]) {
      matcherGroups[config.matcher] = [];
    }
    matcherGroups[config.matcher].push({ type: 'command', command });
  }

  const newEntries: ClaudeCodeHookEntry[] = Object.entries(matcherGroups).map(
    ([matcher, hooks]) => ({ matcher, hooks }),
  );

  let settings: Record<string, unknown> = {};
  if (await fileExists(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }

  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  const existingPreToolUse = asHookGroup(existingHooks.PreToolUse);
  const merged = mergeHookGroups(existingPreToolUse, newEntries, Object.keys(hooksConfig));

  settings.hooks = { ...existingHooks, PreToolUse: merged };
  await ensureDir(path.dirname(settingsPath));
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { installed: true };
}

/**
 * Qwen Code / Qoder format:
 * Writes to settings.json with { hooks: { PreToolUse: [{ matcher, hooks: [{ type, command }] }] } }
 */
async function installQwenStyleHooks(
  baseDir: string,
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
  _hookFormat: string,
): Promise<{ installed: boolean; reason?: string }> {
  const settingsPath = path.join(platformBase, 'settings.json');

  // Group by matcher
  const matcherGroups: Record<
    string,
    Array<{ type: string; command: string; description: string }>
  > = {};
  for (const [scriptRelPath, config] of Object.entries(hooksConfig)) {
    if (!matcherGroups[config.matcher]) {
      matcherGroups[config.matcher] = [];
    }
    matcherGroups[config.matcher].push({
      type: 'command',
      command: buildHookCommand(baseDir, skillsDir, scriptRelPath),
      description: config.description,
    });
  }

  const preToolUseEntries = Object.entries(matcherGroups).map(([matcher, hooks]) => ({
    matcher,
    hooks,
  }));

  let settings: Record<string, unknown> = {};
  if (await fileExists(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }

  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  const existingPreToolUse = asHookGroup(existingHooks.PreToolUse);
  const merged = mergeHookGroups(existingPreToolUse, preToolUseEntries, Object.keys(hooksConfig));

  settings.hooks = { ...existingHooks, PreToolUse: merged };
  await ensureDir(path.dirname(settingsPath));
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { installed: true };
}

/**
 * Gemini CLI format:
 * Writes to .gemini/settings.json with { hooks: { BeforeTool: [{ matcher, hooks: [{ type, command }] }] } }
 */
async function installGeminiHooks(
  baseDir: string,
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
): Promise<{ installed: boolean; reason?: string }> {
  const settingsPath = path.join(platformBase, 'settings.json');

  const entries: Array<{
    matcher: string;
    hooks: Array<{ type: string; command: string; name: string }>;
  }> = [];
  for (const [scriptRelPath, config] of Object.entries(hooksConfig)) {
    entries.push({
      matcher: config.matcher === 'Write|Edit' ? 'write_file|edit_file' : config.matcher,
      hooks: [
        {
          type: 'command',
          command: buildHookCommand(baseDir, skillsDir, scriptRelPath),
          name: config.description,
        },
      ],
    });
  }

  let settings: Record<string, unknown> = {};
  if (await fileExists(settingsPath)) {
    try {
      settings = JSON.parse(await readFile(settingsPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }

  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  const existingBeforeTool = asHookGroup(existingHooks.BeforeTool);
  const merged = mergeHookGroups(existingBeforeTool, entries, Object.keys(hooksConfig));

  settings.hooks = { ...existingHooks, BeforeTool: merged };
  await ensureDir(path.dirname(settingsPath));
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { installed: true };
}

/**
 * Windsurf format:
 * Writes to .windsurf/hooks.json with { hooks: { pre_write_code: [{ command }] } }
 */
async function installWindsurfHooks(
  baseDir: string,
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
): Promise<{ installed: boolean; reason?: string }> {
  const hooksPath = path.join(platformBase, 'hooks.json');

  const entries: Array<{ command: string; show_output: boolean }> = [];
  for (const [scriptRelPath] of Object.entries(hooksConfig)) {
    entries.push({
      command: buildHookCommand(baseDir, skillsDir, scriptRelPath),
      show_output: true,
    });
  }

  let hooksFile: Record<string, unknown> = {};
  if (await fileExists(hooksPath)) {
    try {
      hooksFile = JSON.parse(await readFile(hooksPath, 'utf-8')) as Record<string, unknown>;
    } catch {
      hooksFile = {};
    }
  }

  const existingHooks = (hooksFile.hooks as Record<string, unknown>) ?? {};
  const existingPreWrite = asHookGroup(existingHooks.pre_write_code);
  const merged = existingPreWrite.filter(
    (entry) => !isManagedHookCommand(entry.command, Object.keys(hooksConfig)),
  );
  merged.push(...entries);

  hooksFile.hooks = { ...existingHooks, pre_write_code: merged };
  await ensureDir(path.dirname(hooksPath));
  await writeFile(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n', 'utf-8');
  return { installed: true };
}

/**
 * GitHub Copilot format:
 * Writes to .github/hooks/comet-guard.json with preToolUse hooks config.
 */
async function installCopilotHooks(
  baseDir: string,
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
): Promise<{ installed: boolean; reason?: string }> {
  const hooksDir = path.join(platformBase, 'hooks');
  const hookFilePath = path.join(hooksDir, 'comet-guard.json');

  const scriptEntries: Array<{ bash: string; powershell: string }> = [];
  for (const [scriptRelPath] of Object.entries(hooksConfig)) {
    const cmd = buildHookCommand(baseDir, skillsDir, scriptRelPath);
    // Hook runs through node on every platform; both fields use the same command
    scriptEntries.push({ bash: cmd, powershell: cmd });
  }

  const hookConfig = {
    version: 1,
    hooks: {
      preToolUse: scriptEntries,
    },
  };

  await ensureDir(hooksDir);
  await writeFile(hookFilePath, JSON.stringify(hookConfig, null, 2) + '\n', 'utf-8');
  return { installed: true };
}

/**
 * Kiro format:
 * Writes to .kiro/hooks/comet-phase-guard.kiro.hook as a JSON file.
 */
async function installKiroHooks(
  baseDir: string,
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
): Promise<{ installed: boolean; reason?: string }> {
  const hooksDir = path.join(platformBase, 'hooks');

  for (const [scriptRelPath, config] of Object.entries(hooksConfig)) {
    const hookFileName = path.basename(scriptRelPath).replace(/\.mjs$/, '.kiro.hook');
    const hookFilePath = path.join(hooksDir, hookFileName);

    // Map Write|Edit matcher to Kiro's write tool category
    const toolName = config.matcher === 'Write|Edit' ? 'write' : '*';

    const hookConfig = {
      enabled: true,
      name: config.description,
      description: config.description,
      version: '1',
      when: {
        type: 'preToolUse',
        toolName,
      },
      then: {
        type: 'runCommand',
        command: buildHookCommand(baseDir, skillsDir, scriptRelPath),
      },
    };

    await ensureDir(hooksDir);
    await writeFile(hookFilePath, JSON.stringify(hookConfig, null, 2) + '\n', 'utf-8');
  }

  return { installed: true };
}

function managedConfigFields(language: string = 'en') {
  const artifactLanguage = resolveArtifactLanguage(language);
  return [
    {
      key: 'language',
      def: artifactLanguage.id,
      comment: `# language: ${formatSupportedArtifactLanguages()}`,
    },
    { key: 'context_compression', def: 'off', comment: '# context_compression: off | beta' },
    { key: 'review_mode', def: 'standard', comment: '# review_mode: off | standard | thorough' },
    { key: 'auto_transition', def: 'true', comment: '# auto_transition: true | false' },
  ] as const;
}

const MANAGED_CONFIG_FIELDS = managedConfigFields();

type ManagedConfigField = ReturnType<typeof managedConfigFields>[number];

function getManagedConfigFields(language: string = 'en'): readonly ManagedConfigField[] {
  return language === 'en' ? MANAGED_CONFIG_FIELDS : managedConfigFields(language);
}

function parseProjectConfigOverrides(content: string): Record<string, string> {
  if (!content.trim()) return {};
  const doc = parseDocument(content, { uniqueKeys: false });
  if (doc.errors.length > 0) return {};
  const js = doc.toJS();
  if (!js || typeof js !== 'object' || Array.isArray(js)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(js as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out[k] = String(v);
    }
  }
  return out;
}

function renderProjectConfig(existing: Record<string, string>, language: string = 'en'): string {
  const lines: string[] = [];
  const fields = getManagedConfigFields(language);
  const managed: Set<string> = new Set(fields.map((f) => f.key));
  for (const f of fields) {
    lines.push(f.comment);
    lines.push(`${f.key}: ${existing[f.key] ?? f.def}`);
  }
  for (const [k, v] of Object.entries(existing)) {
    if (!managed.has(k)) lines.push(`${k}: ${v}`);
  }
  lines.push('');
  return lines.join('\n');
}

async function mergeProjectConfig(projectPath: string, language: string = 'en'): Promise<void> {
  const configPath = path.join(projectPath, '.comet', 'config.yaml');
  let existing: Record<string, string> = {};
  if (await fileExists(configPath)) {
    existing = parseProjectConfigOverrides(await readFile(configPath, 'utf-8'));
  }
  await ensureDir(path.dirname(configPath));
  await writeFile(configPath, renderProjectConfig(existing, language), 'utf-8');
}

async function createWorkingDirs(projectPath: string, language: string = 'en'): Promise<void> {
  const dirs = [
    path.join(projectPath, 'docs', 'superpowers', 'specs'),
    path.join(projectPath, 'docs', 'superpowers', 'plans'),
    path.join(projectPath, '.comet'),
  ];

  for (const dir of dirs) {
    await ensureDir(dir);
  }

  await mergeProjectConfig(projectPath, language);
}

export {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  readManifest,
  getManagedSkillPaths,
  getManifestSkills,
  getUserFacingSkillNames,
  createWorkingDirs,
  getAssetsDir,
  computeRuleDestPath,
  formatRuleContent,
  isManagedHookCommand,
  planSkillDirectoryCopy,
  mergeProjectConfig,
  parseProjectConfigOverrides,
  renderProjectConfig,
  getCentralSkillsDir,
  installSkillsAsSymlink,
};
export type { Manifest, LanguageConfig, PlannedSkillFile, PlannedSkillSourceFile };
