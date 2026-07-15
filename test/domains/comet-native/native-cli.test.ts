import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { acquireNativeLock, releaseNativeLock } from '../../../domains/comet-native/native-lock.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';

const brief = `# Outcome
Add sentence counting.
# Scope
Count sentences in text.
# Non-goals
No language detection.
# Acceptance examples
- Two sentences return two.
# Constraints and invariants
Keep existing APIs stable.
# Decisions
Use punctuation boundaries.
# Open questions
None.
# Verification expectations
Run focused tests.
`;

const verification = `# Acceptance evidence
Acceptance examples passed.
# Commands and results
Focused tests passed.
# Skipped checks
None.
# Spec consistency
Consistent.
# Known limitations and risks
None.
# Conclusion
Pass.
`;

interface JsonEnvelope {
  command: string | null;
  exitCode: number;
  data?: unknown;
  error?: { code: string; message: string };
}

function json(result: Awaited<ReturnType<typeof runNativeCli>>): JsonEnvelope {
  expect(result.stdout).toBeTruthy();
  return JSON.parse(result.stdout!) as JsonEnvelope;
}

describe('Comet Native CLI dispatcher', () => {
  let projectRoot: string;
  const projectArgs = () => ['--project-root', projectRoot] as const;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-cli-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('runs the complete change lifecycle with a custom artifact root', async () => {
    const initialized = await runNativeCli([
      'init',
      '--root',
      'docs',
      '--language',
      'zh-CN',
      '--json',
      ...projectArgs(),
    ]);
    expect(initialized.exitCode).toBe(0);
    expect(json(initialized)).toMatchObject({
      command: 'init',
      exitCode: 0,
      data: { artifactRoot: 'docs', language: 'zh-CN' },
    });

    const root = json(await runNativeCli(['root', 'show', '--json', ...projectArgs()]));
    expect(root).toMatchObject({ command: 'root show', data: { artifactRoot: 'docs' } });

    const created = await runNativeCli([
      'new',
      'sentence-counting',
      '--language',
      'zh-CN',
      ...projectArgs(),
    ]);
    expect(created).toMatchObject({ exitCode: 0 });
    expect(created.stdout).toContain('Created Native change sentence-counting');
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'sentence-counting');
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    await fs.mkdir(path.join(changeDir, 'specs', 'sentence-counting'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'sentence-counting', 'spec.md'),
      '# Sentence counting\nCount sentences by punctuation.\n',
    );

    expect(json(await runNativeCli(['list', '--json', ...projectArgs()])).data).toHaveLength(1);
    expect(
      json(await runNativeCli(['show', 'sentence-counting', '--json', ...projectArgs()])).data,
    ).toMatchObject({ state: { language: 'zh-CN', phase: 'shape' } });
    expect(
      json(await runNativeCli(['status', 'sentence-counting', '--json', ...projectArgs()])).data,
    ).toMatchObject({
      phase: 'shape',
      nextCommand: 'comet native next sentence-counting --summary "<summary>"',
    });
    expect(await runNativeCli(['select', 'sentence-counting', ...projectArgs()])).toMatchObject({
      exitCode: 0,
    });

    const shaped = json(
      await runNativeCli([
        'next',
        'sentence-counting',
        '--summary',
        'Requirements are clear',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(shaped).toMatchObject({
      exitCode: 0,
      data: {
        change: {
          phase: 'build',
          spec_changes: [
            {
              capability: 'sentence-counting',
              operation: 'create',
              source: 'specs/sentence-counting/spec.md',
              base_hash: null,
            },
          ],
        },
      },
    });

    await fs.writeFile(path.join(projectRoot, 'feature.ts'), 'export const count = 2;\n');
    const built = await runNativeCli([
      'next',
      'sentence-counting',
      '--summary',
      'Implemented sentence counting',
      '--artifact',
      'feature.ts',
      ...projectArgs(),
    ]);
    expect(built.exitCode, built.stderr).toBe(0);

    await fs.writeFile(path.join(changeDir, 'verification.md'), verification);
    const verified = json(
      await runNativeCli([
        'next',
        'sentence-counting',
        '--summary',
        'Verification passed',
        '--result',
        'pass',
        '--report',
        'verification.md',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(verified).toMatchObject({ data: { change: { phase: 'archive' } } });

    const archived = await runNativeCli(['archive', 'sentence-counting', ...projectArgs()]);
    expect(archived.exitCode, archived.stderr).toBe(0);
    expect(archived.stdout).toContain('Archived Native change sentence-counting');

    const moved = await runNativeCli(['root', 'move', 'artifacts/native', ...projectArgs()]);
    expect(moved.exitCode, moved.stderr).toBe(0);
    expect(moved.stdout).toContain(path.join('artifacts', 'native', 'comet'));

    const doctor = json(await runNativeCli(['doctor', '--json', ...projectArgs()]));
    expect(doctor).toMatchObject({ command: 'doctor', exitCode: 0, data: { healthy: true } });
  });

  it('creates the default config from new and keeps Classic paths untouched', async () => {
    const result = await runNativeCli(['new', 'default-root', '--json', ...projectArgs()]);
    expect(result.exitCode).toBe(0);
    expect(json(result)).toMatchObject({ data: { name: 'default-root', phase: 'shape' } });
    expect(await fs.readFile(path.join(projectRoot, 'comet.config.yaml'), 'utf8')).toContain(
      'artifact_root: .',
    );
    await expect(fs.access(path.join(projectRoot, '.comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(projectRoot, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('uses stable usage, data, and conflict exit codes with one JSON object', async () => {
    const usage = await runNativeCli(['unknown', '--json', ...projectArgs()]);
    expect(usage.exitCode).toBe(64);
    expect(json(usage)).toMatchObject({
      command: 'unknown',
      exitCode: 64,
      error: { code: 'usage' },
    });
    expect(usage.stderr).toBeUndefined();

    const help = await runNativeCli(['--help', ...projectArgs()]);
    expect(help.stdout).toContain('[--confirmed]');
    expect(help.stdout).toContain('spec rebase <change-name> --summary <text>');

    const missing = await runNativeCli(['list', '--json', ...projectArgs()]);
    expect(missing.exitCode).toBe(65);
    expect(json(missing)).toMatchObject({ error: { code: 'invalid-data' } });

    await runNativeCli(['init', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, '.');
    const lock = await acquireNativeLock(paths, 'root-move', 'archive concurrent-change');
    try {
      const conflict = await runNativeCli(['root', 'move', 'docs', '--json', ...projectArgs()]);
      expect(conflict.exitCode).toBe(73);
      expect(json(conflict)).toMatchObject({ error: { code: 'conflict' } });
    } finally {
      await releaseNativeLock(lock);
    }
  });

  it('returns guard findings as structured invalid data', async () => {
    await runNativeCli(['new', 'blocked-shape', ...projectArgs()]);
    const result = await runNativeCli([
      'next',
      'blocked-shape',
      '--summary',
      'Not actually ready',
      '--json',
      ...projectArgs(),
    ]);
    expect(result.exitCode).toBe(65);
    expect(json(result)).toMatchObject({
      command: 'next',
      error: { code: 'invalid-data' },
      data: { next: 'manual' },
    });
  });

  it('records explicit confirmation through Shape next without editing change state', async () => {
    await runNativeCli(['new', 'confirmed-shape', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, '.');
    const changeDir = path.join(paths.changesDir, 'confirmed-shape');
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);

    const result = json(
      await runNativeCli([
        'next',
        'confirmed-shape',
        '--summary',
        'The user confirmed the product decision',
        '--confirmed',
        '--json',
        ...projectArgs(),
      ]),
    );

    expect(result).toMatchObject({
      exitCode: 0,
      data: { change: { phase: 'build', approval: 'confirmed' } },
    });
  });

  it('records a remove intent and canonical hash through the spec command', async () => {
    await runNativeCli(['new', 'remove-capability', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, '.');
    const canonical = path.join(paths.specsDir, 'legacy-capability', 'spec.md');
    await fs.mkdir(path.dirname(canonical), { recursive: true });
    await fs.writeFile(canonical, '# Legacy capability\nRemove this behavior.\n');

    const result = json(
      await runNativeCli([
        'spec',
        'remove',
        'remove-capability',
        'legacy-capability',
        '--json',
        ...projectArgs(),
      ]),
    );

    expect(result).toMatchObject({
      command: 'spec remove',
      exitCode: 0,
      data: {
        spec_changes: [
          {
            capability: 'legacy-capability',
            operation: 'remove',
          },
        ],
      },
    });
  });

  it('repairs a stale selection without requiring a transaction strategy', async () => {
    await runNativeCli(['init', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, '.');
    await fs.writeFile(
      path.join(paths.runtimeDir, 'current-change.json'),
      JSON.stringify({ schema: 'comet.native.selection.v1', change: 'missing-change' }),
    );
    const repaired = await runNativeCli(['doctor', '--repair', '--json', ...projectArgs()]);
    expect(repaired.exitCode).toBe(0);
    const data = json(repaired).data as { findings: Array<{ code: string }> };
    expect(data.findings).toContainEqual(expect.objectContaining({ code: 'selection-cleared' }));
  });

  it('returns exit 70 for an unexpected filesystem failure', async () => {
    const failure = Object.assign(new Error('simulated storage failure'), { code: 'EIO' });
    const realpath = vi.spyOn(fs, 'realpath').mockRejectedValueOnce(failure);
    try {
      const result = await runNativeCli(['init', '--json', ...projectArgs()]);
      expect(result.exitCode).toBe(70);
      expect(json(result)).toMatchObject({ error: { code: 'internal' } });
    } finally {
      realpath.mockRestore();
    }
  });
});
