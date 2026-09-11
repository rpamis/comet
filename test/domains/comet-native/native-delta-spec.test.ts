import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  applyNativeDelta,
  inspectNativeTotalSpec,
  mergeNativeDelta,
  nativeDeltaAcceptanceMarkdown,
  nativeLegacySectionHash,
  nativeRequirementSectionHash,
  parseNativeDelta,
  type NativeDeltaDocument,
} from '../../../domains/comet-native/native-delta-spec.js';

function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function delta(
  baseline: string,
  operations: NativeDeltaDocument['operations'],
  extra: Partial<NativeDeltaDocument> = {},
): NativeDeltaDocument {
  return {
    schema: 'comet.native.delta.v1',
    capability: 'authentication',
    base_hash: hash(baseline),
    base_version: 1,
    legacy_hash: nativeLegacySectionHash(baseline),
    base_requirements: Object.fromEntries(
      inspectNativeTotalSpec(baseline).requirements.map((requirement) => [
        requirement.id,
        nativeRequirementSectionHash(requirement.raw),
      ]),
    ),
    operations,
    ...extra,
  };
}

describe('Native delta specs', () => {
  it('adds a requirement without replacing existing total capability content', () => {
    const baseline = `# Authentication\n\nThe existing capability remains supported.\n\n## Requirement: authentication.password Password login\n\nPassword login MUST remain available.\n\n`;
    const result = applyNativeDelta({
      baselineMarkdown: baseline,
      delta: delta(baseline, [
        {
          id: 'authentication.sms',
          operation: 'add',
          title: 'SMS login',
          body: 'SMS login MUST be available as an alternative.',
        },
      ]),
    });

    expect(result.markdown).toContain('The existing capability remains supported.');
    expect(result.markdown).toContain('authentication.password');
    expect(result.markdown).toContain('authentication.sms');
    expect(result.changedRequirementIds).toEqual(['authentication.sms']);
  });

  it('modifies, removes, and renames only the addressed stable requirements', () => {
    const baseline = `# Authentication\n\n## Requirement: authentication.password Password login\n\nPassword behavior.\n\n## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`;
    const passwordSection = `## Requirement: authentication.password Password login\n\nPassword behavior.\n\n`;
    const profileSection = `## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`;
    const result = applyNativeDelta({
      baselineMarkdown: baseline,
      delta: delta(baseline, [
        {
          id: 'authentication.password',
          operation: 'modify',
          title: 'Password login',
          body: 'Password behavior with a stronger session check.',
          expected_hash: nativeRequirementSectionHash(passwordSection),
        },
        {
          id: 'authentication.profile',
          operation: 'rename',
          to_id: 'authentication.account-profile',
          expected_hash: nativeRequirementSectionHash(profileSection),
        },
      ]),
    });

    expect(result.markdown).toContain('stronger session check');
    expect(result.markdown).toContain('authentication.account-profile');
    expect(result.markdown).not.toContain('authentication.profile');
    expect(result.markdown).toContain('Profile behavior.');
    expect(result.markdown).toContain('authentication.password');
  });

  it('rejects invalid targets, duplicate operations, and malformed delta input', () => {
    const baseline = '# Authentication\n';
    expect(() =>
      applyNativeDelta({
        baselineMarkdown: baseline,
        delta: delta(baseline, [
          { id: 'authentication.missing', operation: 'modify', body: 'not valid' },
        ]),
      }),
    ).toThrow(/target.*does not exist|expected_hash/iu);

    expect(() =>
      parseNativeDelta(`
schema: comet.native.delta.v1
capability: authentication
base_hash: ${hash(baseline)}
base_version: 1
operations:
  - id: authentication.sms
    operation: add
    body: first
  - id: authentication.sms
    operation: add
    body: second
`),
    ).toThrow(/duplicate|unique/iu);
  });

  it('automatically rebases independent changes and blocks overlapping changes', () => {
    const baseline = `# Authentication\n\n## Requirement: authentication.password Password login\n\nPassword behavior.\n\n## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n`;
    const passwordSection = `## Requirement: authentication.password Password login\n\nPassword behavior.\n\n`;
    const change = delta(
      baseline,
      [
        {
          id: 'authentication.password',
          operation: 'modify',
          body: 'Password behavior with a session check.',
          expected_hash: nativeRequirementSectionHash(passwordSection),
        },
      ],
      {
        independent_requirements: {
          'authentication.profile': nativeRequirementSectionHash(
            '## Requirement: authentication.profile Profile\n\nProfile behavior.\n\n',
          ),
        },
      },
    );
    const independentCurrent = baseline.replace(
      'Profile behavior.',
      'Profile behavior with an avatar.',
    );
    const rebased = mergeNativeDelta({
      baselineMarkdown: baseline,
      currentMarkdown: independentCurrent,
      delta: change,
    });
    expect(rebased.rebased).toBe(true);
    expect(rebased.markdown).toContain('avatar');
    expect(rebased.markdown).toContain('session check');

    expect(() =>
      mergeNativeDelta({
        baselineMarkdown: baseline,
        currentMarkdown: independentCurrent,
        delta: { ...change, base_requirements: undefined },
      }),
    ).toThrow(/base_requirements|independent/iu);

    const conflictingCurrent = baseline.replace('Password behavior.', 'Concurrent password edit.');
    expect(() =>
      mergeNativeDelta({
        baselineMarkdown: baseline,
        currentMarkdown: conflictingCurrent,
        delta: change,
      }),
    ).toThrow(/authentication\.password|conflict/iu);
  });

  it('allows clearly independent edits but blocks shared or referenced requirement impact', () => {
    const baseline = `# Authentication\n\n## Requirement: authentication.password Password login\n\nPassword behavior.\n\n## Requirement: authentication.policy Session policy\n\nSession policy behavior.\n\n`;
    const passwordSection =
      '## Requirement: authentication.password Password login\n\nPassword behavior.\n\n';
    const policySection =
      '## Requirement: authentication.policy Session policy\n\nSession policy behavior.\n\n';
    const change = delta(
      baseline,
      [
        {
          id: 'authentication.password',
          operation: 'modify',
          body: 'Password behavior with a session check.',
          expected_hash: nativeRequirementSectionHash(passwordSection),
        },
      ],
      {
        base_requirements: {
          'authentication.password': nativeRequirementSectionHash(passwordSection),
          'authentication.policy': nativeRequirementSectionHash(policySection),
        },
        independent_requirements: {
          'authentication.policy': nativeRequirementSectionHash(policySection),
        },
      },
    );
    const independent = baseline.replace('Session policy behavior.', 'Session policy with audit.');
    expect(
      mergeNativeDelta({
        baselineMarkdown: baseline,
        currentMarkdown: independent,
        delta: change,
      }).markdown,
    ).toContain('Session policy with audit.');

    const shared = baseline.replace(
      'Session policy behavior.',
      'Shared session policy MUST apply to all authentication flows.',
    );
    expect(() =>
      mergeNativeDelta({
        baselineMarkdown: baseline,
        currentMarkdown: shared,
        delta: change,
      }),
    ).toThrow(/shared|referenced|uncertain/iu);
  });

  it('blocks a concurrent change to legacy shared constraints', () => {
    const baseline = '# Authentication\n\nShared session constraint.\n';
    const change = delta(baseline, [
      { id: 'authentication.sms', operation: 'add', body: 'SMS behavior.' },
    ]);
    const current = baseline.replace('Shared session constraint.', 'Changed session constraint.');

    expect(() =>
      mergeNativeDelta({
        baselineMarkdown: baseline,
        currentMarkdown: current,
        delta: change,
      }),
    ).toThrow(/shared legacy constraints|conflict/iu);
  });

  it('keeps legacy full-text specs readable and makes a legacy merge explicit', () => {
    const baseline = '# Legacy authentication\n\nExisting behavior.\n';
    const change = delta(
      baseline,
      [
        {
          id: 'authentication.sms',
          operation: 'add',
          body: 'SMS behavior.',
        },
      ],
      { legacy_hash: nativeLegacySectionHash(baseline) },
    );
    const result = applyNativeDelta({ baselineMarkdown: baseline, delta: change });
    expect(result.markdown).toContain('Existing behavior.');
    expect(result.markdown).toContain('authentication.sms');

    expect(() =>
      applyNativeDelta({
        baselineMarkdown: baseline,
        delta: delta(
          baseline,
          [{ id: 'authentication.sms', operation: 'add', body: 'SMS behavior.' }],
          { legacy_hash: undefined },
        ),
      }),
    ).toThrow(/legacy_hash|legacy/iu);
  });

  it('scopes acceptance to changed requirements instead of replaying the baseline', () => {
    const baseline = `# Authentication\n\n## Requirement: authentication.password Password login\n\n### Scenario: Password remains available\n\n- **WHEN** a password is submitted\n- **THEN** the session starts\n\n`;
    const target = `${baseline}## Requirement: authentication.sms SMS login\n\n### Scenario: SMS is accepted\n\n- **WHEN** an SMS code is submitted\n- **THEN** the session starts\n\n`;
    const change = delta(baseline, [
      {
        id: 'authentication.sms',
        operation: 'add',
        body: '### Scenario: SMS is accepted\n\n- **WHEN** an SMS code is submitted\n- **THEN** the session starts',
      },
    ]);

    const scoped = nativeDeltaAcceptanceMarkdown(target, change);
    expect(scoped).toContain('SMS is accepted');
    expect(scoped).not.toContain('Password remains available');
  });

  it('is idempotent when recovery sees the already-applied result', () => {
    const baseline = '# Authentication\n';
    const change = delta(baseline, [
      { id: 'authentication.sms', operation: 'add', body: 'SMS behavior.' },
    ]);
    const first = applyNativeDelta({ baselineMarkdown: baseline, delta: change });
    const second = mergeNativeDelta({
      baselineMarkdown: baseline,
      currentMarkdown: first.markdown,
      delta: change,
    });
    expect(second.markdown).toBe(first.markdown);
    expect(second.rebased).toBe(true);
    expect(second.changedRequirementIds).toEqual([]);
  });
});
