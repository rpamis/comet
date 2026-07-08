import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { doctorCommand } from '../../app/commands/doctor.js';

const stateScript = path.resolve('assets', 'skills', 'comet', 'scripts', 'comet-state.mjs');

async function installManagedCometSkills(baseDir: string): Promise<void> {
  const manifest = JSON.parse(
    await fs.readFile(path.resolve('assets', 'manifest.json'), 'utf8'),
  ) as {
    skills: string[];
    internalSkills?: string[];
  };
  const managedPaths = [...new Set([...manifest.skills, ...(manifest.internalSkills ?? [])])];
  for (const relPath of managedPaths) {
    const target = path.join(baseDir, '.claude', 'skills', ...relPath.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${relPath}\n`);
  }
}

function state(cwd: string, ...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (args[0] === 'set' && args[2] === 'phase') {
    // Direct phase writes are normally blocked; the force hatch is the
    // documented way for tooling/tests to seed a change into a specific phase.
    env.COMET_FORCE_PHASE = '1';
  }
  return spawnSync(process.execPath, [stateScript, ...args], {
    cwd,
    encoding: 'utf8',
    env,
  });
}

describe('doctor command', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `comet-doctor-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('accepts current comet state fields in JSON output', async () => {
    const changeDir = path.join(tmpDir, 'openspec', 'changes', 'current-state');
    state(tmpDir, 'init', 'current-state', 'full');
    state(tmpDir, 'set', 'current-state', 'phase', 'verify');
    const before = await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await doctorCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const results = JSON.parse(json).results as Array<{ check: string; status: string }>;
    expect(results.find((result) => result.check === '.comet.yaml: current-state')).toMatchObject({
      status: 'pass',
      message: expect.stringContaining('full.verify.run'),
    });
    expect(await fs.readFile(path.join(changeDir, '.comet.yaml'), 'utf8')).not.toBe(before);
  });

  it('prints the current Comet version in text output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      await doctorCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('Comet CLI: installed (');
  });

  it('explains auto scope and treats global installs as available when project scope is empty', async () => {
    const fakeHome = path.join(tmpDir, 'home');
    await installManagedCometSkills(fakeHome);

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      await doctorCommand(tmpDir, { homeDir: fakeHome });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain(
      'Scope: auto checks project scope first, then global scope when it is different',
    );
    expect(output).toContain('skills: Claude Code (global): complete');
    expect(output).toContain(
      'Project scope: no project-local Comet skills installed; global scope is available',
    );
    expect(output).toContain(
      'run: comet init --scope project only if this project needs its own copy',
    );
    expect(output).not.toContain('skills: Claude Code (project): missing');
  });

  it('does not report non-Comet skill directories as missing Comet installs in auto scope', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'using-superpowers'), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(tmpDir, '.claude', 'skills', 'using-superpowers', 'SKILL.md'),
      '# using-superpowers\n',
    );

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      await doctorCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).not.toContain('skills: Claude Code (project): missing');
    expect(output).toContain('Superpowers: detected');
    expect(output).toContain(
      'Comet skills: not installed in project or global scope — run: comet init',
    );
  });

  it('reports partial Comet installs with an update command instead of a raw missing dump', async () => {
    await fs.mkdir(path.join(tmpDir, '.claude', 'skills', 'comet'), {
      recursive: true,
    });
    await fs.writeFile(path.join(tmpDir, '.claude', 'skills', 'comet', 'SKILL.md'), '# comet\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      await doctorCommand(tmpDir, { scope: 'project' });
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain('skills: Claude Code (project): partial');
    expect(output).toContain('run: comet update --scope project');
    expect(output).not.toContain('missing 31:');
  });

  it('uses the shared schema and leaves invalid state untouched', async () => {
    const invalidChangeDir = path.join(tmpDir, 'openspec', 'changes', 'top-level-invalid');
    state(tmpDir, 'init', 'top-level-invalid', 'full');
    await fs.appendFile(path.join(invalidChangeDir, '.comet.yaml'), 'unknown_root_field: true\n');
    const before = await fs.readFile(path.join(invalidChangeDir, '.comet.yaml'), 'utf8');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await doctorCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    const results = JSON.parse(json).results as Array<{
      check: string;
      status: string;
      message: string;
    }>;

    expect(
      results.find((result) => result.check === '.comet.yaml: top-level-invalid'),
    ).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('unknown_root_field'),
    });
    expect(await fs.readFile(path.join(invalidChangeDir, '.comet.yaml'), 'utf8')).toBe(before);
  });

  it('uses Classic diagnostics for comet yaml validity messages', async () => {
    state(tmpDir, 'init', 'demo', 'full');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let json = '';
    try {
      await doctorCommand(tmpDir, { json: true });
      json = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }
    const payload = JSON.parse(json);
    const cometYaml = payload.results.find(
      (item: { check: string }) => item.check === '.comet.yaml: demo',
    );

    expect(cometYaml.message).toContain('step: full.open');
    expect(cometYaml.message).toContain('mode: engine-projection');
  });

  it('prints runtime check evidence in doctor output for valid changes', async () => {
    state(tmpDir, 'init', 'demo', 'full');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      await doctorCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain(
      'runtime_check: demo: fail (full.open; missing: openspec.proposal, openspec.tasks;',
    );
    expect(output).toContain(
      'next: run /comet-open or restore missing evidence (openspec.proposal, openspec.tasks), then rerun comet doctor',
    );
  });

  it('prints invalid comet yaml errors together with a concrete next step', async () => {
    const invalidChangeDir = path.join(tmpDir, 'openspec', 'changes', 'top-level-invalid');
    state(tmpDir, 'init', 'top-level-invalid', 'full');
    await fs.appendFile(path.join(invalidChangeDir, '.comet.yaml'), 'unknown_root_field: true\n');

    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let output = '';
    try {
      await doctorCommand(tmpDir);
      output = log.mock.calls.map((call) => call.join(' ')).join('\n');
    } finally {
      log.mockRestore();
    }

    expect(output).toContain(
      '.comet.yaml: top-level-invalid: Invalid Classic state: unknown field(s): unknown_root_field',
    );
    expect(output).toContain('next: top-level-invalid: inspect .comet.yaml and rerun comet doctor');
  });
});
