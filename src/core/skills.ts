import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import { fileURLToPath } from 'url';

import { fileExists, readJson, copyFile, ensureDir } from '../utils/file-system.js';
import { getPlatformSkillsDir, type Platform } from './platforms.js';
import type { InstallScope } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type LanguageConfig = {
  id: string;
  name: string;
  skillsDir: string;
};

type HookConfig = {
  matcher: string;
  description: string;
};

type Manifest = {
  version: string;
  skills: string[];
  rules?: string[];
  hooks?: Record<string, HookConfig>;
  languages?: LanguageConfig[];
};

const OPENCODE_COMMAND_HEADER = `---
description: Run the {skillName} Comet workflow
---
`;

function getAssetsDir(): string {
  return path.resolve(__dirname, '..', '..', 'assets');
}

async function copyCometSkillsForPlatform(
  baseDir: string,
  platform: Platform,
  overwrite: boolean,
  languageSkillsDir: string = 'skills',
  scope: InstallScope = 'project',
): Promise<{ copied: number; skipped: number }> {
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

  for (const skillRelPath of manifest.skills) {
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
      console.error(`    Failed to copy ${skillRelPath}: ${(err as Error).message}`);
    }
  }

  if (platform.id === 'opencode') {
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

  return { copied, skipped: skippedCount };
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
  return manifest.skills;
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
        return installClaudeCodeHooks(platformBase, skillsDir, hooksConfig);
      case 'qwen':
      case 'qoder':
        return installQwenStyleHooks(platformBase, skillsDir, hooksConfig, hookFormat);
      case 'gemini':
        return installGeminiHooks(platformBase, skillsDir, hooksConfig);
      case 'windsurf':
        return installWindsurfHooks(platformBase, skillsDir, hooksConfig);
      case 'copilot':
        return installCopilotHooks(platformBase, skillsDir, hooksConfig);
      case 'kiro':
        return installKiroHooks(platformBase, skillsDir, hooksConfig);
      default:
        return { installed: false, reason: `unsupported hook format: ${hookFormat}` };
    }
  } catch (err) {
    return { installed: false, reason: (err as Error).message };
  }
}

/** Build the command path for a hook script given its manifest rel path and skillsDir */
function buildHookCommand(skillsDir: string, scriptRelPath: string): string {
  return `bash ${skillsDir}/skills/${scriptRelPath}`;
}

/**
 * Claude Code, Codex, Amazon Q format:
 * Writes to settings.local.json with { hooks: { PreToolUse: [...] } }
 */
async function installClaudeCodeHooks(
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
    const command = buildHookCommand(skillsDir, scriptRelPath);
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
  const existingPreToolUse = (existingHooks.PreToolUse as ClaudeCodeHookEntry[]) ?? [];

  // Deduplicate by matcher — replace existing entries with the same matcher
  const matchersSeen = new Set<string>();
  const merged: ClaudeCodeHookEntry[] = [];
  for (const entry of [...newEntries, ...existingPreToolUse]) {
    if (!matchersSeen.has(entry.matcher)) {
      matchersSeen.add(entry.matcher);
      merged.push(entry);
    }
  }

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
      command: buildHookCommand(skillsDir, scriptRelPath),
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
  const existingPreToolUse = (existingHooks.PreToolUse as Array<Record<string, unknown>>) ?? [];

  // Add entries that don't already exist (match by description in nested hooks)
  const existingDescs = new Set(
    existingPreToolUse.flatMap(
      (g) =>
        ((g as Record<string, unknown>).hooks as Array<Record<string, string>>)?.map(
          (h) => h.description,
        ) ?? [],
    ),
  );
  for (const entry of preToolUseEntries) {
    const hasNew = entry.hooks.some((h) => !existingDescs.has(h.description));
    if (hasNew) {
      existingPreToolUse.push(entry as unknown as Record<string, unknown>);
    }
  }

  settings.hooks = { ...existingHooks, PreToolUse: existingPreToolUse };
  await ensureDir(path.dirname(settingsPath));
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { installed: true };
}

/**
 * Gemini CLI format:
 * Writes to .gemini/settings.json with { hooks: { BeforeTool: [{ matcher, hooks: [{ type, command }] }] } }
 */
