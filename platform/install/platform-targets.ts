import { isValidPlatformId, PLATFORMS, type Platform } from './platforms.js';
import type { InstallScope } from './types.js';

export type PlatformTargetResolution = {
  platform: Platform;
  native: boolean;
};

export function resolvePlatformTarget(
  platformId: string,
  scope: InstallScope,
): PlatformTargetResolution {
  const normalized = platformId.trim();
  if (normalized.length === 0) {
    throw new Error('--platform must be a non-empty platform id');
  }
  if (!isValidPlatformId(normalized)) {
    throw new Error('--platform must contain only lowercase letters, numbers, and hyphens');
  }

  const registered = PLATFORMS.find((platform) => platform.id === normalized);
  if (registered) {
    return { platform: registered, native: true };
  }

  if (scope === 'global') {
    throw new Error('custom --platform targets are only supported with project scope');
  }

  return {
    platform: {
      id: normalized,
      name: normalized,
      skillsDir: `.${normalized}`,
      openspecToolId: normalized,
      rulesDir: 'rules',
      rulesFormat: 'md',
      supportsHooks: true,
      hookFormat: 'claude-code',
    },
    native: false,
  };
}
