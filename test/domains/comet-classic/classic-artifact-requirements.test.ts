import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readClassicArtifactRequirements,
  requiredArtifactClosure,
  recordClassicArchiveRequirements,
  classicArchivedRequirementsProblems,
} from '../../../domains/comet-classic/classic-artifact-requirements.js';
import * as openspec from '../../../domains/comet-classic/classic-openspec-command.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

const artifact = (id: string, requires: string[] = [], status = 'done') => ({
  id,
  requires,
  status,
  outputPath: `${id}.md`,
});

describe('Classic OpenSpec artifact adapter', () => {
  let root: string;
  let directory: string;
  const cli = (...args: string[]) =>
    withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(args),
    );
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-artifacts-'));
    await prepareClassicLegacyProject(root);
    expect((await cli('state', 'init', 'demo', 'full')).exitCode).toBe(0);
    directory = path.join(root, 'openspec/changes/demo');
    await fs.writeFile(
      path.join(directory, '.openspec.yaml'),
      'schema: spec-driven\nskip_specs: true\n',
    );
    await fs.writeFile(
      path.join(directory, 'proposal.md'),
      '# Proposal\nRefactor without behavior changes.\n',
    );
    await fs.writeFile(path.join(directory, 'tasks.md'), '- [ ] Refactor and run tests\n');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  function status(designRequired = false) {
    return {
      changeRoot: directory,
      applyRequires: ['tasks'],
      artifacts: [
        artifact('proposal'),
        { ...artifact('specs', ['proposal'], 'skipped'), outputPath: 'specs/**/*.md' },
        artifact('design', ['proposal'], 'ready'),
        artifact('tasks', designRequired ? ['specs', 'design'] : ['specs']),
      ],
    };
  }
  function mockStatus(data = status()) {
    return vi
      .spyOn(openspec, 'executeClassicOpenSpec')
      .mockResolvedValue({ exitCode: 0, stdout: JSON.stringify(data) });
  }
  it.each(['off', 'beta'])(
    'accepts explicitly skipped specs and optional design through Open and %s handoff',
    async (mode) => {
      mockStatus();
      await cli('state', 'set', 'demo', 'context_compression', mode);
      const required = await readClassicArtifactRequirements(root, directory);
      expect(required).toMatchObject({ designRequired: false, skipped: ['specs'], problems: [] });
      expect((await cli('guard', 'demo', 'open')).exitCode).toBe(0);
      const recoveredOpen = await cli('state', 'check', 'demo', 'open', '--recover');
      expect(recoveredOpen.exitCode, recoveredOpen.stderr).toBe(0);
      expect(recoveredOpen.stdout).toContain('All artifacts complete');
      expect(recoveredOpen.stdout).not.toContain('design.md: PENDING');
      const transition = await cli('state', 'transition', 'demo', 'open-complete');
      expect(transition.exitCode, transition.stderr).toBe(0);
      const handoff = await cli('handoff', 'demo', 'design', '--write');
      expect(handoff.exitCode, handoff.stderr).toBe(0);
      const recoveredDesign = await cli('state', 'check', 'demo', 'design', '--recover');
      expect(recoveredDesign.exitCode, recoveredDesign.stderr).toBe(0);
      expect(recoveredDesign.stdout).not.toContain('design.md: MISSING');
    },
  );
  it('does not confuse done tasks with ready dependencies', async () => {
    mockStatus(status(true));
    const required = await readClassicArtifactRequirements(root, directory);
    expect(required.designRequired).toBe(true);
    expect(required.problems.join('\n')).toContain('design');
    expect((await cli('state', 'transition', 'demo', 'open-complete')).exitCode).not.toBe(0);
  });
  it('archives optional design through the command and final guard', async () => {
    const previous = process.cwd();
    vi.stubEnv('COMET_FORCE_PHASE', '1');
    try {
      process.chdir(root);
      for (const [field, value] of [
        ['phase', 'archive'],
        ['verify_result', 'pass'],
        ['branch_status', 'handled'],
      ]) {
        expect((await cli('state', 'set', 'demo', field, value)).exitCode).toBe(0);
      }
      await fs.writeFile(path.join(directory, 'tasks.md'), '- [x] Refactor and run tests\n');
      expect((await cli('state', 'transition', 'demo', 'archive-confirm')).exitCode).toBe(0);
      vi.spyOn(openspec, 'executeClassicOpenSpec').mockImplementation(async (args) => {
        if (args[0] === 'status') return { exitCode: 0, stdout: JSON.stringify(status()) };
        expect(args).toEqual(['archive', 'demo', '--yes']);
        const archived = path.join(
          root,
          `openspec/changes/archive/${new Date().toISOString().slice(0, 10)}-demo`,
        );
        await fs.mkdir(path.dirname(archived), { recursive: true });
        await fs.rename(directory, archived);
        return { exitCode: 0, stdout: 'Archived' };
      });
      const archived = await cli('archive', 'demo');
      expect(archived.exitCode, archived.stderr).toBe(0);
      const guarded = await cli('guard', 'demo', 'archive');
      expect(guarded.exitCode, guarded.stderr).toBe(0);
    } finally {
      process.chdir(previous);
      vi.unstubAllEnvs();
    }
  });
  it('preserves optional design requirements after archive without querying active changes', async () => {
    const query = mockStatus();
    await fs.mkdir(path.join(directory, '.comet'), { recursive: true });
    await recordClassicArchiveRequirements(root, directory);
    const archived = path.join(root, 'openspec/changes/archive/2026-09-09-demo');
    await fs.mkdir(path.dirname(archived), { recursive: true });
    await fs.rename(directory, archived);
    query.mockRejectedValue(new Error('Active change no longer exists'));
    expect(await classicArchivedRequirementsProblems(root, archived)).toEqual([]);
    await fs.unlink(path.join(archived, 'tasks.md'));
    expect((await classicArchivedRequirementsProblems(root, archived)).join('\n')).toContain(
      'tasks.md',
    );
    await fs.writeFile(
      path.join(archived, '.comet/archive-requirements.json'),
      JSON.stringify({
        schema: 'comet.classic.archive-requirements.v1',
        files: ['proposal.md', 'tasks.md', '../outside.md'],
      }),
    );
    await expect(classicArchivedRequirementsProblems(root, archived)).rejects.toThrow(
      'Invalid Classic archive',
    );
  });
  it('rejects conflicting nested specs and missing skip approval', async () => {
    mockStatus();
    await fs.writeFile(path.join(directory, '.openspec.yaml'), 'schema: spec-driven\n');
    await expect(readClassicArtifactRequirements(root, directory)).rejects.toThrow(
      'explicit skip_specs',
    );
    await fs.writeFile(
      path.join(directory, '.openspec.yaml'),
      'schema: spec-driven\nskip_specs: true\n',
    );
    await fs.mkdir(path.join(directory, 'specs/domain/feature'), { recursive: true });
    await fs.writeFile(path.join(directory, 'specs/domain/feature/spec.md'), '# Changed behavior');
    await expect(readClassicArtifactRequirements(root, directory)).rejects.toThrow(
      'conflicting spec',
    );
  });
  it('refuses an upstream status routed to another planning root', async () => {
    mockStatus({ ...status(), changeRoot: path.join(root, 'other') });
    await expect(readClassicArtifactRequirements(root, directory)).rejects.toThrow(
      'selected Classic change',
    );
  });
});

