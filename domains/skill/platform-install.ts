import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, lstat, unlink, symlink, rm, readdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { parseDocument } from 'yaml';

import { fileExists, readJson, copyFile, ensureDir } from '../../platform/fs/file-system.js';
import {
  getPlatformConfigDir,
  getPlatformSkillsDir,
  type Platform,
} from '../../platform/install/platforms.js';
import type { InstallScope, InstallMode } from '../../platform/install/types.js';
import { resolveArtifactLanguage } from './languages.js';
import type { LanguageConfig, SkillLanguageId } from './languages.js';
import { installCometProjectInstructions } from './project-instructions.js';
import { readJsonObjectFile } from './json-object.js';
import type { InitWorkflowSelection } from '../comet-entry/types.js';
import {
  projectConfigComment,
  renderStructuredProjectConfig,
} from '../workflow-contract/project-config.js';

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
  nativeRules?: string[];
  hooks?: Record<string, HookConfig>;
  nativeHooks?: Record<string, HookConfig>;
  languages?: LanguageConfig[];
};

const HOOK_ROUTER_SCRIPT = 'comet/scripts/comet-hook-router.mjs';
const LEGACY_HOOK_SCRIPTS = [
  'comet/scripts/comet-hook-guard.mjs',
  'comet-native/scripts/comet-native-hook-guard.mjs',
] as const;
const LEGACY_RULE_FILES = ['comet-phase-guard.md', 'comet-native-phase-guard.md'] as const;
const NATIVE_SHARED_SKILL_PATHS = new Set([
  'comet/SKILL.md',
  'comet/scripts/comet-entry-runtime.mjs',
  'comet/scripts/comet-hook-router.mjs',
]);

interface HookCommandContext {
  platformId: string;
  scope: InstallScope;
}

type HookInstallStatus = 'installed' | 'skipped' | 'failed';

export interface HookInstallResult {
  status: HookInstallStatus;
  reason?: string;
  cleanupFailed?: number;
}

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

function isManagedSkillPathForSelection(
  skillPath: string,
  workflowSelection: InitWorkflowSelection,
): boolean {
  if (workflowSelection === 'both') return true;
  if (workflowSelection === 'classic') return !skillPath.startsWith('comet-native/');
  return (
    NATIVE_SHARED_SKILL_PATHS.has(skillPath) ||
    skillPath.startsWith('comet-native/') ||
    skillPath.startsWith('comet-any/')
  );
}

function getManagedSkillPathsForSelection(
  manifest: Manifest,
  workflowSelection: InitWorkflowSelection,
): string[] {
  return getManagedSkillPaths(manifest).filter((skillPath) =>
    isManagedSkillPathForSelection(skillPath, workflowSelection),
  );
}

function getUserFacingSkillPathsForSelection(
  manifest: Manifest,
  workflowSelection: InitWorkflowSelection,
): string[] {
  return manifest.skills.filter((skillPath) =>
    isManagedSkillPathForSelection(skillPath, workflowSelection),
  );
}

function getUserFacingSkillNames(manifest: Manifest): string[] {
  return getTopLevelSkillNames(manifest.skills);
}

function getManagedSkillReplacementPaths(
  manifest: Manifest,
  workflowSelection: InitWorkflowSelection = 'both',
): Set<string> {
  const allowed = new Set<string>();

  for (const skillPath of getManagedSkillPathsForSelection(manifest, workflowSelection)) {
    const parts = skillPath.split('/').filter(Boolean);
    for (let depth = 1; depth <= parts.length; depth++) {
      allowed.add(parts.slice(0, depth).join('/'));
    }
  }

  return allowed;
}

function getManagedSkillTopLevelEntries(
  manifest: Manifest,
  workflowSelection: InitWorkflowSelection = 'both',
): string[] {
  const entries = new Set<string>();

  for (const skillPath of getManagedSkillPathsForSelection(manifest, workflowSelection)) {
    const [topLevel] = skillPath.split('/').filter(Boolean);
    if (topLevel) entries.add(topLevel);
  }

  return [...entries].sort();
}

