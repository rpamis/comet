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
      schema: 'comet.dashboard.native.v1',
      totalChangeCount: 3,
      visibleChangeCount: 3,
      omittedChangeCount: 0,
      changesTruncated: false,
    });
    expect(DEMO_SNAPSHOT.native.changes.map((change) => change.phase)).toEqual([
      'build',
      'verify',
      'archive',
    ]);
    expect(DEMO_SNAPSHOT.native.changes.some((change) => change.archiveReady)).toBe(true);
    expect(
      DEMO_SNAPSHOT.native.changes.some((change) => change.continuation?.requiresUserDecision),
    ).toBe(true);
    expect(DEMO_SNAPSHOT.native.changes.some((change) => change.conflicts.peers.length > 0)).toBe(
      true,
    );
  });
});
