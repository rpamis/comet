import { promises as fs } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

interface NativeEnvelope {
  command?: string | null;
  exitCode: number;
  data?: {
    phase?: string;
    preparation?: { projectRoot?: string };
    change?: { phase?: string };
    state?: { phase?: string; loop?: { iteration?: number } };
    findingSummary?: { codes?: string[] };
    continuation?: { disposition?: string };
  };
  error?: { code?: string; message?: string };
}

interface NativeProcessResult extends NativeEnvelope {
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const NATIVE_SCRIPTS = path.resolve('assets/skills/comet-native/scripts');
const COMMAND_TIMEOUT_MS = 20_000;
const CHANGE_NAMES = ['parallel-alpha', 'parallel-beta'] as const;
const BUSINESS_SOURCE = 'src/business.ts';
const BRIEF = `# Outcome
Keep Native parallel worktrees recoverable.
# Scope
Exercise two independent linked worktrees.
# Non-goals
No model or network access.
# Acceptance examples
- Both worktrees progress without blocking each other.
# Constraints and invariants
Business source edits remain user-authored.
# Decisions
Use process-level Native CLI commands.
# Open questions
None.
# Verification expectations
Run the deterministic parallel-worktree regression test.
`;
const SPEC = `# native parallel worktree probe

## Requirements

### Requirement: Keep independent worktrees usable

Native parallel worktrees MUST progress without crossing Runtime boundaries.

#### Scenario: Two linked worktrees progress

- **WHEN** two changes progress concurrently
- **THEN** each worktree keeps its own state and Runtime
`;

function commandScript(command: string): string {
  return path.join(NATIVE_SCRIPTS, `comet-native-${command}.mjs`);
}

function runNativeCommand(
  command: string,
  args: string[],
  projectRoot: string,
  timeoutMs = COMMAND_TIMEOUT_MS,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<NativeProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [commandScript(command), ...args, '--json', '--project-root', projectRoot],
      {
        cwd: projectRoot,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        stdout,
        stderr: `${stderr}${error.message}`,
        timedOut,
      });
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      let envelope: NativeEnvelope;
      try {
        envelope = JSON.parse(stdout) as NativeEnvelope;
      } catch {
        envelope = { exitCode: code ?? -1 };
      }
      resolve({
        ...envelope,
        exitCode: envelope.exitCode ?? code ?? -1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

function assertCompleted(result: NativeProcessResult, label: string): void {
  expect(result.timedOut, `${label} timed out\n${result.stderr}`).toBe(false);
  expect(result.exitCode, `${label}\n${result.stdout}\n${result.stderr}`).toBe(0);
}

async function submitBuilderHandoff(
  name: string,
  projectRoot: string,
  reviewerExecutionRef = `reviewer-${name}`,
): Promise<NativeProcessResult> {
  const input = path.join(projectRoot, `.runner-input-${name}.json`);
  await fs.writeFile(
    input,
    JSON.stringify({
      kind: 'builder-handoff',
      summary: 'Implemented the confirmed behavior.',
      addressed_acceptance_ids: ['A1'],
      checks: [],
      known_limits: [],
      review: {
        status: 'passed',
        summary: 'Read-only review passed.',
        reviewer_execution_ref: reviewerExecutionRef,
      },
    }),
  );
  try {
    return await runNativeCommand('next', [name, '--runner-input', input], projectRoot);
  } finally {
    await fs.rm(input, { force: true });
  }
}

async function readDirectoryOrEmpty(directory: string): Promise<string[]> {
  try {
    return (await fs.readdir(directory)).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

describe('Native parallel linked-worktree Runtime', () => {
  const repositories: string[] = [];
  const linkedWorktrees: Array<{ repository: string; root: string }> = [];

  afterEach(async () => {
    for (const { repository, root } of linkedWorktrees.splice(0)) {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', root], {
          cwd: repository,
          stdio: 'ignore',
        });
      } catch {
        // The assertion failure is more useful than cleanup noise.
      }
      await fs.rm(root, { recursive: true, force: true });
    }
    await Promise.all(
      repositories
        .splice(0)
        .map((repository) => fs.rm(repository, { recursive: true, force: true })),
    );
  });

  it('keeps concurrent linked worktrees usable after a manual business-source edit', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-parallel-'));
    repositories.push(repository);
    execFileSync('git', ['init'], { cwd: repository, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native@example.test'], {
      cwd: repository,
      stdio: 'ignore',
    });
    execFileSync('git', ['config', 'user.name', 'Native Test'], {
      cwd: repository,
      stdio: 'ignore',
    });

    const initialized = await runNativeCommand(
      'init',
      ['--root', 'docs', '--language', 'en'],
      repository,
    );
    assertCompleted(initialized, 'initialize Native fixture');
    await fs.mkdir(path.join(repository, 'src'), { recursive: true });
    await fs.writeFile(path.join(repository, BUSINESS_SOURCE), 'export const value = "base";\n');
    execFileSync('git', ['add', '.comet/config.yaml', BUSINESS_SOURCE], {
      cwd: repository,
      stdio: 'ignore',
    });
    execFileSync('git', ['commit', '-m', 'seed Native parallel fixture'], {
      cwd: repository,
      stdio: 'ignore',
    });
    const targetBranch = execFileSync('git', ['branch', '--show-current'], {
      cwd: repository,
      encoding: 'utf8',
    }).trim();

    const created = await Promise.all(
      CHANGE_NAMES.map((name) =>
        runNativeCommand(
          'new',
          [name, '--isolation', 'worktree', '--target-branch', targetBranch],
          repository,
        ),
      ),
    );
    created.forEach((result, index) => assertCompleted(result, `create ${CHANGE_NAMES[index]}`));

    const worktrees = await Promise.all(
      CHANGE_NAMES.map(async (name) => ({
        name,
        root: await fs.realpath(path.resolve(repository, '.worktrees', name)),
      })),
    );
    worktrees.forEach(({ root }) => linkedWorktrees.push({ repository, root }));
    expect(new Set(created.map((result) => result.data?.preparation?.projectRoot))).toEqual(
      new Set(worktrees.map(({ root }) => root)),
    );
    const worktreeList = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: repository,
      encoding: 'utf8',
    }).replaceAll('\\', '/');
    expect(worktreeList).toContain(worktrees[0].root.replaceAll('\\', '/'));
    expect(worktreeList).toContain(worktrees[1].root.replaceAll('\\', '/'));

    await Promise.all(
      worktrees.map(async ({ name, root }) => {
        const changeDir = path.join(root, 'docs', 'comet', 'changes', name);
        await fs.writeFile(path.join(changeDir, 'brief.md'), BRIEF);
        await fs.mkdir(path.join(changeDir, 'specs', 'parallel-probe'), { recursive: true });
        await fs.writeFile(path.join(changeDir, 'specs', 'parallel-probe', 'spec.md'), SPEC);

        const shaped = await runNativeCommand(
          'next',
          [name, '--summary', 'Confirm the parallel worktree contract', '--confirmed'],
          root,
        );
        assertCompleted(shaped, `shape ${name}`);
        expect(shaped.data?.state?.phase).toBe('build');

        await fs.writeFile(
          path.join(root, BUSINESS_SOURCE),
          `export const value = "${name}-implementation";\n`,
        );
        const built = await submitBuilderHandoff(name, root);
        assertCompleted(built, `build ${name}`);
        expect(built.data?.state?.phase).toBe('verify');
      }),
    );

    const editedWorktree = worktrees[0];
    const untouchedWorktree = worktrees[1];
    const userSource = 'export const value = "user-edited-during-verify";\n';
    const guard = await runNativeCommand(
      'hook-guard',
      [],
      editedWorktree.root,
      COMMAND_TIMEOUT_MS,
      { ...process.env, FILE_PATH: BUSINESS_SOURCE },
    );
    assertCompleted(guard, 'guard manual source edit');
    await fs.writeFile(path.join(editedWorktree.root, BUSINESS_SOURCE), userSource);

    const [editedStatus, untouchedStatus] = await Promise.all([
      runNativeCommand('status', [editedWorktree.name], editedWorktree.root),
      runNativeCommand('status', [untouchedWorktree.name], untouchedWorktree.root),
    ]);
    assertCompleted(editedStatus, 'status after manual source edit');
    assertCompleted(untouchedStatus, 'status in untouched worktree');
    expect(editedStatus.data?.phase).toBe('build');
    expect(editedStatus.data?.continuation?.disposition).not.toBe('blocked');
    expect(untouchedStatus.data?.phase).toBe('verify');
    await expect(
      fs.readFile(path.join(untouchedWorktree.root, BUSINESS_SOURCE), 'utf8'),
    ).resolves.toBe('export const value = "parallel-beta-implementation";\n');

    const rebuilt = await submitBuilderHandoff(
      editedWorktree.name,
      editedWorktree.root,
      `reviewer-${editedWorktree.name}-repair`,
    );
    assertCompleted(rebuilt, 'rebuild edited worktree');
    expect(rebuilt.data?.state?.phase).toBe('verify');
    await expect(
      fs.readFile(path.join(editedWorktree.root, BUSINESS_SOURCE), 'utf8'),
    ).resolves.toBe(userSource);

    for (const { root } of worktrees) {
      const locks = path.join(root, '.comet', 'runtime', 'native', 'locks');
      const lockEntries = await readDirectoryOrEmpty(locks);
      expect(lockEntries.filter((entry) => entry !== '.coordinator')).toEqual([]);
      expect(await readDirectoryOrEmpty(path.join(locks, '.coordinator'))).toEqual([]);
      expect(
        await readDirectoryOrEmpty(path.join(root, '.comet', 'runtime', 'native', 'transactions')),
      ).toEqual([]);
      expect(
        execFileSync('git', ['branch', '--show-current'], { cwd: root, encoding: 'utf8' }).trim(),
      ).toBe(`comet/${path.basename(root)}`);
      const selection = JSON.parse(
        await fs.readFile(path.join(root, '.comet', 'current-change.json'), 'utf8'),
      ) as { workflow: string; change: string };
      expect(selection).toMatchObject({ workflow: 'native', change: path.basename(root) });
    }
    await expect(
      fs.access(path.join(repository, 'docs', 'comet', 'changes', 'parallel-alpha')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      fs.access(path.join(repository, 'docs', 'comet', 'changes', 'parallel-beta')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);

  it('rejects the retired checkpoint bundle on a linked-worktree-capable host', async () => {
    const repository = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-retired-command-'));
    repositories.push(repository);
    execFileSync('git', ['init'], { cwd: repository, stdio: 'ignore' });
    const result = await runNativeCommand('runtime', ['checkpoint', 'legacy-change'], repository);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(64);
    expect(result.error?.code).toBe('usage');
  }, 30_000);
});
