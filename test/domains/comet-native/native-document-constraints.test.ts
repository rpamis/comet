import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
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
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';

const completeBrief = `# Outcome
Ship the documented behavior.
# Scope
The requested behavior only.
## Directory structure
### Created
None.
### Modified
- The behavior module.
### Deleted
None.
### Not created
None.
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

  it('rejects empty target specs at the file boundary', () => {
    expect(validateNativeSpecDocumentText('', 'specs/auth/spec.md')).toMatchObject({
      valid: false,
      findings: [
        expect.objectContaining({ code: 'spec-document-empty', path: 'specs/auth/spec.md' }),
      ],
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

  it('lets Shape replace a previously declared target Spec before confirmation', async () => {
    const projectRoot = path.join(root, 'retarget-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'retarget-change', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'retarget-change');
    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    const writeSpec = async (capability: string) => {
      await fs.mkdir(path.join(changeDir, 'specs', capability), { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'specs', capability, 'spec.md'),
        `# ${capability}\n\n## Requirement\nThe ${capability} behavior is complete.\n`,
      );
    };
    await writeSpec('original-capability');

    const first = await nativeNextCommand(
      ['retarget-change', '--summary', 'Prepare Shape'],
      projectRoot,
    );
    expect(first.exitCode).toBe(0);
    await expect(readNativePortableChange(paths, 'retarget-change')).resolves.toMatchObject({
      phase: 'shape',
      status: 'await-user',
      spec_changes: [expect.objectContaining({ capability: 'original-capability' })],
    });

    await fs.rm(path.join(changeDir, 'specs', 'original-capability'), {
      recursive: true,
      force: true,
    });
    await writeSpec('replacement-capability');
    const pending = await readNativePortableChange(paths, 'retarget-change');
    const stateFile = path.join(changeDir, 'comet-state.yaml');
    const pendingBytes = await fs.readFile(stateFile);
    await expect(
      nativeNextCommand(
        [
          'retarget-change',
          '--revise-requirements',
          '--summary',
          'SIMULATED user changes the unapproved target',
        ],
        projectRoot,
      ),
    ).rejects.toThrow('User decisions require --expected-state-version and --expected-action');
    expect(await fs.readFile(stateFile)).toEqual(pendingBytes);
    const revision = await nativeNextCommand(
      [
        'retarget-change',
        '--revise-requirements',
        '--summary',
        'SIMULATED user replaces the proposed target before approval',
        '--expected-state-version',
        String(pending.state_version),
        '--expected-action',
        'revise-requirements',
      ],
      projectRoot,
    );
    expect(revision.exitCode).toBe(0);
    const retargeted = await nativeNextCommand(
      ['retarget-change', '--summary', 'Prepare Shape'],
      projectRoot,
    );
    expect(retargeted.exitCode).toBe(0);
    const prepared = await readNativePortableChange(paths, 'retarget-change');
    await expect(
      fs.access(path.join(changeDir, 'specs/original-capability')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      await fs.readFile(path.join(changeDir, 'specs/replacement-capability/spec.md'), 'utf8'),
    ).toContain('The replacement-capability behavior is complete.');
    expect(prepared).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      spec_changes: [
        {
          capability: 'replacement-capability',
          operation: 'create',
          source: 'specs/replacement-capability/spec.md',
        },
      ],
    });
  });

  it('lets an SDK Shape revision replace a previously declared target Spec', async () => {
    const projectRoot = path.join(root, 'sdk-retarget-project');
    const home = path.join(root, 'sdk-retarget-home');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(home, { recursive: true });
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
      const cli = async (...args: string[]) => {
        const result = await runNativeCli([...args, '--project-root', projectRoot, '--json']);
        return { exitCode: result.exitCode, json: JSON.parse(result.stdout ?? '{}') };
      };
      expect((await cli('new', 'sdk-retarget', '--runtime', 'sdk')).exitCode).toBe(0);
      const changeDir = path.join(projectRoot, 'docs/comet/changes/sdk-retarget');
      await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
      const writeSpec = async (capability: string) => {
        await fs.mkdir(path.join(changeDir, 'specs', capability), { recursive: true });
        await fs.writeFile(
          path.join(changeDir, 'specs', capability, 'spec.md'),
          `# ${capability}\n\n## Requirement\nThe ${capability} behavior is complete.\n`,
        );
      };
      const state = async () =>
        (await inspectNativeSdkRun(projectRoot, 'sdk-retarget', { readOnly: true })).state;
      await writeSpec('original-capability');
      expect((await cli('next', 'sdk-retarget', '--summary', 'Prepare Shape')).exitCode).toBe(0);
      expect(await state()).toMatchObject({
        status: 'await-user',
        spec_changes: [expect.objectContaining({ capability: 'original-capability' })],
      });

      await fs.rm(path.join(changeDir, 'specs', 'original-capability'), {
        recursive: true,
        force: true,
      });
      await writeSpec('replacement-capability');
      const status = await cli('status', 'sdk-retarget');
      const revise = (
        status.json.data.continuation.commandAlternatives as Array<{
          name: string;
          commandArgs: string[];
        }>
      ).find(({ name }) => name === 'revise-requirements');
      expect(revise).toBeDefined();
      const reviseArgs = revise!.commandArgs
        .slice(2)
        .map((arg) => (arg === '<summary>' ? 'User changed the target capability.' : arg))
        .filter(
          (arg, index, all) =>
            arg !== '--json' && arg !== '--project-root' && all[index - 1] !== '--project-root',
        );
      const revised = await cli(...reviseArgs);
      expect(revised.exitCode, JSON.stringify(revised.json.summary)).toBe(0);
      const prepared = await state();
      expect(prepared).toMatchObject({
        phase: 'shape',
        status: 'await-user',
        spec_changes: [
          {
            capability: 'replacement-capability',
            operation: 'create',
            source: 'specs/replacement-capability/spec.md',
          },
        ],
      });

      const confirmed = await cli(
        'next',
        'sdk-retarget',
        '--confirmed',
        '--summary',
        'User approved Shape.',
        '--expected-state-version',
        String(prepared.state_version),
        '--expected-action',
        'confirm-shape',
      );
      expect(confirmed.exitCode).toBe(0);
      expect(await state()).toMatchObject({
        phase: 'build',
        spec_changes: [expect.objectContaining({ capability: 'replacement-capability' })],
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps a confirmed target Spec bound after Shape', async () => {
    const projectRoot = path.join(root, 'confirmed-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'confirmed-change',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    await fs.mkdir(path.join(changeDir, 'specs', 'replacement-capability'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'replacement-capability', 'spec.md'),
      '# Replacement\n\n## Requirement\nThe replacement behavior is complete.\n',
    );
    const declared = {
      capability: 'declared-capability',
      operation: 'create' as const,
      source: 'specs/declared-capability/spec.md',
    };
    const replacement = {
      capability: 'replacement-capability',
      operation: 'create' as const,
      source: 'specs/replacement-capability/spec.md',
    };

    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [declared] },
        specChanges: [replacement],
      }),
    ).resolves.toMatchObject({ valid: true, findings: [] });
    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, phase: 'build', spec_changes: [declared] },
        specChanges: [replacement],
      }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [
        expect.objectContaining({
          code: 'spec-document-missing',
          path: 'specs/declared-capability/spec.md',
        }),
      ],
    });
  });

  it('does not let an unrelated Shape removal hide a declared target Spec', async () => {
    const projectRoot = path.join(root, 'unrelated-removal-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'unrelated-removal-change',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    const declared = {
      capability: 'declared-capability',
      operation: 'modify' as const,
      source: 'specs/declared-capability/spec.md',
    };
    const remove = (capability: string) => ({
      capability,
      operation: 'remove' as const,
      source: null,
    });

    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [declared] },
        specChanges: [remove('legacy-capability')],
      }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [
        expect.objectContaining({
          code: 'spec-document-missing',
          path: 'specs/declared-capability/spec.md',
        }),
      ],
    });
    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [declared] },
        specChanges: [remove('declared-capability')],
      }),
    ).resolves.toMatchObject({ valid: true, findings: [] });
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