function getManagedEntriesForTopLevel(
  managedEntries: Set<string>,
  topLevelEntry: string,
): Set<string> {
  const scopedEntries = new Set<string>();
  const prefix = `${topLevelEntry}/`;

  for (const entry of managedEntries) {
    if (entry.startsWith(prefix)) {
      scopedEntries.add(entry.slice(prefix.length));
    }
  }

  return scopedEntries;
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

async function lstatOrNull(filePath: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

async function prepareManagedSkillCopyTarget(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
  workflowSelection: InitWorkflowSelection = 'both',
): Promise<void> {
  const manifest = await readManifest();
  const managedEntries = new Set(getManagedSkillTopLevelEntries(manifest, workflowSelection));
  const skillsRoot = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills');
  const rootStat = await lstatOrNull(skillsRoot);
  if (!rootStat) return;

  if (rootStat.isSymbolicLink()) {
    let linkedEntries: string[] = [];
    try {
      linkedEntries = await readdir(skillsRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const unmanagedEntries = linkedEntries.filter((entry) => !managedEntries.has(entry));
    if (unmanagedEntries.length > 0) {
      throw new Error(
        `Refusing to replace ${skillsRoot} with managed copies because the linked directory contains unmanaged entries: ${unmanagedEntries.join(', ')}`,
      );
    }
    await unlink(skillsRoot);
    await ensureDir(skillsRoot);
    return;
  }

  if (!rootStat.isDirectory()) return;
  for (const entry of managedEntries) {
    const entryPath = path.join(skillsRoot, entry);
    const entryStat = await lstatOrNull(entryPath);
    if (entryStat?.isSymbolicLink()) {
      await unlink(entryPath);
    }
  }
}

async function prepareNativeSkillInstallTarget(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  languageSkillsDir: string,
  action: 'overwrite' | 'fill' | 'skip',
): Promise<void> {
  if (action !== 'skip') {
    await prepareManagedSkillCopyTarget(baseDir, platform, scope, 'native');
  }
  if (action === 'overwrite') return;

  const skillsRoot = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills');
  const assetsDir = getAssetsDir();
  const manifest = await readManifest();
  const requiredFiles = getManagedSkillPaths(manifest)
    .filter(
      (relativePath) =>
        relativePath === 'comet/SKILL.md' ||
        relativePath === 'comet/scripts/comet-entry-runtime.mjs' ||
        relativePath === 'comet/scripts/comet-hook-router.mjs' ||
        relativePath.startsWith('comet-any/') ||
        relativePath.startsWith('comet-native/'),
    )
    .map((relativePath) => {
      const pathParts = relativePath.split('/');
      const sourceDir = relativePath.includes('/scripts/') ? 'skills' : languageSkillsDir;
      return {
        label: `the required Native asset ${relativePath}`,
        destination: path.join(skillsRoot, ...pathParts),
        source: path.join(assetsDir, sourceDir, ...pathParts),
      };
    });

  for (const required of requiredFiles) {
    const destinationStat = await lstatOrNull(required.destination);
    if (!destinationStat) {
      if (action === 'fill') continue;
      throw new Error(
        `Cannot activate Native while skipping existing Comet files because ${required.label} is missing at ${required.destination}`,
      );
    }
    if (!destinationStat.isFile()) {
      throw new Error(
        `Cannot activate Native because ${required.label} is not a regular file at ${required.destination}; rerun with --overwrite after preserving any custom content`,
      );
    }
    const [installed, bundled] = await Promise.all([
      readFile(required.destination),
      readFile(required.source),
    ]);
    if (!installed.equals(bundled)) {
      throw new Error(
        `Cannot activate Native because ${required.label} differs from the bundled routing contract at ${required.destination}; rerun with --overwrite after preserving any custom content`,
      );
    }
  }
}

async function createSkillsSymlinks(
  targetRoot: string,
  linkRoot: string,
  managedEntries: Set<string>,
  topLevelEntries: string[],
): Promise<number> {
  const rootStat = await lstatOrNull(linkRoot);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    await createSymlink(targetRoot, linkRoot, managedEntries);
    return 0;
  }

  let failed = 0;
  for (const topLevelEntry of topLevelEntries) {
    const targetEntry = path.join(targetRoot, topLevelEntry);
    const linkEntry = path.join(linkRoot, topLevelEntry);
    const managedEntryScope = getManagedEntriesForTopLevel(managedEntries, topLevelEntry);

    try {
      await createSymlink(targetEntry, linkEntry, managedEntryScope);
    } catch (err) {
      failed++;
      console.error(
        `    Failed to create symlink ${linkEntry} -> ${targetEntry}: ${(err as Error).message}`,
      );
    }
  }

  return failed;
}

/**
 * Install skills using symlink mode:
 * 1. Copy skills to central store (.comet/skills/)
 * 2. Create symlinks from the platform skills dir to central store
 */
async function installSkillsAsSymlink(
  baseDir: string,
  platform: Platform,
  overwrite: boolean,
  languageSkillsDir: string = 'skills',
  scope: InstallScope = 'project',
  workflowSelection: InitWorkflowSelection = 'both',
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
  const managedSkillPaths = getManagedSkillPathsForSelection(manifest, workflowSelection);
  const userFacingSkillPaths = getUserFacingSkillPathsForSelection(manifest, workflowSelection);
  const managedSkillReplacementPaths = getManagedSkillReplacementPaths(manifest, workflowSelection);
  const managedSkillTopLevelEntries = getManagedSkillTopLevelEntries(manifest, workflowSelection);

  // Step 1: Copy skills to central store
  let copied = 0;
  let skippedCount = 0;
  let failedCount = 0;

  for (const skillRelPath of managedSkillPaths) {
    const isScript = skillRelPath.includes('/scripts/');
    const sourceDir = isScript ? 'skills' : languageSkillsDir;
    const src = path.join(assetsDir, sourceDir, skillRelPath);
    const centralDest = path.join(centralDir, 'skills', skillRelPath);

    try {
      if (!overwrite && (await fileExists(centralDest))) {
        skippedCount++;
        continue;
      }
      await copyFile(src, centralDest);
      copied++;
    } catch (err) {
      failedCount++;
      console.error(
        `    Failed to copy ${skillRelPath} to central store: ${(err as Error).message}`,
      );
    }
  }

  // Step 2: Create symlinks from platform dir to central store
  const platformSkillsDir = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills');
  const centralSkillsDir = path.join(centralDir, 'skills');

  try {
    failedCount += await createSkillsSymlinks(
      centralSkillsDir,
      platformSkillsDir,
      managedSkillReplacementPaths,
      managedSkillTopLevelEntries,
    );
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
      userFacingSkillPaths,
      overwrite,
      scope,
      languageSkillsDir,
    );
    copied += result.copied;
    skippedCount += result.skipped;
    failedCount += result.failed;
  }

  // Handle Pi platform command extension
  if (platform.id === 'pi') {
    const result = await createPiCommandExtension(
      baseDir,
      platform,
      userFacingSkillPaths,
      overwrite,
      scope,
    );
    copied += result.copied;
    skippedCount += result.skipped;
    failedCount += result.failed;
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
  workflowSelection: InitWorkflowSelection = 'both',
): Promise<{ copied: number; skipped: number; failed: number }> {
  if (installMode === 'symlink') {
    return installSkillsAsSymlink(
      baseDir,
      platform,
      overwrite,
      languageSkillsDir,
      scope,
      workflowSelection,
    );
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
  const managedSkillPaths = getManagedSkillPathsForSelection(manifest, workflowSelection);
  const userFacingSkillPaths = getUserFacingSkillPathsForSelection(manifest, workflowSelection);

  for (const skillRelPath of managedSkillPaths) {
    const isScript = skillRelPath.includes('/scripts/');
    const sourceDir = isScript ? 'skills' : languageSkillsDir;

    const src = path.join(assetsDir, sourceDir, skillRelPath);
    const dest = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'skills', skillRelPath);

    try {
      if (!overwrite && (await fileExists(dest))) {
        skippedCount++;
        continue;
      }
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
      userFacingSkillPaths,
      overwrite,
      scope,
      languageSkillsDir,
    );
    copied += result.copied;
    skippedCount += result.skipped;
    failedCount += result.failed;
  }

  if (platform.id === 'pi') {
    const result = await createPiCommandExtension(
      baseDir,
      platform,
      userFacingSkillPaths,
      overwrite,
      scope,
    );
    copied += result.copied;
    skippedCount += result.skipped;
    failedCount += result.failed;
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
): Promise<{ copied: number; skipped: number; failed: number }> {
  const platformBase = path.join(baseDir, getPlatformSkillsDir(platform, scope));
  const settingsPath = path.join(platformBase, 'settings.json');
  const extensionPath = path.join(platformBase, 'extensions', PI_COMMAND_EXTENSION_FILE);

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  try {
    let settings: Record<string, unknown> = {};
    if (await fileExists(settingsPath)) {
      const parsed = JSON.parse(await readFile(settingsPath, 'utf-8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('expected a JSON object');
      }
      settings = parsed as Record<string, unknown>;
    }

    if (settings.enableSkillCommands !== true) {
      settings.enableSkillCommands = true;
      await ensureDir(path.dirname(settingsPath));
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
      copied++;
    }
  } catch (err) {
    failed++;
    console.error(`    Failed to update Pi settings at ${settingsPath}: ${(err as Error).message}`);
  }

  if (failed > 0) return { copied, skipped, failed };

  try {
    if (!overwrite && (await fileExists(extensionPath))) {
      skipped++;
    } else {
      await ensureDir(path.dirname(extensionPath));
      await writeFile(
        extensionPath,
        renderPiCommandExtension(getTopLevelSkillNames(skillPaths)),
        'utf-8',
      );
      copied++;
    }
  } catch (err) {
    failed++;
    console.error(
      `    Failed to write Pi command extension at ${extensionPath}: ${(err as Error).message}`,
    );
  }

  return { copied, skipped, failed };
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
): Promise<{ copied: number; skipped: number; failed: number }> {
  let copied = 0;
  let skipped = 0;
  let failed = 0;
  const assetsDir = getAssetsDir();
  const commandsDir = path.join(baseDir, getPlatformSkillsDir(platform, scope), 'commands');

  for (const skillPath of skillPaths) {
    const parts = skillPath.split('/');
    if (parts.length !== 2 || parts[1] !== 'SKILL.md') continue;

    const skillName = parts[0];
    const dest = path.join(commandsDir, `${skillName}.md`);

    try {
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
    } catch (err) {
      failed++;
      console.error(`    Failed to create OpenCode command ${dest}: ${(err as Error).message}`);
    }
  }

  return { copied, skipped, failed };
}

async function readManifest(): Promise<Manifest> {
  const assetsDir = getAssetsDir();
  const manifestPath = path.join(assetsDir, 'manifest.json');
  return readJson<Manifest>(manifestPath);
}

async function getManifestSkills(
  workflowSelection: InitWorkflowSelection = 'both',
): Promise<string[]> {
  const manifest = await readManifest();
  return getManagedSkillPathsForSelection(manifest, workflowSelection);
}

/**
 * Copy Comet rule files to a platform's rules directory.
 * Formats:
 *   'md' = plain markdown copy
 *   'mdc' = Cursor MDC with frontmatter
 *   'copilot' = GitHub Copilot .instructions.md with applyTo frontmatter
 * Skips platforms without rulesDir.
 */
// Rule variants share a base name and differ only by a `.en.md` suffix
// (e.g. `comet-phase-guard.md` = zh default, `comet-phase-guard.en.md` = en).
// Centralized here so the naming convention only needs to change in one place.
const EN_RULE_SUFFIX = /\.en\.md$/;

function isEnglishRuleVariant(ruleRelPath: string): boolean {
  return EN_RULE_SUFFIX.test(ruleRelPath);
}

function toRuleBaseName(ruleRelPath: string): string {
  return ruleRelPath.replace(EN_RULE_SUFFIX, '.md');
}

// Pick exactly one variant per base name for the requested language, falling
// back to whichever variant exists if there's no per-language pair.
function selectRulePathsForLanguage(rulePaths: string[], languageId: SkillLanguageId): string[] {
  const wantEnglish = languageId === 'en';
  const selected = new Map<string, { rulePath: string; matched: boolean }>();

  for (const rulePath of rulePaths) {
    const isEnglishVariant = isEnglishRuleVariant(rulePath);
    const baseKey = toRuleBaseName(rulePath);
    const matched = isEnglishVariant === wantEnglish;
    const existing = selected.get(baseKey);

    if (!existing || (matched && !existing.matched)) {
      selected.set(baseKey, { rulePath, matched });
    }
  }

  return [...selected.values()].map((entry) => entry.rulePath);
}

function managedRulesForSelection(manifest: Manifest, _selection: InitWorkflowSelection): string[] {
  return manifest.rules ?? [];
}

function managedHooksForSelection(
  manifest: Manifest,
  _selection: InitWorkflowSelection,
): Record<string, HookConfig> {
  return manifest.hooks ?? {};
}

function managedHookScriptPaths(hooksConfig: Record<string, HookConfig>): string[] {
  return [...new Set([...Object.keys(hooksConfig), ...LEGACY_HOOK_SCRIPTS])];
}

async function copyCometRulesForPlatform(
  baseDir: string,
  platform: Platform,
  overwrite: boolean,
  languageId: SkillLanguageId,
  scope: InstallScope = 'project',
  workflowSelection: InitWorkflowSelection = 'classic',
): Promise<{ copied: number; skipped: number; failed: number }> {
  if (!platform.rulesDir || !platform.rulesFormat) {
    return { copied: 0, skipped: 0, failed: 0 };
  }

  const manifest = await readManifest();
  const rulePaths = selectRulePathsForLanguage(
    managedRulesForSelection(manifest, workflowSelection),
    languageId,
  );
  if (!rulePaths || rulePaths.length === 0) {
    return { copied: 0, skipped: 0, failed: 0 };
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
  let failed = 0;

  for (const ruleRelPath of rulePaths) {
    const src = path.join(assetsDir, 'skills', ruleRelPath);
    try {
      if (!(await fileExists(src))) {
        console.error(`    Rule source not found: ${ruleRelPath}`);
        failed++;
        continue;
      }

      // Normalize the `.en` infix away so the installed file name is the same
      // regardless of which language variant was selected.
      const ruleFileName = toRuleBaseName(path.basename(ruleRelPath));
      const rulesDestDir = path.join(rulesBase, platform.rulesDir);
      const dest = computeRuleDestPath(rulesDestDir, ruleFileName, platform.rulesFormat);

      if (!overwrite && (await fileExists(dest))) {
        skippedCount++;
        continue;
      }

      const content = await readFile(src, 'utf-8');
      await ensureDir(path.dirname(dest));
      const formatted = formatRuleContent(content, ruleFileName, platform.rulesFormat);
      await writeFile(dest, formatted, 'utf-8');
      copied++;
    } catch (err) {
      console.error(`    Failed to copy rule ${ruleRelPath}: ${(err as Error).message}`);
      failed++;
    }
  }

  const rulesDestDir = path.join(rulesBase, platform.rulesDir);
  for (const legacyFile of LEGACY_RULE_FILES) {
    const legacyPath = computeRuleDestPath(rulesDestDir, legacyFile, platform.rulesFormat);
    try {
      await rm(legacyPath, { force: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') continue;
      console.error(`    Failed to remove legacy Rule ${legacyPath}: ${(error as Error).message}`);
      failed++;
    }
  }

  return { copied, skipped: skippedCount, failed };
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
 *   'claude-code' — Claude-shaped JSON with PreToolUse array; defaults to settings.local.json,
 *                   with platform metadata able to override the filename
 *   'qwen' — settings.json with PreToolUse/hooks array (Qwen Code)
 *   'qoder' — settings.json with PreToolUse/hooks array (Qoder)
 *   'codebuddy' — settings.json with PreToolUse/hooks array (CodeBuddy Code)
 *   'gemini' — settings.json with hooks.BeforeTool array (Gemini CLI)
 *   'windsurf' — hooks.json with pre_write_code array
 *   'copilot' — hooks/*.json with preToolUse
 *   'kiro' — hooks/*.kiro.hook JSON files
 */
async function installCometHooksForPlatform(
  baseDir: string,
  platform: Platform,
  scope: InstallScope = 'project',
  workflowSelection: InitWorkflowSelection = 'classic',
): Promise<HookInstallResult> {
  if (!platform.supportsHooks) {
    return { status: 'skipped', reason: 'platform does not support hooks' };
  }
  if (!platform.hookFormat) {
    return {
      status: 'failed',
      reason: 'hook-capable platform does not declare a hook format',
    };
  }

  try {
    const manifest = await readManifest();
    const hooksConfig = managedHooksForSelection(manifest, workflowSelection);
    if (!hooksConfig || Object.keys(hooksConfig).length === 0) {
      return { status: 'skipped', reason: 'no hooks defined in manifest' };
    }

    const hookFormat = platform.hookFormat;
    const skillsDir = getPlatformSkillsDir(platform, scope);
    const platformBase = path.join(baseDir, getPlatformConfigDir(platform, scope));

    switch (hookFormat) {
      case 'claude-code': {
        const result = await installClaudeCodeHooks(
          baseDir,
          platformBase,
          skillsDir,
          hooksConfig,
          platform.hookConfigFile ?? 'settings.local.json',
          platform.name,
          { platformId: platform.id, scope },
        );
        if (result.status === 'installed') {
          const failedLegacyFiles: string[] = [];
          for (const legacyFile of platform.legacyHookConfigFiles ?? []) {
            try {
              const cleanup = await removeManagedHooksFromJsonFile(
                path.join(platformBase, legacyFile),
                managedHookScriptPaths(hooksConfig),
              );
              if (cleanup.failed > 0) failedLegacyFiles.push(legacyFile);
            } catch {
              failedLegacyFiles.push(legacyFile);
            }
          }
          if (failedLegacyFiles.length > 0) {
            return {
              status: 'installed',
              reason: `legacy Hook cleanup failed for ${failedLegacyFiles.join(', ')}`,
              cleanupFailed: failedLegacyFiles.length,
            };
          }
        }
        return result;
      }
      case 'qwen':
      case 'qoder':
      case 'codebuddy':
        return await installQwenStyleHooks(
          baseDir,
          platformBase,
          skillsDir,
          hooksConfig,
          platform.name,
          { platformId: platform.id, scope },
        );
      case 'gemini':
        return await installGeminiHooks(
          baseDir,
          platformBase,
          skillsDir,
          hooksConfig,
          platform.name,
          { platformId: platform.id, scope },
        );
      case 'windsurf':
        return await installWindsurfHooks(
          baseDir,
          platformBase,
          skillsDir,
          hooksConfig,
          platform.name,
          { platformId: platform.id, scope },
        );
      case 'copilot':
        return await installCopilotHooks(baseDir, platformBase, skillsDir, hooksConfig, {
          platformId: platform.id,
          scope,
        });
      case 'kiro':
        return await installKiroHooks(baseDir, platformBase, skillsDir, hooksConfig, {
          platformId: platform.id,
          scope,
        });
      default:
        return { status: 'failed', reason: `unsupported hook format: ${hookFormat}` };
    }
  } catch (err) {
    return { status: 'failed', reason: (err as Error).message };
  }
}

function quoteCommandArg(value: string): string {
  return `"${value.replaceAll('\\', '/').replaceAll('"', '\\"')}"`;
}

/** Build a hook command that is stable even when the hook runner executes from a subdirectory. */
function buildHookCommand(
  baseDir: string,
  skillsDir: string,
  scriptRelPath: string,
  context?: HookCommandContext,
): string {
  const projectRoot = path.resolve(baseDir);
  const scriptPath = path.join(projectRoot, skillsDir, 'skills', ...scriptRelPath.split('/'));
  let command = `node ${quoteCommandArg(scriptPath)}`;
  if (scriptRelPath === HOOK_ROUTER_SCRIPT && context) {
    command += ` --platform ${quoteCommandArg(context.platformId)}`;
    if (context.scope === 'project') {
      command += ` --project-root ${quoteCommandArg(projectRoot)}`;
    }
    return command;
  }
  return `${command} --project-root ${quoteCommandArg(projectRoot)}`;
}

function parseCommandTokens(command: string): string[] | undefined {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let tokenStarted = false;
  let quoteClosed = false;

  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (quote) {
      if (character === quote) {
        quote = undefined;
        quoteClosed = true;
      } else if (character === '\\' && command[index + 1] === quote) {
        current += quote;
        index++;
      } else {
        current += character;
      }
      continue;
    }

    if (character === '\r' || character === '\n' || ';|&<>`'.includes(character)) {
      return undefined;
    }
    if (/\s/u.test(character)) {
      if (tokenStarted) {
        tokens.push(current);
        current = '';
        tokenStarted = false;
        quoteClosed = false;
      }
      continue;
    }
    if (quoteClosed) return undefined;
    if (character === '"' || character === "'") {
      if (tokenStarted) return undefined;
      quote = character;
      tokenStarted = true;
      continue;
    }
    current += character;
    tokenStarted = true;
  }

  if (quote) return undefined;
  if (tokenStarted) tokens.push(current);
  return tokens;
}

function isManagedHookCommand(command: unknown, scriptRelPaths: string[]): boolean {
  if (typeof command !== 'string') return false;

  // Match both the current `node .../comet-hook-guard.mjs` form and the legacy
  // `bash .../comet-hook-guard.sh` form so uninstall also cleans up hooks
  // written by older Comet releases. Compare basenames without extension.
  const tokens = parseCommandTokens(command.trim());
  if (!tokens || tokens.length < 2 || !['node', 'bash', 'sh'].includes(tokens[0])) return false;
  const commandPath = tokens[1].replace(/\\/g, '/');
  const normalize = (value: string): string => value.replace(/\.(?:sh|mjs)$/u, '');

  return scriptRelPaths.some((scriptRelPath) =>
    normalize(commandPath).endsWith(`/skills/${normalize(scriptRelPath.replace(/\\/g, '/'))}`),
  );
}

function mergeHookGroups<T extends { command: string }>(
  existingGroups: unknown[],
  newGroups: Array<{ matcher: string; hooks: T[] }>,
  scriptRelPaths: string[],
): unknown[] {
  const mergedGroups = existingGroups.map((group) => {
    if (!group || typeof group !== 'object' || Array.isArray(group)) return group;
    const record = group as Record<string, unknown>;
    if (!Array.isArray(record.hooks)) return record;

    const hooks = record.hooks.filter((hook) => {
      const command =
        hook && typeof hook === 'object' ? (hook as Record<string, unknown>).command : undefined;
      return !isManagedHookCommand(command, scriptRelPaths);
    });

    return { ...record, hooks };
  });

  for (const newGroup of newGroups) {
    const existingGroupIndex = mergedGroups.findIndex(
      (group) =>
        Boolean(group) &&
        typeof group === 'object' &&
        !Array.isArray(group) &&
        (group as Record<string, unknown>).matcher === newGroup.matcher &&
        Array.isArray((group as Record<string, unknown>).hooks),
    );
    if (existingGroupIndex >= 0) {
      const existingGroup = mergedGroups[existingGroupIndex] as Record<string, unknown>;
      mergedGroups[existingGroupIndex] = {
        ...existingGroup,
        hooks: [...(existingGroup.hooks as unknown[]), ...newGroup.hooks],
      };
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
function asHookGroup(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

async function removeManagedHooksFromJsonFile(
  settingsPath: string,
  scriptRelPaths: string[],
): Promise<{ removed: number; failed: number }> {
  if (!(await fileExists(settingsPath))) return { removed: 0, failed: 0 };

  let source: string;
  try {
    source = await readFile(settingsPath, 'utf-8');
  } catch {
    return { removed: 0, failed: 1 };
  }

  let settings: Record<string, unknown>;
  try {
    const parsed = JSON.parse(source) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { removed: 0, failed: 1 };
    }
    settings = parsed as Record<string, unknown>;
  } catch {
    return { removed: 0, failed: 1 };
  }

  const existingHooks = settings.hooks as Record<string, unknown> | undefined;
  const existingPreToolUse = existingHooks?.PreToolUse;
  if (!existingHooks || !Array.isArray(existingPreToolUse)) {
    return { removed: 0, failed: 0 };
  }

  let removed = 0;
  const filtered = existingPreToolUse.map((group) => {
    if (!group || typeof group !== 'object') return group;
    const record = group as Record<string, unknown>;
    if (!Array.isArray(record.hooks)) return record;
    const handlers = record.hooks.filter((handler) => {
      const command =
        handler && typeof handler === 'object'
          ? (handler as Record<string, unknown>).command
          : undefined;
      const managed = isManagedHookCommand(command, scriptRelPaths);
      if (managed) removed++;
      return !managed;
    });
    return { ...record, hooks: handlers };
  });

  if (removed === 0) return { removed: 0, failed: 0 };
  existingHooks.PreToolUse = filtered;
  try {
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  } catch {
    return { removed: 0, failed: 1 };
  }
  return { removed, failed: 0 };
}

async function readSettingsJsonObject(
  settingsPath: string,
  platformName: string,
): Promise<Record<string, unknown>> {
  const result = await readJsonObjectFile(settingsPath);
  if (result.status === 'missing') return {};
  if (result.status === 'present') return result.value;
  throw new Error(`Invalid ${platformName} settings at ${settingsPath}: ${result.error.message}`, {
    cause: result.error,
  });
}

/**
 * Claude-shaped JSON format used by Claude Code, Codex, and Amazon Q.
 * Defaults to settings.local.json; platform metadata may override the filename.
 */
async function installClaudeCodeHooks(
  baseDir: string,
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
  configFile: string,
  platformName: string,
  context: HookCommandContext,
): Promise<HookInstallResult> {
  const settingsPath = path.join(platformBase, configFile);

  // Claude Code format: { matcher, hooks: [{ type: "command", command }] }
  interface ClaudeCodeHookEntry {
    matcher: string;
    hooks: Array<{ type: string; command: string }>;
  }

  // Group by matcher so hooks sharing the same matcher are merged
  const matcherGroups: Record<string, Array<{ type: string; command: string }>> = {};
  for (const [scriptRelPath, config] of Object.entries(hooksConfig)) {
    const command = buildHookCommand(baseDir, skillsDir, scriptRelPath, context);
    if (!matcherGroups[config.matcher]) {
      matcherGroups[config.matcher] = [];
    }
    matcherGroups[config.matcher].push({ type: 'command', command });
  }

  const newEntries: ClaudeCodeHookEntry[] = Object.entries(matcherGroups).map(
    ([matcher, hooks]) => ({ matcher, hooks }),
  );

  const settings = await readSettingsJsonObject(settingsPath, platformName);

  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  const existingPreToolUse = asHookGroup(existingHooks.PreToolUse);
  const merged = mergeHookGroups(
    existingPreToolUse,
    newEntries,
    managedHookScriptPaths(hooksConfig),
  );

  settings.hooks = { ...existingHooks, PreToolUse: merged };
  await ensureDir(path.dirname(settingsPath));
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { status: 'installed' };
}

/**
 * Qwen Code / Qoder / CodeBuddy format:
 * Writes to settings.json with { hooks: { PreToolUse: [{ matcher, hooks: [{ type, command }] }] } }
 */
async function installQwenStyleHooks(
  baseDir: string,
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
  platformName: string,
  context: HookCommandContext,
): Promise<HookInstallResult> {
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
      command: buildHookCommand(baseDir, skillsDir, scriptRelPath, context),
      description: config.description,
    });
  }

  const preToolUseEntries = Object.entries(matcherGroups).map(([matcher, hooks]) => ({
    matcher,
    hooks,
  }));

  const settings = await readSettingsJsonObject(settingsPath, platformName);

  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  const existingPreToolUse = asHookGroup(existingHooks.PreToolUse);
  const merged = mergeHookGroups(
    existingPreToolUse,
    preToolUseEntries,
    managedHookScriptPaths(hooksConfig),
  );

  settings.hooks = { ...existingHooks, PreToolUse: merged };
  await ensureDir(path.dirname(settingsPath));
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { status: 'installed' };
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
  platformName: string,
  context: HookCommandContext,
): Promise<HookInstallResult> {
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
          command: buildHookCommand(baseDir, skillsDir, scriptRelPath, context),
          name: config.description,
        },
      ],
    });
  }

  const settings = await readSettingsJsonObject(settingsPath, platformName);

  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  const existingBeforeTool = asHookGroup(existingHooks.BeforeTool);
  const merged = mergeHookGroups(existingBeforeTool, entries, managedHookScriptPaths(hooksConfig));

  settings.hooks = { ...existingHooks, BeforeTool: merged };
  await ensureDir(path.dirname(settingsPath));
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { status: 'installed' };
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
  platformName: string,
  context: HookCommandContext,
): Promise<HookInstallResult> {
  const hooksPath = path.join(platformBase, 'hooks.json');

  const entries: Array<{ command: string; show_output: boolean }> = [];
  for (const [scriptRelPath] of Object.entries(hooksConfig)) {
    entries.push({
      command: buildHookCommand(baseDir, skillsDir, scriptRelPath, context),
      show_output: true,
    });
  }

  const hooksFile = await readSettingsJsonObject(hooksPath, platformName);

  const existingHooks = (hooksFile.hooks as Record<string, unknown>) ?? {};
  const existingPreWrite = asHookGroup(existingHooks.pre_write_code);
  const merged = existingPreWrite.filter((entry) => {
    const command =
      entry && typeof entry === 'object' ? (entry as Record<string, unknown>).command : undefined;
    return !isManagedHookCommand(command, managedHookScriptPaths(hooksConfig));
  });
  merged.push(...entries);

  hooksFile.hooks = { ...existingHooks, pre_write_code: merged };
  await ensureDir(path.dirname(hooksPath));
  await writeFile(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n', 'utf-8');
  return { status: 'installed' };
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
  context: HookCommandContext,
): Promise<HookInstallResult> {
  const hooksDir = path.join(platformBase, 'hooks');
  const hookFilePath = path.join(hooksDir, 'comet-guard.json');

  const scriptEntries: Array<{ matcher: string; bash: string; powershell: string }> = [];
  for (const [scriptRelPath, config] of Object.entries(hooksConfig)) {
    const cmd = buildHookCommand(baseDir, skillsDir, scriptRelPath, context);
    const matcher =
      config.matcher === 'Write|Edit'
        ? 'create|edit|str_replace_editor|apply_patch'
        : config.matcher;
    // Hook runs through node on every platform; both fields use the same command
    scriptEntries.push({ matcher, bash: cmd, powershell: cmd });
  }

  const hookConfig = {
    version: 1,
    hooks: {
      preToolUse: scriptEntries,
    },
  };

  await ensureDir(hooksDir);
  await writeFile(hookFilePath, JSON.stringify(hookConfig, null, 2) + '\n', 'utf-8');
  return { status: 'installed' };
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
  context: HookCommandContext,
): Promise<HookInstallResult> {
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
        command: buildHookCommand(baseDir, skillsDir, scriptRelPath, context),
      },
    };

    await ensureDir(hooksDir);
    await writeFile(hookFilePath, JSON.stringify(hookConfig, null, 2) + '\n', 'utf-8');
  }

  for (const legacyScript of LEGACY_HOOK_SCRIPTS) {
    const legacyFile = path.join(
      hooksDir,
      path.basename(legacyScript).replace(/\.mjs$/u, '.kiro.hook'),
    );
    await rm(legacyFile, { force: true });
  }

  return { status: 'installed' };
}

type ManagedConfigField = {
  key: string;
  def: string;
  comment: string;
};

type ManagedConfigFields = {
  top: readonly ManagedConfigField[];
  native: readonly ManagedConfigField[];
  classic: readonly ManagedConfigField[];
};

function managedConfigFields(language: string = 'en'): ManagedConfigFields {
  const artifactLanguage = resolveArtifactLanguage(language);
  const commentLanguage = artifactLanguage.id === 'zh-CN' ? 'zh-CN' : 'en';
  const top: ManagedConfigField[] = [
    {
      key: 'ambient_resume',
      def: 'true',
      comment: projectConfigComment('ambient_resume', commentLanguage),
    },
  ];
  const classic: ManagedConfigField[] = [
    {
      key: 'language',
      def: artifactLanguage.id,
      comment: projectConfigComment('classic.language', commentLanguage),
    },
    {
      key: 'context_compression',
      def: 'off',
      comment: projectConfigComment('classic.context_compression', commentLanguage),
    },
    {
      key: 'review_mode',
      def: 'standard',
      comment: projectConfigComment('classic.review_mode', commentLanguage),
    },
    {
      key: 'auto_transition',
      def: 'true',
      comment: projectConfigComment('classic.auto_transition', commentLanguage),
    },
  ];
  const native: ManagedConfigField[] = [
    {
      key: 'clarification_mode',
      def: 'sequential',
      comment: projectConfigComment('native.clarification_mode', commentLanguage),
    },
  ];
  return { top, native, classic };
}

const MANAGED_CONFIG_FIELDS = managedConfigFields();

function getManagedConfigFields(language: string = 'en'): ManagedConfigFields {
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

// Coerce the string forms captured by `parseProjectConfigOverrides` back into YAML scalars
// so booleans render as bare true/false rather than quoted strings.
function coerceConfigScalar(raw: unknown): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return raw;
}

// `language` is null when the caller has no definitive language selection to assert (e.g.
// multiple platforms in the same scope disagree and no --language flag was given) — in that
// case the existing config's language is preserved, falling back to 'en' only when absent.
// A non-null language always overwrites the managed `classic.language` field: init/update
// pass it specifically to persist the language the user just selected/installed.
function renderProjectConfig(
  existing: Record<string, string>,
  language: string | null = null,
): string {
  const resolvedLanguage = language ?? existing.language ?? 'en';
  const fields = getManagedConfigFields(resolvedLanguage);
  const managedKeys = new Set<string>([
    ...fields.top.map((f) => f.key),
    ...fields.classic.map((f) => f.key),
  ]);
  const root: Record<string, unknown> = {};
  for (const f of fields.top) {
    root[f.key] = coerceConfigScalar(existing[f.key] ?? f.def);
  }
  for (const [k, v] of Object.entries(existing)) {
    if (!managedKeys.has(k)) root[k] = coerceConfigScalar(v);
  }
  const classicBlock: Record<string, unknown> = {};
  for (const f of fields.classic) {
    const value = f.key === 'language' ? resolvedLanguage : (existing[f.key] ?? f.def);
    classicBlock[f.key] = coerceConfigScalar(value);
  }
  root.classic = classicBlock;
  return renderStructuredProjectConfig(root, resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en');
}

async function mergeProjectConfig(
  projectPath: string,
  language: string | null = null,
): Promise<void> {
  const configPath = path.join(projectPath, '.comet', 'config.yaml');
  let existing: Record<string, string> = {};
  let existingSource = '';
  if (await fileExists(configPath)) {
    existingSource = await readFile(configPath, 'utf-8');
    existing = parseProjectConfigOverrides(existingSource);
  }
  await ensureDir(path.dirname(configPath));

  // Preserve the full parsed structure (e.g. the `native:` block) plus any legacy top-level
  // Classic fields pending migration. Falling back to an empty mapping keeps this idempotent
  // for a missing or unparseable config.
  const document = parseDocument(existingSource, { uniqueKeys: false });
  const parsedRoot = document.errors.length === 0 ? document.toJS() : null;
  const root: Record<string, unknown> =
    parsedRoot && typeof parsedRoot === 'object' && !Array.isArray(parsedRoot)
      ? { ...(parsedRoot as Record<string, unknown>) }
      : {};
  const prevClassic =
    root.classic && typeof root.classic === 'object' && !Array.isArray(root.classic)
      ? { ...(root.classic as Record<string, unknown>) }
      : {};
  const prevNative =
    root.native && typeof root.native === 'object' && !Array.isArray(root.native)
      ? { ...(root.native as Record<string, unknown>) }
      : null;
  const existingClassicLanguage =
    typeof prevClassic.language === 'string' ? prevClassic.language : undefined;
  const resolvedLanguage = language ?? existingClassicLanguage ?? existing.language ?? 'en';
  const fields = getManagedConfigFields(resolvedLanguage);

  // Top-level managed field (ambient_resume).
  for (const f of fields.top) {
    root[f.key] = coerceConfigScalar(existing[f.key] ?? f.def);
  }

  // Native settings are managed only when the project already has a Native block. This lets
  // update add new Native defaults without activating Native in Classic-only installations.
  if (prevNative) {
    const nativeBlock = { ...prevNative };
    for (const f of fields.native) {
      const value = nativeBlock[f.key] ?? f.def;
      if (f.key === 'clarification_mode' && value !== 'sequential' && value !== 'batch') {
        throw new Error('native.clarification_mode must be sequential or batch');
      }
      nativeBlock[f.key] = coerceConfigScalar(value);
    }
    root.native = nativeBlock;
  }

  // Classic block: preserve explicit new-format values, then migrate legacy top-level values,
  // then apply defaults. An explicit language argument still represents the caller's requested
  // install/update language and therefore overrides both stored forms.
  const classicBlock: Record<string, unknown> = {};
  for (const f of fields.classic) {
    let value: unknown;
    if (f.key === 'language') {
      value = resolvedLanguage;
    } else {
      const legacyTop = root[f.key];
      if (prevClassic[f.key] !== undefined) value = prevClassic[f.key];
      else if (legacyTop !== undefined) value = legacyTop;
      else value = f.def;
    }
    classicBlock[f.key] = coerceConfigScalar(value);
  }
  // Remove migrated legacy top-level Classic fields so they don't linger at the root.
  for (const f of fields.classic) {
    delete root[f.key];
  }
  root.classic = classicBlock;

  await writeFile(
    configPath,
    renderStructuredProjectConfig(root, resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en'),
    'utf-8',
  );
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
  await installCometProjectInstructions(projectPath, language === 'zh-CN' ? 'zh' : 'en');
}

export {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  readManifest,
  getManagedSkillPaths,
  getManagedSkillPathsForSelection,
  getManifestSkills,
  getUserFacingSkillNames,
  createWorkingDirs,
  getAssetsDir,
  computeRuleDestPath,
  formatRuleContent,
  isManagedHookCommand,
  buildHookCommand,
  removeManagedHooksFromJsonFile,
  planSkillDirectoryCopy,
  mergeProjectConfig,
  parseProjectConfigOverrides,
  renderProjectConfig,
  getCentralSkillsDir,
  installSkillsAsSymlink,
  prepareManagedSkillCopyTarget,
  prepareNativeSkillInstallTarget,
};
export type { Manifest, LanguageConfig, PlannedSkillFile, PlannedSkillSourceFile };
