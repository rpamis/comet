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

  it('includes a Native parent-child explorer example', async () => {
    const { DEMO_SNAPSHOT } = await import('../../../domains/dashboard/web/demo.js');
    const parent = DEMO_SNAPSHOT.native.changes.find(
      (change) => (change.children?.length ?? 0) > 0,
    );

    expect(parent?.name).toBe('ship-native-dashboard');
    expect(parent?.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: 'done', changeStatus: 'archived' }),
        expect.objectContaining({ status: 'active', changeStatus: 'active' }),
        expect.objectContaining({ status: 'pending', changeStatus: 'active' }),
      ]),
    );
  });

  it('provides enabled personal memory and project knowledge center pages', async () => {
    const { DEMO_PLUGIN_PAGES } = await import('../../../domains/dashboard/web/demo.js');
    const personalMemory = DEMO_PLUGIN_PAGES.find(
      (page) => page.pluginId === 'comet.personal-memory',
    );
    const projectKnowledge = DEMO_PLUGIN_PAGES.find(
      (page) => page.pluginId === 'comet.project-knowledge',
    );

    expect(personalMemory).toMatchObject({
      status: 'enabled',
      data: {
        projectKey: 'comet',
      },
    });
    expect(personalMemory?.data.management.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: '交付语言与结构',
          scope: 'global',
          text: expect.stringContaining('先给结论'),
        }),
        expect.objectContaining({
          category: 'Dashboard 验收基线',
          scope: 'project',
          projectKey: 'comet',
          text: expect.stringContaining('390 × 844'),
        }),
        expect.objectContaining({
          category: '官网工作台迭代',
          memoryType: 'personal-episode',
          episode: expect.objectContaining({
            lesson: expect.stringContaining('独立的展示边界'),
          }),
        }),
      ]),
    );
    expect(projectKnowledge).toMatchObject({
      status: 'enabled',
      data: {
        provider: 'local',
      },
    });
    expect(projectKnowledge?.data.records).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Dashboard 数据采集与详情读取链路',
          conclusions: expect.arrayContaining([
            expect.objectContaining({
              sources: expect.arrayContaining([
                expect.objectContaining({
                  source: 'domains/dashboard/collector.ts',
                }),
              ]),
            }),
          ]),
        }),
        expect.objectContaining({
          title: 'Dashboard 文件预览与写入边界',
          summary: expect.stringContaining('项目边界'),
        }),
      ]),
    );
    expect(projectKnowledge?.data.local.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'domains/dashboard/collector.ts' }),
      ]),
    );
  });

  it('keeps website preview data free from Demo-labelled user copy', async () => {
    const { DEMO_PLUGIN_PAGES, DEMO_SNAPSHOT } =
      await import('../../../domains/dashboard/web/demo.js');
    const userVisibleData = JSON.stringify({
      pluginPages: DEMO_PLUGIN_PAGES,
      snapshot: DEMO_SNAPSHOT,
    });

    expect(userVisibleData).not.toMatch(/\bDemo\b/u);
  });

  it('provides realistic project settings for the website demo', async () => {
    const { DEMO_PROJECT_CONFIG } = await import('../../../domains/dashboard/web/demo.js');

    expect(DEMO_PROJECT_CONFIG).toMatchObject({
      schema: 'comet.project.v1',
      defaultWorkflow: 'classic',
      workflows: ['classic', 'native'],
      ambientResume: true,
      knowledge: {
        provider: 'local',
        localInclude: expect.arrayContaining(['docs/architecture/**/*.md']),
      },
      native: {
        language: 'zh-CN',
        clarificationMode: 'sequential',
      },
      classic: {
        artifactLayout: 'docs',
        language: 'zh-CN',
      },
    });
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

  it('provides substantial Classic and Native artifact previews', async () => {
    const { DEMO_SNAPSHOT } = await import('../../../domains/dashboard/web/demo.js');
    const classicChanges = [...DEMO_SNAPSHOT.changes.active, ...DEMO_SNAPSHOT.changes.archived];

    for (const change of classicChanges) {
      expect(change.path).toMatch(/^docs\/openspec\/changes\//u);
      for (const artifact of change.artifacts.grouped.filter((item) => item.exists)) {
        expect(artifact.content?.length, `${change.name}/${artifact.key}`).toBeGreaterThan(360);
      }
    }

    const rateLimit = DEMO_SNAPSHOT.changes.active.find(
      (change) => change.name === 'add-auth-rate-limiting',
    );
    expect(
      rateLimit?.artifacts.grouped.find((artifact) => artifact.key === 'proposal')?.content,
    ).toContain('## 背景');
    expect(
      rateLimit?.artifacts.grouped.find((artifact) => artifact.key === 'design')?.content,
    ).toContain('## 数据流');
    expect(
      rateLimit?.artifacts.grouped.find((artifact) => artifact.key === 'tasks')?.content,
    ).toContain('- [x]');
    expect(
      rateLimit?.artifacts.grouped.find((artifact) => artifact.key === 'cometYaml')?.content,
    ).toContain('schema: comet.classic.v1');

    for (const change of DEMO_SNAPSHOT.native.changes) {
      for (const artifact of change.artifacts.filter((item) => item.exists)) {
        expect(artifact.content?.length, `${change.name}/${artifact.key}`).toBeGreaterThan(360);
      }
    }

    const nativeDashboard = DEMO_SNAPSHOT.native.changes.find(
      (change) => change.name === 'ship-native-dashboard',
    );
    expect(
      nativeDashboard?.artifacts.find((artifact) => artifact.key === 'brief')?.content,
    ).toContain('## 验收标准');
    expect(
      nativeDashboard?.artifacts.find((artifact) => artifact.key === 'spec-dashboard')?.content,
    ).toContain('### Scenario');
    const nativeRepair = DEMO_SNAPSHOT.native.changes.find(
      (change) => change.name === 'align-dashboard-copy',
    );
    expect(
      nativeRepair?.artifacts.find((artifact) => artifact.key === 'verification')?.content,
    ).toContain('## 未通过项');
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
