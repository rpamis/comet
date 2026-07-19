import { promises as fs } from 'fs';
import { spawnSync } from 'child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  COMET_RESUME_PROBE_SCHEMA_VERSION,
  resolveCometEntryResumeProbe,
} from '../../../domains/comet-entry/resume-probe.js';
import {
  createNativeChange,
  nativeChangeDir,
} from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import {
  nativeSelectionFile,
  selectNativeChange,
} from '../../../domains/comet-native/native-selection.js';
import { advanceNativeChange } from '../../../domains/comet-native/native-transitions.js';
import { nativeVerificationFixtureReport } from '../../helpers/native-verification.js';

const VALID_BRIEF = `# Outcome
Ship cache controls.
# Scope
Cache expiration behavior.
# Non-goals
No storage migration.
# Acceptance examples
- Cache entries expire predictably.
# Constraints and invariants
Preserve existing APIs.
# Decisions
Use Native state.
# Open questions
None.
# Verification expectations
Run focused cache tests.
`;

const CLASSIC_BUILD_STATE = [
  'workflow: full',
  'phase: build',
  'archived: false',
  'build_pause: null',
  'isolation: branch',
  'build_mode: executing-plans',
  'tdd_mode: direct',
  'review_mode: standard',
  'verify_mode: light',
  'verified_at: null',
  'verify_result: pending',
  'auto_transition: true',
  'design_doc: null',
  'plan: null',
  '',
].join('\n');

async function writeFile(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content, 'utf8');
}

async function createNative(projectRoot: string, name: string, artifactRoot = '.'): Promise<void> {
  const paths = await nativeProjectPaths(projectRoot, artifactRoot);
  const state = await createNativeChange({ paths, name, language: 'en' });
  await fs.writeFile(path.join(nativeChangeDir(paths, name), state.brief), VALID_BRIEF, 'utf8');
}

async function createClassic(projectRoot: string, name: string): Promise<void> {
  const changeDir = path.join(projectRoot, 'openspec', 'changes', name);
  await writeFile(path.join(changeDir, '.comet.yaml'), CLASSIC_BUILD_STATE);
  await writeFile(path.join(changeDir, 'proposal.md'), `# ${name}\n`);
  await writeFile(path.join(changeDir, 'design.md'), `# ${name} design\n`);
  await writeFile(path.join(changeDir, 'tasks.md'), '- [ ] finish\n');
}

function input(utterance: string, nonTrivialWork = true) {
  return {
    schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
    utterance,
    locale: 'zh-CN',
    agent_context: {
      non_trivial_work: nonTrivialWork,
      already_in_comet_flow: false,
    },
  } as const;
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        result[`${relative}/`] = 'directory';
        await visit(absolute);
      } else {
        result[relative] = (await fs.readFile(absolute)).toString('base64');
      }
    }
  }
  await visit(root);
  return result;
}

