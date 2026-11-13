import { spawnSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { resolveClassicRunDirectory } from '../../../domains/comet-classic/classic-runtime-paths.js';
import { readRunState, writeRunState } from '../../../domains/engine/state.js';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const scriptByCommand: Record<string, string> = {
  guard: path.join(scriptsDir, 'comet-guard.mjs'),
  handoff: path.join(scriptsDir, 'comet-handoff.mjs'),
  state: path.join(scriptsDir, 'comet-state.mjs'),
};
const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

function run(cwd: string, ...args: string[]) {
  const [command, ...rest] = args;
  return spawnSync(process.execPath, [scriptByCommand[command as string], ...rest], {
    cwd,
    encoding: 'utf8',
  });
}

async function makeProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-handoff-'));
  temporary.push(dir);
  await fs.mkdir(path.join(dir, '.comet'), { recursive: true });
  await fs.writeFile(
    path.join(dir, '.comet', 'config.yaml'),
    [
      'schema: comet.project.v1',
      'default_workflow: classic',
      'workflows: [classic]',
      'classic:',
      '  artifact_layout: legacy',
      '',
    ].join('\n'),
  );
  await fs.mkdir(path.join(dir, 'openspec', 'changes'), { recursive: true });
  return dir;
}

async function seedDesignChange(dir: string, name = 'demo'): Promise<string> {
  run(dir, 'state', 'init', name, 'full', '--runtime', 'compat');
  const changeDir = path.join(dir, 'openspec', 'changes', name);
  // Open→design transition requires the open artifacts to exist first.
  await fs.writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
  await fs.writeFile(path.join(changeDir, 'design.md'), 'design\n');
  await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] implement handoff\n');
  run(dir, 'state', 'transition', name, 'open-complete'); // open -> design (full workflow)
  return changeDir;
}

