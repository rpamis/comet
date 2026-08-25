import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  classicChangeId,
  inferClassicWorkflow,
  parseClassicLifecycleEvidence,
} from '../../../domains/comet-classic/classic-experience.js';

describe('Classic workflow experience evidence', () => {
  const roots: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('extracts bounded lifecycle evidence and resolves command change ids', () => {
    expect(
      parseClassicLifecycleEvidence(
        JSON.stringify({
          data: {
            changedPaths: ['app/a.ts', false, 'app/b.ts'],
            artifactRefs: ['docs/plan.md', 1],
          },
        }),
      ),
    ).toEqual({
      changedPaths: ['app/a.ts', 'app/b.ts'],
      artifactRefs: ['docs/plan.md'],
    });
    expect(classicChangeId(['set', 'change-name', '--json'], 'state')).toBe('change-name');
    expect(classicChangeId(['change-name', '--json'], 'archive')).toBe('change-name');
  });

  it('prefers an explicit preset and otherwise falls back to the host hint', async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-experience-'));
    roots.push(projectRoot);
    vi.stubEnv('COMET_WORKFLOW', 'tweak');

    await expect(inferClassicWorkflow(['check', 'hotfix'], projectRoot, 'guard')).resolves.toBe(
      'hotfix',
    );
    await expect(inferClassicWorkflow(['missing-change'], projectRoot, 'archive')).resolves.toBe(
      'tweak',
    );
  });
});
