import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  validateNativeBrief,
  validateNativeSpecDocumentText,
} from '../../../domains/comet-native/native-artifacts.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  nativePortableChangeDir,
  readNativePortableChange,
  validateNativePortableDocuments,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { nativeNextCommand } from '../../../domains/comet-native/native-next-command.js';

const completeBrief = `# Outcome
Ship the documented behavior.
# Scope
The requested behavior only.
# Non-goals
None.
# Acceptance examples
- The behavior works.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run the focused Native checks.
`;

describe('Native document constraints', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-document-constraints-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('requires every brief section to contain real content at the strict boundary', async () => {
    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace('# Decisions\nNone.', '# Decisions\n'),
    );

    await expect(validateNativeBrief(root, 'brief.md', { strict: true })).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'brief-section-empty', path: 'brief.md' })],
    });
  });

  it('accepts explicit no-item statements but rejects template-only content', async () => {
    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace(
        '# Constraints and invariants\nPreserve existing compatibility.',
        '# Constraints and invariants\nTODO: fill this in.',
      ),
    );

    await expect(validateNativeBrief(root, 'brief.md', { strict: true })).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'brief-section-placeholder' })],
    });

    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace('# Outcome\nShip the documented behavior.', '# Outcome\n- None.'),
    );
    await expect(validateNativeBrief(root, 'brief.md', { strict: true })).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'brief-section-empty' })],
    });

    await fs.writeFile(path.join(root, 'brief.md'), completeBrief);
    await expect(validateNativeBrief(root, 'brief.md', { strict: true })).resolves.toEqual({
      valid: true,
      findings: [],
    });
  });

  it('rejects empty and template-only target specs with actionable findings', () => {
    expect(validateNativeSpecDocumentText('', 'specs/auth/spec.md')).toMatchObject({
      valid: false,
      findings: [
        expect.objectContaining({ code: 'spec-document-empty', path: 'specs/auth/spec.md' }),
      ],
    });
    expect(validateNativeSpecDocumentText('# Authentication', 'specs/auth/spec.md')).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-empty' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\nTODO: fill this in.', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\n<TODO>', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\n**<TODO>**', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\nTODO: explain later', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\n```\nTODO\n```', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
  });

  it('rejects placeholder-only product behavior exemptions at the Shape boundary', async () => {
    const projectRoot = path.join(root, 'placeholder-exemption-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'placeholder-exemption', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'placeholder-exemption');
    for (const reason of [
      'No product behavior change: TODO',
      'No product behavior change: TODO: explain later',
      'No product behavior change: 待补充',
      'No product behavior change: 不涉及产品行为',
      '<!-- No product behavior change: explain reason here -->',
      'No product behavior change: {{reason}}',
    ]) {
      await fs.writeFile(
        path.join(changeDir, 'brief.md'),
        completeBrief.replace('# Decisions\nNone.', `# Decisions\n${reason}`),
      );

      await expect(
        nativeNextCommand(['placeholder-exemption', '--summary', 'Prepare Shape'], projectRoot),
      ).rejects.toThrow(/spec-exemption-missing/u);
    }

    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace(
        '# Decisions\nNone.',
        '# Decisions\nNo product behavior change: 仅更新说明文档。',
      ),
    );
    await expect(
      nativeNextCommand(['placeholder-exemption', '--summary', 'Prepare Shape'], projectRoot),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  it('blocks the public Shape transition and succeeds after the documented repair', async () => {
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'doc-change', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'doc-change');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace('# Decisions\nNone.', '# Decisions\n'),
    );

    await expect(
      nativeNextCommand(['doc-change', '--summary', 'Prepare Shape'], projectRoot),
    ).rejects.toThrow(/brief-section-empty[\s\S]*rerun the latest continuation command/u);

    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace(
        '# Decisions\nNone.',
        '# Decisions\nNo product behavior change: documentation-only wording.',
      ),
    );
    const prepared = await nativeNextCommand(
      ['doc-change', '--summary', 'Prepare Shape'],
      projectRoot,
    );
    expect(prepared.exitCode).toBe(0);
    expect(prepared.data as { state: { status: string } }).toMatchObject({
      state: { status: 'await-user' },
    });
    await expect(readNativePortableChange(paths, 'doc-change')).resolves.toMatchObject({
      document_constraints_version: 1,
    });
  });

  it('allows a formal removal without a target Spec or exemption', async () => {
    const projectRoot = path.join(root, 'removal-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'remove-change',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    const removal = { capability: 'legacy-capability', operation: 'remove' as const, source: null };

    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [removal] },
        specChanges: [removal],
      }),
    ).resolves.toMatchObject({ valid: true, findings: [] });
  });

  it('does not let an exemption hide a previously declared missing target Spec', async () => {
    const projectRoot = path.join(root, 'missing-spec-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'missing-spec-change',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace(
        '# Decisions\nNone.',
        '# Decisions\nNo product behavior change: documentation-only wording.',
      ),
    );
    const declared = {
      capability: 'declared-capability',
      operation: 'create' as const,
      source: 'specs/declared-capability/spec.md',
    };

    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [declared] },
        specChanges: [],
      }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-missing' })],
    });
  });

  it('covers reject-repair-retry for exemption, target content, and formal path checks', async () => {
    const projectRoot = path.join(root, 'repair-matrix-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'repair-matrix',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);

    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    await expect(
      validateNativePortableDocuments({ paths, state, specChanges: [] }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-exemption-missing' })],
    });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace(
        '# Decisions\nNone.',
        '# Decisions\nNo product behavior change: documentation-only wording.',
      ),
    );
    await expect(
      validateNativePortableDocuments({ paths, state, specChanges: [] }),
    ).resolves.toMatchObject({ valid: true, findings: [] });

    const declared = {
      capability: 'repairable-capability',
      operation: 'create' as const,
      source: 'specs/repairable-capability/spec.md',
    };
    const declaredState = { ...state, spec_changes: [declared] };
    await expect(
      validateNativePortableDocuments({ paths, state: declaredState, specChanges: [] }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-missing' })],
    });
    await fs.mkdir(path.join(changeDir, 'specs', 'repairable-capability'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'repairable-capability', 'spec.md'),
      '# Repairable capability\n\n## Requirement\nThe repaired target is complete.\n',
    );
    await expect(
      validateNativePortableDocuments({ paths, state: declaredState, specChanges: [declared] }),
    ).resolves.toMatchObject({ valid: true, findings: [] });

    await expect(
      validateNativePortableDocuments({
        paths,
        state: declaredState,
        specChanges: [{ ...declared, source: 'specs/wrong-location/spec.md' }],
      }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-source-path-invalid' })],
    });
    await expect(
      validateNativePortableDocuments({ paths, state: declaredState, specChanges: [declared] }),
    ).resolves.toMatchObject({ valid: true, findings: [] });
  });
});