async function installGeminiHooks(
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
          command: buildHookCommand(skillsDir, scriptRelPath),
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
  const existingBeforeTool = (existingHooks.BeforeTool as Array<Record<string, unknown>>) ?? [];
  const existingNames = new Set(
    existingBeforeTool.flatMap(
      (g) =>
        ((g as Record<string, unknown>).hooks as Array<Record<string, string>>)?.map(
          (h) => h.name,
        ) ?? [],
    ),
  );

  for (const entry of entries) {
    const hasNew = entry.hooks.some((h) => !existingNames.has(h.name));
    if (hasNew) {
      existingBeforeTool.push(entry as unknown as Record<string, unknown>);
    }
  }

  settings.hooks = { ...existingHooks, BeforeTool: existingBeforeTool };
  await ensureDir(path.dirname(settingsPath));
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  return { installed: true };
}

/**
 * Windsurf format:
 * Writes to .windsurf/hooks.json with { hooks: { pre_write_code: [{ command }] } }
 */
async function installWindsurfHooks(
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
): Promise<{ installed: boolean; reason?: string }> {
  const hooksPath = path.join(platformBase, 'hooks.json');

  const entries: Array<{ command: string; show_output: boolean }> = [];
  for (const [scriptRelPath, config] of Object.entries(hooksConfig)) {
    entries.push({
      command: buildHookCommand(skillsDir, scriptRelPath),
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
  const existingPreWrite = (existingHooks.pre_write_code as Array<Record<string, unknown>>) ?? [];

  // Add entries that don't already exist (match by command substring)
  const existingCmds = new Set(
    existingPreWrite.map((e) => (e as Record<string, string>).command ?? ''),
  );
  for (const entry of entries) {
    if (!existingCmds.has(entry.command)) {
      existingPreWrite.push(entry as unknown as Record<string, unknown>);
    }
  }

  hooksFile.hooks = { ...existingHooks, pre_write_code: existingPreWrite };
  await ensureDir(path.dirname(hooksPath));
  await writeFile(hooksPath, JSON.stringify(hooksFile, null, 2) + '\n', 'utf-8');
  return { installed: true };
}

/**
 * GitHub Copilot format:
 * Writes to .github/hooks/comet-guard.json with preToolUse hooks config.
 */
async function installCopilotHooks(
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
): Promise<{ installed: boolean; reason?: string }> {
  const hooksDir = path.join(platformBase, 'hooks');
  const hookFilePath = path.join(hooksDir, 'comet-guard.json');

  const scriptEntries: Array<{ bash: string; powershell: string }> = [];
  for (const [scriptRelPath] of Object.entries(hooksConfig)) {
    const cmd = buildHookCommand(skillsDir, scriptRelPath);
    // Script requires bash; PowerShell field wraps bash invocation for Windows
    scriptEntries.push({ bash: cmd, powershell: `bash -c '${cmd}'` });
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
  platformBase: string,
  skillsDir: string,
  hooksConfig: Record<string, HookConfig>,
): Promise<{ installed: boolean; reason?: string }> {
  const hooksDir = path.join(platformBase, 'hooks');

  for (const [scriptRelPath, config] of Object.entries(hooksConfig)) {
    const hookFileName = path.basename(scriptRelPath).replace(/\.sh$/, '.kiro.hook');
    const hookFilePath = path.join(hooksDir, hookFileName);

    // Map Write|Edit matcher to Kiro's write tool category
    const kiroEvent = config.matcher === 'Write|Edit' ? 'Pre Tool Use' : 'Pre Tool Use';
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
        command: buildHookCommand(skillsDir, scriptRelPath),
      },
    };

    await ensureDir(hooksDir);
    await writeFile(hookFilePath, JSON.stringify(hookConfig, null, 2) + '\n', 'utf-8');
  }

  return { installed: true };
}

async function createWorkingDirs(projectPath: string): Promise<void> {
  const dirs = [
    path.join(projectPath, 'docs', 'superpowers', 'specs'),
    path.join(projectPath, 'docs', 'superpowers', 'plans'),
    path.join(projectPath, '.comet'),
  ];

  for (const dir of dirs) {
    await ensureDir(dir);
  }

  const configPath = path.join(projectPath, '.comet', 'config.yaml');
  if (!(await fileExists(configPath))) {
    await writeFile(configPath, 'context_compression: off\nauto_transition: true\n', 'utf-8');
  }
}

export {
  copyCometSkillsForPlatform,
  copyCometRulesForPlatform,
  installCometHooksForPlatform,
  readManifest,
  getManifestSkills,
  createWorkingDirs,
  getAssetsDir,
};
export type { Manifest, LanguageConfig };
