import { describe, expect, it } from 'vitest';

import { resolveFastRuntime } from '../../bin/fast-runtime-router.js';

describe('CLI fast runtime router', () => {
  it('maps public high-frequency commands to their package-owned runtime bundles', () => {
    expect(resolveFastRuntime(['state', 'current', '--json'])).toEqual({
      assetPath: 'assets/skills/comet/scripts/comet-state.mjs',
      args: ['current', '--json'],
    });
    expect(resolveFastRuntime(['workflow', 'resolve', '.', '--json'])).toEqual({
      assetPath: 'assets/skills/comet/scripts/comet-entry-runtime.mjs',
      args: ['.', '--json'],
    });
    expect(resolveFastRuntime(['workflow', 'resolve', '.', '--activate', '--json'])).toBeNull();
    expect(resolveFastRuntime(['native', 'status', '--project-root', 'project', '--json'])).toEqual(
      {
        assetPath: 'assets/skills/comet-native/scripts/comet-native-status.mjs',
        args: ['--project-root', 'project', '--json'],
      },
    );
  });

  it('preserves the command tail without parsing it', () => {
    expect(
      resolveFastRuntime([
        'native',
        'receipt',
        'automated',
        'change',
        '--',
        'node',
        'script.mjs',
        '--flag',
      ]),
    ).toEqual({
      assetPath: 'assets/skills/comet-native/scripts/comet-native-receipt.mjs',
      args: ['automated', 'change', '--', 'node', 'script.mjs', '--flag'],
    });
  });

  it('falls back to Commander for help, unsupported groups, and unknown subcommands', () => {
    expect(resolveFastRuntime(['state', '--help'])).toBeNull();
    expect(resolveFastRuntime(['native', '--help'])).toBeNull();
    expect(resolveFastRuntime(['native', 'unknown'])).toBeNull();
    expect(resolveFastRuntime(['classic', 'root', 'show'])).toBeNull();
    expect(resolveFastRuntime(['resume-probe', '.', '--json'])).toBeNull();
  });
});
