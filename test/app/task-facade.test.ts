import { describe, expect, it } from 'vitest';

import { resolveTaskFacadeOptions } from '../../app/commands/task-facade.js';

describe('comet task fast facade argument parsing', () => {
  it('parses the documented options into the command shape', () => {
    expect(
      resolveTaskFacadeOptions([
        '.',
        '--task',
        'repair the build',
        '--phase',
        'build',
        '--context-budget',
        '2000',
        '--verification-result',
        'passed',
        '--outcome',
        'used-successfully',
        '--learning-check',
        'submitted',
        '--complete',
        '--json',
      ]),
    ).toEqual({
      targetPath: '.',
      options: {
        task: 'repair the build',
        phase: 'build',
        contextBudget: '2000',
        verificationResult: 'passed',
        outcome: 'used-successfully',
        learningCheck: 'submitted',
        complete: true,
        json: true,
      },
    });
  });

  it('accepts inline --task=value and a trailing positional path', () => {
    expect(resolveTaskFacadeOptions(['--task=probe', 'packages/app'])).toEqual({
      targetPath: 'packages/app',
      options: { task: 'probe' },
    });
  });

  it('declines argv the Commander entry must diagnose', () => {
    expect(resolveTaskFacadeOptions(['--json'])).toBeNull(); // required --task missing
    expect(resolveTaskFacadeOptions(['--task', ' '])).toBeNull(); // blank task
    expect(resolveTaskFacadeOptions(['--task', 'x', '--unknown', 'y'])).toBeNull();
    expect(resolveTaskFacadeOptions(['--task', 'x', '--verification-result', 'maybe'])).toBeNull();
    expect(resolveTaskFacadeOptions(['--task', 'x', '--learning-check', 'later'])).toBeNull();
    expect(resolveTaskFacadeOptions(['--task', 'x', '--outcome', 'fine'])).toBeNull();
    expect(resolveTaskFacadeOptions(['--task', 'x', 'a', 'b'])).toBeNull(); // two positionals
    expect(resolveTaskFacadeOptions(['--task', 'x', '--'])).toBeNull();
    expect(resolveTaskFacadeOptions(['--task', 'x', '--json=yes'])).toBeNull();
    expect(resolveTaskFacadeOptions(['--task', 'x', '--phase'])).toBeNull(); // missing value
    expect(resolveTaskFacadeOptions(['--task', 'x', '--phase', '-v'])).toBeNull(); // flag-like value
  });
});
