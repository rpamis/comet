import { describe, expect, it } from 'vitest';

import { buildNativeContractSnapshot } from '../../../domains/comet-native/native-contract.js';

const brief = `# Outcome
Ship authentication.

# Acceptance examples
- Valid credentials create a session.
`;

const authSpec = `## Requirement: Password login
### Scenario: Invalid credentials
- **WHEN** invalid credentials are submitted
- **THEN** access is denied
`;

function replaceSpec(capability = 'authentication') {
  return {
    capability,
    operation: 'replace' as const,
    source: `specs/${capability}/spec.md`,
    baseHash: 'a'.repeat(64),
    markdown: authSpec,
  };
}

describe('Native contract snapshot', () => {
  it('is deterministic across spec input order and includes brief plus Scenario criteria', () => {
    const first = buildNativeContractSnapshot({
      briefMarkdown: brief,
      specs: [replaceSpec('zeta-2-auth'), replaceSpec('alpha-10-auth')],
    });
    const reordered = buildNativeContractSnapshot({
      briefMarkdown: brief,
      specs: [replaceSpec('alpha-10-auth'), replaceSpec('zeta-2-auth')],
    });

    expect(first).toEqual(reordered);
    expect(first.contractHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.acceptance).toHaveLength(3);
    expect(first.specs.map(({ capability }) => capability)).toEqual([
      'alpha-10-auth',
      'zeta-2-auth',
    ]);
  });

  it('changes the contract hash for brief, target spec, operation, or canonical base changes', () => {
    const baseline = buildNativeContractSnapshot({ briefMarkdown: brief, specs: [replaceSpec()] });
    const variants = [
      buildNativeContractSnapshot({
        briefMarkdown: brief.replace('create a session', 'create a secure session'),
        specs: [replaceSpec()],
      }),
      buildNativeContractSnapshot({
        briefMarkdown: brief,
        specs: [{ ...replaceSpec(), markdown: authSpec.replace('denied', 'rejected') }],
      }),
      buildNativeContractSnapshot({
        briefMarkdown: brief,
        specs: [{ ...replaceSpec(), operation: 'create', baseHash: null }],
      }),
      buildNativeContractSnapshot({
        briefMarkdown: brief,
        specs: [{ ...replaceSpec(), baseHash: 'b'.repeat(64) }],
      }),
    ];

    expect(new Set(variants.map(({ contractHash }) => contractHash))).toHaveLength(4);
    for (const variant of variants) expect(variant.contractHash).not.toBe(baseline.contractHash);
  });

  it('records remove operations without inventing target content or acceptance criteria', () => {
    const contract = buildNativeContractSnapshot({
      briefMarkdown: brief,
      specs: [
        {
          capability: 'legacy-login',
          operation: 'remove',
          source: null,
          baseHash: 'c'.repeat(64),
          markdown: null,
        },
      ],
    });

    expect(contract.specs[0]).toMatchObject({
      operation: 'remove',
      source: null,
      contentHash: null,
    });
    expect(contract.acceptance).toHaveLength(1);
  });

  it('rejects duplicate capabilities, unsafe refs, and missing structured acceptance', () => {
    expect(() =>
      buildNativeContractSnapshot({
        briefMarkdown: brief,
        specs: [replaceSpec(), replaceSpec()],
      }),
    ).toThrow('duplicate capabilities');
    expect(() =>
      buildNativeContractSnapshot({
        briefMarkdown: brief,
        specs: [{ ...replaceSpec(), source: '../outside.md' }],
      }),
    ).toThrow('project-relative ref');
    for (const source of [
      '.',
      'specs/auth/',
      'specs\\auth\\spec.md',
      ' specs/auth/spec.md',
      'specs/auth/spec.md\n',
      'C:/spec.md',
      '//server/share/spec.md',
    ]) {
      expect(() =>
        buildNativeContractSnapshot({
          briefMarkdown: brief,
          specs: [{ ...replaceSpec(), source }],
        }),
      ).toThrow('project-relative ref');
    }
    expect(() =>
      buildNativeContractSnapshot({
        briefMarkdown: '# Acceptance examples\nThis is prose only.\n',
        specs: [],
      }),
    ).toThrow('no structured acceptance criteria');
  });

  it('fails closed before an acceptance set can exceed the model-context budget', () => {
    const examples = Array.from(
      { length: 1_025 },
      (_, index) => `- Bounded acceptance criterion ${index + 1}.`,
    ).join('\n');
    expect(() =>
      buildNativeContractSnapshot({
        briefMarkdown: `# Acceptance examples\n${examples}\n`,
        specs: [],
      }),
    ).toThrow('1024-criterion acceptance budget');
  });

  it('rejects a near-maximum dense Markdown list without materializing every criterion', () => {
    const denseExamples = '- x\n'.repeat(1_048_000);
    expect(Buffer.byteLength(denseExamples, 'utf8')).toBeLessThanOrEqual(4 * 1024 * 1024);
    expect(() =>
      buildNativeContractSnapshot({
        briefMarkdown: `# Acceptance examples\n${denseExamples}`,
        specs: [],
      }),
    ).toThrow('1024-criterion acceptance budget');
  }, 10_000);

  it('rejects a source shared by the brief or another capability', () => {
    expect(() =>
      buildNativeContractSnapshot({
        briefSource: 'specs/authentication/spec.md',
        briefMarkdown: brief,
        specs: [replaceSpec()],
      }),
    ).toThrow('duplicate artifact sources');
    expect(() =>
      buildNativeContractSnapshot({
        briefMarkdown: brief,
        specs: [
          replaceSpec('alpha-auth'),
          { ...replaceSpec('beta-auth'), source: 'specs/alpha-auth/spec.md' },
        ],
      }),
    ).toThrow('duplicate artifact sources');
  });

  it('normalizes line endings without changing the contract hash', () => {
    const lf = buildNativeContractSnapshot({ briefMarkdown: brief, specs: [replaceSpec()] });
    const crlf = buildNativeContractSnapshot({
      briefMarkdown: brief.replaceAll('\n', '\r\n'),
      specs: [{ ...replaceSpec(), markdown: authSpec.replaceAll('\n', '\r\n') }],
    });

    expect(crlf).toEqual(lf);
  });

  it('rejects invalid create, replace, and remove base/source combinations', () => {
    expect(() =>
      buildNativeContractSnapshot({
        briefMarkdown: brief,
        specs: [{ ...replaceSpec(), operation: 'create', baseHash: 'a'.repeat(64) }],
      }),
    ).toThrow('requires a null base hash');
    expect(() =>
      buildNativeContractSnapshot({
        briefMarkdown: brief,
        specs: [{ ...replaceSpec(), baseHash: null }],
      }),
    ).toThrow('requires a base hash');
    expect(() =>
      buildNativeContractSnapshot({
        briefMarkdown: brief,
        specs: [
          {
            capability: 'legacy-login',
            operation: 'remove',
            source: 'specs/legacy-login/spec.md',
            baseHash: 'a'.repeat(64),
            markdown: authSpec,
          },
        ],
      }),
    ).toThrow('requires only a base hash');
  });
});
