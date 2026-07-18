import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';

const repositoryRoot = path.resolve('.');
const cli = path.join(repositoryRoot, 'bin', 'comet.js');

function runCli(...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
}

describe('CLI help text', () => {
  beforeAll(async () => {
    await ensureCliBuilt(repositoryRoot);
  }, 120_000);

  it('uses the evaluated-workflows tagline in CLI and package metadata', () => {
    const help = runCli('--help');
    const packageJson = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { description: string; version: string };
    const packageLock = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'package-lock.json'), 'utf8'),
    ) as { version: string; packages: { '': { version: string } } };
    const assetsManifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, 'assets', 'manifest.json'), 'utf8'),
    ) as { version: string };
    const tagline = 'Agent Skill Harness For Turning Ideas Into Evaluated Workflows';

    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain(tagline);
    expect(packageJson.description).toBe(tagline);
    expect(packageJson.version).toBe('0.4.0-beta.6');
    expect(packageLock.version).toBe('0.4.0-beta.6');
    expect(packageLock.packages[''].version).toBe('0.4.0-beta.6');
    expect(assetsManifest.version).toBe('0.4.0-beta.6');
  });

  it('marks bundle as the advanced backend and skill Engine runs as advanced', () => {
    const creatorHelp = runCli('creator', '--help');
    const publishHelp = runCli('publish', '--help');
    const bundleHelp = runCli('bundle', '--help');
    const skillHelp = runCli('skill', '--help');

    expect(creatorHelp.status, creatorHelp.stderr).toBe(0);
    expect(publishHelp.status, publishHelp.stderr).toBe(0);
    expect(bundleHelp.status, bundleHelp.stderr).toBe(0);
    expect(skillHelp.status, skillHelp.stderr).toBe(0);
    expect(creatorHelp.stdout).toContain('Skill Creator workspace');
    expect(creatorHelp.stdout).toContain('next [options] <name>');
    expect(creatorHelp.stdout).toContain('generate [options] <name>');
    expect(publishHelp.stdout).toContain('Review, approve, publish, and distribute');
    expect(bundleHelp.stdout).toContain('Advanced Bundle backend');
    expect(bundleHelp.stdout).not.toContain('factory-');
    expect(bundleHelp.stdout).not.toContain('authoring-plan');
    expect(bundleHelp.stdout).not.toContain('authoring-record');
    expect(bundleHelp.stdout).not.toContain('list [options]');
    expect(bundleHelp.stdout).not.toContain('status [options] <name>');
    expect(skillHelp.stdout).toContain('Install, inspect, and debug local Skill packages');
    expect(skillHelp.stdout).toContain('add [options] <path>');
    expect(skillHelp.stdout).toContain('show [options] <skill>');
    expect(skillHelp.stdout).toContain('run [options] <skill>');
    expect(skillHelp.stdout).toContain('continue [options]');
    expect(skillHelp.stdout).toContain('Advanced: start a deterministic Engine Skill Run');
    expect(skillHelp.stdout).toContain('Advanced: resume a deterministic Engine Skill Run');
    expect(skillHelp.stdout).not.toContain('install [options] <path>');
    expect(skillHelp.stdout).not.toContain('validate [options] <skill>');
    expect(skillHelp.stdout).not.toContain('inspect [options] <skill>');
    expect(skillHelp.stdout).not.toContain('resume [options]');
  });

  it('exposes only the four stable Classic facade commands at the root', () => {
    const help = runCli('--help');

    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain('Read and update Classic workflow state');
    expect(help.stdout).toContain('Check Classic workflow phase guards');
    expect(help.stdout).toContain('Create and inspect Classic workflow handoffs');
    expect(help.stdout).toContain('Archive completed Classic workflow changes');
    expect(help.stdout).not.toMatch(/^\s+(validate|intent|hook-guard)\b/mu);
    const facadeDescriptions = [
      'Read and update Classic workflow state',
      'Check Classic workflow phase guards',
      'Create and inspect Classic workflow handoffs',
      'Archive completed Classic workflow changes',
    ];
    expect(
      facadeDescriptions.filter((description) => help.stdout.includes(description)),
    ).toHaveLength(4);
    expect(help.stdout).toMatch(/^\s+resume-probe \[options\] \[path\]\s+Probe whether/mu);
  });

  it('separates repository evals from Engine Run runtime checks', () => {
    const evalHelp = runCli('eval', '--help');
    const skillCheckHelp = runCli('skill', 'check', '--help');

    expect(evalHelp.status, evalHelp.stderr).toBe(0);
    expect(skillCheckHelp.status, skillCheckHelp.stderr).toBe(0);
    expect(evalHelp.stdout).toContain('Evaluate a Skill or eval manifest with one command');
    expect(evalHelp.stdout).toContain('Usage: comet eval [options] [target]');
    expect(evalHelp.stdout).toContain('--collect');
    expect(evalHelp.stdout).not.toContain('run [options]');
    expect(evalHelp.stdout).not.toContain('collect [options]');
    expect(skillCheckHelp.stdout).toContain('Check deterministic Engine Run runtime checks.');
    expect(skillCheckHelp.stdout).toContain('Use comet eval');
    expect(skillCheckHelp.stdout).toContain('reports');
    expect(skillCheckHelp.stdout).toContain('Runtime check scope');
    expect(skillCheckHelp.stdout).not.toContain('Runtime eval scope');
    expect(skillCheckHelp.stdout).not.toContain('general Skill evals');
  });

  it('does not expose the old skill eval command', () => {
    const help = runCli('skill', '--help');

    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain('check [options]');
    expect(help.stdout).not.toContain('eval [options]');
  });

  it('keeps Skill Creator resume commands out of the publish surface', () => {
    const creatorHelp = runCli('creator', '--help');
    const publishHelp = runCli('publish', '--help');

    expect(creatorHelp.status, creatorHelp.stderr).toBe(0);
    expect(publishHelp.status, publishHelp.stderr).toBe(0);
    expect(creatorHelp.stdout).toContain('status [options] <name>');
    expect(creatorHelp.stdout).toContain('next [options] <name>');
    expect(publishHelp.stdout).not.toContain('list [options]');
    expect(publishHelp.stdout).not.toContain('status [options] <name>');
    expect(publishHelp.stdout).not.toContain('next [options] <name>');
    expect(publishHelp.stdout).toContain('review [options] <name>');
    expect(publishHelp.stdout).toContain('distribute [options] <name>');
  });

  it('uses eval wording for advanced Bundle evidence commands', () => {
    const help = runCli('bundle', '--help');

    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toContain('eval-plan');
    expect(help.stdout).toContain('eval-record');
    expect(help.stdout).not.toContain('benchmark-plan');
    expect(help.stdout).not.toContain('benchmark-record');
  });

  it('exposes ambient resume probe help', () => {
    const help = runCli('--help');
    const commandHelp = runCli('resume-probe', '--help');

    expect(help.status, help.stderr).toBe(0);
    expect(commandHelp.status, commandHelp.stderr).toBe(0);
    expect(help.stdout).toContain('resume-probe');
    expect(commandHelp.stdout).toContain('Probe whether an active Comet workflow should resume');
    expect(commandHelp.stdout).toContain('--utterance');
    expect(commandHelp.stdout).toContain('--stdin');
    expect(commandHelp.stdout).toContain('--json');
    expect(commandHelp.stdout).toContain('--no-workflow-work');
    expect(commandHelp.stdout).not.toContain('--no-non-trivial-work');
    expect(commandHelp.stdout).toContain('--already-in-comet-flow');
  });
});
