/**
 * Platform Definitions
 *
 * Supported AI coding platforms, mirroring OpenSpec's AI_TOOLS config.
 * Reference: OpenSpec/src/core/config.ts
 */

import os from 'os';
import path from 'path';

import type { InstallScope } from './types.js';

export interface Platform {
  id: string;
  name: string;
  skillsDir: string;
  globalSkillsDir?: string;
  legacySkillsDirs?: string[];
  /** Platform configuration and hook root when it differs from the Skill root. */
  configDir?: string;
  /** Global platform configuration and hook root when it differs from the global Skill root. */
  globalConfigDir?: string;
  /** Historical platform configuration and hook roots checked during migration and uninstall. */
  legacyConfigDirs?: string[];
  detectionPaths?: string[];
  openspecToolId: string;
  /** OpenSpec's generated tool root when it differs from Comet's canonical Skill root. */
  openspecSkillsDir?: string;
  /**
   * When set, OpenSpec output for `openspecToolId` is copied into this
   * platform's Skill root. The generator platform's root is written only
   * when that platform was also selected.
   */
  openspecMirrorFrom?: string;
  /** Platform's rules/instructions subdirectory relative to rulesBaseDir (defaults to baseDir). Omit if unsupported. */
  rulesDir?: string;
  /** Override base directory for rules. When set, rules go to rulesBaseDir/rulesDir instead of skillsDir/rulesDir. Useful when rules live outside the skills config dir (e.g., Cline's .clinerules/ is at project root, not inside .cline/). */
  rulesBaseDir?: string;
  /** Rule file format: 'md' = plain markdown, 'mdc' = Cursor MDC with frontmatter, 'copilot' = GitHub Copilot instructions format, 'dsh' = managed AGENTS instruction block. */
  rulesFormat?: 'md' | 'mdc' | 'copilot' | 'dsh';
  /** Whether this platform supports PreToolUse hooks. */
  supportsHooks?: boolean;
  /** Whether a user-scoped Hook can safely discover the active project from the host request. */
  supportsGlobalHooks?: boolean;
  /** Hook configuration format. Determines how installCometHooksForPlatform writes the hook config. */
  hookFormat?:
    | 'claude-code'
    | 'gemini'
    | 'windsurf'
    | 'copilot'
    | 'qwen'
    | 'kiro'
    | 'qoder'
    | 'codebuddy'
    | 'dsh'
    | 'omp'
    | 'trae';
  /** Hook config filename relative to the platform config root when it differs from the format default. */
  hookConfigFile?: string;
  /** Historical hook config filenames checked during migration and uninstall. */
  legacyHookConfigFiles?: string[];
  /** Installed PreToolUse matcher when it differs from the portable hook descriptor. */
  hookMatcher?: string;
}

const PLATFORM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isValidPlatformId(platformId: string): boolean {
  return PLATFORM_ID_PATTERN.test(platformId);
}

export function getPlatformSkillsDir(platform: Platform, scope: InstallScope): string {
  if (platform.id === 'dsh' && scope === 'global') {
    const homeDir = path.resolve(os.homedir());
    const dshHome = getDshHome(homeDir);
    return path.relative(homeDir, dshHome) || '.';
  }
  if (scope === 'global' && platform.globalSkillsDir) {
    return platform.globalSkillsDir;
  }
  return platform.skillsDir;
}

export function getDshHome(homeDir = os.homedir()): string {
  return path.resolve(process.env.DSH_HOME || path.join(homeDir, '.dsh'));
}

export function getPlatformSkillsDirs(platform: Platform, scope: InstallScope): string[] {
  return [
    ...new Set([getPlatformSkillsDir(platform, scope), ...(platform.legacySkillsDirs ?? [])]),
  ];
}

export function getPlatformConfigDir(platform: Platform, scope: InstallScope): string {
  if (scope === 'global' && platform.globalConfigDir) {
    return platform.globalConfigDir;
  }
  return platform.configDir ?? getPlatformSkillsDir(platform, scope);
}

