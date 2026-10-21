import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  DEMO_SNAPSHOT,
  DEMO_PLUGIN_PAGES,
  DEMO_PROJECT_CONFIG,
} from '../../../domains/dashboard/web/demo.js';
import { localizedDemo } from '../../../domains/dashboard/web/src/demo-locale.js';
import { setDashboardLanguage, t } from '../../../domains/dashboard/web/src/dashboard-i18n.js';
import { readApplicationDemo } from '../../../domains/dashboard/web/src/application-demo.js';
import { readEvalDemo } from '../../../domains/dashboard/web/src/eval-demo.js';
import {
  DEMO_CHANGE_TRACES,
  DEMO_CHANGE_TRACE_INDEX,
} from '../../../domains/dashboard/web/src/change-trace-demo.js';

function untranslated(value: unknown, path = ''): string[] {
  if (typeof value === 'string') return /\p{Script=Han}/u.test(value) ? [`${path}: ${value}`] : [];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) => untranslated(child, `${path}.${key}`));
}

afterEach(() => setDashboardLanguage('zh', { persist: false }));

describe('Dashboard example content language', () => {
  it('keeps three applications, pinned versions and their independent traces separate', () => {
    const applications = readApplicationDemo('application-runs', { kind: 'application' });
    expect(new Set(applications.items.map((item) => item.applicationId))).toEqual(
      new Set(['grill-suite', 'docs-publisher', 'dependency-audit']),
    );
    const expected = [
      ['grill-suite', ['run-128', 'run-127', 'review-022']],
      ['docs-publisher', ['docs-042', 'docs-041']],
      ['dependency-audit', ['audit-009']],
    ] as const;
    for (const [applicationId, runIds] of expected) {
      const list = readApplicationDemo('application-runs', { applicationId, kind: 'application' });
      expect(list.items.map((item) => item.runId)).toEqual(runIds);
      for (const item of list.items) {
        const detail = readApplicationDemo('application-run', { locator: item.locator });
        expect(detail.applicationId).toBe(applicationId);
        expect(detail.application.version).toBe(item.application.version);
        if (!item.isChild) {
          expect(detail.definition.workflow.id).toBe(
            applicationId === 'grill-suite' ? 'demo' : applicationId,
          );
          expect(detail.definition.steps.length).toBeGreaterThan(2);
        }
        if (applicationId !== 'grill-suite') expect(detail.sourceCreators).toEqual([]);
      }
    }
    const docs = readApplicationDemo('application-runs', { applicationId: 'docs-publisher' });
    expect(docs.items.map((item) => item.application.version)).toEqual(['2.1.0', '2.0.0']);
    const failed = readApplicationDemo('application-run', {
      locator: applications.items.find((item) => item.runId === 'audit-009')!.locator,
    });
    expect(failed.records.some((record) => record.status === 'failed')).toBe(true);
    expect(failed.definition.steps.find((step) => step.stepId === 'remediate')!.recordCount).toBe(
      0,
    );
  });
  it('loads both demo adapters directly in Node for browser-test setup', () => {
    expect(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          'await import("./domains/dashboard/web/src/application-demo.js"); await import("./domains/dashboard/web/src/eval-demo.js");',
        ],
        { encoding: 'utf8' },
      ),
    ).toBe('');
  });
  it('translates all preset records and artifact bodies without changing source fixtures or IDs', () => {
    const original = JSON.stringify(DEMO_SNAPSHOT);
    const localized = localizedDemo(DEMO_SNAPSHOT);
    setDashboardLanguage('en', { persist: false });
    const resources = {
      snapshot: localized,
      plugins: localizedDemo(DEMO_PLUGIN_PAGES),
      configuration: localizedDemo(DEMO_PROJECT_CONFIG),
      traces: localizedDemo(DEMO_CHANGE_TRACES),
      traceIndex: localizedDemo(DEMO_CHANGE_TRACE_INDEX),
    };
    expect(untranslated(resources)).toEqual([]);
    expect(localized.changes.active[0].name).toBe(DEMO_SNAPSHOT.changes.active[0].name);
    expect(localized.changes.active[0].tasks.sections[2].title).toBe('Test coverage');
    expect(JSON.stringify(DEMO_SNAPSHOT)).toBe(original);
    expect(t('为认证接口增加分布式限流')).toBe('为认证接口增加分布式限流');
    setDashboardLanguage('zh', { persist: false });
    expect(JSON.stringify(localized)).toBe(original);
  });

  it('keeps Any and Eval search, detail, history, and previews in English', async () => {
    setDashboardLanguage('en', { persist: false });
    const applications = readApplicationDemo('application-runs');
    expect(untranslated(applications)).toEqual([]);
    expect(readApplicationDemo('application-runs', { q: 'release notes' }).items).toHaveLength(1);
    for (const item of applications.items) {
      for (const endpoint of [
        'application-run',
        'application-run-records',
        'application-run-artifact',
      ]) {
        expect(untranslated(readApplicationDemo(endpoint, { locator: item.locator }))).toEqual([]);
      }
    }
    const evaluation = await readEvalDemo('/runs');
    expect(untranslated(evaluation)).toEqual([]);
    for (const item of evaluation.items) {
      expect(untranslated(await readEvalDemo(`/runs/${item.id}`))).toEqual([]);
      expect(untranslated(await readEvalDemo(`/runs/${item.id}/artifact?ref=summary.md`))).toEqual(
        [],
      );
    }
    expect((await readEvalDemo('/runs?q=Report%20workflow')).items).toHaveLength(1);
  });
});
