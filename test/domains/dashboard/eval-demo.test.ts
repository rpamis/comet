import { describe, expect, it } from 'vitest';
import {
  readEvalDemo,
  readEvalDemoSettings,
} from '../../../domains/dashboard/web/src/eval-demo.js';

describe('Dashboard evaluation demo', () => {
  it('previews independent model and budget settings without credential values', () => {
    const settings = readEvalDemoSettings();
    expect(settings.defaults.judgeEnabled).toBe(true);
    expect(settings.defaults.applicationTimeoutSeconds).toBeLessThan(
      settings.defaults.skillTimeoutSeconds,
    );
    expect(settings.credentials.main).toMatchObject({ configured: false, saved: false });
    expect(settings.credentials.judge).toMatchObject({ configured: false, saved: false });
    expect(settings.credentials.main).not.toHaveProperty('value');
    settings.defaults.model = 'changed';
    expect(readEvalDemoSettings().defaults.model).toBe('demo-model');
  });
  it('provides a searchable run with separate results and uncovered recovery paths', async () => {
    const { items } = await readEvalDemo('/runs');
    expect(items).toHaveLength(1);
    const run = await readEvalDemo(`/runs/${items[0].id}`);
    expect(run.cases.map((item) => item.passed)).toEqual([true, false]);
    expect(run.coverage.uncoveredSteps).toContain('reconcile');
    expect((await readEvalDemo('/runs?q=missing')).items).toEqual([]);
    items[0].target.name = 'modified';
    expect((await readEvalDemo('/runs')).items[0].target.name).toContain('示例');
  });

  it('previews a labelled example report and rejects mutations', async () => {
    const artifact = await readEvalDemo('/runs/demo-eval-report/artifact?ref=summary.md');
    expect(artifact.content).toContain('仅展示界面交互');
    await expect(readEvalDemo('/runs/demo-eval-report/stop', { body: {} })).rejects.toThrow(
      '只支持读取',
    );
    await expect(readEvalDemo('/runs/missing')).rejects.toThrow('不存在');
  });
});