describe('OpenSpec required artifact closure', () => {
  it('includes transitive dependencies even when tasks already reports done', () => {
    const required = requiredArtifactClosure({
      applyRequires: ['tasks'],
      artifacts: [
        artifact('proposal'),
        artifact('specs', ['proposal'], 'ready'),
        artifact('design', ['proposal']),
        artifact('tasks', ['specs', 'design']),
      ],
    });
    expect(required.map((item) => item.id)).toEqual(['proposal', 'specs', 'design', 'tasks']);
    expect(required.find((item) => item.id === 'specs')?.status).toBe('ready');
  });
  it('does not require optional design outside the actual closure', () => {
    expect(
      requiredArtifactClosure({
        applyRequires: ['tasks'],
        artifacts: [
          artifact('proposal'),
          artifact('specs', ['proposal'], 'skipped'),
          artifact('design', ['proposal'], 'ready'),
          artifact('tasks', ['specs']),
        ],
      }).map((item) => item.id),
    ).toEqual(['proposal', 'specs', 'tasks']);
  });
  it('rejects unavailable edges, missing dependencies and cycles instead of guessing readiness', () => {
    expect(() =>
      requiredArtifactClosure({
        applyRequires: ['tasks'],
        artifacts: [{ id: 'tasks', status: 'done', outputPath: 'tasks.md' }],
      }),
    ).toThrow('dependency edges');
    expect(() =>
      requiredArtifactClosure({
        applyRequires: ['tasks'],
        artifacts: [artifact('tasks', ['missing'])],
      }),
    ).toThrow('Missing');
    expect(() =>
      requiredArtifactClosure({
        applyRequires: ['tasks'],
        artifacts: [artifact('tasks', ['proposal']), artifact('proposal', ['tasks'])],
      }),
    ).toThrow('Cyclic');
  });
});
