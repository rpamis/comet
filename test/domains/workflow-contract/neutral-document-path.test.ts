import { describe, expect, it } from 'vitest';
import { isNeutralDocumentPath } from '../../../domains/workflow-contract/neutral-document-path.js';

describe('neutral document paths', () => {
  it('treats root documentation files as neutral', () => {
    expect(isNeutralDocumentPath('README.md')).toBe(true);
    expect(isNeutralDocumentPath('CHANGELOG.md')).toBe(true);
    expect(isNeutralDocumentPath('AGENTS.md')).toBe(true);
    expect(isNeutralDocumentPath('LICENSE')).toBe(true);
    expect(isNeutralDocumentPath('LICENSE-MIT')).toBe(true);
    expect(isNeutralDocumentPath('NOTICE')).toBe(true);
    expect(isNeutralDocumentPath('AUTHORS')).toBe(true);
    // Root text files often feed commands (fixtures, data) and stay bound.
    expect(isNeutralDocumentPath('notes.txt')).toBe(false);
    expect(isNeutralDocumentPath('data.rst')).toBe(false);
  });

  it('treats documentation-directory markdown as neutral', () => {
    expect(isNeutralDocumentPath('docs/guide.md')).toBe(true);
    expect(isNeutralDocumentPath('docs/nested/deep/rst-guide.rst')).toBe(true);
    expect(isNeutralDocumentPath('docs/notes.txt')).toBe(true);
    expect(isNeutralDocumentPath('doc/setup.md')).toBe(true);
    expect(isNeutralDocumentPath('documentation/api.md')).toBe(true);
    expect(isNeutralDocumentPath('.github/ISSUE_TEMPLATE/bug.md')).toBe(true);
  });

  it('keeps source, tests, and non-document files bound', () => {
    expect(isNeutralDocumentPath('src/index.ts')).toBe(false);
    expect(isNeutralDocumentPath('src/component.md')).toBe(false);
    expect(isNeutralDocumentPath('test/fixtures/data.txt')).toBe(false);
    expect(isNeutralDocumentPath('docs/build.js')).toBe(false);
    expect(isNeutralDocumentPath('docs/config.yaml')).toBe(false);
    expect(isNeutralDocumentPath('.github/workflows/ci.yml')).toBe(false);
    expect(isNeutralDocumentPath('package.json')).toBe(false);
    expect(isNeutralDocumentPath('Makefile')).toBe(false);
  });

  it('never treats protected prefixes as neutral', () => {
    const protectedPrefixes = ['openspec', 'docs/superpowers'];
    expect(isNeutralDocumentPath('openspec/changes/demo/tasks.md', protectedPrefixes)).toBe(false);
    expect(
      isNeutralDocumentPath('openspec/changes/demo/specs/cap/spec.md', protectedPrefixes),
    ).toBe(false);
    expect(isNeutralDocumentPath('docs/superpowers/specs/design.md', protectedPrefixes)).toBe(
      false,
    );
    expect(isNeutralDocumentPath('docs/superpowers/plans/plan.md', protectedPrefixes)).toBe(false);
    // Unrelated documentation in the same tree stays neutral.
    expect(isNeutralDocumentPath('docs/guide.md', protectedPrefixes)).toBe(true);
  });

  it('rejects malformed paths', () => {
    expect(isNeutralDocumentPath('')).toBe(false);
    expect(isNeutralDocumentPath('docs/')).toBe(false);
    expect(isNeutralDocumentPath('./README.md')).toBe(true);
    expect(isNeutralDocumentPath('docs\\guide.md')).toBe(true);
  });
});
