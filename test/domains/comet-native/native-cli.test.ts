import { promises as fs } from 'fs';
import { execFileSync } from 'node:child_process';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER,
  parseNativeVerificationMachineBlock,
} from '../../../domains/comet-native/native-acceptance.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { NATIVE_CONTRACT_FILE_LIMITS } from '../../../domains/comet-native/native-contract-files.js';
import { acquireNativeLock, releaseNativeLock } from '../../../domains/comet-native/native-lock.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES } from '../../../domains/comet-native/native-verification-scope.js';

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
    vi.unstubAllEnvs();
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
    const config = defaultProjectConfig('.');
    config.native.snapshot.max_total_bytes = 5 * 1024 * 1024;
    await writeProjectConfig(projectRoot, config);
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
        supportedFixes: [
          expect.stringContaining('native.snapshot.max_files'),
          expect.stringContaining('native.snapshot.exclude'),
        ],
        requiredAction: 'resolve-native-baseline',
      },
      error: { code: 'baseline-incomplete' },
    });
    await expect(
      fs.access(path.join(projectRoot, 'comet', 'changes', 'incomplete-baseline')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('binds the first change and requires a worktree before creating another change', async () => {
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
    const workspace = JSON.parse(
      await fs.readFile(
        path.join(
          projectRoot,
          'docs',
          'comet',
          'changes',
          'first-change',
          'runtime',
          'workspace.json',
        ),
        'utf8',
      ),
    ) as { changeBranch: string; targetBranch: string };
    expect(workspace).toMatchObject({
      schema: 'comet.native.workspace.v3',
      isolation: 'current',
      changeBranch: expect.any(String),
    });
    expect(workspace.targetBranch).toBe(workspace.changeBranch);

    const second = json(await runNativeCli(['new', 'second-change', '--json', ...projectArgs()]));
    expect(second).toMatchObject({
      exitCode: 73,
      data: {
        requestedIsolation: 'current',
        activeChanges: ['first-change'],
        requiredAction: 'create-native-worktree',
      },
      error: { code: 'workspace-isolation-required' },
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
  });

  it('atomically allows only one default-current creation when two sessions race', async () => {
    const results = await Promise.all(
      ['race-alpha', 'race-beta'].map(async (name) => ({
        name,
        result: json(await runNativeCli(['new', name, '--json', ...projectArgs()])),
      })),
    );
    const succeeded = results.filter(({ result }) => result.exitCode === 0);
    const rejected = results.filter(({ result }) => result.exitCode === 73);

    expect(succeeded, JSON.stringify(results)).toHaveLength(1);
    expect(rejected, JSON.stringify(results)).toHaveLength(1);
    expect(rejected[0].result).toMatchObject({
      data: {
        requestedIsolation: 'current',
        activeChanges: [succeeded[0].name],
        requiredAction: 'create-native-worktree',
      },
      error: { code: 'workspace-isolation-required' },
    });
  });

  it('treats a runtime-incompatible active change as occupying the working directory', async () => {
    expect(await runNativeCli(['new', 'future-owner', ...projectArgs()])).toMatchObject({
      exitCode: 0,
    });
    const stateFile = path.join(projectRoot, 'docs/comet/changes/future-owner/comet-state.yaml');
    const source = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(
      stateFile,
      source
        .replace('schema: comet.native.v3', 'schema: comet.native.v4')
        .replace('minimum_runtime_version: 3', 'minimum_runtime_version: 4'),
    );

    expect(
      json(await runNativeCli(['new', 'blocked-by-future', '--json', ...projectArgs()])),
    ).toMatchObject({
      exitCode: 73,
      data: {
        activeChanges: ['future-owner'],
        requiredAction: 'create-native-worktree',
      },
      error: { code: 'workspace-isolation-required' },
    });
  });

  it('persists branch ownership and blocks a bound change after branch drift', async () => {
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const targetBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['switch', '-c', 'comet/branch-owned'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });

    expect(
      json(
        await runNativeCli([
          'new',
          'invalid-target',
          '--isolation',
          'branch',
          '--target-branch',
          'missing-target',
          '--json',
          ...projectArgs(),
        ]),
      ),
    ).toMatchObject({
      exitCode: 65,
      error: { message: expect.stringContaining('not a verified local branch') },
    });

    expect(
      await runNativeCli([
        'new',
        'branch-owned',
        '--isolation',
        'branch',
        '--target-branch',
        targetBranch,
        ...projectArgs(),
      ]),
    ).toMatchObject({ exitCode: 0 });
    const workspace = JSON.parse(
      await fs.readFile(
        path.join(projectRoot, 'docs/comet/changes/branch-owned/runtime/workspace.json'),
        'utf8',
      ),
    );
    expect(workspace).toMatchObject({
      schema: 'comet.native.workspace.v3',
      isolation: 'branch',
      changeBranch: 'comet/branch-owned',
      targetBranch,
    });

    execFileSync('git', ['switch', targetBranch], { cwd: projectRoot, stdio: 'ignore' });
    const drifted = json(
      await runNativeCli(['select', 'branch-owned', '--json', ...projectArgs()]),
    );
    expect(drifted).toMatchObject({
      exitCode: 65,
      error: { code: 'invalid-data', message: expect.stringContaining('workspace-branch-changed') },
    });
    expect(
      json(await runNativeCli(['status', 'branch-owned', '--json', ...projectArgs()])).data,
    ).toMatchObject({
      name: 'branch-owned',
      phase: 'shape',
      findingSummary: {
        codes: expect.arrayContaining(['workspace-branch-changed']),
      },
      continuation: { disposition: 'blocked' },
    });
  });

  it('rechecks an explicit Git binding under the creation lock', async () => {
    expect(await runNativeCli(['init', ...projectArgs()])).toMatchObject({ exitCode: 0 });
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    execFileSync('git', ['add', '.comet/config.yaml'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: projectRoot, stdio: 'ignore' });
    const targetBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['switch', '-c', 'comet/locked-binding'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const lock = await acquireNativeLock(paths, 'root-move', 'hold new under test');
    let pending: ReturnType<typeof runNativeCli>;
    try {
      pending = runNativeCli([
        'new',
        'locked-binding',
        '--isolation',
        'branch',
        '--change-branch',
        'comet/locked-binding',
        '--target-branch',
        targetBranch,
        '--json',
        ...projectArgs(),
      ]);
      await new Promise((resolve) => setTimeout(resolve, 75));
      execFileSync('git', ['switch', targetBranch], { cwd: projectRoot, stdio: 'ignore' });
    } finally {
      await releaseNativeLock(lock);
    }
    expect(json(await pending!)).toMatchObject({
      exitCode: 65,
      error: {
        code: 'invalid-data',
        message: expect.stringContaining('does not match the current branch'),
      },
    });
    await expect(
      fs.access(path.join(projectRoot, 'docs/comet/changes/locked-binding')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['workspace v3', false],
    ['legacy workspace v2', true],
  ])('ignores an active change bound to another physical worktree (%s)', async (_label, legacy) => {
    expect(await runNativeCli(['init', ...projectArgs()])).toMatchObject({ exitCode: 0 });
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const targetBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    expect(await runNativeCli(['new', 'primary-change', ...projectArgs()])).toMatchObject({
      exitCode: 0,
    });
    if (legacy) {
      const workspaceFile = path.join(
        projectRoot,
        'docs/comet/changes/primary-change/runtime/workspace.json',
      );
      const workspace = JSON.parse(await fs.readFile(workspaceFile, 'utf8')) as Record<
        string,
        unknown
      >;
      workspace.schema = 'comet.native.workspace.v2';
      delete workspace.isolation;
      delete workspace.changeBranch;
      delete workspace.targetBranch;
      delete workspace.finish;
      await fs.writeFile(workspaceFile, `${JSON.stringify(workspace, null, 2)}\n`);
    }
    execFileSync('git', ['add', '.comet/config.yaml', 'docs/comet/changes/primary-change'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-m', 'capture active change fixture'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const secondary = path.join(
      os.tmpdir(),
      `comet-native-independent-worktree-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'comet/secondary-change', secondary, 'HEAD'], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      expect(
        json(
          await runNativeCli([
            'new',
            'secondary-change',
            '--isolation',
            'worktree',
            '--target-branch',
            targetBranch,
            '--json',
            '--project-root',
            secondary,
          ]),
        ),
      ).toMatchObject({ exitCode: 0 });
      if (!legacy) {
        expect(
          json(
            await runNativeCli(['status', 'primary-change', '--json', '--project-root', secondary]),
          ).data,
        ).toMatchObject({
          phase: 'shape',
          findingSummary: {
            codes: expect.arrayContaining(['workspace-binding-root-changed']),
          },
          continuation: { disposition: 'blocked' },
        });
      }
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', secondary], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      await fs.rm(secondary, { recursive: true, force: true });
    }
  });

  it('accepts worktree isolation only from a linked Git worktree', async () => {
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const targetBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    const secondary = path.join(
      os.tmpdir(),
      `comet-native-cli-worktree-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'comet/worktree-owned', secondary, 'HEAD'], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      const created = json(
        await runNativeCli([
          'new',
          'worktree-owned',
          '--isolation',
          'worktree',
          '--target-branch',
          targetBranch,
          '--json',
          '--project-root',
          secondary,
        ]),
      );
      expect(created).toMatchObject({
        exitCode: 0,
        data: {
          workspace: {
            schema: 'comet.native.workspace.v3',
            isolation: 'worktree',
            changeBranch: 'comet/worktree-owned',
            targetBranch,
          },
        },
      });
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', secondary], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      await fs.rm(secondary, { recursive: true, force: true });
    }
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
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: projectRoot });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: projectRoot });
    if (process.platform === 'win32') {
      await fs.writeFile(
        path.join(projectRoot, 'receipt-probe.cmd'),
        [
          '@echo off',
          'if not "%COMET_NATIVE_RECEIPT_ENV_TEST%"=="available" exit /b 8',
          'if not "%~1"=="value & with spaces" exit /b 9',
          'echo shim-ok',
        ].join('\r\n'),
      );
      execFileSync('git', ['add', 'receipt-probe.cmd'], { cwd: projectRoot });
    }
    execFileSync('git', ['commit', '--allow-empty', '-m', 'initial'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });

    const targetBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim();
    execFileSync('git', ['switch', '-c', 'comet/sentence-counting'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });

    const root = json(await runNativeCli(['root', 'show', '--json', ...projectArgs()]));
    expect(root).toMatchObject({ command: 'root show', data: { artifactRoot: 'docs' } });

    const created = await runNativeCli([
      'new',
      'sentence-counting',
      '--isolation',
      'branch',
      '--target-branch',
      targetBranch,
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

    expect(json(await runNativeCli(['status', '--json', ...projectArgs()])).data).toMatchObject({
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
    expect(builtCriteria).toHaveLength(2);
    expect(builtCriteria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringMatching(/^acceptance-[a-f0-9]{64}$/u) }),
      ]),
    );

    const resumed = json(
      await runNativeCli(['status', 'sentence-counting', '--details', '--json', ...projectArgs()]),
    );
    const resumedCriteria = (resumed.data as { acceptancePage: { items: Array<{ id: string }> } })
      .acceptancePage.items;
    expect(resumedCriteria).toEqual(builtCriteria);
    vi.stubEnv('COMET_NATIVE_RECEIPT_ENV_TEST', 'available');
    const argvProbe = json(
      await runNativeCli([
        'receipt',
        'automated',
        'sentence-counting',
        ...resumedCriteria.flatMap((criterion) => ['--acceptance', criterion.id]),
        '--timeout-ms',
        '5000',
        '--json',
        ...projectArgs(),
        '--',
        process.execPath,
        '-e',
        "const expected=['--json','--project-root','child-root']; if(JSON.stringify(process.argv.slice(1))!==JSON.stringify(expected)||process.env.COMET_NATIVE_RECEIPT_ENV_TEST!=='available') process.exit(2); process.stdout.write('argv and environment preserved; to'+'ken=secret-value')",
        '--',
        '--json',
        '--project-root',
        'child-root',
      ]),
    );
    expect(argvProbe, JSON.stringify(argvProbe)).toMatchObject({
      exitCode: 0,
      data: {
        receipt: {
          status: 'passed',
          evidence: {
            args: expect.arrayContaining(['--json', '--project-root', 'child-root']),
            outputSummary: 'argv and environment preserved; token=[REDACTED]',
          },
        },
      },
    });
    if (process.platform === 'win32') {
      const shimProbe = json(
        await runNativeCli([
          'receipt',
          'automated',
          'sentence-counting',
          ...resumedCriteria.flatMap((criterion) => ['--acceptance', criterion.id]),
          '--json',
          ...projectArgs(),
          '--',
          '.\\receipt-probe',
          'value & with spaces',
        ]),
      );
      expect(shimProbe, JSON.stringify(shimProbe)).toMatchObject({
        exitCode: 0,
        data: {
          receipt: {
            status: 'passed',
            evidence: {
              args: ['value & with spaces'],
              outputSummary: 'shim-ok',
            },
          },
        },
      });
    }
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    try {
      const posixProbe = json(
        await runNativeCli([
          'receipt',
          'automated',
          'sentence-counting',
          ...resumedCriteria.flatMap((criterion) => ['--acceptance', criterion.id]),
          '--json',
          ...projectArgs(),
          '--',
          process.execPath,
          '-e',
          "process.stdout.write('posix-direct-ok')",
        ]),
      );
      expect(posixProbe, JSON.stringify(posixProbe)).toMatchObject({
        exitCode: 0,
        data: {
          receipt: {
            status: 'passed',
            evidence: { outputSummary: 'posix-direct-ok' },
          },
        },
      });
    } finally {
      platformSpy.mockRestore();
    }
    const timedOutReceipt = json(
      await runNativeCli([
        'receipt',
        'automated',
        'sentence-counting',
        ...resumedCriteria.flatMap((criterion) => ['--acceptance', criterion.id]),
        '--timeout-ms',
        '1',
        '--json',
        ...projectArgs(),
        '--',
        process.execPath,
        '-e',
        'setInterval(() => {}, 1_000)',
      ]),
    );
    expect(timedOutReceipt, JSON.stringify(timedOutReceipt)).toMatchObject({
      exitCode: 1,
      data: {
        receipt: {
          status: 'blocked',
          evidence: { timedOut: true, exitCode: 124, signal: 'SIGKILL' },
        },
      },
    });
    const manualReceiptResult = json(
      await runNativeCli([
        'receipt',
        'manual',
        'sentence-counting',
        ...resumedCriteria.flatMap((criterion) => ['--acceptance', criterion.id]),
        '--step',
        'Execute the sentence-counting acceptance contract.',
        '--observation',
        'Every acceptance criterion produced the expected result.',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(manualReceiptResult.exitCode).toBe(0);
    expect(manualReceiptResult.data).toMatchObject({
      receipt: {
        schema: 'comet.native.verification-receipt.v3',
        actor: 'native-runtime:manual-evidence',
        evidence: {
          steps: ['Execute the sentence-counting acceptance contract.'],
          observations: ['Every acceptance criterion produced the expected result.'],
        },
      },
    });
    expect(JSON.stringify(manualReceiptResult.data)).not.toContain('responsible');
    const manualReceiptRef = (manualReceiptResult.data as { ref: string }).ref;
    const acceptanceEntries = resumedCriteria
      .map((criterion) => ({
        acceptance_id: criterion.id,
        status: 'passed',
        evidence_refs: [manualReceiptRef],
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

    expect(
      json(
        await runNativeCli([
          'archive',
          'sentence-counting',
          '--dry-run',
          '--json',
          ...projectArgs(),
        ]),
      ),
    ).toMatchObject({
      exitCode: 64,
      error: { message: expect.stringContaining('require --finish') },
    });
    const preview = json(
      await runNativeCli([
        'archive',
        'sentence-counting',
        '--dry-run',
        '--finish',
        'merge',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(preview.data).toMatchObject({
      archiveConfirmation: 'automatic',
      workspaceFinish: 'merge',
      continuation: {
        disposition: 'continue',
        action: 'archive',
        requiresUserDecision: false,
      },
    });
    const preflightHash = (preview.data as { preflightHash: string }).preflightHash;
    const pushPreview = json(
      await runNativeCli([
        'archive',
        'sentence-counting',
        '--dry-run',
        '--finish',
        'push',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(pushPreview.data).toMatchObject({ workspaceFinish: 'push' });
    expect((pushPreview.data as { preflightHash: string }).preflightHash).not.toBe(preflightHash);
    const restoredPreview = json(
      await runNativeCli([
        'archive',
        'sentence-counting',
        '--dry-run',
        '--finish',
        'merge',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect((restoredPreview.data as { preflightHash: string }).preflightHash).toBe(preflightHash);
    const config = await readProjectConfig(projectRoot);
    expect(config).not.toBeNull();
    config!.native.archive_confirmation = 'required';
    await writeProjectConfig(projectRoot, config!);
    const requiredPreview = json(
      await runNativeCli(['archive', 'sentence-counting', '--dry-run', '--json', ...projectArgs()]),
    );
    expect(requiredPreview.data).toMatchObject({
      archiveConfirmation: 'required',
      continuation: {
        disposition: 'await-user',
        action: 'archive',
        command: null,
        requiresUserDecision: true,
        requiredInputs: ['archive-confirmation'],
      },
    });
    const requiredPreflightHash = (requiredPreview.data as { preflightHash: string }).preflightHash;
    expect(requiredPreflightHash).not.toBe(preflightHash);
    const unconfirmed = json(
      await runNativeCli([
        'archive',
        'sentence-counting',
        '--expect-preflight',
        requiredPreflightHash,
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(unconfirmed).toMatchObject({
      exitCode: 64,
      error: {
        code: 'usage',
        message: 'archive requires --confirmed when native.archive_confirmation is required',
      },
    });
    await expect(
      fs.stat(path.join(projectRoot, 'docs', 'comet', 'changes', 'sentence-counting')),
    ).resolves.toBeDefined();
    const archived = await runNativeCli([
      'archive',
      'sentence-counting',
      '--expect-preflight',
      requiredPreflightHash,
      '--confirmed',
      ...projectArgs(),
    ]);
    expect(archived.exitCode, archived.stderr).toBe(0);
    expect(archived.stdout).toContain('Archived Native change sentence-counting');

    const moved = await runNativeCli(['root', 'move', 'artifacts/native', ...projectArgs()]);
    expect(moved.exitCode, moved.stderr).toBe(0);
    expect(moved.stdout).toContain(path.join('artifacts', 'native', 'comet'));

    const doctor = json(await runNativeCli(['doctor', '--json', ...projectArgs()]));
    expect(doctor).toMatchObject({ command: 'doctor', exitCode: 0, data: { healthy: true } });
  }, 240_000);

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
    expect(help.stdout).not.toContain('trust ');
    expect(help.stdout).not.toContain('receipt implement');
    expect(help.stdout).not.toContain('receipt review');
    expect(help.stdout).not.toContain('receipt waive');
    expect(help.stdout).not.toContain('--waiver');
    expect(help.stdout).not.toContain('\n  list ');
    expect(help.stdout).not.toContain('--receipt <');
    expect(help.stdout).not.toContain('--evidence-receipt');
    expect(help.stdout).not.toContain('--failure-category');
    expect(help.stdout).not.toContain('--failed-check');
    expect(help.stdout).not.toContain('--independent-review-receipt');

    const missing = await runNativeCli(['status', '--json', ...projectArgs()]);
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

  it('enforces shared-understanding confirmation in Sequential and Batch modes', async () => {
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
        nextCommand: 'comet native next mode-boundary --summary "<summary>" --confirmed',
        continuation: {
          command: 'comet native next mode-boundary --summary "<summary>" --confirmed',
          requiredInputs: ['summary', 'shared-understanding-confirmation'],
        },
      },
    });

    const batchBlocked = json(
      await runNativeCli([
        'next',
        'mode-boundary',
        '--summary',
        'Batch clarification is complete',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(batchBlocked).toMatchObject({
      exitCode: 65,
      data: {
        change: { phase: 'shape', approval: null },
        findings: [expect.objectContaining({ code: 'shape-confirmation-required' })],
      },
    });

    const advanced = json(
      await runNativeCli([
        'next',
        'mode-boundary',
        '--summary',
        'Batch shared understanding is confirmed',
        '--confirmed',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(advanced).toMatchObject({
      exitCode: 0,
      data: { change: { phase: 'build', approval: 'confirmed' } },
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
      const commandArgs = [...args];
      const failure = Object.assign(new Error('simulated storage failure'), { code: 'EIO' });
      const realpath = vi.spyOn(fs, 'realpath').mockRejectedValueOnce(failure);
      try {
        const result = await runNativeCli([...commandArgs, '--json', ...projectArgs()]);
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
      const retried = await runNativeCli([...commandArgs, '--json', ...projectArgs()]);
      expect(retried.exitCode).toBe(0);
      expect(json(retried)).toMatchObject({ data: { name: 'storage-failure' } });
    },
  );

  it('formats acceptance evidence entries into the exact canonical verification.md block', async () => {
    const acceptanceId = `acceptance-${'a'.repeat(64)}`;
    const firstRef = `runtime/evidence/receipts/${'a'.repeat(64)}.json`;
    const secondRef = `runtime/evidence/receipts/${'b'.repeat(64)}.json`;
    const entriesPath = path.join(projectRoot, 'entries.json');
    await fs.writeFile(
      entriesPath,
      JSON.stringify([
        {
          acceptance_id: acceptanceId,
          status: 'passed',
          evidence_refs: [secondRef, firstRef],
        },
      ]),
    );

    const result = await runNativeCli([
      'evidence',
      'format',
      '--entries',
      entriesPath,
      '--json',
      ...projectArgs(),
    ]);

    expect(result.exitCode).toBe(0);
    const { block } = json(result).data as { block: string };
    expect(block).toContain(NATIVE_ACCEPTANCE_EVIDENCE_START_MARKER);
    expect(parseNativeVerificationMachineBlock(block)).toEqual([
      {
        acceptance_id: acceptanceId,
        status: 'passed',
        evidence_refs: [firstRef, secondRef],
      },
    ]);

    const handWritten = block.replace('  {', ' {');
    expect(() => parseNativeVerificationMachineBlock(handWritten)).toThrow(
      'canonical serialization',
    );
  });

  it('rejects evidence format with no entries source when stdin is a TTY', async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    try {
      const result = await runNativeCli(['evidence', 'format', '--json', ...projectArgs()]);
      expect(result.exitCode).toBe(64);
      expect(json(result)).toMatchObject({ error: { code: 'usage' } });
    } finally {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: originalIsTTY,
        configurable: true,
      });
    }
  });

  it.each([
    ['malformed JSON', '{not json'],
    ['a non-array JSON value', '{}'],
  ])('rejects %s as invalid acceptance evidence entries', async (_label, contents) => {
    const entriesPath = path.join(projectRoot, 'entries.json');
    await fs.writeFile(entriesPath, contents);

    const result = await runNativeCli([
      'evidence',
      'format',
      '--entries',
      entriesPath,
      '--json',
      ...projectArgs(),
    ]);

    expect(result.exitCode).toBe(65);
    expect(json(result)).toMatchObject({ error: { code: 'invalid-data' } });
  });

  it('rejects an entries file larger than the Native evidence document limit', async () => {
    const entriesPath = path.join(projectRoot, 'entries.json');
    await fs.writeFile(
      entriesPath,
      'x'.repeat(MAX_NATIVE_IMPLEMENTATION_EVIDENCE_DOCUMENT_BYTES + 1),
    );

    const result = await runNativeCli([
      'evidence',
      'format',
      '--entries',
      entriesPath,
      '--json',
      ...projectArgs(),
    ]);

    expect(result.exitCode).toBe(65);
    expect(json(result)).toMatchObject({
      error: { code: 'invalid-data', message: expect.stringContaining('exceeds') },
    });
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a FIFO entries source without blocking on open',
    async () => {
      const fifoPath = path.join(projectRoot, 'entries.fifo');
      execFileSync('mkfifo', [fifoPath]);

      const result = await runNativeCli([
        'evidence',
        'format',
        '--entries',
        fifoPath,
        '--json',
        ...projectArgs(),
      ]);

      expect(result.exitCode).toBe(65);
      expect(json(result)).toMatchObject({
        error: { code: 'invalid-data', message: expect.stringContaining('not a regular file') },
      });
    },
  );

  it.skipIf(process.platform === 'win32')(
    'rejects a symlink entries source instead of following it',
    async () => {
      const target = path.join(projectRoot, 'entries-target.json');
      await fs.writeFile(target, JSON.stringify([]));
      const linkPath = path.join(projectRoot, 'entries-link.json');
      await fs.symlink(target, linkPath);

      const result = await runNativeCli([
        'evidence',
        'format',
        '--entries',
        linkPath,
        '--json',
        ...projectArgs(),
      ]);

      expect(result.exitCode).toBe(65);
      expect(json(result)).toMatchObject({
        error: { code: 'invalid-data', message: expect.stringContaining('not a regular file') },
      });
    },
  );
});
