import { promises as fs } from 'fs';
import { execFileSync } from 'node:child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  readProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { NATIVE_CONTRACT_FILE_LIMITS } from '../../../domains/comet-native/native-contract-files.js';
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
    execFileSync('git', ['init'], { cwd: projectRoot, stdio: 'ignore' });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('initializes docs as the default Native artifact root', async () => {
    const initialized = json(await runNativeCli(['init', '--json', ...projectArgs()]));

    expect(initialized).toMatchObject({
      command: 'init',
      exitCode: 0,
      data: { artifactRoot: 'docs', language: 'en' },
    });
    await expect(
      fs.stat(path.join(projectRoot, 'docs', 'comet', 'changes')),
    ).resolves.toBeDefined();
    await expect(fs.access(path.join(projectRoot, 'comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
    ).resolves.toContain('artifact_root: docs');
  });

  it('returns structured baseline diagnostics when change creation cannot capture a complete baseline', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'oversized-baseline.bin'),
      Buffer.alloc(5 * 1024 * 1024 + 1, 0x61),
    );

    const result = json(
      await runNativeCli(['new', 'incomplete-baseline', '--json', ...projectArgs()]),
    );
    expect(result).toMatchObject({
      exitCode: 65,
      data: {
        change: 'incomplete-baseline',
        complete: false,
        omittedCount: 1,
        omittedByReason: { 'file-size': 1 },
        samplePaths: ['oversized-baseline.bin'],
        sampleTruncated: false,
        requiredAction: 'resolve-native-baseline',
      },
      error: { code: 'baseline-incomplete' },
    });
    await expect(
      fs.access(path.join(projectRoot, 'comet', 'changes', 'incomplete-baseline')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('selects each successfully created change as the current Native owner', async () => {
    expect(await runNativeCli(['new', 'first-change', ...projectArgs()])).toMatchObject({
      exitCode: 0,
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(projectRoot, '.comet', 'current-change.json'), 'utf8'),
      ),
    ).toEqual({
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'first-change',
      branch: null,
    });

    expect(await runNativeCli(['new', 'second-change', ...projectArgs()])).toMatchObject({
      exitCode: 0,
    });
    expect(
      JSON.parse(
        await fs.readFile(path.join(projectRoot, '.comet', 'current-change.json'), 'utf8'),
      ),
    ).toEqual({
      schema: 'comet.selection.v2',
      workflow: 'native',
      change: 'second-change',
      branch: null,
    });
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

    const created = await runNativeCli(['new', 'sentence-counting', ...projectArgs()]);
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

    expect(json(await runNativeCli(['list', '--json', ...projectArgs()])).data).toMatchObject({
      schema: 'comet.native.status-page.v1',
      total: 1,
      items: [expect.objectContaining({ name: 'sentence-counting', phase: 'shape' })],
    });
    expect(
      json(await runNativeCli(['show', 'sentence-counting', '--json', ...projectArgs()])).data,
    ).toMatchObject({ state: { language: 'zh-CN', phase: 'shape' } });
    expect(
      json(await runNativeCli(['status', 'sentence-counting', '--json', ...projectArgs()])).data,
    ).toMatchObject({
      phase: 'shape',
      nextCommand: 'comet native next sentence-counting --summary "<summary>" --confirmed',
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
        '--confirmed',
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
    const built = json(
      await runNativeCli([
        'next',
        'sentence-counting',
        '--summary',
        'Implemented sentence counting',
        '--artifact',
        'feature.ts',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(built.exitCode).toBe(0);
    const builtCriteria = (
      built.data as {
        preparedScope: { acceptancePage: { items: Array<{ id: string }> } };
      }
    ).preparedScope.acceptancePage.items;
    expect(builtCriteria).toEqual([
      expect.objectContaining({ id: expect.stringMatching(/^acceptance-[a-f0-9]{64}$/u) }),
    ]);

    const resumed = json(
      await runNativeCli(['status', 'sentence-counting', '--details', '--json', ...projectArgs()]),
    );
    const resumedCriteria = (resumed.data as { acceptancePage: { items: Array<{ id: string }> } })
      .acceptancePage.items;
    expect(resumedCriteria).toEqual(builtCriteria);
    const acceptanceEntries = resumedCriteria
      .map((criterion) => ({
        acceptance_id: criterion.id,
        evidence_refs: ['feature.ts'],
      }))
      .sort((left, right) => left.acceptance_id.localeCompare(right.acceptance_id));

    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
<!-- comet-native:acceptance-evidence:start -->
${JSON.stringify(acceptanceEntries, null, 2)}
<!-- comet-native:acceptance-evidence:end -->
# Commands and results
Focused checks passed.
# Skipped checks
None.
# Spec consistency
Consistent.
# Known limitations and risks
None.
# Conclusion
Pass.
`,
    );
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

    const preview = json(
      await runNativeCli(['archive', 'sentence-counting', '--dry-run', '--json', ...projectArgs()]),
    );
    const preflightHash = (preview.data as { preflightHash: string }).preflightHash;
    const archived = await runNativeCli([
      'archive',
      'sentence-counting',
      '--expect-preflight',
      preflightHash,
      ...projectArgs(),
    ]);
    expect(archived.exitCode, archived.stderr).toBe(0);
    expect(archived.stdout).toContain('Archived Native change sentence-counting');

    const moved = await runNativeCli(['root', 'move', 'artifacts/native', ...projectArgs()]);
    expect(moved.exitCode, moved.stderr).toBe(0);
    expect(moved.stdout).toContain(path.join('artifacts', 'native', 'comet'));

    const doctor = json(await runNativeCli(['doctor', '--json', ...projectArgs()]));
    expect(doctor).toMatchObject({ command: 'doctor', exitCode: 0, data: { healthy: true } });
  }, 120_000);

  it('pages every Runtime-derived acceptance ID through the public status command', async () => {
    await runNativeCli(['new', 'paged-acceptance', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'paged-acceptance');
    const acceptanceExamples = Array.from(
      { length: 17 },
      (_, index) => `- Acceptance outcome ${index + 1} is observable.`,
    ).join('\n');
    const pagedBrief = brief.replace('- Two sentences return two.', acceptanceExamples);
    await fs.writeFile(path.join(changeDir, 'brief.md'), pagedBrief);
    expect(
      (
        await runNativeCli([
          'next',
          'paged-acceptance',
          '--summary',
          'The acceptance contract is executable',
          '--confirmed',
          ...projectArgs(),
        ])
      ).exitCode,
    ).toBe(0);
    await fs.writeFile(path.join(projectRoot, 'paged.ts'), 'export const paged = true;\n');
    const built = json(
      await runNativeCli([
        'next',
        'paged-acceptance',
        '--summary',
        'Implemented the paged acceptance contract',
        '--artifact',
        'paged.ts',
        '--json',
        ...projectArgs(),
      ]),
    );
    const firstPage = (
      built.data as {
        preparedScope: {
          acceptancePage: {
            items: Array<{ id: string }>;
            nextCursor: string | null;
            total: number;
          };
        };
      }
    ).preparedScope.acceptancePage;
    expect(firstPage).toMatchObject({ total: 17 });
    expect(firstPage.items).toHaveLength(16);
    expect(firstPage.nextCursor).not.toBeNull();

    const ids = [...firstPage.items.map((item) => item.id)];
    let cursor = firstPage.nextCursor;
    while (cursor) {
      const pageResult = json(
        await runNativeCli([
          'status',
          'paged-acceptance',
          '--details',
          '--acceptance-cursor',
          cursor,
          '--json',
          ...projectArgs(),
        ]),
      );
      expect(pageResult.exitCode).toBe(0);
      const page = (
        pageResult.data as {
          acceptancePage: { items: Array<{ id: string }>; nextCursor: string | null };
        }
      ).acceptancePage;
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
    }
    expect(ids).toHaveLength(17);
    expect(new Set(ids).size).toBe(17);

    const withoutDetails = json(
      await runNativeCli([
        'status',
        'paged-acceptance',
        '--acceptance-cursor',
        firstPage.nextCursor!,
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(withoutDetails).toMatchObject({ exitCode: 64, error: { code: 'usage' } });

    const tamperedCursor = `${firstPage.nextCursor!.slice(0, -1)}${firstPage.nextCursor!.endsWith('0') ? '1' : '0'}`;
    const tampered = json(
      await runNativeCli([
        'status',
        'paged-acceptance',
        '--details',
        '--acceptance-cursor',
        tamperedCursor,
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(tampered).toMatchObject({ exitCode: 65, error: { code: 'invalid-data' } });

    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      pagedBrief.replace('Acceptance outcome 17', 'Changed acceptance outcome 17'),
    );
    const stale = json(
      await runNativeCli([
        'status',
        'paged-acceptance',
        '--details',
        '--acceptance-cursor',
        firstPage.nextCursor!,
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(stale).toMatchObject({ exitCode: 65, error: { code: 'invalid-data' } });
    expect(stale.error?.message).toContain('stale');
  });

  it('creates the default config from new and keeps Classic paths untouched', async () => {
    const result = await runNativeCli(['new', 'default-root', '--json', ...projectArgs()]);
    expect(result.exitCode).toBe(0);
    expect(json(result)).toMatchObject({ data: { name: 'default-root', phase: 'shape' } });
    expect(await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8')).toContain(
      'artifact_root: docs',
    );
    await expect(
      fs.stat(path.join(projectRoot, 'docs', 'comet', 'changes', 'default-root')),
    ).resolves.toBeDefined();
    await expect(fs.access(path.join(projectRoot, 'comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(projectRoot, '.comet'))).resolves.toBeUndefined();
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

    await runNativeCli(['init', '--root', '.', ...projectArgs()]);
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
    const paths = await nativeProjectPaths(projectRoot, 'docs');
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

  it('enforces Sequential confirmation while preserving Batch progression', async () => {
    await runNativeCli(['init', '--root', 'docs', ...projectArgs()]);
    await runNativeCli(['new', 'mode-boundary', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'mode-boundary');
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);

    const blocked = json(
      await runNativeCli([
        'next',
        'mode-boundary',
        '--summary',
        'Sequential clarification is complete',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(blocked).toMatchObject({
      exitCode: 65,
      data: {
        next: 'manual',
        change: { phase: 'shape', approval: null },
        findings: [
          expect.objectContaining({
            code: 'shape-confirmation-required',
            retryCommand: 'comet native next mode-boundary --summary "<summary>" --confirmed',
          }),
        ],
      },
    });
    const sequentialStatus = json(
      await runNativeCli(['status', 'mode-boundary', '--json', ...projectArgs()]),
    );
    expect(sequentialStatus).toMatchObject({
      data: {
        nextCommand: 'comet native next mode-boundary --summary "<summary>" --confirmed',
        continuation: {
          command: 'comet native next mode-boundary --summary "<summary>" --confirmed',
          requiredInputs: ['summary', 'shared-understanding-confirmation'],
        },
      },
    });

    const config = await readProjectConfig(projectRoot);
    expect(config).not.toBeNull();
    await writeProjectConfig(projectRoot, {
      ...config!,
      native: { ...config!.native, clarification_mode: 'batch' },
    });
    const batchStatus = json(
      await runNativeCli(['status', 'mode-boundary', '--json', ...projectArgs()]),
    );
    expect(batchStatus).toMatchObject({
      data: {
        nextCommand: 'comet native next mode-boundary --summary "<summary>"',
        continuation: {
          command: 'comet native next mode-boundary --summary "<summary>"',
          requiredInputs: ['summary'],
        },
      },
    });

    const advanced = json(
      await runNativeCli([
        'next',
        'mode-boundary',
        '--summary',
        'Batch clarification is complete',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(advanced).toMatchObject({
      exitCode: 0,
      data: { change: { phase: 'build', approval: 'implicit' } },
    });
  });

  it('records a remove intent and canonical hash through the spec command', async () => {
    await runNativeCli(['new', 'remove-capability', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
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

  it('rejects show when the brief exceeds its bounded-read budget', async () => {
    await runNativeCli(['new', 'oversized-brief', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await fs.writeFile(
      path.join(paths.changesDir, 'oversized-brief', 'brief.md'),
      Buffer.alloc(NATIVE_CONTRACT_FILE_LIMITS.maxFileBytes + 1, 0x61),
    );

    const result = await runNativeCli(['show', 'oversized-brief', '--json', ...projectArgs()]);

    expect(result.exitCode).toBe(65);
    expect(json(result)).toMatchObject({
      error: { code: 'invalid-data', message: expect.stringContaining('exceeds') },
    });
  });

  it('rejects show when proposed specs exceed the count budget', async () => {
    await runNativeCli(['new', 'too-many-specs', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const specsDir = path.join(paths.changesDir, 'too-many-specs', 'specs');
    await Promise.all(
      Array.from({ length: NATIVE_CONTRACT_FILE_LIMITS.maxSpecs + 1 }, async (_, index) => {
        const directory = path.join(specsDir, `capability-${index}`);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'spec.md'), '# Capability\n');
      }),
    );

    const result = await runNativeCli(['show', 'too-many-specs', '--json', ...projectArgs()]);

    expect(result.exitCode).toBe(65);
    expect(json(result)).toMatchObject({
      error: { code: 'invalid-data', message: expect.stringContaining('spec-count budget') },
    });
  });

  it('rejects show when proposed specs exceed the aggregate byte budget', async () => {
    await runNativeCli(['new', 'oversized-spec-set', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const specsDir = path.join(paths.changesDir, 'oversized-spec-set', 'specs');
    const fileBytes = NATIVE_CONTRACT_FILE_LIMITS.maxFileBytes - 1024;
    await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const directory = path.join(specsDir, `capability-${index}`);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'spec.md'), Buffer.alloc(fileBytes, 0x61));
      }),
    );

    const result = await runNativeCli(['show', 'oversized-spec-set', '--json', ...projectArgs()]);

    expect(result.exitCode).toBe(65);
    expect(json(result)).toMatchObject({
      error: { code: 'invalid-data', message: expect.stringContaining('total byte budget') },
    });
  });

  it('repairs a stale selection without requiring a transaction strategy', async () => {
    await runNativeCli(['init', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'current-change.json'),
      JSON.stringify({
        schema: 'comet.selection.v2',
        workflow: 'native',
        change: 'missing-change',
        branch: null,
      }),
    );
    const repaired = await runNativeCli(['doctor', '--repair', '--json', ...projectArgs()]);
    expect(repaired.exitCode).toBe(0);
    const data = json(repaired).data as { findings: Array<{ code: string }> };
    expect(data.findings).toContainEqual(expect.objectContaining({ code: 'selection-cleared' }));
  });

  it.each([
    [
      'failure facts without a failed result',
      ['next', 'repair-change', '--summary', 'retry', '--failure-category', 'test-failed'],
    ],
    [
      'an unpaired repair override',
      ['next', 'repair-change', '--summary', 'retry', '--override-repair', 'a'.repeat(64)],
    ],
    [
      'a receipt without a Verify result',
      [
        'next',
        'repair-change',
        '--summary',
        'retry',
        '--receipt',
        `runtime/evidence/check-receipts/${'a'.repeat(64)}.json`,
      ],
    ],
    [
      'an override mixed with a Verify result',
      [
        'next',
        'repair-change',
        '--summary',
        'retry',
        '--override-repair',
        'a'.repeat(64),
        '--override-summary',
        'retry once',
        '--result',
        'fail',
      ],
    ],
  ] as const)('rejects %s before touching project state', async (_label, args) => {
    const result = await runNativeCli([...args, '--json', ...projectArgs()]);

    expect(result.exitCode).toBe(64);
    expect(json(result)).toMatchObject({ error: { code: 'usage' } });
    await expect(fs.access(path.join(projectRoot, '.comet', 'config.yaml'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    ['init', ['init'], false],
    ['new', ['new', 'storage-failure'], true],
  ] as const)(
    'returns exit 70 with a retryable state when %s hits an unexpected filesystem failure',
    async (_command, args, retryCreatesChange) => {
      const failure = Object.assign(new Error('simulated storage failure'), { code: 'EIO' });
      const realpath = vi.spyOn(fs, 'realpath').mockRejectedValueOnce(failure);
      try {
        const result = await runNativeCli([...args, '--json', ...projectArgs()]);
        expect(result.exitCode).toBe(70);
        expect(json(result)).toMatchObject({ error: { code: 'internal' } });
      } finally {
        realpath.mockRestore();
      }
      await expect(
        fs.access(path.join(projectRoot, '.comet', 'config.yaml')),
      ).rejects.toMatchObject({
        code: 'ENOENT',
      });
      if (!retryCreatesChange) return;
      const retried = await runNativeCli([...args, '--json', ...projectArgs()]);
      expect(retried.exitCode).toBe(0);
      expect(json(retried)).toMatchObject({ data: { name: 'storage-failure' } });
    },
  );
});
