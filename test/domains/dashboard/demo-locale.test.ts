import { afterEach, describe, expect, it } from 'vitest';
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
