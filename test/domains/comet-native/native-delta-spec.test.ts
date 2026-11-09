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

  it('applies the Agent-selected requirement edit and preserves independent current sections', () => {
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
    expect(rebased.changedRequirementIds).toEqual(['authentication.password']);
    expect(rebased.markdown).toContain('avatar');
    expect(rebased.markdown).toContain('session check');

    expect(
      mergeNativeDelta({
        baselineMarkdown: baseline,
        currentMarkdown: independentCurrent,
        delta: { ...change, base_requirements: undefined },
      }).markdown,
    ).toBe(rebased.markdown);

    const conflictingCurrent = baseline.replace('Password behavior.', 'Concurrent password edit.');
    const selected = mergeNativeDelta({
      baselineMarkdown: baseline,
      currentMarkdown: conflictingCurrent,
      delta: change,
    });
    expect(selected.markdown).toContain('Password behavior with a session check.');
    expect(selected.markdown).not.toContain('Concurrent password edit.');
    expect(selected.markdown).toContain('Profile behavior.');
  });

  it('preserves unselected shared policy text while applying the selected requirement', () => {
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
    const merged = mergeNativeDelta({
      baselineMarkdown: baseline,
      currentMarkdown: shared,
      delta: change,
    });
    expect(merged.markdown).toContain(
      'Shared session policy MUST apply to all authentication flows.',
    );
    expect(merged.markdown).toContain('Password behavior with a session check.');
  });

  it('preserves current legacy constraints when adding a selected requirement', () => {
    const baseline = '# Authentication\n\nShared session constraint.\n';
    const change = delta(baseline, [
      { id: 'authentication.sms', operation: 'add', body: 'SMS behavior.' },
    ]);
    const current = baseline.replace('Shared session constraint.', 'Changed session constraint.');

    const merged = mergeNativeDelta({
      baselineMarkdown: baseline,
      currentMarkdown: current,
      delta: change,
    });
    expect(merged.markdown).toContain('Changed session constraint.');
    expect(merged.markdown).toContain('SMS behavior.');
  });

  it('keeps legacy full-text specs readable without requiring a content proof', () => {
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

    const withoutProof = applyNativeDelta({
      baselineMarkdown: baseline,
      delta: delta(
        baseline,
        [{ id: 'authentication.sms', operation: 'add', body: 'SMS behavior.' }],
        { legacy_hash: undefined },
      ),
    });
    expect(withoutProof.markdown).toBe(result.markdown);
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
    expect(second.markdown.match(/## Requirement: authentication\.sms/g)).toHaveLength(1);
    expect(second.changedRequirementIds).toEqual([]);
  });
});
