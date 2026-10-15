import { isValidPlatformId, PLATFORMS, type Platform } from './platforms.js';
import type { InstallScope } from './types.js';

export type PlatformTargetResolution = {
  platform: Platform;
  native: boolean;
};

const PLATFORM_ID_ALIASES: Readonly<Record<string, string>> = {
  omp: 'oh-my-pi',
};

export function resolvePlatformTarget(
  platformId: string,
  scope: InstallScope,
  options: { allowCustom?: boolean } = {},
): PlatformTargetResolution {
  const normalized = platformId.trim();
  if (normalized.length === 0) {
    throw new Error('--platform must be a non-empty platform id');
  }
  if (!isValidPlatformId(normalized)) {
    throw new Error('--platform must contain only lowercase letters, numbers, and hyphens');
  }

  const canonicalId = PLATFORM_ID_ALIASES[normalized] ?? normalized;
  const registered = PLATFORMS.find((platform) => platform.id === canonicalId);
  if (registered) {
    return { platform: registered, native: true };
  }

  if (scope === 'global') {
    throw new Error('custom --platform targets are only supported with project scope');
  }
  if (!options.allowCustom) {
    throw new Error(
      `Unknown platform: ${normalized}. Select a supported platform, or use --custom-platform explicitly for a project-scoped Claude-compatible target.`,
    );
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
