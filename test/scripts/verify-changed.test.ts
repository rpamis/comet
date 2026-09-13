import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  planChangedVerification,
  resolvePnpmInvocation,
} from '../../scripts/lint/verify-changed.mjs';

describe('changed verification planner', () => {
  it('maps Runtime, rule, and test changes to deterministic read-only checks', () => {
    const plan = planChangedVerification([
      'domains/comet-native/native-portable-checks.ts',
      'domains/comet-entry/AGENTS.md',
      '.claude/rules/22-entry-and-hook-router.md',
      'test/domains/comet-native/native-portable-runtime.test.ts',
    ]);

    expect(plan.map((check) => check.id)).toEqual([
      'architecture',
      'typecheck',
      'format',
      'generated',
      'agent-rules',
      'domain:comet-native',
    ]);
    expect(plan.every((check) => !check.command.includes('write'))).toBe(true);
  });

  it('deduplicates paths and keeps generated checks scoped to Runtime sources', () => {
    const runtime = planChangedVerification([
      'domains/comet-entry/hook-router.ts',
      'domains/comet-entry/hook-router.ts',
    ]);
    const dashboard = planChangedVerification(['domains/dashboard/git.ts']);

    expect(runtime.filter((check) => check.id === 'generated')).toHaveLength(1);
    expect(runtime.map((check) => check.id)).toContain('domain:comet-entry');
    expect(dashboard.map((check) => check.id)).not.toContain('generated');
    expect(dashboard.map((check) => check.id)).toContain('domain:dashboard');

    const instructions = planChangedVerification(['domains/comet-entry/AGENTS.md']);
    expect(instructions.map((check) => check.id)).toEqual(['format', 'agent-rules']);
  });

  it('does not repeat a changed test already covered by its module suite', () => {
    const plan = planChangedVerification([
      'scripts/lint/architecture.mjs',
      'test/scripts/architecture-lint.test.ts',
    ]);

    expect(plan.map((check) => check.id)).toContain('scripts');
    expect(plan.map((check) => check.id)).not.toContain(
      'test:test/scripts/architecture-lint.test.ts',
    );
  });

  it('normalizes Windows paths and emits shell-free command arguments', () => {
    const plan = planChangedVerification(['platform\\process\\hook-adapter.ts']);
    const platform = plan.find((check) => check.id === 'platform');

    expect(platform).toMatchObject({
      executable: 'pnpm',
      args: ['exec', 'vitest', 'run', 'test/platform'],
    });
  });

  it('runs pnpm through its JavaScript entrypoint on Windows', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-pnpm-bin-'));
    const pnpmEntry = path.join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
    await fs.mkdir(path.dirname(pnpmEntry), { recursive: true });
    await fs.writeFile(pnpmEntry, '');

    try {
      expect(
        resolvePnpmInvocation({ platform: 'win32', pathValue: root, npmExecPath: null }),
      ).toEqual({ executable: process.execPath, argumentPrefix: [pnpmEntry] });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('is exposed as the repository changed-verification command', async () => {
    const packageJson = JSON.parse(await fs.readFile(path.resolve('package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.['verify:changed']).toBe('node scripts/lint/verify-changed.mjs');
  });
});
