import { describe, expect, it } from 'vitest';
import { PLATFORMS } from '../../platform/install/platforms.js';
import { resolvePlatformTarget } from '../../platform/install/platform-targets.js';

describe('resolvePlatformTarget', () => {
  it('returns a registered native platform by id', () => {
    const codex = PLATFORMS.find((platform) => platform.id === 'codex')!;

    expect(resolvePlatformTarget('codex', 'project')).toEqual({
      platform: codex,
      native: true,
    });
  });

  it('creates a conservative project-scoped custom platform', () => {
    expect(resolvePlatformTarget('test', 'project')).toEqual({
      native: false,
      platform: {
        id: 'test',
        name: 'test',
        skillsDir: '.test',
        openspecToolId: 'test',
        rulesDir: 'rules',
        rulesFormat: 'md',
        supportsHooks: true,
        hookFormat: 'claude-code',
      },
    });
  });

  it.each(['', '   '])('rejects empty platform id %#', (platformId) => {
    expect(() => resolvePlatformTarget(platformId, 'project')).toThrow(
      '--platform must be a non-empty platform id',
    );
  });

  it.each(['Codex', 'codex_cli', 'codex.cli', 'codex/cli'])(
    'rejects malformed platform id %s',
    (platformId) => {
      expect(() => resolvePlatformTarget(platformId, 'project')).toThrow(
        '--platform must contain only lowercase letters, numbers, and hyphens',
      );
    },
  );

  it('rejects global custom platform targets', () => {
    expect(() => resolvePlatformTarget('test', 'global')).toThrow(
      'custom --platform targets are only supported with project scope',
    );
  });
});
