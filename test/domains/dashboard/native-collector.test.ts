import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createNativeChange,
  nativeChangeDir,
  writeNativeChangeFile,
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
    const stateFile = path.join(nativeChangeDir(paths, state.name), 'comet-state.yaml');
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
          status: 'active',
          phase: 'shape',
          archiveReady: false,
          artifacts: [
            {
              key: 'brief',
              label: '需求简报',
              path: 'brief.md',
              exists: true,
              content: brief,
            },
          ],
          progress: { createdAt: expect.any(String) },
          specs: { total: 0, capabilities: [] },
          acceptance: { total: 1, evidenced: 0, skipped: 0, missing: 1 },
          implementation: null,
          repair: null,
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

  it('collects archived Native changes and their user-facing Markdown artifacts', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const state = await createNativeChange({ paths, name: 'archived-dashboard', language: 'en' });
    const activeDir = nativeChangeDir(paths, state.name);
    await fs.writeFile(path.join(activeDir, 'brief.md'), brief);
    await fs.writeFile(path.join(activeDir, 'verification.md'), '# Conclusion\nPassed.\n');
    await writeNativeChangeFile(path.join(activeDir, 'comet-state.yaml'), {
      ...state,
      phase: 'archive',
      verification_result: 'pass',
      verification_report: 'verification.md',
      archived: true,
    });
    const archiveDir = path.join(paths.archiveDir, '2026-07-18-archived-dashboard');
    await fs.mkdir(paths.archiveDir, { recursive: true });
    await fs.rename(activeDir, archiveDir);

    const projection = await collectNativeDashboardProjection(projectRoot, {
      now: new Date('2026-07-19T10:00:00.000Z'),
    });

    expect(projection).toMatchObject({
      totalChangeCount: 1,
      visibleChangeCount: 1,
      changes: [
        {
          name: 'archived-dashboard',
          status: 'archived',
          archivedAt: '2026-07-18',
          archiveReady: true,
          progress: {
            createdAt: expect.any(String),
            summary: 'Native change 已完成并归档。',
          },
          specs: { total: 0, capabilities: [] },
          acceptance: { total: 1, evidenced: 0, skipped: 0, missing: 1 },
          artifacts: expect.arrayContaining([
            expect.objectContaining({ key: 'brief', exists: true, content: brief }),
            expect.objectContaining({
              key: 'verification',
              exists: true,
              content: '# Conclusion\nPassed.\n',
            }),
          ]),
        },
      ],
    });
  });

  it('consumes bounded status pages and reports Dashboard omissions exactly', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    for (let index = 0; index < 34; index += 1) {
      const directory = path.join(
        paths.changesDir,
        `dashboard-page-${String(index).padStart(2, '0')}`,
      );
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, 'comet-state.yaml'), 'schema: [invalid\n');
    }

    const projection = await collectNativeDashboardProjection(projectRoot, {
      now: new Date('2026-07-17T10:00:00.000Z'),
    });

    expect(projection).toMatchObject({
      totalChangeCount: 34,
      visibleChangeCount: 32,
      omittedChangeCount: 2,
      changesTruncated: true,
    });
    expect(projection?.changes).toHaveLength(32);
    expect(projection?.changes[0].name).toBe('dashboard-page-00');
    expect(projection?.changes.at(-1)?.name).toBe('dashboard-page-31');
  });
});
