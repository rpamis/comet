import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stringify } from 'yaml';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  readProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { projectRootFrom } from '../../../domains/comet-native/native-cli-shared.js';
import { acquireNativeLock, releaseNativeLock } from '../../../domains/comet-native/native-lock.js';
import {
  nativeChangeRuntimeDir,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  nativeLocalExecutionFile,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';

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

  function configureGit(root = projectRoot): void {
    execFileSync('git', ['config', 'user.email', 'native@example.test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: root });
  }

  function currentBranch(root = projectRoot): string {
    return execFileSync('git', ['branch', '--show-current'], {
      cwd: root,
      encoding: 'utf8',
    }).trim();
  }

  async function initializeAndCommit(): Promise<string> {
    expect(await runNativeCli(['init', ...projectArgs()])).toMatchObject({ exitCode: 0 });
    configureGit();
    execFileSync('git', ['add', '-A'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'initialize Native'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    return currentBranch();
  }

  it('initializes docs as the default Native artifact root and allowlists only project config', async () => {
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
    const gitignore = await fs.readFile(path.join(projectRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('/.comet/*');
    expect(gitignore).toContain('!/.comet/config.yaml');
    expect(gitignore).not.toContain('!/.comet/runtime');
  });

  it('preserves an existing Native root and language when init is repeated', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('artifacts/native', 'zh-CN'));

    const initialized = json(await runNativeCli(['init', '--json', ...projectArgs()]));

    expect(initialized).toMatchObject({
      exitCode: 0,
      data: { artifactRoot: 'artifacts/native', language: 'zh-CN' },
    });
    const saved = await readProjectConfig(projectRoot);
    expect(saved?.native).toMatchObject({ artifact_root: 'artifacts/native', language: 'zh-CN' });
  });

  it('creates v4 portable artifacts without scanning or snapshotting an unrelated large project file', async () => {
    const branch = currentBranch();
    await fs.writeFile(
      path.join(projectRoot, 'large-project-file.bin'),
      Buffer.alloc(5 * 1024 * 1024),
    );

    const created = json(
      await runNativeCli(['new', 'portable-change', '--json', ...projectArgs()]),
    );

    expect(created).toMatchObject({
      exitCode: 0,
      data: {
        schema: 'comet.native.v4',
        name: 'portable-change',
        phase: 'shape',
        workspace: {
          isolation: 'current',
          change_branch: branch,
          target_branch: branch,
          finish: null,
        },
        continuation: {
          schema: 'comet.native.continuation.v2',
          action: 'confirm-shape',
          disposition: 'continue',
          runnerAction: { kind: 'none' },
        },
      },
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'portable-change');
    expect((await fs.readdir(changeDir)).sort()).toEqual(['brief.md', 'comet-state.yaml', 'specs']);
    const runtimeDir = nativeChangeRuntimeDir(paths, 'portable-change');
    expect(await fs.readdir(runtimeDir)).toEqual(['state.json']);

    const yaml = await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8');
    expect(yaml).toContain('schema: comet.native.v4');
    expect(yaml).toContain('state_version: 1');
    expect(yaml).not.toMatch(/snapshot|baseline|sha256|contract_hash|approved_contract/iu);
    const local = JSON.parse(
      await fs.readFile(path.join(runtimeDir, 'state.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(local).toMatchObject({
      schema: 'comet.native.local-execution.v4',
      change: 'portable-change',
      basedOnStateVersion: 1,
      execution: null,
      checks: [],
      workspace: {
        projectRoot: path.resolve(projectRoot),
        worktreeRoot: path.resolve(projectRoot),
      },
    });
    expect(JSON.stringify(local)).not.toMatch(/snapshot|baseline|receipt|evidence|checkpoint/iu);
  });

  it('binds one current-workspace change and requires isolation for a second change', async () => {
    const branch = currentBranch();
    const first = json(await runNativeCli(['new', 'first-change', '--json', ...projectArgs()]));
    expect(first).toMatchObject({
      exitCode: 0,
      data: {
        workspace: { isolation: 'current', change_branch: branch, target_branch: branch },
      },
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
  });

  it('fails closed when a current-workspace change is opened from another branch', async () => {
    const boundBranch = await initializeAndCommit();
    expect(
      json(await runNativeCli(['new', 'current-bound', '--json', ...projectArgs()])),
    ).toMatchObject({
      exitCode: 0,
      data: {
        workspace: {
          isolation: 'current',
          change_branch: boundBranch,
          target_branch: boundBranch,
        },
      },
    });

    execFileSync('git', ['switch', '-c', 'current-drift'], { cwd: projectRoot, stdio: 'ignore' });
    expect(
      json(await runNativeCli(['status', 'current-bound', '--json', ...projectArgs()])),
    ).toMatchObject({
      data: {
        workspace: { bindingState: 'mismatch', changeBranch: boundBranch },
        continuation: {
          disposition: 'await-user',
          requiredInputs: ['return-to-bound-workspace'],
        },
      },
    });
  });

  it('atomically allows only one current-workspace creation when two sessions race', async () => {
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
        activeChanges: [succeeded[0].name],
        requiredAction: 'create-native-worktree',
      },
      error: { code: 'workspace-isolation-required' },
    });
  });

  it('persists portable branch ownership and projects branch drift as await-user', async () => {
    const targetBranch = await initializeAndCommit();
    execFileSync('git', ['switch', '-c', 'comet/branch-owned'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });

    const created = json(
      await runNativeCli([
        'new',
        'branch-owned',
        '--isolation',
        'branch',
        '--target-branch',
        targetBranch,
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(created).toMatchObject({
      exitCode: 0,
      data: {
        workspace: {
          isolation: 'branch',
          change_branch: 'comet/branch-owned',
          target_branch: targetBranch,
        },
      },
    });
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await expect(
      fs.access(path.join(nativeChangeRuntimeDir(paths, 'branch-owned'), 'workspace.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });

    execFileSync('git', ['switch', targetBranch], { cwd: projectRoot, stdio: 'ignore' });
    const status = json(await runNativeCli(['status', 'branch-owned', '--json', ...projectArgs()]));
    expect(status).toMatchObject({
      exitCode: 0,
      data: {
        schema: 'comet.native.status.v2',
        workspace: {
          projectRoot: path.resolve(projectRoot),
          isolation: 'branch',
          bindingState: 'mismatch',
          changeBranch: 'comet/branch-owned',
          targetBranch,
          message: expect.stringContaining('Expected branch'),
        },
        continuation: {
          disposition: 'await-user',
          action: 'none',
          commandArgs: null,
          requiredInputs: ['return-to-bound-workspace'],
          runnerAction: { kind: 'none' },
        },
      },
    });
  });

  it('rechecks an explicit Git binding under the Native creation lock', async () => {
    const targetBranch = await initializeAndCommit();
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
      error: { code: 'invalid-data', message: expect.stringContaining('current branch') },
    });
    await expect(
      fs.access(path.join(projectRoot, 'docs', 'comet', 'changes', 'locked-binding')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists worktree binding and reports drift from the linked worktree', async () => {
    const targetBranch = await initializeAndCommit();
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
            isolation: 'worktree',
            change_branch: 'comet/worktree-owned',
            target_branch: targetBranch,
          },
          preparation: {
            isolation: 'worktree',
            projectRoot: path.resolve(secondary),
            worktreePath: path.resolve(secondary),
          },
        },
      });
      expect(
        json(
          await runNativeCli(['status', 'worktree-owned', '--json', '--project-root', secondary]),
        ).data,
      ).toMatchObject({
        workspace: {
          projectRoot: path.resolve(secondary),
          isolation: 'worktree',
          bindingState: 'aligned',
          changeBranch: 'comet/worktree-owned',
          targetBranch,
        },
        continuation: { disposition: 'continue' },
      });

      execFileSync('git', ['switch', '-c', 'comet/worktree-drift'], {
        cwd: secondary,
        stdio: 'ignore',
      });
      expect(
        json(
          await runNativeCli(['status', 'worktree-owned', '--json', '--project-root', secondary]),
        ).data,
      ).toMatchObject({
        workspace: { bindingState: 'mismatch', changeBranch: 'comet/worktree-owned' },
        continuation: {
          disposition: 'await-user',
          requiredInputs: ['return-to-bound-workspace'],
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

  it('rejects an incomplete root move before preparing an isolated workspace', async () => {
    const targetBranch = await initializeAndCommit();
    const config = await readProjectConfig(projectRoot);
    expect(config).not.toBeNull();
    config!.native.pending_root_move = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      fromArtifactRoot: 'docs',
      toArtifactRoot: 'artifacts/native',
      stage: 'ready',
    };
    await writeProjectConfig(projectRoot, config!);

    const result = json(
      await runNativeCli([
        'new',
        'blocked-root-move',
        '--isolation',
        'branch',
        '--target-branch',
        targetBranch,
        '--json',
        ...projectArgs(),
      ]),
    );

    expect(result).toMatchObject({
      exitCode: 73,
      error: { code: 'conflict', message: expect.stringContaining('root move') },
    });
    expect(currentBranch()).toBe(targetBranch);
    expect(
      execFileSync('git', ['branch', '--list', 'comet/blocked-root-move'], {
        cwd: projectRoot,
        encoding: 'utf8',
      }).trim(),
    ).toBe('');
  });

  it('keeps a linked worktree authoritative when a host passes the primary root', async () => {
    configureGit();
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    execFileSync('git', ['add', '.comet/config.yaml'], { cwd: projectRoot, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed Native config'], {
      cwd: projectRoot,
      stdio: 'ignore',
    });
    const secondary = path.join(
      os.tmpdir(),
      `comet-native-cli-root-route-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    try {
      execFileSync('git', ['worktree', 'add', '-b', 'comet/root-route', secondary, 'HEAD'], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      const cwd = vi.spyOn(process, 'cwd').mockReturnValue(secondary);
      try {
        await expect(projectRootFrom(projectRoot)).resolves.toBe(path.resolve(secondary));
        expect(
          json(await runNativeCli(['new', 'root-routed', '--json', '--project-root', projectRoot])),
        ).toMatchObject({ exitCode: 0 });
      } finally {
        cwd.mockRestore();
      }

      const secondaryPaths = await nativeProjectPaths(secondary, 'docs');
      await expect(
        fs.access(path.join(nativeChangeRuntimeDir(secondaryPaths, 'root-routed'), 'state.json')),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(
          path.join(secondary, 'docs', 'comet', 'changes', 'root-routed', 'comet-state.yaml'),
        ),
      ).resolves.toBeUndefined();
      await expect(
        fs.access(path.join(projectRoot, 'docs', 'comet', 'changes', 'root-routed')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      execFileSync('git', ['worktree', 'remove', '--force', secondary], {
        cwd: projectRoot,
        stdio: 'ignore',
      });
      await fs.rm(secondary, { recursive: true, force: true });
    }
  });

  it('runs a custom-root change through every CLI-reachable stable boundary', async () => {
    expect(
      json(
        await runNativeCli([
          'init',
          '--root',
          'artifacts/native',
          '--language',
          'zh-CN',
          '--json',
          ...projectArgs(),
        ]),
      ),
    ).toMatchObject({
      exitCode: 0,
      data: { artifactRoot: 'artifacts/native', language: 'zh-CN' },
    });
    const created = json(
      await runNativeCli(['new', 'sentence-counting', '--json', ...projectArgs()]),
    );
    expect(created).toMatchObject({
      exitCode: 0,
      data: {
        schema: 'comet.native.v4',
        continuation: { action: 'confirm-shape', runnerAction: { kind: 'none' } },
      },
    });
    const paths = await nativeProjectPaths(projectRoot, 'artifacts/native');
    const changeDir = path.join(paths.changesDir, 'sentence-counting');
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    await fs.mkdir(path.join(changeDir, 'specs', 'sentence-counting'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'sentence-counting', 'spec.md'),
      '# Sentence counting\nCount sentences by punctuation.\n',
    );

    expect(json(await runNativeCli(['status', '--json', ...projectArgs()])).data).toMatchObject({
      schema: 'comet.native.status-page.v2',
      total: 1,
      items: [
        expect.objectContaining({
          name: 'sentence-counting',
          phase: 'shape',
          workspace: expect.objectContaining({
            projectRoot: path.resolve(projectRoot),
            bindingState: 'aligned',
          }),
        }),
      ],
    });
    expect(
      json(await runNativeCli(['show', 'sentence-counting', '--json', ...projectArgs()])).data,
    ).toMatchObject({
      state: { schema: 'comet.native.v4', language: 'zh-CN', phase: 'shape' },
      brief,
      continuation: { action: 'confirm-shape' },
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
        state: {
          schema: 'comet.native.v4',
          phase: 'build',
          state_version: 2,
          spec_changes: [
            {
              capability: 'sentence-counting',
              operation: 'create',
              source: 'specs/sentence-counting/spec.md',
            },
          ],
          acceptance: [
            { id: 'A1', source: 'brief.md', text: 'Two sentences return two.', result: 'pending' },
            {
              id: 'A2',
              source: 'specs/sentence-counting/spec.md',
              text: 'Count sentences by punctuation.',
              result: 'pending',
            },
          ],
        },
        continuation: {
          action: 'builder-handoff',
          commandArgs: [
            'comet',
            'native',
            'next',
            'sentence-counting',
            '--runner-input',
            '<temporary-json-file>',
          ],
          runnerAction: { kind: 'builder-handoff', iteration: 1, attempt: 0 },
        },
      },
    });
    expect(JSON.stringify(shaped.data)).not.toMatch(/base_hash|approved_contract|sha256/iu);

    const status = json(
      await runNativeCli(['status', 'sentence-counting', '--details', '--json', ...projectArgs()]),
    );
    expect(status.data).toMatchObject({
      schema: 'comet.native.status.v2',
      phase: 'build',
      acceptance: { total: 2, pending: 2, passed: 0, failed: 0, blocked: 0 },
      details: {
        acceptance: [
          { id: 'A1', text: 'Two sentences return two.' },
          { id: 'A2', text: 'Count sentences by punctuation.' },
        ],
        specChanges: [{ capability: 'sentence-counting', operation: 'create' }],
      },
      continuation: { action: 'builder-handoff', runnerAction: { kind: 'builder-handoff' } },
    });

    const runnerOnly = json(
      await runNativeCli([
        'next',
        'sentence-counting',
        '--summary',
        'Agent claims implementation is complete',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(runnerOnly).toMatchObject({
      exitCode: 65,
      error: {
        code: 'invalid-data',
        message: expect.stringContaining('public JSON cannot supply identity'),
      },
      data: {
        state: { phase: 'build' },
        continuation: { runnerAction: { kind: 'builder-handoff' } },
      },
    });
    expect((await fs.readdir(nativeChangeRuntimeDir(paths, 'sentence-counting'))).sort()).toEqual([
      'state.json',
    ]);
  });

  it('returns every A1..An acceptance item directly instead of paginating derived IDs', async () => {
    await runNativeCli(['new', 'complete-acceptance', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'complete-acceptance');
    const acceptanceExamples = Array.from(
      { length: 17 },
      (_, index) => `- Acceptance outcome ${index + 1} is observable.`,
    ).join('\n');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      brief.replace('- Two sentences return two.', acceptanceExamples),
    );
    expect(
      (
        await runNativeCli([
          'next',
          'complete-acceptance',
          '--summary',
          'The acceptance contract is executable',
          '--confirmed',
          ...projectArgs(),
        ])
      ).exitCode,
    ).toBe(0);

    const status = json(
      await runNativeCli([
        'status',
        'complete-acceptance',
        '--details',
        '--json',
        ...projectArgs(),
      ]),
    );
    const data = status.data as {
      acceptance: { total: number };
      details: { acceptance: Array<{ id: string; text: string }> };
    };
    expect(data.acceptance.total).toBe(17);
    expect(data.details.acceptance.map(({ id }) => id)).toEqual(
      Array.from({ length: 17 }, (_, index) => `A${index + 1}`),
    );
    expect(data.details.acceptance.at(-1)?.text).toBe('Acceptance outcome 17 is observable.');

    const oldPagination = json(
      await runNativeCli([
        'status',
        'complete-acceptance',
        '--details',
        '--acceptance-cursor',
        'retired-cursor',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(oldPagination).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
  });

  it('creates default config from new and keeps Classic paths untouched', async () => {
    const result = json(await runNativeCli(['new', 'default-root', '--json', ...projectArgs()]));
    expect(result).toMatchObject({
      exitCode: 0,
      data: { schema: 'comet.native.v4', name: 'default-root', phase: 'shape' },
    });
    expect(await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8')).toContain(
      'artifact_root: docs',
    );
    await expect(
      fs.stat(path.join(projectRoot, 'docs', 'comet', 'changes', 'default-root')),
    ).resolves.toBeDefined();
    await expect(fs.access(path.join(projectRoot, 'comet'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fs.access(path.join(projectRoot, 'openspec'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('uses stable usage, data, and conflict exit codes and retires the old public commands', async () => {
    const usage = await runNativeCli(['unknown', '--json', ...projectArgs()]);
    expect(usage.exitCode).toBe(64);
    expect(json(usage)).toMatchObject({
      command: 'unknown',
      exitCode: 64,
      error: { code: 'usage' },
    });
    expect(usage.stderr).toBeUndefined();

    const help = await runNativeCli(['--help', ...projectArgs()]);
    expect(help.stdout).toContain('next <change-name>');
    const nextHelp = await runNativeCli(['next', '--help', ...projectArgs()]);
    expect(nextHelp.stdout).toContain('--confirmed');
    expect(nextHelp.stdout).toContain('--runner-input <file>');
    expect(nextHelp.stdout).toContain('skill-coordinated JSON');
    expect(nextHelp.stdout).toContain('Identity/provider/execution/candidate fields are rejected');
    expect(nextHelp.stdout).not.toMatch(/^\s+--(?:result|report|artifact)\b/mu);
    const specHelp = await runNativeCli(['spec', 'remove', '--help', ...projectArgs()]);
    expect(specHelp.stdout).toContain('spec remove <change-name> <capability>');
    expect(
      json(await runNativeCli(['spec', 'rebase', '--help', '--json', ...projectArgs()])),
    ).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
    for (const retired of ['checkpoint', 'check', 'evidence', 'receipt']) {
      expect(help.stdout).not.toContain(`\n  ${retired}`);
      expect(json(await runNativeCli([retired, '--json', ...projectArgs()]))).toMatchObject({
        command: retired,
        exitCode: 64,
        error: { code: 'usage', message: `Unknown Native command: ${retired}` },
      });
    }

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

  it('returns the v2 confirmation continuation when Shape has not been confirmed', async () => {
    await runNativeCli(['new', 'blocked-shape', ...projectArgs()]);
    const result = json(
      await runNativeCli([
        'next',
        'blocked-shape',
        '--summary',
        'Not actually ready',
        '--json',
        ...projectArgs(),
      ]),
    );

    expect(result).toMatchObject({
      command: 'next',
      exitCode: 65,
      error: { code: 'invalid-data' },
      data: {
        state: { schema: 'comet.native.v4', phase: 'shape' },
        continuation: {
          schema: 'comet.native.continuation.v2',
          disposition: 'continue',
          action: 'confirm-shape',
          commandArgs: [
            'comet',
            'native',
            'next',
            'blocked-shape',
            '--summary',
            '<summary>',
            '--confirmed',
          ],
          requiredInputs: ['summary', 'shared-understanding-confirmation'],
        },
      },
    });
  });

  it('records explicit Shape confirmation in portable state and advances to Builder handoff', async () => {
    await runNativeCli(['new', 'confirmed-shape', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await fs.writeFile(path.join(paths.changesDir, 'confirmed-shape', 'brief.md'), brief);

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
      data: {
        state: {
          phase: 'build',
          loop: { stage: 'building', iteration: 1, next_action: 'submit-builder-candidate' },
          acceptance: [{ id: 'A1', result: 'pending' }],
        },
        continuation: { action: 'builder-handoff', runnerAction: { kind: 'builder-handoff' } },
      },
    });
    expect(JSON.stringify(result.data)).not.toContain('approval');
  });

  it('returns Verify to Build only after a trusted Runner submitted the Builder candidate', async () => {
    await runNativeCli(['new', 'return-to-build', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await fs.writeFile(path.join(paths.changesDir, 'return-to-build', 'brief.md'), brief);

    const invalidPhase = json(
      await runNativeCli([
        'next',
        'return-to-build',
        '--summary',
        'Shape cannot return to Build',
        '--return-to-build',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(invalidPhase).toMatchObject({ exitCode: 65, error: { code: 'invalid-data' } });

    expect(
      (
        await runNativeCli([
          'next',
          'return-to-build',
          '--summary',
          'Shape is confirmed',
          '--confirmed',
          ...projectArgs(),
        ])
      ).exitCode,
    ).toBe(0);
    const runner = createNativeRunnerChannel();
    await submitNativePortableBuilderCandidate({
      paths,
      name: 'return-to-build',
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: 'builder-return-to-build',
        }),
        candidateId: 'candidate-return-to-build',
        summary: 'Implemented the confirmed acceptance.',
        addressedAcceptanceIds: ['A1'],
      },
    });

    expect(
      json(await runNativeCli(['status', 'return-to-build', '--json', ...projectArgs()])).data,
    ).toMatchObject({
      phase: 'verify',
      continuation: { action: 'dispatch-verifier', runnerAction: { kind: 'dispatch-verifier' } },
    });
    const returned = json(
      await runNativeCli([
        'next',
        'return-to-build',
        '--summary',
        'Implementation changed after handoff',
        '--return-to-build',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(returned).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          phase: 'build',
          verification_result: 'pending',
          builder_handoff: null,
          loop: { stage: 'repairing', iteration: 2, attempt: 0 },
          history: [expect.objectContaining({ outcome: 'recovery' })],
        },
        continuation: { action: 'repair', runnerAction: { kind: 'builder-handoff' } },
      },
    });

    const mixed = json(
      await runNativeCli([
        'next',
        'return-to-build',
        '--summary',
        'Invalid mixed request',
        '--return-to-build',
        '--confirmed',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(mixed).toMatchObject({ exitCode: 64, error: { code: 'usage' } });
  });

  it('keeps the same explicit Shape confirmation boundary in Sequential and Batch modes', async () => {
    await runNativeCli(['init', '--root', 'docs', ...projectArgs()]);
    const initialConfig = await readProjectConfig(projectRoot);
    expect(initialConfig).not.toBeNull();
    await writeProjectConfig(projectRoot, {
      ...initialConfig!,
      native: { ...initialConfig!.native, clarification_mode: 'sequential' },
    });
    await runNativeCli(['new', 'mode-boundary', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await fs.writeFile(path.join(paths.changesDir, 'mode-boundary', 'brief.md'), brief);

    const sequential = json(
      await runNativeCli([
        'next',
        'mode-boundary',
        '--summary',
        'Sequential clarification is complete',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(sequential).toMatchObject({
      exitCode: 65,
      data: {
        state: { phase: 'shape' },
        continuation: {
          action: 'confirm-shape',
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
    const batch = json(
      await runNativeCli([
        'next',
        'mode-boundary',
        '--summary',
        'Batch clarification is complete',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(batch).toMatchObject({
      exitCode: 65,
      data: { state: { phase: 'shape' }, continuation: { action: 'confirm-shape' } },
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
      data: { state: { phase: 'build' }, continuation: { action: 'builder-handoff' } },
    });
  });

  it('records a complete remove intent without a canonical hash', async () => {
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
        schema: 'comet.native.v4',
        phase: 'shape',
        spec_changes: [{ capability: 'legacy-capability', operation: 'remove', source: null }],
        continuation: { action: 'confirm-shape' },
      },
    });
    expect(JSON.stringify(result.data)).not.toMatch(/hash|snapshot/iu);
  });

  it('shows a brief larger than the retired per-file read budget', async () => {
    await runNativeCli(['new', 'large-brief', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const largeBrief = `${brief}\n# Notes\n${'x'.repeat(1024 * 1024 + 1024)}\n`;
    await fs.writeFile(path.join(paths.changesDir, 'large-brief', 'brief.md'), largeBrief);

    const result = json(await runNativeCli(['show', 'large-brief', '--json', ...projectArgs()]));

    expect(result).toMatchObject({ exitCode: 0, data: { brief: largeBrief } });
  });

  it('shows complete proposed Specs beyond the retired count, aggregate, and output budgets', async () => {
    await runNativeCli(['new', 'large-spec-set', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'large-spec-set');
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    const specsDir = path.join(changeDir, 'specs');
    const padding = 'x'.repeat(170 * 1024);
    await Promise.all(
      Array.from({ length: 65 }, async (_, index) => {
        const directory = path.join(specsDir, `capability-${index}`);
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'spec.md'), `# Capability ${index}\n${padding}\n`);
      }),
    );
    expect(
      (
        await runNativeCli([
          'next',
          'large-spec-set',
          '--summary',
          'The complete target specification is confirmed',
          '--confirmed',
          ...projectArgs(),
        ])
      ).exitCode,
    ).toBe(0);

    const result = json(await runNativeCli(['show', 'large-spec-set', '--json', ...projectArgs()]));
    const data = result.data as {
      state: { spec_changes: Array<{ capability: string }> };
      proposedSpecs: Array<{ capability: string; content: string }>;
    };
    expect(result.exitCode).toBe(0);
    expect(data.state.spec_changes).toHaveLength(65);
    expect(data.proposedSpecs).toHaveLength(65);
    expect(Buffer.byteLength(JSON.stringify(data), 'utf8')).toBeGreaterThan(10 * 1024 * 1024);
    expect(data.proposedSpecs[64].content).toContain(padding);
  }, 120_000);

  it('repairs a stale selection without requiring a transaction strategy', async () => {
    await runNativeCli(['init', ...projectArgs()]);
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
      'failure facts',
      ['next', 'repair-change', '--summary', 'retry', '--failure-category', 'test-failed'],
    ],
    [
      'Agent-authored artifacts',
      ['next', 'repair-change', '--summary', 'retry', '--artifact', 'x'],
    ],
    [
      'Agent-authored Verify result',
      ['next', 'repair-change', '--summary', 'retry', '--result', 'pass'],
    ],
    [
      'a legacy receipt',
      [
        'next',
        'repair-change',
        '--summary',
        'retry',
        '--receipt',
        `runtime/evidence/check-receipts/${'a'.repeat(64)}.json`,
      ],
    ],
  ] as const)('rejects retired %s before touching project state', async (_label, args) => {
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
      ).rejects.toMatchObject({ code: 'ENOENT' });
      if (!retryCreatesChange) return;
      const retried = await runNativeCli([...args, '--json', ...projectArgs()]);
      expect(retried.exitCode).toBe(0);
      expect(json(retried)).toMatchObject({ data: { name: 'storage-failure' } });
    },
  );

  it('migrates a legacy active change on its first mutating CLI command', async () => {
    await runNativeCli(['init', ...projectArgs()]);
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    const changeDir = path.join(paths.changesDir, 'legacy-change');
    await fs.mkdir(path.join(changeDir, 'specs'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- Migrated behavior remains pending verification.\n',
    );
    await fs.writeFile(
      path.join(changeDir, 'comet-state.yaml'),
      stringify({
        schema: 'comet.native.v3',
        minimum_runtime_version: 3,
        revision: 4,
        verification_protocol: 'legacy-v1',
        name: 'legacy-change',
        language: 'en',
        phase: 'verify',
        brief: 'brief.md',
        approval: 'confirmed',
        approved_contract_hash: 'a'.repeat(64),
        spec_changes: [],
        verification_result: 'pass',
        verification_report: 'verification.md',
        implementation_scope: `runtime/evidence/scopes/${'b'.repeat(64)}.json`,
        verification_evidence: `runtime/evidence/verifications/${'c'.repeat(64)}.json`,
        partial_allowance: null,
        archived: false,
        created_at: '2026-08-01',
        run_id: 'legacy-run',
      }),
    );
    const runtimeDir = nativeChangeRuntimeDir(paths, 'legacy-change');
    await fs.mkdir(path.join(runtimeDir, 'evidence'), { recursive: true });
    await fs.writeFile(path.join(changeDir, 'evidence.md'), 'legacy evidence');

    expect(
      json(await runNativeCli(['status', 'legacy-change', '--json', ...projectArgs()])),
    ).toMatchObject({
      exitCode: 0,
      data: {
        schema: 'comet.native.status.v2',
        migrationRequired: true,
        continuation: { disposition: 'blocked' },
      },
    });
    const migrated = json(
      await runNativeCli([
        'next',
        'legacy-change',
        '--summary',
        'Resume from the portable stable boundary',
        '--json',
        ...projectArgs(),
      ]),
    );
    expect(migrated).toMatchObject({
      exitCode: 0,
      data: {
        state: {
          schema: 'comet.native.v4',
          phase: 'build',
          verification_result: 'pending',
          builder_handoff: null,
          acceptance: [{ id: 'A1', result: 'pending' }],
          loop: { iteration: 1, attempt: 0 },
        },
        migration: {
          completed: true,
          summary: 'Resume from the portable stable boundary',
        },
        continuation: { runnerAction: { kind: 'builder-handoff' } },
      },
    });
    expect(JSON.stringify(migrated.data)).not.toMatch(/[a-f0-9]{64}/u);
    expect(await fs.readdir(runtimeDir)).toEqual(['state.json']);
    await expect(fs.access(path.join(changeDir, 'evidence.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const yaml = await fs.readFile(path.join(changeDir, 'comet-state.yaml'), 'utf8');
    expect(yaml).toContain('schema: comet.native.v4');
    expect(yaml).not.toMatch(/approved_contract_hash|implementation_scope|verification_evidence/iu);
    expect(await readNativePortableChange(paths, 'legacy-change')).toMatchObject({
      phase: 'build',
      schema: 'comet.native.v4',
    });
    await expect(
      fs.access(nativeLocalExecutionFile(paths, 'legacy-change')),
    ).resolves.toBeUndefined();
  });
});
