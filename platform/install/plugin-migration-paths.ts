import path from 'node:path';
import { promises as fs } from 'node:fs';
import { PLATFORMS, getPlatformConfigDir, getPlatformSkillsDirs } from './platforms.js';

export interface PluginMigrationArea {
  root: string;
  skills: string[];
  hooks: string[];
  rules: string[];
  instruction?: string;
}

/** 只检查当前工作区的发现链和用户目录，不递归扫描磁盘上的其他项目。 */
export async function pluginMigrationAreas(options: {
  platform: 'codex' | 'dsh';
  homeDir: string;
  configRoot: string;
  projectPath?: string;
}): Promise<PluginMigrationArea[]> {
  const platform = PLATFORMS.find((p) => p.id === options.platform)!;
  const makeArea = (root: string, global = false): PluginMigrationArea => {
    const config = global
      ? options.configRoot
      : path.join(root, getPlatformConfigDir(platform, 'project'));
    return {
      root,
      skills: global
        ? options.platform === 'codex'
          ? [path.join(root, '.agents/skills'), path.join(config, 'skills')]
          : [path.join(config, 'skills')]
        : getPlatformSkillsDirs(platform, 'project').map((dir) => path.join(root, dir, 'skills')),
      hooks: [
        path.join(config, 'hooks.json'),
        ...(options.platform === 'codex' ? [path.join(config, 'settings.local.json')] : []),
      ],
      rules:
        options.platform === 'codex'
          ? ['comet-workflow-guard', 'comet-phase-guard', 'comet-native-phase-guard'].map((name) =>
              path.join(config, 'rules', name + '.md'),
            )
          : [],
      ...(options.platform === 'dsh'
        ? {
            instruction: global
              ? path.join(config, 'AGENTS.md')
              : path.join(root, 'AGENTS.local.md'),
          }
        : {}),
    };
  };
  const areas = [makeArea(path.resolve(options.homeDir), true)];
  if (!options.projectPath) return areas;
  let cursor = path.resolve(options.projectPath);
  const ancestors: string[] = [];
  let foundRoot = false;
  while (cursor !== path.parse(cursor).root) {
    ancestors.push(cursor);
    if (await fs.lstat(path.join(cursor, '.git')).catch(() => null)) {
      foundRoot = true;
      break;
    }
    cursor = path.dirname(cursor);
  }
  for (const root of foundRoot ? ancestors : ancestors.slice(0, 1)) {
    if (root !== path.resolve(options.homeDir)) areas.push(makeArea(root));
  }
  return areas;
}
