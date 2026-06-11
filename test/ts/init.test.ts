import { describe, expect, it } from 'vitest';
import { applyBulkOverwriteChoice } from '../../src/commands/init.js';
import { createWorkingDirs } from '../../src/core/skills.js';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

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

  it('creates a project Comet config with context compression disabled by default', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-init-config-'));

    try {
      await createWorkingDirs(tmpDir);

      const config = await fs.readFile(path.join(tmpDir, '.comet', 'config.yaml'), 'utf-8');
      expect(config).toContain('context_compression: off');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
