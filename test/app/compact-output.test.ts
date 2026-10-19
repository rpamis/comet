import { describe, expect, it } from 'vitest';
import { splitCompactOutputArgs } from '../../app/commands/compact-output.js';

describe('compact facade arguments', () => {
  it('keeps full JSON for evidence recording and forwards child options unchanged', () => {
    expect(
      splitCompactOutputArgs(['check', '--json', '--compact', '--', 'node', '--compact']),
    ).toEqual({ compact: true, args: ['check', '--json', '--', 'node', '--compact'] });
  });
  it('does not consume OpenSpec flags or hide invalid combinations', () => {
    for (const args of [
      ['next', '--compact'],
      ['check', '--', '--json', '--compact'],
    ]) {
      expect(splitCompactOutputArgs(args)).toEqual({ compact: false, args });
    }
    const args = ['openspec', '--json', '--compact'];
    expect(splitCompactOutputArgs(args, false)).toEqual({ compact: false, args });
  });
});
