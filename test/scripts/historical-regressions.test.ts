import { describe, expect, it } from 'vitest';
import {
  historicalRegressionEntries,
  mergeHistoricalRegressions,
} from '../../scripts/lint/historical-regressions.mjs';

function catalog() {
  return {
    schema: 'comet.release.historical-bad-cases.v1',
    inventory: {
      complete: true,
      sourceIssueNumbers: [157, 158, 159],
      outOfScopeIssues: [{ number: 159, reason: 'Only unrelated product behavior.' }],
    },
    issues: [
      {
        number: 157,
        cases: [
          {
            id: '157-approval',
            behavior: 'wait for actual approval',
            status: 'covered',
            reason: '',
            evidence: [] as string[],
            tests: [
              {
                file: 'test/domains/comet-classic/classic-sdk-application.test.ts',
                namePattern: 'waits for the user',
                requiredNames: ['waits for the user'],
              },
            ],
          },
        ],
      },
      {
        number: 158,
        cases: [
          {
            id: '158-removed',
            behavior: 'removed shell command',
            status: 'excluded',
            reason: 'No shell runtime in 050.',
            evidence: ['assets/manifest.json'],
            tests: [] as Array<{ file: string; namePattern: string; requiredNames: string[] }>,
          },
        ],
      },
    ],
  };
}

describe('historical workflow bad-case inventory', () => {
  it('keeps surviving tests and excludes only documented absent behavior', () => {
    const entries = historicalRegressionEntries(catalog());
    expect(entries).toHaveLength(1);
    expect(entries[0].issues).toEqual([157]);
    expect(entries[0].requiredNames).toEqual(['waits for the user']);
  });

  it('extends existing complete or filtered groups without weakening mandatory historical assertions', () => {
    const history = historicalRegressionEntries(catalog());
    const core = [
      {
        id: 'core',
        files: history[0].files,
        issues: [503],
        requiredNames: ['core case'],
        invariant: 'bound outputs',
      },
    ];
    const merged = mergeHistoricalRegressions(core, history);
    expect(merged).toHaveLength(1);
    expect(merged[0].requiredNames).toEqual(['core case', 'waits for the user']);
    expect(merged[0].issues).toEqual([503, 157]);
    expect(merged[0].testNamePattern).toBeUndefined();
    expect(core[0].requiredNames).toEqual(['core case']);
    const filtered = mergeHistoricalRegressions(
      [{ ...core[0], testNamePattern: 'core case' }],
      history,
    );
    expect(filtered[0].testNamePattern).toContain('waits for the user');
    expect(filtered[0].testNamePattern).toContain('core case');
  });

  it('groups related issue selections per file so mandatory publication does not rerun the file per issue', () => {
    const input = catalog();
    const entry = structuredClone(input.issues[0].cases[0]);
    entry.id = '157-delivery';
    entry.tests[0].namePattern = 'verifies real delivery';
    entry.tests[0].requiredNames = ['verifies real delivery'];
    input.issues[0].cases.push(entry);
    const entries = historicalRegressionEntries(input);
    expect(entries).toHaveLength(1);
    expect(entries[0].testNamePattern).toBe('(?:waits for the user)|(?:verifies real delivery)');
    expect(entries[0].requiredNames).toHaveLength(2);
  });

  it('rejects an incomplete scan and unaccounted or twice-accounted issue numbers', () => {
    const incomplete = catalog();
    incomplete.inventory.complete = false;
    expect(() => historicalRegressionEntries(incomplete)).toThrow('全集');
    const missing = catalog();
    missing.inventory.sourceIssueNumbers.push(160);
    expect(() => historicalRegressionEntries(missing)).toThrow('未归类');
    const duplicate = catalog();
    duplicate.inventory.outOfScopeIssues.push({
      number: 157,
      reason: 'Cannot exclude and cover the same issue.',
    });
    expect(() => historicalRegressionEntries(duplicate)).toThrow('重复归类');
  });

  it('rejects a gap, missing executable test, or unsubstantiated exclusion', () => {
    const gap = catalog();
    gap.issues[0].cases[0].status = 'gap';
    expect(() => historicalRegressionEntries(gap)).toThrow('尚无');
    const empty = catalog();
    empty.issues[0].cases[0].tests = [];
    expect(() => historicalRegressionEntries(empty)).toThrow('尚无');
    const excluded = catalog();
    excluded.issues[1].cases[0].evidence = [];
    expect(() => historicalRegressionEntries(excluded)).toThrow('移除依据');
  });

  it('rejects unsafe paths, empty required names and duplicate case IDs', () => {
    const unsafe = catalog();
    unsafe.issues[0].cases[0].tests[0].file = 'test/../outside.test.ts';
    expect(() => historicalRegressionEntries(unsafe)).toThrow('不完整');
    const missing = catalog();
    missing.issues[0].cases[0].tests[0].requiredNames = [];
    expect(() => historicalRegressionEntries(missing)).toThrow('不完整');
    const duplicate = catalog();
    duplicate.issues[1].cases[0].id = '157-approval';
    expect(() => historicalRegressionEntries(duplicate)).toThrow('重复');
  });
});
