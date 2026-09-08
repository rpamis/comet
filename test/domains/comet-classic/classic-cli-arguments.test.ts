import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import { classicGuardCommand } from '../../../domains/comet-classic/classic-guard.js';
import { classicHandoffCommand } from '../../../domains/comet-classic/classic-handoff.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';

describe('Classic public argument safety', () => {
  let root: string;
  const options = () => ({ json: false, invocationCwd: root, projectRoot: root });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-args-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    await fs.mkdir(path.join(root, '.comet'));
    await fs.writeFile(
      path.join(root, '.comet/config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    await fs.mkdir(path.join(root, 'openspec/changes'), { recursive: true });
    const result = await classicStateCommand(['init', 'demo', 'tweak'], options());
    expect(result.exitCode, result.stderr).toBe(0);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects unsupported dry-run before writing state', async () => {
    const stateFile = path.join(root, 'openspec/changes/demo/.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');
    const result = await classicStateCommand(
      ['set', 'demo', 'verify_result', 'pass', '--dry-run'],
      options(),
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('comet state');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  });

  it('rejects a misspelled apply flag before Guard work', async () => {
    const result = await classicGuardCommand(['demo', 'open', '--aplly'], options());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Usage: comet guard');
    expect(result.stderr).not.toContain('ALL CHECKS PASSED');
  });

  it.each([
    ['demo'],
    ['demo', 'design'],
    ['demo', 'design', '--write', '--bogus'],
    ['demo', '--hash-only', '--write'],
  ])('rejects unsupported handoff form %j before looking up artifacts', async (...args) => {
    const stateFile = path.join(root, 'openspec/changes/demo/.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');
    const result = await classicHandoffCommand(args, options());
    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain('Usage: comet handoff');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  });

  it.each(['state', 'guard', 'handoff', 'archive', 'validate', 'workspace'])(
    'provides useful %s help without interpreting it as a change',
    async (command) => {
      const result = await runClassicCli([command, '--help']);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain('Usage: comet');
      expect(result.stdout).not.toContain('.mjs');
    },
  );
});
