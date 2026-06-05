import { describe, expect, it } from 'vitest';
import { applyBulkOverwriteChoice } from '../../src/commands/init.js';

describe('init command helpers', () => {
  it('can apply a single overwrite choice to all existing components on a platform', () => {
    const plan = {
      osAction: 'install' as const,
      spAction: 'install' as const,
      cmAction: 'install' as const,
    };

    expect(applyBulkOverwriteChoice(plan, 'overwrite-all')).toEqual({
      osAction: 'overwrite',
      spAction: 'overwrite',
      cmAction: 'overwrite',
    });
    expect(applyBulkOverwriteChoice(plan, 'skip-all')).toEqual({
      osAction: 'skip',
      spAction: 'skip',
      cmAction: 'skip',
    });
  });

  it('only affects existing components when hasExisting is provided with skip-all', () => {
    const plan = {
      osAction: 'install' as const,
      spAction: 'install' as const,
      cmAction: 'install' as const,
    };
    const hasExisting = { os: true, sp: false, cm: true };

    expect(applyBulkOverwriteChoice(plan, 'skip-all', hasExisting)).toEqual({
      osAction: 'skip',
      spAction: 'install',
      cmAction: 'skip',
    });
  });

  it('only affects existing components when hasExisting is provided with overwrite-all', () => {
    const plan = {
      osAction: 'install' as const,
      spAction: 'install' as const,
      cmAction: 'install' as const,
    };
    const hasExisting = { os: false, sp: true, cm: false };

    expect(applyBulkOverwriteChoice(plan, 'overwrite-all', hasExisting)).toEqual({
      osAction: 'install',
      spAction: 'overwrite',
      cmAction: 'install',
    });
  });

  it('skips-all with hasExisting all false leaves all as install', () => {
    const plan = {
      osAction: 'install' as const,
      spAction: 'install' as const,
      cmAction: 'install' as const,
    };
    const hasExisting = { os: false, sp: false, cm: false };

    expect(applyBulkOverwriteChoice(plan, 'skip-all', hasExisting)).toEqual({
      osAction: 'install',
      spAction: 'install',
      cmAction: 'install',
    });
  });

  it('does not affect non-install actions even when hasExisting is true', () => {
    const plan = {
      osAction: 'overwrite' as const,
      spAction: 'skip' as const,
      cmAction: 'install' as const,
    };
    const hasExisting = { os: true, sp: true, cm: true };

    expect(applyBulkOverwriteChoice(plan, 'skip-all', hasExisting)).toEqual({
      osAction: 'overwrite',
      spAction: 'skip',
      cmAction: 'skip',
    });
  });
});
