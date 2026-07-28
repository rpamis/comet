import { spawnSync } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { readRunState, writeRunState } from '../../../domains/engine/state.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';

const scriptsDir = path.resolve('assets', 'skills', 'comet', 'scripts');
const scriptByCommand: Record<string, string> = {
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
  return spawnSync(process.execPath, [scriptByCommand[command], ...rest], {
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
  run(dir, 'state', 'init', name, 'full');
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
      expect((await runClassicCli(['state', 'init', 'linked-handoff', 'full'])).exitCode).toBe(0);
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

      const result = await runClassicCli(['handoff', 'linked-handoff', 'design', '--write']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toMatch(/symbolic link or junction/iu);
      expect(await fs.readFile(path.join(outside, 'marker.txt'), 'utf8')).toBe('unchanged\n');
      expect(await fs.readdir(outside)).toEqual(['marker.txt']);
    } finally {
      process.chdir(previous);
    }
  });

  it('writes a compact design handoff and records the context fields', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);

    const result = run(dir, 'handoff', 'demo', 'design', '--write');
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      '[HANDOFF] wrote openspec/changes/demo/.comet/handoff/design-context.json',
    );
    expect(result.stderr).toMatch(/\[HANDOFF\] handoff_hash=[a-f0-9]{64}/);

    const md = await fs.readFile(
      path.join(changeDir, '.comet', 'handoff', 'design-context.md'),
      'utf8',
    );
    expect(md).toContain('Generated-by: comet-handoff.sh');
    expect(md).toContain('- Mode: compact');
    expect(md).toContain('- Source: openspec/changes/demo/proposal.md');

    expect(run(dir, 'state', 'get', 'demo', 'handoff_context').stdout.trim()).toBe(
      'openspec/changes/demo/.comet/handoff/design-context.json',
    );
    expect(run(dir, 'state', 'get', 'demo', 'handoff_hash').stdout).toMatch(/^[a-f0-9]{64}/);

    const state = parse(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')) as Record<
      string,
      unknown
    >;
    const runState = await readRunState(changeDir);
    expect(runState).not.toBeNull();
    const context = await fs.readFile(path.join(changeDir, runState!.contextRef), 'utf8');
    const artifacts = JSON.parse(
      await fs.readFile(path.join(changeDir, runState!.artifactsRef), 'utf8'),
    ) as Record<string, string>;
    const checkpoint = JSON.parse(
      await fs.readFile(path.join(changeDir, runState!.checkpointRef), 'utf8'),
    ) as Record<string, unknown>;
    expect(context).toBe(md);
    expect(artifacts).toMatchObject({
      handoff_context: 'openspec/changes/demo/.comet/handoff/design-context.json',
      handoff_markdown: 'openspec/changes/demo/.comet/handoff/design-context.md',
    });
    expect(checkpoint).toMatchObject({
      runId: state.run_id,
      contextHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      artifactsHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(runState!.currentStep).toBe('full.design.document');
    expect(runState!.iteration).toBe(1);
    expect(runState!.pending).toBeNull();
    await expect(fs.access(path.join(changeDir, runState!.pendingRef))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('computes and prints the hash without writing files in --hash-only mode', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);

    const result = run(dir, 'handoff', 'demo', '--hash-only');
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^[a-f0-9]{64}$/);
    expect(existsSync(path.join(changeDir, '.comet', 'handoff'))).toBe(false);
  });

  it('fails closed when source evidence changed after a completed handoff', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);
    expect(run(dir, 'handoff', 'demo', 'design', '--write').status).toBe(0);
    const before = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

    await fs.appendFile(path.join(changeDir, 'proposal.md'), 'changed\n');
    const result = run(dir, 'handoff', 'demo', 'design', '--write');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('stale');
    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).toBe(before);
  });

  it('reconciles a matching pending handoff and records recovery once', async () => {
    const dir = await makeProject();
    const changeDir = await seedDesignChange(dir);
    expect(run(dir, 'handoff', 'demo', 'design', '--write').status).toBe(0);
    const hash = run(dir, 'state', 'get', 'demo', 'handoff_hash').stdout.trim();
    const runStateBefore = await readRunState(changeDir);
    expect(runStateBefore).not.toBeNull();
    const actionId = `classic-handoff:${hash}`;
    await fs.writeFile(
      path.join(changeDir, runStateBefore!.pendingRef),
      JSON.stringify({
        id: actionId,
        stepId: runStateBefore!.currentStep,
        type: 'handoff',
        ref: hash,
      }),
    );
    await writeRunState(changeDir, { ...runStateBefore!, pending: actionId });

    const result = run(dir, 'handoff', 'demo', 'design', '--write');
    expect(result.status).toBe(0);
    const afterRunState = await readRunState(changeDir);
    expect(afterRunState).not.toBeNull();
    expect(afterRunState!.pending).toBeNull();
    const trajectory = (
      await fs.readFile(path.join(changeDir, afterRunState!.trajectoryRef), 'utf8')
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