export function getPlatformConfigDirs(platform: Platform, scope: InstallScope): string[] {
  return [
    ...new Set([getPlatformConfigDir(platform, scope), ...(platform.legacyConfigDirs ?? [])]),
  ];
}

export function getPlatformRuleBaseDirs(platform: Platform, scope: InstallScope): string[] {
  if (platform.rulesBaseDir !== undefined) return [platform.rulesBaseDir];
  return getPlatformSkillsDirs(platform, scope);
}

export const PLATFORMS: Platform[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    skillsDir: '.claude',
    globalSkillsDir: '.claude',
    openspecToolId: 'claude',
    rulesDir: 'rules',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'claude-code',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    skillsDir: '.cursor',
    globalSkillsDir: '.cursor',
    openspecToolId: 'cursor',
    rulesDir: 'rules',
    rulesFormat: 'mdc',
  },
  {
    id: 'codex',
    name: 'Codex',
    skillsDir: '.agents',
    globalSkillsDir: '.agents',
    legacySkillsDirs: ['.codex'],
    configDir: '.codex',
    detectionPaths: ['.codex'],
    openspecToolId: 'codex',
    openspecSkillsDir: '.agents',
    rulesBaseDir: '.codex',
    rulesDir: 'rules',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'claude-code',
    hookConfigFile: 'hooks.json',
    legacyHookConfigFiles: ['settings.local.json'],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    skillsDir: '.opencode',
    globalSkillsDir: '.config/opencode',
    openspecToolId: 'opencode',
    rulesDir: 'rules',
    rulesFormat: 'md',
  },
  {
    id: 'windsurf',
    name: 'Devin Desktop (formerly Windsurf)',
    skillsDir: '.devin',
    globalSkillsDir: '.devin',
    legacySkillsDirs: ['.windsurf'],
    legacyConfigDirs: ['.windsurf'],
    openspecToolId: 'windsurf',
    rulesDir: 'rules',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'windsurf',
  },
  {
    id: 'cline',
    name: 'Cline',
    skillsDir: '.cline',
    globalSkillsDir: '.cline',
    openspecToolId: 'cline',
    // Cline rules go to .clinerules/ at project root, NOT inside .cline/
    rulesBaseDir: '',
    rulesDir: '.clinerules',
    rulesFormat: 'md',
  },
  {
    id: 'roocode',
    name: 'RooCode',
    skillsDir: '.roo',
    globalSkillsDir: '.roo',
    openspecToolId: 'roocode',
    rulesDir: 'rules',
    rulesFormat: 'md',
  },
  {
    id: 'continue',
    name: 'Continue',
    skillsDir: '.continue',
    globalSkillsDir: '.continue',
    openspecToolId: 'continue',
    rulesDir: 'rules',
    rulesFormat: 'md',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    skillsDir: '.github',
    globalSkillsDir: '.github',
    detectionPaths: [
      '.github/copilot-instructions.md',
      '.github/instructions',
      '.github/prompts',
      '.github/skills',
    ],
    openspecToolId: 'github-copilot',
    // Copilot uses .github/instructions/*.instructions.md format
    rulesDir: 'instructions',
    rulesFormat: 'copilot',
    supportsHooks: true,
    hookFormat: 'copilot',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    skillsDir: '.gemini',
    globalSkillsDir: '.gemini',
    openspecToolId: 'gemini',
    // Gemini uses GEMINI.md files, not a rules directory — no rulesDir
    supportsHooks: true,
    hookFormat: 'gemini',
  },
  {
    id: 'grok',
    name: 'Grok',
    skillsDir: '.grok',
    globalSkillsDir: '.grok',
    detectionPaths: ['.grok'],
    // OpenSpec has no grok tool; generate Codex output and mirror it into .grok.
    openspecToolId: 'codex',
    openspecMirrorFrom: 'codex',
    rulesDir: 'rules',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'claude-code',
    hookConfigFile: 'hooks/comet.json',
    hookMatcher: 'Write|Edit|write|search_replace',
  },
  {
    id: 'amazon-q',
    name: 'Amazon Q Developer',
    skillsDir: '.amazonq',
    globalSkillsDir: '.amazonq',
    openspecToolId: 'amazon-q',
    rulesDir: 'rules',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'claude-code',
  },
  {
    id: 'qwen',
    name: 'Qwen Code',
    skillsDir: '.qwen',
    globalSkillsDir: '.qwen',
    openspecToolId: 'qwen',
    rulesDir: 'rules',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'qwen',
  },
  {
    id: 'kilocode',
    name: 'Kilo Code',
    skillsDir: '.kilocode',
    globalSkillsDir: '.kilocode',
    openspecToolId: 'kilocode',
    rulesDir: 'rules',
    rulesFormat: 'md',
  },
  {
    id: 'auggie',
    name: 'Auggie (Augment CLI)',
    skillsDir: '.augment',
    globalSkillsDir: '.augment',
    openspecToolId: 'auggie',
    rulesDir: 'rules',
    rulesFormat: 'md',
  },
  {
    id: 'kiro',
    name: 'Kiro',
    skillsDir: '.kiro',
    globalSkillsDir: '.kiro',
    openspecToolId: 'kiro',
    // Kiro uses .kiro/steering/ not .kiro/rules/
    rulesDir: 'steering',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'kiro',
  },
  {
    id: 'kimicode',
    name: 'Kimi Code',
    skillsDir: '.kimi-code',
    globalSkillsDir: '.kimi-code',
    openspecToolId: 'kimi',
  },
  {
    id: 'lingma',
    name: 'Lingma',
    skillsDir: '.lingma',
    globalSkillsDir: '.lingma',
    openspecToolId: 'lingma',
    rulesDir: 'rules',
    rulesFormat: 'md',
  },
  { id: 'junie', name: 'Junie', skillsDir: '.junie', openspecToolId: 'junie' },
  {
    id: 'codebuddy',
    name: 'CodeBuddy',
    skillsDir: '.codebuddy',
    globalSkillsDir: '.codebuddy',
    openspecToolId: 'codebuddy',
    supportsHooks: true,
    hookFormat: 'codebuddy',
    rulesDir: 'rules',
    rulesFormat: 'md',
  },
  {
    id: 'workbuddy',
    name: 'WorkBuddy',
    skillsDir: '.workbuddy',
    globalSkillsDir: '.workbuddy',
    // WorkBuddy currently shares CodeBuddy's OpenSpec-compatible generated
    // Skill shape; Comet copies the generated output into .workbuddy below.
    openspecToolId: 'codebuddy',
    openspecMirrorFrom: 'codebuddy',
    supportsHooks: true,
    hookFormat: 'codebuddy',
  },
  { id: 'costrict', name: 'CoStrict', skillsDir: '.cospec', openspecToolId: 'costrict' },
  { id: 'crush', name: 'Crush', skillsDir: '.crush', openspecToolId: 'crush' },
  { id: 'factory', name: 'Factory Droid', skillsDir: '.factory', openspecToolId: 'factory' },
  { id: 'iflow', name: 'iFlow', skillsDir: '.iflow', openspecToolId: 'iflow' },
  {
    id: 'pi',
    name: 'Pi',
    skillsDir: '.pi',
    globalSkillsDir: '.pi/agent',
    openspecToolId: 'pi',
  },
  {
    id: 'oh-my-pi',
    name: 'Oh My Pi',
    skillsDir: '.omp',
    globalSkillsDir: '.omp/agent',
    openspecToolId: 'oh-my-pi',
    rulesDir: 'rules',
    // OMP reads both .md and .mdc rules. MDC gives the Comet guard an
    // explicit alwaysApply contract instead of leaving an unconditioned rule
    // in the rulebook.
    rulesFormat: 'mdc',
    supportsHooks: true,
    supportsGlobalHooks: true,
    hookFormat: 'omp',
  },
  {
    id: 'qoder',
    name: 'Qoder',
    skillsDir: '.qoder',
    globalSkillsDir: '.qoder',
    openspecToolId: 'qoder',
    rulesDir: 'rules',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'qoder',
  },
  {
    id: 'antigravity',
    name: 'Antigravity',
    skillsDir: '.agents',
    globalSkillsDir: '.gemini/antigravity',
    openspecToolId: 'antigravity',
  },
  {
    id: 'antigravity2',
    name: 'Antigravity 2.0',
    skillsDir: '.agents',
    globalSkillsDir: '.gemini/config',
    openspecToolId: 'antigravity',
  },
  { id: 'bob', name: 'Bob Shell', skillsDir: '.bob', openspecToolId: 'bob' },
  { id: 'forgecode', name: 'ForgeCode', skillsDir: '.forge', openspecToolId: 'forgecode' },
  {
    id: 'trae',
    name: 'Trae',
    skillsDir: '.trae',
    globalSkillsDir: '.trae',
    openspecToolId: 'trae',
    rulesDir: 'rules',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'trae',
  },
  {
    id: 'trae-cn',
    name: 'Trae CN',
    skillsDir: '.trae-cn',
    globalSkillsDir: '.trae-cn',
    configDir: '.trae',
    globalConfigDir: '.trae-cn',
    // OpenSpec exposes Trae as one tool id; keep Comet's CN-specific install
    // directories but reuse the supported OpenSpec Trae integration.
    openspecToolId: 'trae',
    rulesDir: 'rules',
    rulesFormat: 'md',
    supportsHooks: true,
    hookFormat: 'trae',
  },
  {
    id: 'zcode',
    name: 'ZCode',
    skillsDir: '.zcode',
    globalSkillsDir: '.zcode',
    // openspec CLI has no zcode tool id; zcode is built on opencode (it shares the
    // opencode.ai config schema), so we reuse openspec's opencode support and migrate
    // the .opencode/{skills,commands} output to .zcode/ after install.
    openspecToolId: 'opencode',
    openspecMirrorFrom: 'opencode',
    rulesDir: 'rules',
    rulesFormat: 'md',
  },
  {
    id: 'mimocode',
    name: 'MimoCode',
    skillsDir: '.mimocode',
    globalSkillsDir: '.config/mimocode',
    // MimoCode is built on OpenCode and reads the same skills/commands shape
    // from its own config directory.
    openspecToolId: 'opencode',
    openspecMirrorFrom: 'opencode',
    rulesDir: 'rules',
    rulesFormat: 'md',
  },
  {
    id: 'dsh',
    name: 'DeepSeek Harness',
    skillsDir: '.dsh',
    globalSkillsDir: '.dsh',
    // OpenSpec has no native dsh tool id. dsh consumes the Claude-shaped
    // generated Skills through its official Claude-compatible environment.
    openspecToolId: 'claude',
    rulesFormat: 'dsh',
    supportsHooks: true,
    supportsGlobalHooks: true,
    hookFormat: 'dsh',
    hookConfigFile: 'hooks.json',
  },
];

export function getOpenSpecGeneratorPlatform(toolId: string): Platform | undefined {
  return (
    PLATFORMS.find((platform) => platform.id === toolId) ??
    PLATFORMS.find((platform) => platform.openspecToolId === toolId && !platform.openspecMirrorFrom)
  );
}

export function resolveOpenSpecMirrorPlatformIds(selectedPlatformIds: readonly string[]): string[] {
  return [...new Set(selectedPlatformIds)].filter((id) => {
    const platform = PLATFORMS.find((candidate) => candidate.id === id);
    return Boolean(platform?.openspecMirrorFrom);
  });
}

export function getOpenSpecMirrorPlatforms(
  mirrorPlatformIds: readonly string[],
  generatorId: string,
): Platform[] {
  return [...new Set(mirrorPlatformIds)]
    .map((id) => PLATFORMS.find((platform) => platform.id === id))
    .filter((platform): platform is Platform =>
      Boolean(platform?.openspecMirrorFrom === generatorId),
    );
}
