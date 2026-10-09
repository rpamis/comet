import os from 'node:os';
import path from 'node:path';
import { getPlatformSkillsDir, PLATFORMS } from '../install/platforms.js';
import { resolvePlatformTarget } from '../install/platform-targets.js';

export function workflowApplicationPlatforms(ids: readonly string[]): string[] {
  const requested = ids.includes('all')
    ? [...ids.filter((id) => id !== 'all'), ...PLATFORMS.map(({ id }) => id)]
    : ids;
  return [
    ...new Set(
      requested.map((id) => {
        const target = resolvePlatformTarget(id, 'project');
        if (!target.native) throw new Error(`未知平台：${id}；请选择 Comet 已支持的平台`);
        return target.platform.id;
      }),
    ),
  ];
}

export function workflowApplicationPlatformInfo(id: string) {
  const platform = PLATFORMS.find((platform) => platform.id === id);
  if (!platform) throw new Error(`未知平台：${id}`);
  return {
    id: platform.id,
    name: platform.name,
    rulesSupported: Boolean(platform.rulesFormat),
    hooksSupported: platform.id === 'codex' || Boolean(platform.supportsHooks),
  };
}

export function workflowApplicationSkillsRoot(options: {
  projectRoot: string;
  scope: 'project' | 'user';
  userRoot?: string;
  platform?: string;
  host?: 'codex' | 'claude-code';
}): string {
  const id = options.platform ?? (options.host === 'claude-code' ? 'claude' : options.host);
  const platform = PLATFORMS.find((platform) => platform.id === id);
  if (!platform) throw new Error(`未知平台：${id ?? ''}`);
  const scope = options.scope === 'project' ? 'project' : 'global';
  // 显式 userRoot 用于隔离安装，不借用真实 HOME 或 DSH_HOME。
  const skillsDir =
    platform.id === 'dsh' &&
    scope === 'global' &&
    options.userRoot &&
    path.resolve(options.userRoot) !== path.resolve(os.homedir())
      ? (platform.globalSkillsDir ?? platform.skillsDir)
      : getPlatformSkillsDir(platform, scope);
  return path.join(
    options.scope === 'project' ? options.projectRoot : (options.userRoot ?? os.homedir()),
    skillsDir,
    'skills',
  );
}
