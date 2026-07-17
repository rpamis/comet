import { describe, expect, it } from 'vitest';

import {
  NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER,
  NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER,
  deriveBriefAcceptanceCriteria,
  deriveSpecAcceptanceCriteria,
  normalizeNativeAcceptanceText,
  parseNativeVerificationMachineBlock,
  projectNativeAcceptancePage,
  serializeNativeVerificationMachineBlock,
} from '../../../domains/comet-native/native-acceptance.js';
import type { NativeAcceptanceCriterion } from '../../../domains/comet-native/native-acceptance.js';

describe('Native acceptance criteria', () => {
  function criterion(index: number, overrides: Partial<NativeAcceptanceCriterion> = {}) {
    return {
      id: `acceptance-${index.toString(16).padStart(64, '0')}`,
      kind: 'brief-example' as const,
      source: 'brief.md',
      context: [],
      text: `Criterion ${index}.`,
      ...overrides,
    };
  }

  it.each([0, 1, 16, 17, 41])(
    'pages %i acceptance criteria without losing or repeating IDs',
    (count) => {
      const criteria = Array.from({ length: count }, (_, index) => criterion(index + 1));
      const acceptanceHash = 'a'.repeat(64);
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page = projectNativeAcceptancePage({ criteria, acceptanceHash, cursor });
        expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(32 * 1024);
        ids.push(...page.items.map((item) => item.id));
        cursor = page.nextCursor;
      } while (cursor !== null);

      expect(ids).toEqual(criteria.map((item) => item.id));
      expect(new Set(ids).size).toBe(ids.length);
    },
  );

  it('bounds long Unicode text and context without splitting code points', () => {
    const page = projectNativeAcceptancePage({
      acceptanceHash: 'b'.repeat(64),
      criteria: [
        criterion(1, {
          text: '鱼'.repeat(1_000),
          context: ['章'.repeat(500), 'second', 'third', 'fourth', 'fifth'],
        }),
      ],
    });

    expect(Buffer.byteLength(page.items[0].text, 'utf8')).toBeLessThanOrEqual(512);
    expect(page.items[0].text).not.toContain('\uFFFD');
    expect(page.items[0]).toMatchObject({ textTruncated: true, contextTruncated: true });
    expect(page.items[0].context).toHaveLength(4);
    expect(Buffer.byteLength(page.items[0].context[0], 'utf8')).toBeLessThanOrEqual(256);
  });

  it('binds cursors to the acceptance hash and rejects malformed offsets', () => {
    const criteria = Array.from({ length: 17 }, (_, index) => criterion(index + 1));
    const first = projectNativeAcceptancePage({ criteria, acceptanceHash: 'c'.repeat(64) });
    expect(first.nextCursor).not.toBeNull();
    expect(() =>
      projectNativeAcceptancePage({
        criteria,
        acceptanceHash: 'd'.repeat(64),
        cursor: first.nextCursor,
      }),
    ).toThrow('stale');
    expect(() =>
      projectNativeAcceptancePage({
        criteria,
        acceptanceHash: 'c'.repeat(64),
        cursor: `native-acceptance-v1.${'c'.repeat(64)}.00g`,
      }),
    ).toThrow('invalid');
    const tamperedCursor = `${first.nextCursor!.slice(0, -1)}${first.nextCursor!.endsWith('0') ? '1' : '0'}`;
    expect(() =>
      projectNativeAcceptancePage({
        criteria,
        acceptanceHash: 'c'.repeat(64),
        cursor: tamperedCursor,
      }),
    ).toThrow('integrity');
  });

  it('derives stable IDs from Acceptance examples independent of list order and wrapping', () => {
    const first = `# Outcome
Ship login.

# Acceptance examples
- Valid credentials create a session.
- Invalid credentials are rejected
  without revealing which field failed.

# Constraints and invariants
Keep compatibility.
`;
    const reordered = `# Acceptance examples
- Invalid credentials are rejected without revealing which field failed.
- Valid credentials create a session.
`;

    const firstCriteria = deriveBriefAcceptanceCriteria(first);
    const reorderedCriteria = deriveBriefAcceptanceCriteria(reordered);

    expect(new Set(firstCriteria.map(({ id }) => id))).toEqual(
      new Set(reorderedCriteria.map(({ id }) => id)),
    );
    expect(firstCriteria).toHaveLength(2);
    expect(firstCriteria[0]).toMatchObject({
      kind: 'brief-example',
      source: 'brief.md',
      text: 'Valid credentials create a session.',
    });
  });

  it('normalizes whitespace and canonically equivalent Unicode without folding case', () => {
    expect(normalizeNativeAcceptanceText('  Café\r\n  opens\tfast.  ')).toBe('Café opens fast.');
    expect(normalizeNativeAcceptanceText('Café')).toBe('Café');
    expect(normalizeNativeAcceptanceText('PASS')).not.toBe(normalizeNativeAcceptanceText('pass'));
  });

  it('derives Scenario criteria while ignoring headings inside fenced code', () => {
    const spec = `# Authentication

## Requirement: Password login

### Scenario: Valid credentials
- **WHEN** valid credentials are submitted
- **THEN** a session is created

\`\`\`md
### Scenario: Not a real scenario
\`\`\`

### Scenario: Invalid credentials
- **WHEN** invalid credentials are submitted
- **THEN** access is denied
`;

    const criteria = deriveSpecAcceptanceCriteria(spec, 'specs/authentication/spec.md');

    expect(criteria).toHaveLength(2);
    expect(criteria.map(({ source }) => source)).toEqual([
      'specs/authentication/spec.md',
      'specs/authentication/spec.md',
    ]);
    expect(criteria[0]).toMatchObject({
      kind: 'spec-scenario',
      text: expect.stringContaining('Valid credentials'),
    });
    expect(criteria[0].id).not.toBe(criteria[1].id);
  });

  it('keeps the Scenario ID set stable when Scenario blocks are reordered', () => {
    const alpha = `### Scenario: Alpha
Alpha result.

### Scenario: Beta
Beta result.
`;
    const beta = `### Scenario: Beta
Beta result.

### Scenario: Alpha
Alpha result.
`;

    expect(new Set(deriveSpecAcceptanceCriteria(alpha).map(({ id }) => id))).toEqual(
      new Set(deriveSpecAcceptanceCriteria(beta).map(({ id }) => id)),
    );
  });

  it('separates brief examples from scenarios and changes IDs when content changes', () => {
    const briefId = deriveBriefAcceptanceCriteria(
      '# Acceptance examples\n- The result is visible.\n',
    )[0].id;
    const scenarioId = deriveSpecAcceptanceCriteria('### Scenario: The result is visible.\n')[0].id;
    const changedId = deriveBriefAcceptanceCriteria(
      '# Acceptance examples\n- The result is private.\n',
    )[0].id;

    expect(briefId).toMatch(/^acceptance-[a-f0-9]{64}$/u);
    expect(briefId).not.toBe(scenarioId);
    expect(briefId).not.toBe(changedId);
  });

  it('separates identical Scenario text from different capability sources', () => {
    const scenario = '### Scenario: The result is visible.\n- **THEN** it is shown.\n';
    const first = deriveSpecAcceptanceCriteria(scenario, 'specs/alpha/spec.md')[0];
    const second = deriveSpecAcceptanceCriteria(scenario, 'specs/beta/spec.md')[0];

    expect(first.id).not.toBe(second.id);
    expect(first.source).toBe('specs/alpha/spec.md');
    expect(deriveSpecAcceptanceCriteria(scenario, 'specs\\alpha\\spec.md')[0].id).toBe(first.id);
  });

  it('uses parent Requirement context to separate identical Scenarios in one spec', () => {
    const spec = `## Requirement: Public result
### Scenario: Visible
- **THEN** the result is shown.

## Requirement: Private result
### Scenario: Visible
- **THEN** the result is shown.
`;
    const criteria = deriveSpecAcceptanceCriteria(spec);

    expect(criteria).toHaveLength(2);
    expect(criteria[0].context).toEqual(['Requirement: Public result']);
    expect(criteria[1].context).toEqual(['Requirement: Private result']);
    expect(criteria[0].id).not.toBe(criteria[1].id);
  });

  it('does not promote nested list items or commented headings into criteria', () => {
    const brief = `<!--
# Acceptance examples
- Fake commented item.
-->
# Acceptance examples
- Parent outcome.
  - Nested detail.
`;
    const criteria = deriveBriefAcceptanceCriteria(brief);

    expect(criteria).toHaveLength(1);
    expect(criteria[0].text).toContain('Nested detail');
  });

  it.each([1, 2, 3])('accepts a top-level list item indented by %i spaces', (indent) => {
    const brief = `# Acceptance examples\n${' '.repeat(indent)}- Indented outcome.\n`;

    expect(deriveBriefAcceptanceCriteria(brief)).toMatchObject([
      {
        kind: 'brief-example',
        text: 'Indented outcome.',
      },
    ]);
  });

  it('ignores Scenario headings inside HTML blocks', () => {
    const spec = `<div>
### Scenario: HTML example only
</div>

## Requirement: Real
### Scenario: Real scenario
Real result.
`;

    expect(deriveSpecAcceptanceCriteria(spec)).toHaveLength(1);
  });

  it('fails closed on duplicate Acceptance sections and empty criteria', () => {
    expect(() =>
      deriveBriefAcceptanceCriteria(
        '# Acceptance examples\n- First.\n# Acceptance examples\n- Second.\n',
      ),
    ).toThrow('exactly one');
    expect(() => deriveBriefAcceptanceCriteria('# Acceptance examples\n-   \n')).toThrow(
      'must not be empty',
    );
    expect(() => deriveSpecAcceptanceCriteria('### Scenario:\n')).toThrow(
      'Scenario title must not be empty',
    );
  });
});

