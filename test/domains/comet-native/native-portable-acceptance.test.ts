import { describe, expect, it } from 'vitest';

import {
  assertNativePortableAcceptanceIds,
  buildNativePortableAcceptance,
  sameNativePortableAcceptance,
} from '../../../domains/comet-native/native-portable-acceptance.js';

describe('Native portable acceptance', () => {
  it('assigns readable sequential IDs without content hashes', () => {
    const acceptance = buildNativePortableAcceptance({
      briefMarkdown: `# Acceptance examples
- Login succeeds with valid credentials.
- Invalid credentials do not create a session.
`,
      specs: [
        {
          capability: 'session',
          source: 'specs/session/spec.md',
          markdown: `### Scenario: Session expiry
- **WHEN** a session expires
- **THEN** the next request is rejected
`,
        },
      ],
    });

    expect(acceptance.map(({ id }) => id)).toEqual(['A1', 'A2', 'A3']);
    expect(JSON.stringify(acceptance)).not.toMatch(/[a-f0-9]{64}/u);
    expect(() => assertNativePortableAcceptanceIds(acceptance)).not.toThrow();
  });

  it('creates one acceptance item per explicit scenario and ignores descriptive prose', () => {
    const acceptance = buildNativePortableAcceptance({
      briefMarkdown: `# Acceptance examples
- The brief outcome remains observable.
`,
      specs: [
        {
          capability: 'verification-loop',
          source: 'specs/verification-loop/spec.md',
          markdown: `## Requirement: Repair verification
The repair round should stay focused and fast.

- The Runtime keeps already passing results.
- The next attempt uses the affected scenario IDs.

### Scenario: Repair scope passes
- **WHEN** a repair changes one previously failing scenario
- **THEN** only the affected scenarios are checked in that repair round
- **AND** a final full verification is prepared before Archive

### Scenario: Final verification passes
- **WHEN** every scenario is checked together on the final candidate
- **THEN** the change may continue to Archive
`,
        },
      ],
    });

    expect(acceptance).toHaveLength(3);
    expect(acceptance.map(({ text }) => text)).toEqual([
      'The brief outcome remains observable.',
      expect.stringContaining('Repair scope passes'),
      expect.stringContaining('Final verification passes'),
    ]);
    expect(acceptance.map(({ text }) => text).join('\n')).not.toContain(
      'The Runtime keeps already passing results.',
    );
  });

  it('rejects empty and duplicate acceptance definitions', () => {
    expect(() =>
      buildNativePortableAcceptance({ briefMarkdown: '# Outcome\nNothing yet.\n' }),
    ).toThrow('at least one');
    expect(() =>
      buildNativePortableAcceptance({
        briefMarkdown: `# Acceptance examples
- Same outcome.
- Same outcome.
`,
      }),
    ).toThrow('duplicate');
  });

  it('compares confirmed acceptance by source and full text', () => {
    const first = [
      { source: 'brief.md', text: 'First.' },
      { source: 'specs/api/spec.md', text: 'Second.' },
    ];
    expect(sameNativePortableAcceptance(first, [...first])).toBe(true);
    expect(sameNativePortableAcceptance(first, [first[1], first[0]])).toBe(false);
    expect(sameNativePortableAcceptance(first, [{ ...first[0], text: 'Changed.' }, first[1]])).toBe(
      false,
    );
  });

  it('requires a contiguous A1..An sequence', () => {
    expect(() => assertNativePortableAcceptanceIds([{ id: 'A1' }, { id: 'A3' }])).toThrow(
      'contiguous',
    );
  });

  it('does not reject a valid acceptance set at the legacy criterion budget', () => {
    const items = Array.from({ length: 1_025 }, (_, index) => `- Observable result ${index + 1}.`);
    const acceptance = buildNativePortableAcceptance({
      briefMarkdown: `# Acceptance examples\n${items.join('\n')}\n`,
    });
    expect(acceptance).toHaveLength(1_025);
    expect(acceptance.at(-1)?.id).toBe('A1025');
  });
});
