import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { classicResumeProbeCommand } from '../../../domains/comet-classic/classic-resume-probe-command.js';

const buildYaml = [
  'workflow: full',
  'language: en',
  'phase: build',
  'context_compression: off',
  'build_mode: executing-plans',
  'build_pause: null',
  'subagent_dispatch: null',
  'tdd_mode: tdd',
  'review_mode: standard',
  'isolation: branch',
  'verify_mode: full',
  'auto_transition: true',
  'base_ref: null',
  'design_doc: docs/superpowers/specs/cache-ttl.md',
  'plan: docs/superpowers/plans/cache-ttl.md',
  'verify_result: pending',
  'verification_report: null',
  'branch_status: pending',
  'created_at: 2026-01-01',
  'verified_at: null',
  'archived: false',
  'direct_override: true',
  'handoff_context: null',
  'handoff_hash: null',
  '',
].join('\n');

const originalCwd = process.cwd();
let tmpDir: string;

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function createActiveChange(name: string): Promise<string> {
  const changeDir = path.join(tmpDir, 'openspec', 'changes', name);
  await fs.mkdir(changeDir, { recursive: true });
  await writeFile(path.join(changeDir, '.comet.yaml'), buildYaml);
  await writeFile(path.join(changeDir, 'proposal.md'), 'Improve cache ttl\n');
  await writeFile(path.join(changeDir, 'design.md'), 'Cache ttl design\n');
  await writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Update cache ttl\n');
  await writeFile(path.join(tmpDir, 'docs/superpowers/specs/cache-ttl.md'), '# Cache TTL\n');
  await writeFile(
    path.join(tmpDir, 'docs/superpowers/plans/cache-ttl.md'),
    '- [ ] Update cache ttl\n',
  );
  return changeDir;
}

const SAMPLE_INPUT = JSON.stringify({
  schema_version: 'comet.resume_probe.v1',
  utterance: 'continue cache-ttl',
  locale: 'en',
  agent_context: { non_trivial_work: true, already_in_comet_flow: false },
});

async function runWithStdin<T>(payload: string, fn: () => Promise<T>): Promise<T> {
  const originalStdin = process.stdin;
  const input = new PassThrough();
  input.end(payload);
  Object.defineProperty(process, 'stdin', { value: input, configurable: true });

  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  }
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-resume-probe-command-'));
  process.chdir(tmpDir);
  await createActiveChange('cache-ttl');
});

afterEach(async () => {
  process.chdir(originalCwd);
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

describe('classicResumeProbeCommand', () => {
  it('prints usage for missing probe subcommand input', async () => {
    const result = await classicResumeProbeCommand([], { json: false });

    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain('Usage: comet-resume-probe.mjs probe <input-json>');
  });

  it('reports invalid JSON with exit code 1', async () => {
    const result = await classicResumeProbeCommand(['probe', '{'], { json: false });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Invalid JSON');
  });

  it('returns parsed probe result for `probe <input-json>`', async () => {
    const result = await classicResumeProbeCommand(['probe', SAMPLE_INPUT], { json: false });
    const payload = JSON.parse(result.stdout ?? '');

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBeUndefined();
    expect(payload).toMatchObject({
      action: 'auto_resume',
      changeName: 'cache-ttl',
      phase: 'build',
    });
  });

  it('returns parsed probe result for `probe --stdin`', async () => {
    const result = await runWithStdin(SAMPLE_INPUT, () =>
      classicResumeProbeCommand(['probe', '--stdin'], { json: false }),
    );
    const payload = JSON.parse(result.stdout ?? '');

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      action: 'auto_resume',
      changeName: 'cache-ttl',
      phase: 'build',
    });
  });

  it('accepts a raw user request through `probe --stdin`', async () => {
    const result = await runWithStdin('continue cache-ttl', () =>
      classicResumeProbeCommand(['probe', '--stdin'], { json: false }),
    );
    const payload = JSON.parse(result.stdout ?? '');

    expect(result.exitCode).toBe(0);
    expect(payload).toMatchObject({
      action: 'auto_resume',
      changeName: 'cache-ttl',
      phase: 'build',
    });
  });

  it('emits a classic --json envelope that contains the probe stdout payload', async () => {
    const result = await runClassicCli(['resume-probe', 'probe', SAMPLE_INPUT, '--json']);
    const envelope = JSON.parse(result.stdout ?? '');
    const payload = JSON.parse(envelope.stdout);

    expect(result.exitCode).toBe(0);
    expect(envelope).toMatchObject({
      command: 'resume-probe',
      exitCode: 0,
    });
    expect(payload).toMatchObject({ action: 'auto_resume', changeName: 'cache-ttl' });
  });

  it('is registered in the shared Classic CLI dispatcher', async () => {
    const result = await runClassicCli(['resume-probe'], {
      'resume-probe': async () => ({ exitCode: 0, stdout: 'ok\n' }),
    });

    expect(result).toMatchObject({ exitCode: 0, stdout: 'ok\n' });
  });
});