describe('Comet entry resume probe v2', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-entry-resume-'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('routes a configured Native project only through the permanent Native entry', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'cache-controls');
    await createClassic(projectRoot, 'cache-controls');

    await expect(
      resolveCometEntryResumeProbe(projectRoot, input('继续 cache-controls')),
    ).resolves.toMatchObject({
      schema_version: 'comet.resume_probe.v2',
      workflow: 'native',
      skill: 'comet-native',
      entrySource: 'project-config',
      action: 'auto_resume',
      changeName: 'cache-controls',
      phase: 'shape',
      nextCommand: '/comet-native',
    });
  });

  it('routes configured Classic and legacy projects through the permanent Classic entry', async () => {
    await writeProjectConfig(projectRoot, {
      ...defaultProjectConfig('.'),
      default_workflow: 'classic',
    });
    await createClassic(projectRoot, 'classic-change');
    await createNative(projectRoot, 'native-ignored');

    const configured = await resolveCometEntryResumeProbe(
      projectRoot,
      input('继续 classic-change'),
    );
    expect(configured).toMatchObject({
      workflow: 'classic',
      skill: 'comet-classic',
      entrySource: 'project-config',
      action: 'auto_resume',
      changeName: 'classic-change',
      nextCommand: '/comet-classic',
    });

    await fs.rm(path.join(projectRoot, '.comet', 'config.yaml'));
    const legacy = await resolveCometEntryResumeProbe(projectRoot, input('继续 classic-change'));
    expect(legacy).toMatchObject({
      workflow: 'classic',
      skill: 'comet-classic',
      entrySource: 'legacy-fallback',
      action: 'auto_resume',
      nextCommand: '/comet-classic',
    });
  });

  it.each(['native', 'classic'] as const)(
    'stops before inspecting %s workflow state when Ambient Resume is disabled',
    async (workflow) => {
      const config = {
        ...defaultProjectConfig('.'),
        default_workflow: workflow,
        ambient_resume: false,
      };
      await writeProjectConfig(projectRoot, config);
      await createNative(projectRoot, 'native-disabled');
      await createClassic(projectRoot, 'classic-disabled');

      await expect(resolveCometEntryResumeProbe(projectRoot, input('继续'))).resolves.toMatchObject(
        {
          workflow: null,
          skill: null,
          action: 'out_of_scope',
          reasonCode: 'ambient-resume-disabled',
          nextCommand: null,
        },
      );
    },
  );

  it('preserves the Classic dirty-worktree confirmation rule behind the v2 facade', async () => {
    await createClassic(projectRoot, 'classic-dirty');
    const initialized = spawnSync('git', ['init'], { cwd: projectRoot, encoding: 'utf8' });
    expect(initialized.status, initialized.stderr).toBe(0);

    await expect(
      resolveCometEntryResumeProbe(projectRoot, input('继续 classic-dirty')),
    ).resolves.toMatchObject({
      workflow: 'classic',
      entrySource: 'legacy-fallback',
      action: 'ask_user',
      reasonCode: 'classic-ask-user',
      changeName: 'classic-dirty',
      nextCommand: null,
    });
  });

  it('fails closed with structured Classic output when legacy change state is malformed', async () => {
    await writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'broken-classic', '.comet.yaml'),
      'workflow: [broken\n',
    );

    await expect(
      resolveCometEntryResumeProbe(projectRoot, input('继续 broken-classic')),
    ).resolves.toMatchObject({
      schema_version: 'comet.resume_probe.v2',
      workflow: 'classic',
      skill: 'comet-classic',
      entrySource: 'legacy-fallback',
      action: 'ask_user',
      confidence: 'low',
      reasonCode: 'classic-state-invalid',
      changeName: null,
      phase: null,
      nextCommand: null,
      reason: expect.stringMatching(/invalid|parse|yaml/iu),
    });
  });

  it('fails closed with a structured result when project config is malformed', async () => {
    await createClassic(projectRoot, 'must-not-fallback');
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
    await writeFile(path.join(projectRoot, '.comet', 'config.yaml'), 'schema: [broken\n');

    await expect(resolveCometEntryResumeProbe(projectRoot, input('继续'))).resolves.toMatchObject({
      schema_version: 'comet.resume_probe.v2',
      workflow: null,
      skill: null,
      entrySource: null,
      action: 'ask_user',
      confidence: 'low',
      reasonCode: 'project-config-invalid',
      changeName: null,
      nextCommand: null,
    });
  });

  it('returns none when the configured Native workflow has no active changes', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));

    await expect(resolveCometEntryResumeProbe(projectRoot, input('继续'))).resolves.toMatchObject({
      workflow: 'native',
      skill: 'comet-native',
      action: 'none',
      reasonCode: 'no-active-native-changes',
      changeName: null,
      nextCommand: null,
    });
  });

  it('uses Native selection for multiple changes without guessing from content', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'cache-controls');
    await createNative(projectRoot, 'login-flow');
    const paths = await nativeProjectPaths(projectRoot, '.');

    const ambiguous = await resolveCometEntryResumeProbe(projectRoot, input('继续'));
    expect(ambiguous).toMatchObject({
      action: 'ask_user',
      reasonCode: 'multiple-native-changes',
      changeName: null,
      nextCommand: null,
    });

    await selectNativeChange(paths, 'login-flow');
    const selected = await resolveCometEntryResumeProbe(projectRoot, input('继续'));
    expect(selected).toMatchObject({
      action: 'auto_resume',
      changeName: 'login-flow',
      nextCommand: '/comet-native',
    });

    const explicitlyNamed = await resolveCometEntryResumeProbe(
      projectRoot,
      input('继续 cache-controls'),
    );
    expect(explicitlyNamed).toMatchObject({
      action: 'auto_resume',
      changeName: 'cache-controls',
      nextCommand: '/comet-native',
    });
  });

  it('falls back from a stale selection only when one active Native change is unambiguous', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'only-active');
    const paths = await nativeProjectPaths(projectRoot, '.');
    await writeFile(
      nativeSelectionFile(paths),
      JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'native',
        change: 'missing-change',
        branch: null,
      }),
    );

    const sole = await resolveCometEntryResumeProbe(projectRoot, input('继续'));
    expect(sole).toMatchObject({
      action: 'auto_resume',
      changeName: 'only-active',
      nextCommand: '/comet-native',
    });
    expect(sole.evidence).toContainEqual(
      expect.objectContaining({ source: 'state', quote: expect.stringContaining('ENOENT') }),
    );

    await createNative(projectRoot, 'second-active');
    await expect(resolveCometEntryResumeProbe(projectRoot, input('继续'))).resolves.toMatchObject({
      action: 'ask_user',
      reasonCode: 'multiple-native-changes',
      changeName: null,
      nextCommand: null,
    });
  });

  it('always resumes every valid Native phase through the permanent Native entry', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'phase-routing');
    const paths = await nativeProjectPaths(projectRoot, '.');
    const changeDir = nativeChangeDir(paths, 'phase-routing');
    const phases = ['shape', 'build', 'verify', 'archive'] as const;

    for (const phase of phases) {
      const probe = await resolveCometEntryResumeProbe(projectRoot, input('继续 phase-routing'));
      expect(probe).toMatchObject({
        workflow: 'native',
        action: 'auto_resume',
        changeName: 'phase-routing',
        phase,
        nextCommand: '/comet-native',
      });

      if (phase === 'shape') {
        const advanced = await advanceNativeChange({
          paths,
          name: 'phase-routing',
          evidence: { summary: 'Shape is complete.' },
        });
        expect(advanced.findings).toEqual([]);
      } else if (phase === 'build') {
        const advanced = await advanceNativeChange({
          paths,
          name: 'phase-routing',
          evidence: {
            summary: 'No code is required for the phase routing fixture.',
            noCodeReason: 'The fixture verifies workflow routing only.',
          },
        });
        expect(advanced.findings).toEqual([]);
      } else if (phase === 'verify') {
        await fs.writeFile(
          path.join(changeDir, 'verification.md'),
          await nativeVerificationFixtureReport({ paths, name: 'phase-routing' }),
          'utf8',
        );
        const advanced = await advanceNativeChange({
          paths,
          name: 'phase-routing',
          evidence: {
            summary: 'Verification passed.',
            verificationResult: 'pass',
            verificationReport: 'verification.md',
          },
        });
        expect(advanced.findings).toEqual([]);
      }
    }
  });

  it('does not attach an unrelated request to the only Native change', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'cache-controls');

    await expect(
      resolveCometEntryResumeProbe(projectRoot, input('给 README 添加安装截图')),
    ).resolves.toMatchObject({
      workflow: 'native',
      action: 'out_of_scope',
      reasonCode: 'request-unrelated',
      changeName: 'cache-controls',
      nextCommand: null,
    });
  });

  it('does not return a resume command for a corrupt Native target', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const paths = await nativeProjectPaths(projectRoot, '.');
    const broken = path.join(paths.changesDir, 'broken-change');
    await writeFile(path.join(broken, 'comet-state.yaml'), 'schema: [broken\n');

    await expect(
      resolveCometEntryResumeProbe(projectRoot, input('继续 broken-change')),
    ).resolves.toMatchObject({
      workflow: 'native',
      action: 'ask_user',
      reasonCode: 'native-change-invalid',
      changeName: 'broken-change',
      phase: 'invalid',
      nextCommand: null,
    });

    await expect(
      resolveCometEntryResumeProbe(projectRoot, input('给 README 添加安装截图')),
    ).resolves.toMatchObject({
      action: 'out_of_scope',
      reasonCode: 'request-unrelated',
      nextCommand: null,
    });
  });

  it('does not auto-resume a Native change whose artifacts fail validation', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'invalid-brief');
    const paths = await nativeProjectPaths(projectRoot, '.');
    await fs.writeFile(
      path.join(nativeChangeDir(paths, 'invalid-brief'), 'brief.md'),
      '# Scope\nOnly a scope remains.\n',
      'utf8',
    );

    const probe = await resolveCometEntryResumeProbe(projectRoot, input('继续 invalid-brief'));

    expect(probe).toMatchObject({
      workflow: 'native',
      action: 'ask_user',
      reasonCode: 'native-change-invalid',
      changeName: 'invalid-brief',
      phase: 'shape',
      nextCommand: null,
    });
    expect(probe.evidence).toContainEqual({
      source: 'state',
      quote: 'finding: brief-section-missing',
    });
  });

  it('does not resume while a Native artifact-root move is incomplete', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'moving-change');
    const config = defaultProjectConfig('.');
    config.native.pending_root_move = {
      id: 'deadbeef-0001',
      fromArtifactRoot: '.',
      toArtifactRoot: 'docs',
      stage: 'copying',
    };
    await writeProjectConfig(projectRoot, config);

    await expect(
      resolveCometEntryResumeProbe(projectRoot, input('继续 moving-change')),
    ).resolves.toMatchObject({
      workflow: 'native',
      skill: 'comet-native',
      action: 'ask_user',
      reasonCode: 'native-state-invalid',
      changeName: null,
      nextCommand: null,
      reason: expect.stringContaining('comet native doctor --repair'),
    });
  });

  it('does not make a dirty worktree a Native resume blocker', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    await createNative(projectRoot, 'cache-controls');
    const initialized = spawnSync('git', ['init'], { cwd: projectRoot, encoding: 'utf8' });
    expect(initialized.status, initialized.stderr).toBe(0);
    await writeFile(path.join(projectRoot, 'notes.txt'), 'uncommitted user work\n');

    const result = await resolveCometEntryResumeProbe(projectRoot, input('继续 cache-controls'));

    expect(result).toMatchObject({
      action: 'auto_resume',
      changeName: 'cache-controls',
      nextCommand: '/comet-native',
    });
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ source: 'repo', quote: expect.stringContaining('dirty file') }),
    );
  });

  it('discovers a custom Native root from a nested path and remains read-only', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    await createNative(projectRoot, 'cache-controls', 'docs');
    const nested = path.join(projectRoot, 'src', 'nested');
    await fs.mkdir(nested, { recursive: true });
    const before = await snapshot(projectRoot);

    const result = await resolveCometEntryResumeProbe(nested, input('继续 cache-controls'));

    expect(result).toMatchObject({
      workflow: 'native',
      action: 'auto_resume',
      changeName: 'cache-controls',
    });
    expect(await snapshot(projectRoot)).toEqual(before);
  });
});
