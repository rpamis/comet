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
    expect(report).not.toMatch(/sha-?256|receipt|snapshot|evidence hash/iu);
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