describe('Native verification acceptance evidence block', () => {
  const entries = [
    {
      acceptance_id: `acceptance-${'1'.repeat(64)}`,
      evidence_refs: ['runtime/evidence/login-test.json'],
    },
    {
      acceptance_id: `acceptance-${'2'.repeat(64)}`,
      evidence_refs: [],
      skipped_reason: 'Requires a hardware security key.',
    },
  ];

  it('round-trips the deterministic fixed block inside ordinary Markdown', () => {
    const block = serializeNativeVerificationMachineBlock(entries);
    const markdown = `# Acceptance evidence

Reviewable summary.

${block}

# Commands and results
Focused tests passed.
`;

    expect(block.startsWith(NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER)).toBe(true);
    expect(block.endsWith(NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER)).toBe(true);
    expect(parseNativeVerificationMachineBlock(markdown)).toEqual(entries);
    expect(serializeNativeVerificationMachineBlock([...entries].reverse())).toBe(block);
  });

  it.each([
    ['a missing block', '# Acceptance evidence\nNone.\n'],
    [
      'a duplicate block',
      `${serializeNativeVerificationMachineBlock(entries)}\n${serializeNativeVerificationMachineBlock(entries)}`,
    ],
    ['a missing end marker', `${NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER}\n[]\n`],
    [
      'an end marker before its start marker',
      `${NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER}\n[]\n${NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER}`,
    ],
    [
      'invalid JSON',
      `${NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER}\n[not-json]\n${NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER}`,
    ],
    [
      'a non-array JSON value',
      `${NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER}\n{}\n${NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER}`,
    ],
  ])('rejects %s', (_label, markdown) => {
    expect(() => parseNativeVerificationMachineBlock(markdown)).toThrow();
  });

  it('rejects machine markers hidden in fenced code or an outer HTML comment', () => {
    const block = serializeNativeVerificationMachineBlock(entries);
    expect(() => parseNativeVerificationMachineBlock(`\`\`\`md\n${block}\n\`\`\``)).toThrow(
      'Markdown body',
    );
    expect(() => parseNativeVerificationMachineBlock(`<!--\n${block}\n-->`)).toThrow(
      'Markdown body',
    );
  });

  it('requires canonical JSON serialization and therefore rejects duplicate keys', () => {
    const id = `acceptance-${'1'.repeat(64)}`;
    const duplicateKey = `${NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER}
[
  {
    "acceptance_id": "${id}",
    "evidence_refs": ["review-visible.json"],
    "evidence_refs": ["machine-only.json"]
  }
]
${NATIVE_ACCEPTANCE_EVIDENCE_END_MARKER}`;
    expect(() => parseNativeVerificationMachineBlock(duplicateKey)).toThrow(
      'canonical serialization',
    );

    const canonical = serializeNativeVerificationMachineBlock(entries);
    expect(() => parseNativeVerificationMachineBlock(canonical.replace('  {', ' {'))).toThrow(
      'canonical serialization',
    );
  });

  it('rejects duplicate or empty acceptance IDs and unknown fields', () => {
    const duplicate = [entries[0], { ...entries[0], evidence_refs: ['other.json'] }];
    expect(() => serializeNativeVerificationMachineBlock(duplicate)).toThrow(
      'duplicate acceptance_id',
    );
    expect(() =>
      serializeNativeVerificationMachineBlock([
        { acceptance_id: '', evidence_refs: ['receipt.json'] },
      ]),
    ).toThrow('acceptance_id');
    expect(() =>
      serializeNativeVerificationMachineBlock([
        {
          ...entries[0],
          result: 'pass',
        },
      ]),
    ).toThrow('unknown field');
  });

  it('requires either evidence refs or a skipped reason, but never both', () => {
    expect(() =>
      serializeNativeVerificationMachineBlock([
        { acceptance_id: `acceptance-${'3'.repeat(64)}`, evidence_refs: [] },
      ]),
    ).toThrow('evidence_refs or skipped_reason');

    expect(() =>
      serializeNativeVerificationMachineBlock([
        {
          acceptance_id: `acceptance-${'3'.repeat(64)}`,
          evidence_refs: ['receipt.json'],
          skipped_reason: 'Not run.',
        },
      ]),
    ).toThrow('must not include both');
  });

  it('rejects empty, duplicate, or non-string evidence refs and blank skipped reasons', () => {
    expect(() =>
      serializeNativeVerificationMachineBlock([
        {
          acceptance_id: `acceptance-${'4'.repeat(64)}`,
          evidence_refs: ['', 'receipt.json'],
        },
      ]),
    ).toThrow('non-empty string');
    expect(() =>
      serializeNativeVerificationMachineBlock([
        {
          acceptance_id: `acceptance-${'4'.repeat(64)}`,
          evidence_refs: ['receipt.json', 'receipt.json'],
        },
      ]),
    ).toThrow('duplicate evidence ref');
    expect(() =>
      serializeNativeVerificationMachineBlock([
        {
          acceptance_id: `acceptance-${'4'.repeat(64)}`,
          evidence_refs: [42],
        },
      ]),
    ).toThrow('non-empty string');
    expect(() =>
      serializeNativeVerificationMachineBlock([
        {
          acceptance_id: `acceptance-${'4'.repeat(64)}`,
          evidence_refs: [],
          skipped_reason: '   ',
        },
      ]),
    ).toThrow('non-empty string');
  });

  it.each(['../outside.json', 'C:/secret.json', 'https://example.test/evidence', '.env'])(
    'rejects unsafe evidence ref %s',
    (reference) => {
      expect(() =>
        serializeNativeVerificationMachineBlock([
          {
            acceptance_id: `acceptance-${'5'.repeat(64)}`,
            evidence_refs: [reference],
          },
        ]),
      ).toThrow();
    },
  );
});
