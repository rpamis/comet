import path from 'path';
import os from 'os';

import { fileExists, readDir, readJson } from '../utils/file-system.js';
import { PLATFORMS, getPlatformSkillsDirs, type Platform } from './platforms.js';

import type { InstallScope } from './types.js';

const SUPERPOWERS_SKILLS = [
  'brainstorming',
  'using-superpowers',
  'writing-plans',
  'test-driven-development',
  'subagent-driven-development',
];

async function hasSuperpowersInPluginCache(pluginsCacheDir: string): Promise<boolean> {
  const marketplaceEntries = await readDir(pluginsCacheDir);
  for (const marketplace of marketplaceEntries) {
    const superpowersDir = path.join(pluginsCacheDir, marketplace, 'superpowers');
    if (!(await fileExists(superpowersDir))) continue;

    const versionEntries = await readDir(superpowersDir);
    for (const version of versionEntries) {
      const skillsDir = path.join(superpowersDir, version, 'skills');
      const skills = await readDir(skillsDir);
      if (SUPERPOWERS_SKILLS.some((name) => skills.includes(name))) {
        return true;
      }
    }
  }

  return false;
}

function getBaseDir(scope: InstallScope, projectPath: string): string {
  return scope === 'global' ? os.homedir() : projectPath;
}

/**
 * Check if superpowers are installed via Claude Code plugin system.
 * Looks in ~/.claude/plugins/cache/{marketplace}/superpowers/{version}/skills/
 */
async function hasPluginSuperpowers(): Promise<boolean> {
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
  const pluginsCacheDir = path.join(claudeDir, 'plugins', 'cache');

  return hasSuperpowersInPluginCache(pluginsCacheDir);
}

/**
 * Check if superpowers are installed via Codex plugin system.
 * Looks in ~/.codex/plugins/cache/{marketplace}/superpowers/{version}/skills/
 */
async function hasCodexPluginSuperpowers(): Promise<boolean> {
  const codexDir =
    process.env.CODEX_HOME || process.env.CODEX_CONFIG_DIR || path.join(os.homedir(), '.codex');
  const pluginsCacheDir = path.join(codexDir, 'plugins', 'cache');

  return hasSuperpowersInPluginCache(pluginsCacheDir);
}

/**
 * Check if superpowers are installed via OpenCode plugin system.
 * Checks multiple locations:
 * 1. ~/.config/opencode/superpowers/skills/ — plugin source directory
 * 2. ~/.config/opencode/opencode.json — plugin config with superpowers entry
 */
async function hasOpenCodePluginSuperpowers(): Promise<boolean> {
  const opencodeDir =
    process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');

  // Check plugin source directory: ~/.config/opencode/superpowers/skills/
  const pluginSkillsDir = path.join(opencodeDir, 'superpowers', 'skills');
  if (await fileExists(pluginSkillsDir)) {
    const skills = await readDir(pluginSkillsDir);
    if (SUPERPOWERS_SKILLS.some((name) => skills.includes(name))) {
      return true;
    }
  }

  // Check opencode.json config for superpowers plugin entry
  const configPath = path.join(opencodeDir, 'opencode.json');
  if (await fileExists(configPath)) {
    try {
      const config = (await readJson(configPath)) as Record<string, unknown>;
      const plugins = config.plugin;
      if (Array.isArray(plugins)) {
        if (plugins.some((entry) => typeof entry === 'string' && entry.includes('superpowers'))) {
          return true;
        }
      }
    } catch {
      // Invalid JSON or unreadable — skip
    }
  }

  return false;
}

async function hasOpenCodeCometCommands(baseDir: string, skillsDir: string, entries: string[]) {
  const cometEntries = entries.filter((entry) => entry.startsWith('comet'));
  if (cometEntries.length === 0) return false;

  const commandsDir = path.join(baseDir, skillsDir, 'commands');
  const commandEntries = await readDir(commandsDir);
  return cometEntries.every((entry) => commandEntries.includes(`${entry}.md`));
}