describe('Classic handoff command', () => {
  it('rejects a nested handoff junction without writing outside the project', async () => {
    const dir = await makeProject();
    const previous = process.cwd();
    process.chdir(dir);
    try {
      expect(
        (await runClassicCli(['state', 'init', 'linked-handoff', 'full', '--runtime', 'compat']))
          .exitCode,
      ).toBe(0);
      const changeDir = path.join(dir, 'openspec', 'changes', 'linked-handoff');
      await fs.writeFile(path.join(changeDir, 'proposal.md'), 'proposal\n');
      await fs.writeFile(path.join(changeDir, 'design.md'), 'design\n');
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] implement\n');
      expect(
        (await runClassicCli(['state', 'transition', 'linked-handoff', 'open-complete'])).exitCode,
      ).toBe(0);

      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-handoff-outside-'));
      temporary.push(outside);
      await fs.writeFile(path.join(outside, 'marker.txt'), 'unchanged\n');
      await fs.symlink(
        outside,
        path.join(changeDir, '.comet', 'handoff'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const result = await runClassicCli([
        'handoff',
        'linked-handoff',
        'design',
        '--write',
        '--full',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/symbolic link or junction/iu);
      expect(await fs.readFile(path.join(outside, 'marker.txt'), 'utf8')).toBe('unchanged\n');
      expect(await fs.readdir(outside)).toEqual(['marker.txt']);
    } finally {
      process.chdir(previous);
    }
  });

  it('references original requirements without generating a default handoff copy', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);
    const result = run(dir, 'handoff', 'demo', 'design', '--write');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain('[HANDOFF] source openspec/changes/demo/proposal.md');
    expect(existsSync(path.join(changeDir, '.comet/handoff'))).toBe(false);
    expect(run(dir, 'state', 'get', 'demo', 'handoff_context').stdout.trim()).toBe(
      'openspec/changes/demo/proposal.md',
    );
    expect(run(dir, 'state', 'get', 'demo', 'handoff_hash').stdout.trim()).toBe('null');
    const state = await readRunState(await resolveClassicRunDirectory(changeDir));
    expect(state).toMatchObject({
      currentStep: 'full.design.document',
      iteration: 1,
      pending: null,
    });
    expect(
      await fs.readFile(
        path.join(await resolveClassicRunDirectory(changeDir), state!.contextRef),
        'utf8',
      ),
    ).toBe(await fs.readFile(path.join(changeDir, 'proposal.md'), 'utf8'));
    await expect(
      fs.access(path.join(await resolveClassicRunDirectory(changeDir), state!.pendingRef)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('generates one complete optional handoff view without advancing the original Run', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);
    expect(run(dir, 'handoff', 'demo', 'design', '--write').status).toBe(0);
    const before = await readRunState(await resolveClassicRunDirectory(changeDir));
    const spec = path.join(changeDir, 'specs', 'nested', 'worker', 'spec.md');
    await fs.mkdir(path.dirname(spec), { recursive: true });
    await fs.writeFile(spec, 'The complete nested worker requirement.\n');
    const result = run(dir, 'handoff', 'demo', 'design', '--write', '--full');
    expect(result.status, result.stderr).toBe(0);
    expect(await fs.readdir(path.join(changeDir, '.comet/handoff'))).toEqual(['design-context.md']);
    const view = await fs.readFile(
      path.join(changeDir, '.comet/handoff/design-context.md'),
      'utf8',
    );
    expect(view).toContain('The complete nested worker requirement.');
    expect(view).toContain('openspec/changes/demo/specs/nested/worker/spec.md');
    expect(view).not.toContain('sha256');
    expect(await readRunState(await resolveClassicRunDirectory(changeDir))).toEqual(before);
  });

  it('refreshes the design handoff from the build phase after a Spec Patch', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);
    expect(run(dir, 'handoff', 'demo', 'design', '--write').status).toBe(0);
    const beforeContext = run(dir, 'state', 'get', 'demo', 'handoff_context').stdout.trim();
    const beforeText = await fs.readFile(path.join(dir, beforeContext), 'utf8');

    // Enter build through the real guard transition, not a forced phase write.
    // The full workflow requires a recorded Design Doc before leaving design.
    const designDoc = path.join(dir, 'docs', 'superpowers', 'specs', 'demo-design.md');
    await fs.mkdir(path.dirname(designDoc), { recursive: true });
    await fs.writeFile(
      designDoc,
      [
        '---',
        'comet_change: demo',
        'role: technical-design',
        'canonical_spec: openspec',
        '---',
        '',
        '# Design',
        '',
      ].join('\n'),
    );
    expect(
      run(dir, 'state', 'set', 'demo', 'design_doc', 'docs/superpowers/specs/demo-design.md')
        .status,
    ).toBe(0);
    const guard = run(dir, 'guard', 'demo', 'design', '--apply');
    expect(guard.status, guard.stderr).toBe(0);
    expect(run(dir, 'state', 'get', 'demo', 'phase').stdout.trim()).toBe('build');
    const runStateBefore = await readRunState(await resolveClassicRunDirectory(changeDir));
    expect(runStateBefore).not.toBeNull();
    expect(runStateBefore!.currentStep).toBe('full.build.configure');

    // Spec Patch the source evidence while in build.
    await fs.appendFile(path.join(changeDir, 'proposal.md'), 'build-phase change\n');

    const result = run(dir, 'handoff', 'demo', 'design', '--write');
    expect(result.status, result.stderr).toBe(0);
    const afterContext = run(dir, 'state', 'get', 'demo', 'handoff_context').stdout.trim();
    expect(await fs.readFile(path.join(dir, afterContext), 'utf8')).toContain('build-phase change');
    expect(await fs.readFile(path.join(dir, afterContext), 'utf8')).not.toBe(beforeText);
    expect(run(dir, 'state', 'get', 'demo', 'handoff_hash').stdout.trim()).toBe('null');

    // The refresh must not move the workflow phase or the Runtime currentStep.
    expect(run(dir, 'state', 'get', 'demo', 'phase').stdout.trim()).toBe('build');
    const runStateAfter = await readRunState(await resolveClassicRunDirectory(changeDir));
    expect(runStateAfter).not.toBeNull();
    expect(runStateAfter!.currentStep).toBe('full.build.configure');
  });

  it('reconciles a matching pending handoff and records recovery once', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);
    expect(run(dir, 'handoff', 'demo', 'design', '--write').status).toBe(0);
    const hash = run(dir, 'state', 'get', 'demo', 'handoff_hash').stdout.trim();
    const runStateBefore = await readRunState(await resolveClassicRunDirectory(changeDir));
    expect(runStateBefore).not.toBeNull();
    const actionId = `classic-handoff:${hash}`;
    await fs.writeFile(
      path.join(await resolveClassicRunDirectory(changeDir), runStateBefore!.pendingRef),
      JSON.stringify({
        id: actionId,
        stepId: runStateBefore!.currentStep,
        type: 'handoff',
        ref: hash,
      }),
    );
    await writeRunState(await resolveClassicRunDirectory(changeDir), {
      ...runStateBefore!,
      pending: actionId,
    });

    const result = run(dir, 'handoff', 'demo', 'design', '--write');
    expect(result.status).toBe(0);
    const afterRunState = await readRunState(await resolveClassicRunDirectory(changeDir));
    expect(afterRunState).not.toBeNull();
    expect(afterRunState!.pending).toBeNull();
    expect(run(dir, 'handoff', 'demo', 'design', '--write').status).toBe(0);
    const trajectory = (
      await fs.readFile(
        path.join(await resolveClassicRunDirectory(changeDir), afterRunState!.trajectoryRef),
        'utf8',
      )
    )
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line) as { type: string; data?: { kind?: string } });
    expect(
      trajectory.filter(
        (event) => event.type === 'recovery_reconciled' && event.data?.kind === 'classic-handoff',
      ),
    ).toHaveLength(1);
  });
});
