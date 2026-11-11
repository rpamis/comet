import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classicCommandHelp } from '../../../domains/comet-classic/classic-cli-help.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';

describe('Classic operational help', () => {
  it('explains platform execution and the non-executing legacy check entry', () => {
    const help = classicCommandHelp('check', ['run', '--help'])!;
    for (const text of [
      'do not execute or replay',
      'Agent platform tools',
      'timeout, cancellation and process cleanup',
      'data.executed=false',
      'comet check rerun',
      'The Agent judges which checks apply',
      '--checks',
      'not that a check passed',
    ]) {
      expect(help).toContain(text);
    }
  });

  it('records actual platform reports without executing their command text', () => {
    const help = classicCommandHelp('state', ['record-check', '--help'])!;
    expect(help).toContain('does not execute');
    expect(help).toContain('failed report cannot advance');
    expect(help).toContain('SDK Build/Verify');
    expect(help).not.toContain('task-checkoff');
  });

  it('explains business recovery without process recovery or command replay', () => {
    const help = classicCommandHelp('state', ['check', '--help'])!;
    expect(help).toContain('original business state, reports and approvals');
    expect(help).toContain('does not replay commands or recover processes');
    expect(help).toContain('cold recovery');
    expect(help).not.toContain('record-check');
  });

  it('keeps guard preview read-only and requires actual reports for advancement', () => {
    const help = classicCommandHelp('guard', ['--help'])!;
    expect(help).toContain('preview is read-only');
    expect(help).toContain('never executes a detected build');
    expect(help).toContain('Apply requires the current tasks, user approvals and accepted reports');
    expect(help).not.toContain('--local');
  });

  it('leaves child help untouched', () => {
    expect(
      classicCommandHelp('check', ['run', 'demo', 'verify', '--', 'node', '--help']),
    ).toBeUndefined();
  });

  it('makes writable fields and transition events discoverable', () => {
    const fields = classicCommandHelp('state', ['set', '--help'])!;
    expect(fields).toContain('verify_mode: light|full');
    expect(fields).not.toContain('archive_confirmation:');
    expect(fields).toContain('atomic state update');
    expect(fields).toContain('data.updated');
    expect(classicCommandHelp('state', ['transition', '--help'])).toContain('archive-confirm');
  });

  it('explains batched field reads and revision-bound SDK continuations', () => {
    const get = classicCommandHelp('state', ['get', '--help'])!;
    expect(get).toContain('<field> [<field> ...]');
    expect(get).toContain('one state snapshot');
    expect(get).toContain('data.fields');
    expect(get).toContain('bare stdout value');
    expect(classicCommandHelp('state', ['check', '--help'])).toContain('nextAction');
    expect(classicCommandHelp('check', ['run', '--help'])).toContain('data.nextAction');
  });

  it('provides JSON help without invoking a state handler', async () => {
    const result = await runClassicCli(['state', 'record-check', '--help', '--json'], {
      state: async () => {
        throw new Error('Help must not invoke a handler');
      },
    });
    const output = JSON.parse(result.stdout!);
    expect(output.exitCode).toBe(0);
    expect(output.stdout).toContain('does not execute');
  });

  it.each(['revise-design', 'revise-plan'])('explains safe %s recovery', (command) => {
    const help = classicCommandHelp('state', [command, '--help'])!;
    expect(help).toContain(`comet state ${command}`);
    expect(help).toContain('--expected-revision <number>');
    expect(help).toContain('stale revision is rejected');
    expect(help).toContain('Revision does not');
    expect(help).toContain('proposal hash');
  });

  it.each([['check', 'run'], ['state', 'record-check'], ['state', 'check'], ['guard']])(
    'keeps public and self-contained %s help aligned without a project',
    (...command) => {
      const expected = classicCommandHelp(command[0], [...command.slice(1), '--help']);
      for (const [entry, args] of [
        ['bin/comet.js', [...command, '--help', '--json']],
        [
          `assets/skills/comet/scripts/comet-${command[0]}.mjs`,
          [...command.slice(1), '--help', '--json'],
        ],
      ] as const) {
        const result = spawnSync(process.execPath, [path.resolve(entry), ...args], {
          cwd: tmpdir(),
          encoding: 'utf8',
          timeout: 15000,
        });
        expect(result.status, result.stderr).toBe(0);
        expect(result.stderr).toBe('');
        expect(JSON.parse(result.stdout).stdout).toBe(expected);
      }
    },
  );
});
