import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { collectNativeDashboardProjection } from '../../../domains/dashboard/native-collector.js';
import { collectDashboardSnapshot } from '../../../domains/dashboard/collector.js';

const brief = `# Outcome
Show Native safely.
# Scope
Project current Native facts.
# Non-goals
No writes.
# Acceptance examples
- The current phase is visible.
# Constraints and invariants
Do not expose raw evidence.
# Decisions
Reuse Runtime inspection.
# Open questions
None.
# Verification expectations
Run the collector test.
`;

describe('Native Dashboard collector', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-dashboard-collector-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('does not create Native state when the project has no Comet config', async () => {
    await expect(
      collectNativeDashboardProjection(projectRoot, {
        now: new Date('2026-07-17T10:00:00.000Z'),
      }),
    ).resolves.toBeNull();
    await expect(fs.access(path.join(projectRoot, 'comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('reuses fresh Runtime projections without mutating the Native root', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const state = await createNativeChange({ paths, name: 'dashboard-change', language: 'en' });
    await fs.writeFile(path.join(nativeChangeDir(paths, state.name), 'brief.md'), brief);
    const stateFile = path.join(nativeChangeDir(paths, state.name), 'change.yaml');
    const before = await fs.readFile(stateFile, 'utf8');

    const projection = await collectNativeDashboardProjection(projectRoot, {
      now: new Date('2026-07-17T10:00:00.000Z'),
    });

    expect(projection).toMatchObject({
      schema: 'comet.dashboard.native.v1',
      generatedAt: '2026-07-17T10:00:00.000Z',
      totalChangeCount: 1,
      changes: [
        {
          workflow: 'native',
          name: 'dashboard-change',
          phase: 'shape',
          archiveReady: false,
          archive: {
            ready: false,
            findingCodes: expect.arrayContaining([
              'archive-phase-required',
              'verification-evidence-missing',
            ]),
          },
        },
      ],
      conflicts: { available: true, relationshipCount: 0 },
    });
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);

    const dashboard = await collectDashboardSnapshot(projectRoot, {
      now: new Date('2026-07-17T10:00:00.000Z'),
    });
    expect(dashboard.native).toMatchObject({
      schema: 'comet.dashboard.native.v1',
      changes: [{ name: 'dashboard-change', phase: 'shape' }],
    });
  });
});
