import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPlatformDetectionPath = vi.fn();

vi.mock('../../platform/install/detect.js', () => ({
  hasPlatformDetectionPath,
}));

describe('canonical Skill root owner resolution', () => {
  beforeEach(() => {
    hasPlatformDetectionPath.mockReset();
  });

  it('does not probe detection paths for unique roots when detection is explicitly disabled', async () => {
    hasPlatformDetectionPath.mockRejectedValue(
      Object.assign(new Error('permission denied'), { code: 'EACCES' }),
    );
    const { resolveCanonicalSkillRootOwners } =
      await import('../../platform/install/skill-root-owner.js');

    const owners = await resolveCanonicalSkillRootOwners('C:\\fake-home', 'global', {
      respectDetectionPaths: false,
    });

    expect(owners.some((owner) => owner.platform.id === 'codex')).toBe(true);
    expect(hasPlatformDetectionPath).not.toHaveBeenCalled();
  });
});