async function detectPlatforms(projectPath: string): Promise<Set<string>> {
  const detected = new Set<string>();

  for (const platform of PLATFORMS) {
    if (platform.detectionPaths && platform.detectionPaths.length > 0) {
      for (const p of platform.detectionPaths) {
        if (await fileExists(path.join(projectPath, p))) {
          detected.add(platform.id);
          break;
        }
      }
    } else {
      for (const skillsDir of getPlatformSkillsDirs(platform, 'project')) {
        const dirPath = path.join(projectPath, skillsDir);
        if (await fileExists(dirPath)) {
          detected.add(platform.id);
          break;
        }
      }
    }
  }

  return detected;
}

async function hasSkills(
  baseDir: string,
  platform: Platform,
  component: 'openspec' | 'superpowers' | 'comet',
  _selectedPlatforms: Platform[] = [],
  scope: InstallScope = 'project',
): Promise<boolean> {
  const skillDirEntries = await Promise.all(
    getPlatformSkillsDirs(platform, scope).map(async (skillsDir) => {
      const fullPath = path.join(baseDir, skillsDir, 'skills');
      return {
        skillsDir,
        entries: (await fileExists(fullPath)) ? await readDir(fullPath) : [],
      };
    }),
  );
  const entries = skillDirEntries.flatMap((dir) => dir.entries);

  switch (component) {
    case 'openspec':
      if (entries.some((e) => e.startsWith('openspec-'))) return true;
      break;
    case 'superpowers':
      if (SUPERPOWERS_SKILLS.some((name) => entries.includes(name))) return true;
      break;
    case 'comet':
      if (platform.id === 'opencode') {
        for (const dir of skillDirEntries) {
          if (await hasOpenCodeCometCommands(baseDir, dir.skillsDir, dir.entries)) return true;
        }
        break;
      }
      if (entries.some((e) => e.startsWith('comet'))) return true;
      break;
  }

  if (scope === 'project' && baseDir !== os.homedir()) {
    const globalSkillDirEntries = await Promise.all(
      getPlatformSkillsDirs(platform, 'global').map(async (skillsDir) => {
        const fullPath = path.join(os.homedir(), skillsDir, 'skills');
        return {
          skillsDir,
          entries: (await fileExists(fullPath)) ? await readDir(fullPath) : [],
        };
      }),
    );
    const globalEntries = globalSkillDirEntries.flatMap((dir) => dir.entries);

    switch (component) {
      case 'openspec':
        if (globalEntries.some((e) => e.startsWith('openspec-'))) return true;
        break;
      case 'superpowers':
        if (SUPERPOWERS_SKILLS.some((name) => globalEntries.includes(name))) return true;
        break;
      case 'comet':
        if (platform.id === 'opencode') {
          for (const dir of globalSkillDirEntries) {
            if (await hasOpenCodeCometCommands(os.homedir(), dir.skillsDir, dir.entries)) {
              return true;
            }
          }
          break;
        }
        if (globalEntries.some((e) => e.startsWith('comet'))) return true;
        break;
    }
  }

  // Check Claude Code plugin cache for plugin-installed superpowers
  if (component === 'superpowers' && platform.id === 'claude') {
    if (await hasPluginSuperpowers()) return true;
  }

  // Check Codex plugin cache for plugin-installed superpowers
  if (component === 'superpowers' && platform.id === 'codex') {
    if (await hasCodexPluginSuperpowers()) return true;
  }

  // Check OpenCode plugin system for plugin-installed superpowers
  if (component === 'superpowers' && platform.id === 'opencode') {
    if (await hasOpenCodePluginSuperpowers()) return true;
  }

  return false;
}

export {
  detectPlatforms,
  hasSkills,
  hasPluginSuperpowers,
  hasCodexPluginSuperpowers,
  hasOpenCodePluginSuperpowers,
  getBaseDir,
};
export type { InstallScope };
