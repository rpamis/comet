import { nativeSdkBeforeBugfree } from '../../../domains/comet-native/native-sdk-definition.js';
import { defineNativeWorkflowApplication } from '../../../domains/comet-native/native-sdk-application.js';
import { defineWorkflow, hashRuntimeValue } from '../../../domains/engine/runtime.js';
import { describe, expect, it } from 'vitest';
import {
  normalizeNativeBugfreeResponse,
  parseNativeVerifierResponse,
} from '../../../domains/comet-native/native-verifier-protocol.js';
import {
  nativeVerifyMode,
  assertNativeVerifyModeSupported,
} from '../../../domains/comet-native/native-verification-policy.js';
import {
  defaultWorkflowProjectConfig,
  mergeWorkflowProjectConfigDocument,
  parseWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
} from '../../../domains/workflow-contract/project-config.js';

function config(mode?: unknown) {
  return JSON.stringify({
    schema: 'comet.project.v1',
    default_workflow: 'native',
    native: { artifact_root: 'docs', ...(mode === undefined ? {} : { verify_mode: mode }) },
  });
}

describe('Native bugfree configuration', () => {
  it('defaults to standard and preserves both modes through rendering and merging', () => {
    expect(defaultWorkflowProjectConfig().native?.verify_mode).toBe('standard');
    expect(parseWorkflowProjectConfigDocument(config()).native?.verify_mode).toBe('standard');
    for (const mode of ['standard', 'bugfree']) {
      const parsed = parseWorkflowProjectConfigDocument(config(mode)).config!;
      const merged = mergeWorkflowProjectConfigDocument(
        { extension: 'keep', native: { custom: 'retain' } },
        parsed,
      );
      const rendered = renderStructuredProjectConfig(merged, 'zh-CN');
      const roundtrip = parseWorkflowProjectConfigDocument(rendered);
      expect(roundtrip.native?.verify_mode).toBe(mode);
      expect(roundtrip.value.extension).toBe('keep');
      expect((roundtrip.value.native as Record<string, unknown>).custom).toBe('retain');
      expect((roundtrip.value.native as Record<string, unknown>).snapshot).toBeUndefined();
    }
  });

  it.each([null, true, false, [], {}, '', 'Bugfree', 'full'].map((mode) => ({ mode })))(
    'rejects invalid mode $mode',
    ({ mode }) => {
      expect(() => parseWorkflowProjectConfigDocument(config(mode))).toThrow('native.verify_mode');
    },
  );
});

describe('Native bugfree result coverage', () => {
  const result = (passedAcceptanceIds: unknown, acceptance: unknown[] = [], verdict = 'pass') => ({
    kind: 'final-result',
    result: {
      iteration: 1,
      attempt: 1,
      verdict,
      passedAcceptanceIds,
      acceptance,
      risks: [],
      summary: 'Read current implementation.',
    },
  });
  it('normalizes explicit passed IDs without creating check evidence', () => {
    const response = normalizeNativeBugfreeResponse(result(['A1', 'A2']), ['A1', 'A2']);
    expect(response.kind).toBe('final-result');
    if (response.kind !== 'final-result') throw Error('Expected final result');
    expect(response.result.acceptance.map((row) => row.id)).toEqual(['A1', 'A2']);
    expect(response.result.acceptance.every((row) => row.reason.includes('语义审查'))).toBe(true);
    expect(() => parseNativeVerifierResponse(result(['A1', 'A2']))).toThrow();
  });
  it.each([
    { passed: ['A1'] },
    { passed: ['A1', 'A1'] },
    { passed: ['A1', 'A3'] },
    { passed: null },
    { passed: ['A1', 'A2'], other: [{ id: 'A2', result: 'failed', reason: 'Actual failure' }] },
    { passed: ['A1'], other: [{ id: 'A2', result: 'passed', reason: 'Mixed format' }] },
  ])('rejects incomplete, conflicting or mixed coverage $passed', ({ passed, other }) => {
    expect(() => normalizeNativeBugfreeResponse(result(passed, other), ['A1', 'A2'])).toThrow();
  });
  it('preserves failed and blocked reasons while requiring failed verdict priority', () => {
    const other = [
      { id: 'A2', result: 'failed', reason: 'Wrong branch' },
      { id: 'A3', result: 'blocked', reason: 'Unavailable environment' },
    ];
    expect(() =>
      normalizeNativeBugfreeResponse(result(['A1'], other, 'blocked'), ['A1', 'A2', 'A3']),
    ).toThrow();
    const response = normalizeNativeBugfreeResponse(result(['A1'], other, 'fail'), [
      'A1',
      'A2',
      'A3',
    ]);
    if (response.kind !== 'final-result') throw Error('Expected final result');
    expect(response.result.acceptance.slice(1)).toEqual(other);
  });
  it('requires fail priority for the complete result format as well', () => {
    const full = {
      kind: 'final-result',
      result: {
        iteration: 1,
        attempt: 1,
        verdict: 'blocked',
        acceptance: [
          { id: 'A1', result: 'failed', reason: 'Wrong behavior' },
          { id: 'A2', result: 'blocked', reason: 'Missing information' },
        ],
        risks: [],
        summary: 'One failure and one blocker',
      },
    };
    expect(() => normalizeNativeBugfreeResponse(full, ['A1', 'A2'])).toThrow('fail verdict');
    expect(() => parseNativeVerifierResponse(full)).not.toThrow();
    expect(
      normalizeNativeBugfreeResponse({ ...full, result: { ...full.result, verdict: 'fail' } }, [
        'A1',
        'A2',
      ]).kind,
    ).toBe('final-result');
  });
  it('never derives an existing Run mode from mutable project configuration', () => {
    expect(nativeVerifyMode({ input: {} })).toBe('standard');
    expect(nativeVerifyMode({ input: { verifyMode: 'bugfree' } })).toBe('bugfree');
    expect(() => nativeVerifyMode({ input: { verifyMode: null } })).toThrow();
    expect(() =>
      assertNativeVerifyModeSupported({ input: { verifyMode: 'bugfree' } }, '1'),
    ).toThrow();
  });
});

it('captures the pre-bugfree builtin identity', () => {
  const hash = hashRuntimeValue(
    defineWorkflow(nativeSdkBeforeBugfree(defineNativeWorkflowApplication().workflow)),
  );
  expect(hash).toBe('6b69940df45e10d64d8086e58369f03b1d0f5872dae0713373cd18c0c5a4b137');
});
