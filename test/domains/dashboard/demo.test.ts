import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

describe('dashboard demo data', () => {
  it('uses eval readiness wording in the user-visible Skill Creator demo', async () => {
    const source = await fs.readFile(path.resolve('domains/dashboard/web/demo.js'), 'utf8');

    expect(source).toContain('Eval result attached');
    expect(source).toContain("currentStep: 'needs-eval'");
    expect(source).not.toContain('Benchmark result attached');
    expect(source).not.toContain("currentStep: 'needs-benchmark'");
  });

  it('includes representative Native workflow projections', async () => {
    const { DEMO_SNAPSHOT } = await import('../../../domains/dashboard/web/demo.js');

    expect(DEMO_SNAPSHOT.native).toMatchObject({
      schema: 'comet.dashboard.native.v2',
      totalChangeCount: DEMO_SNAPSHOT.native.changes.length,
      visibleChangeCount: DEMO_SNAPSHOT.native.changes.length,
      omittedChangeCount: 0,
      changesTruncated: false,
    });
    expect(DEMO_SNAPSHOT.native.changes.slice(0, 3).map((change) => change.phase)).toEqual([
      'build',
      'build',
      'archive',
    ]);
    expect(DEMO_SNAPSHOT.native.changes.slice(0, 3).map((change) => change.loop.stage)).toEqual([
      'building',
      'repairing',
      'done',
    ]);
    expect(
      DEMO_SNAPSHOT.native.changes.some(
        (change) =>
          change.acceptance?.passed > 0 &&
          change.acceptance?.failed > 0 &&
          change.acceptance?.blocked > 0 &&
          change.acceptance?.pending > 0,
      ),
    ).toBe(true);
    expect(DEMO_SNAPSHOT.native.changes.some((change) => change.checks.length > 0)).toBe(true);
    expect(DEMO_SNAPSHOT.native.changes.some((change) => change.blockers.length > 0)).toBe(true);
    expect(DEMO_SNAPSHOT.native.changes.some((change) => change.history.length > 0)).toBe(true);
    expect(
      DEMO_SNAPSHOT.native.changes.some((change) => change.historyOverflow.droppedEntries > 0),
    ).toBe(true);
    expect(
      DEMO_SNAPSHOT.native.changes.some((change) => change.localExecution.reason === 'current'),
    ).toBe(true);
    expect(
      DEMO_SNAPSHOT.native.changes.some(
        (change) => change.localExecution.reason === 'version-mismatch',
      ),
    ).toBe(true);
    expect(
      DEMO_SNAPSHOT.native.changes.some((change) => change.localExecution.reason === 'archived'),
    ).toBe(true);
  });

  it('shows the complete beta17 portable artifact set by lifecycle', async () => {
    const { DEMO_SNAPSHOT } = await import('../../../domains/dashboard/web/demo.js');

    for (const change of DEMO_SNAPSHOT.native.changes) {
      const keys = change.artifacts
        .filter((artifact) => artifact.exists)
        .map((artifact) => artifact.key);
      expect(keys).toContain('comet-state.yaml');
      expect(keys).toContain('brief');
      expect(keys.some((key) => key.startsWith('spec-'))).toBe(true);
      if (change.verificationResult !== 'pending') {
        expect(keys).toContain('verification');
      }
    }
  });

  it('populates enough changes to demonstrate bounded side-panel scrolling', async () => {
    const { DEMO_SNAPSHOT } = await import('../../../domains/dashboard/web/demo.js');

    expect(DEMO_SNAPSHOT.changes.active.length).toBeGreaterThanOrEqual(10);
    expect(DEMO_SNAPSHOT.changes.archived.length).toBeGreaterThanOrEqual(8);
    expect(DEMO_SNAPSHOT.native.changes.length).toBeGreaterThanOrEqual(10);
    expect(DEMO_SNAPSHOT.changes.active[0].risks.length).toBeGreaterThanOrEqual(8);
    expect(DEMO_SNAPSHOT.git.recentCommits.length).toBeGreaterThanOrEqual(10);
    expect(DEMO_SNAPSHOT.native.changes[0].history.length).toBeGreaterThanOrEqual(8);
  });
});
