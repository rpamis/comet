import path from 'path';

import { fileExists } from '../fs/file-system.js';
import { hasPlatformDetectionPath } from './detect.js';
import {
  PLATFORMS,
  getPlatformConfigDir,
  getPlatformSkillsDir,
  type Platform,
} from './platforms.js';
import type { InstallScope } from './types.js';

export interface CanonicalSkillRootOwner {
  platform: Platform;
  canonicalSkillsDir: string;
  hasOwnershipEvidence: boolean;
  sharedCanonicalRoot: boolean;
}

interface ResolveCanonicalSkillRootOwnersOptions {
  respectDetectionPaths?: boolean;
}

async function hasOwnershipEvidence(
  baseDir: string,
  platform: Platform,
  scope: InstallScope,
  canonicalSkillsDir: string,
): Promise<boolean> {
  if (platform.detectionPaths?.length && (await hasPlatformDetectionPath(baseDir, platform))) {
    return true;
  }

  const configDir = getPlatformConfigDir(platform, scope);
  return configDir !== canonicalSkillsDir && (await fileExists(path.join(baseDir, configDir)));
}

/** Resolve exactly one platform owner for every canonical Skill root. */
export async function resolveCanonicalSkillRootOwners(
  baseDir: string,
  scope: InstallScope,
  options: ResolveCanonicalSkillRootOwnersOptions = {},
): Promise<CanonicalSkillRootOwner[]> {
  const groups = new Map<string, { canonicalSkillsDir: string; platforms: Platform[] }>();
  for (const platform of PLATFORMS) {
    const canonicalSkillsDir = getPlatformSkillsDir(platform, scope);
    const key = path.resolve(baseDir, canonicalSkillsDir).toLowerCase();
    const group = groups.get(key) ?? { canonicalSkillsDir, platforms: [] };
    group.platforms.push(platform);
    groups.set(key, group);
  }

  const owners: CanonicalSkillRootOwner[] = [];
  for (const { canonicalSkillsDir, platforms } of groups.values()) {
    if (platforms.length === 1) {
      const [platform] = platforms;
      if (options.respectDetectionPaths === false) {
        owners.push({
          platform,
          canonicalSkillsDir,
          hasOwnershipEvidence: false,
          sharedCanonicalRoot: false,
        });
        continue;
      }
      const detected = await hasPlatformDetectionPath(baseDir, platform);
      if (!detected) continue;
      owners.push({
        platform,
        canonicalSkillsDir,
        hasOwnershipEvidence: true,
        sharedCanonicalRoot: false,
      });
      continue;
    }

    let owner: Platform | undefined;
    for (const platform of platforms) {
      if (await hasOwnershipEvidence(baseDir, platform, scope, canonicalSkillsDir)) {
        owner = platform;
        break;
      }
    }

    const hasEvidence = owner !== undefined;
    owner ??= platforms.find((platform) => !platform.detectionPaths?.length);
    if (!owner && options.respectDetectionPaths === false) owner = platforms[0];
    if (owner) {
      owners.push({
        platform: owner,
        canonicalSkillsDir,
        hasOwnershipEvidence: hasEvidence,
        sharedCanonicalRoot: true,
      });
    }
  }

  return owners;
}
