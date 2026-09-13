import { describe, expect, it } from 'vitest';

import {
  parseNativeLifecycleEvidence,
  parseNativeOutcomeEvidence,
  projectNativeExperienceEvidence,
  projectNativeLifecycleEvidence,
  projectNativeOutcomeEvidence,
} from '../../../domains/comet-native/native-experience.js';
import {
  renderNativeCommandDetailed,
  type DispatchResult,
} from '../../../domains/comet-native/native-cli-shared.js';

describe('Native workflow experience evidence', () => {
  it('projects structured command data without reparsing rendered stdout', () => {
    const data = {
      change: {
        phase: 'archive',
        verification: { verdict: 'pass', summary: 'Structured pass.' },
        history: [{ outcome: 'fail' }],
      },
      artifactRefs: ['docs/archive.md'],
      changedPaths: ['src/example.ts'],
    };
    expect(projectNativeOutcomeEvidence(data)).toEqual({
      reviewResolved: true,
      failureResolved: true,
      summary: 'Structured pass.',
    });
    expect(projectNativeLifecycleEvidence(data)).toEqual({
      changedPaths: ['src/example.ts'],
      artifactRefs: ['docs/archive.md'],
    });
  });

  it.each([
    { name: 'default envelope', json: false, verbose: false, envelope: true },
    { name: 'verbose envelope', json: false, verbose: true, envelope: true },
    { name: 'JSON envelope', json: true, verbose: false, envelope: true },
    { name: 'default raw JSON', json: false, verbose: false, envelope: false },
  ])('matches the legacy stdout projection for $name', ({ json, verbose, envelope }) => {
    const data = {
      state: {
        phase: 'archive',
        verification_result: 'pass',
        history: [{ outcome: 'fail' }],
      },
      changedPaths: ['domains/example.ts'],
      artifactRefs: ['docs/verification.md'],
    };
    const result: DispatchResult = {
      command: 'next',
      exitCode: 0,
      data,
      text: `${JSON.stringify(data, null, 2)}\n`,
      ...(envelope ? { envelope: { summary: 'Complete.' } } : {}),
    };
    const rendered = renderNativeCommandDetailed(result, json, verbose);

    expect(projectNativeExperienceEvidence(data, rendered.structuredDataVisible)).toEqual({
      lifecycle: parseNativeLifecycleEvidence(rendered.output.stdout),
      outcome: parseNativeOutcomeEvidence(rendered.output.stdout),
    });
  });

  it('recognizes a verifier pass that resolves an earlier failure', () => {
    const stdout = JSON.stringify({
      data: {
        change: {
          phase: 'archive',
          verification: { verdict: 'pass', summary: 'All acceptance criteria passed.' },
          history: [{ outcome: 'fail' }, { outcome: 'pass' }],
        },
      },
    });

    expect(parseNativeOutcomeEvidence(stdout)).toEqual({
      reviewResolved: true,
      failureResolved: true,
      summary: 'All acceptance criteria passed.',
    });
  });

  it('reads v4 state even when change is a name and retains structured verifier evidence', () => {
    const stdout = JSON.stringify({
      data: {
        change: 'demo',
        state: {
          phase: 'archive',
          verification_result: 'pass',
          verification: {
            verdict: 'pass',
            summary: { text: 'Fixed retry handling.', truncated: false },
          },
          history: [{ goal_cycle: 1, outcome: 'fail' }],
        },
        artifactRefs: ['docs/comet/native/archive/demo/verification.md'],
      },
    });
    expect(parseNativeOutcomeEvidence(stdout)).toEqual({
      reviewResolved: true,
      failureResolved: true,
      summary: 'Fixed retry handling.',
    });
    expect(parseNativeLifecycleEvidence(stdout).artifactRefs).toEqual([
      'docs/comet/native/archive/demo/verification.md',
    ]);
    expect(
      parseNativeOutcomeEvidence(
        JSON.stringify({
          data: {
            state: {
              phase: 'archive',
              verification_result: 'pass',
              learning: { failureResolved: true, summary: 'Recovered' },
            },
          },
        }),
      ),
    ).toEqual({ reviewResolved: true, failureResolved: true, summary: 'Recovered' });
  });

  it('extracts only bounded string lifecycle evidence', () => {
    const stdout = JSON.stringify({
      data: {
        changedPaths: ['domains/a.ts', 42, 'domains/b.ts'],
        artifacts: ['docs/brief.md', null],
      },
    });

    expect(parseNativeLifecycleEvidence(stdout)).toEqual({
      changedPaths: ['domains/a.ts', 'domains/b.ts'],
      artifactRefs: ['docs/brief.md'],
    });
  });

  it('treats malformed output as absent evidence', () => {
    expect(parseNativeOutcomeEvidence('not-json')).toEqual({
      reviewResolved: false,
      failureResolved: false,
    });
    expect(parseNativeLifecycleEvidence(undefined)).toEqual({
      changedPaths: [],
      artifactRefs: [],
    });
  });
});
