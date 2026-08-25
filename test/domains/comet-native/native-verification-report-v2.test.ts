import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyNativeVerifierEnvelope,
  confirmNativePortableAcceptance,
  reserveNativeVerifierAttempt,
  submitNativeBuilderCandidate,
} from '../../../domains/comet-native/native-loop-runtime.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import { toNativePortableText } from '../../../domains/comet-native/native-portable-text.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import {
  inspectNativeVerificationReportAlignment,
  nativeVerificationReportStateVersion,
  renderNativeVerificationReport,
  writeNativeVerificationReport,
} from '../../../domains/comet-native/native-verification-report-v2.js';

describe('Native verification report projection', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  function passedState() {
    const runner = createNativeRunnerChannel();
    let state = confirmNativePortableAcceptance({
      state: createNativePortableState({ name: 'report-change', language: 'en' }),
      acceptance: [{ id: 'A1', source: 'brief.md', text: 'The report is readable.' }],
    });
    state = submitNativeBuilderCandidate({
      state,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'builder',
        }),
        candidateId: 'candidate',
        summary: 'Built it.',
        addressedAcceptanceIds: ['A1'],
        review: {
          status: 'passed',
          summary: 'Read-only review passed.',
          reviewerExecutionRef: 'reviewer',
        },
      },
    });
    state = reserveNativeVerifierAttempt(state);
    return applyNativeVerifierEnvelope({
      state,
      checks: [
        {
          id: 'test',
          name: toNativePortableText('Tests'),
          argv_display: [toNativePortableText('test')],
          argv_truncated: false,
          cwd_ref: '.',
          status: 'passed',
          exit_code: 0,
          duration_ms: 10,
        },
      ],
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: 'candidate',
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'verifier',
        }),
        payload: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: [{ id: 'A1', result: 'passed', reason: 'Read the generated report.' }],
            risks: [],
            summary: 'Verification passed.',
          },
        },
      }),
    }).state;
  }

  it('renders a human report bound only to the YAML state version', () => {
    const state = passedState();
    const report = renderNativeVerificationReport(state);
    expect(nativeVerificationReportStateVersion(report)).toBe(state.state_version);
    expect(report).toContain('| A1 | passed |');
    expect(report).toContain('Verification passed.');
    expect(report).toContain(
      'Verification status: **Checks completed, but your confirmation is required**',
    );
    expect(report).not.toMatch(/sha-?256|receipt|snapshot|evidence hash/iu);
  });

  it.each([
    ['host-attested', 'Host independently verified'],
    ['skill-coordinated', 'Checks completed, but your confirmation is required'],
    [
      'semantic-verification-unavailable',
      'Full verification was unavailable; only automatic checks completed',
    ],
    ['user-confirmed-degraded', 'You accepted the incomplete verification result'],
  ] as const)('renders a plain-language label for %s', (assurance, label) => {
    const state = passedState();
    state.verification!.assurance = assurance;
    expect(renderNativeVerificationReport(state)).toContain(`Verification status: **${label}**`);
  });

  it('does not keep the confirmation prompt after skill-coordinated acceptance', () => {
    const state = passedState();
    state.phase = 'archive';
    state.loop.next_action = 'archive';
    state.verification!.assurance = 'skill-coordinated';
    expect(state.phase).toBe('archive');
    expect(state.loop.next_action).toBe('archive');
    expect(state.verification!.assurance).toBe('skill-coordinated');
    expect(renderNativeVerificationReport(state)).toContain(
      'Verification status: **Checks completed; result confirmed**',
    );
    expect(renderNativeVerificationReport({ ...state, archived: true })).toContain(
      'Result: **Archived**',
    );
    expect(renderNativeVerificationReport({ ...state, archived: true })).not.toContain(
      'your confirmation is required',
    );
    state.language = 'zh-CN';
    expect(renderNativeVerificationReport(state)).toContain(
      '验证情况: **已完成检查，验证结果已确认**',
    );
  });

  it('rebuilds a missing or stale report without rerunning verification', async () => {
    const state = passedState();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-report-'));
    roots.push(root);
    const file = path.join(root, 'verification.md');
    expect(
      await inspectNativeVerificationReportAlignment({ file, stateVersion: state.state_version }),
    ).toBe('missing');
    await fs.writeFile(file, '---\ngenerated_from_state_version: 1\n---\nold\n');
    expect(
      await inspectNativeVerificationReportAlignment({ file, stateVersion: state.state_version }),
    ).toBe('stale');
    await writeNativeVerificationReport({ file, state });
    expect(
      await inspectNativeVerificationReportAlignment({ file, stateVersion: state.state_version }),
    ).toBe('aligned');
  });
});
