import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { classicCommandHelp } from '../../../domains/comet-classic/classic-cli-help.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';

describe('Classic operational help', () => {
  it('explains execution, reuse, defaults and machine output for check run', () => {
    const help = classicCommandHelp('check', ['run', '--help'])!;
    for (const text of [
      '300000',
      '3600000',
      'project root',
      'invocation directory',
      'not a location switch',
      'Examples:',
      'data.exitCode',
      '124',
      '70',
    ]) {
      expect(help).toContain(text);
    }
  });

  it('separates manual attestations from executed evidence', () => {
    const help = classicCommandHelp('state', ['record-check', '--help'])!;
    expect(help).toContain('does not execute');
    expect(help).toContain('cannot satisfy');
    expect(help).not.toContain('task-checkoff');
  });

  it('warns that recovery invalidates evidence', () => {
    const help = classicCommandHelp('state', ['check', '--help'])!;
    expect(help).toContain('invalidates');
    expect(help).toContain('cold recovery');
    expect(help).not.toContain('record-check');
  });

  it('does not describe guard preview as read-only', () => {
    const help = classicCommandHelp('guard', ['--help'])!;
    expect(help).toContain('may execute');
    expect(help).toContain('consumes single-use');
    expect(help).toContain('even without --apply');
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
    expect(classicCommandHelp('state', ['transition', '--help'])).toContain('archive-confirm');
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
