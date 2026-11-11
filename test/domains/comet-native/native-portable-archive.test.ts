import '../../helpers/isolated-agent-home.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { markNativeSupervisorChildVerified } from '../../helpers/native-supervisor-results.js';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as gitCommands from '../../../platform/process/git.js';
import { ensureCometProjectGitignore } from '../../../domains/workflow-contract/project-gitignore.js';
import { nativeArchiveCommand } from '../../../domains/comet-native/native-archive-command.js';
import { atomicWriteJson } from '../../../domains/comet-native/native-atomic-file.js';
import { writeNativeChange } from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { nativeStatusCommand } from '../../../domains/comet-native/native-status-command.js';
import {
  inspectNativeWorkspaceFinishCompletion,
  readNativeWorkspaceFinishJournal,
  writeNativeWorkspaceFinishJournal,
  NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA,
} from '../../../domains/comet-native/native-workspace-finish.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  archiveNativePortableChange,
  inspectNativePortableArchive,
  nativePortableArchiveDirectory,
} from '../../../domains/comet-native/native-portable-archive.js';
import { parseNativeChildrenContract } from '../../../domains/comet-native/native-children.js';
import { nativeNextCommand } from '../../../domains/comet-native/native-next-command.js';
import {
  confirmNativePortableSkillCoordinatedPass,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  markNativePortableSpecRemoval,
  nativePortableChangeDir,
  readNativePortableChange,
  setNativePortableWorkspaceFinish,
  returnNativePortableChangeToShape,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { writeNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import {
  createNativeSupervisorState,
  integrateNativeSupervisorChild,
  prepareNativeSupervisorIntegrationWorkspace,
  readNativeSupervisorState,
  recordNativeSupervisorFinalVerification,
  writeNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor.js';
import {
  nativePortableTransactionFile,
  readNativePortableTransaction,
} from '../../../domains/comet-native/native-portable-transactions.js';
import type { NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

import {} from '../../../domains/comet-native/native-portable-storage.js';

function passedReview(reviewerExecutionRef: string) {
  return {
    status: 'passed' as const,
    summary: 'Independent read-only review passed.',
    reviewerExecutionRef,
  };
}

describe('Native portable Archive', () => {
  let root: string;
  let paths: NativeProjectPaths;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-v4-'));
    const config = defaultProjectConfig('docs', 'en');
    await writeProjectConfig(root, config);
    paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function verifyState(state: any, _retiredPlans?: unknown) {
    const name = state.name,
      runner = createNativeRunnerChannel();
    await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED-platform-fixture',
          executionRef: name + '-builder',
        }),
        candidateId: name + '-candidate',
        summary: 'SIMULATED isolated fixture implementation.',
        addressedAcceptanceIds: state.acceptance.map(({ id }: any) => id),
        acceptanceReview: state.acceptance.map(({ id }: any) => ({
          id,
          status: 'implemented-with-evidence',
          evidence: ['SIMULATED isolated fixture evidence'],
          note: 'SIMULATED archive fixture',
        })),
        checks: [
          {
            name: 'SIMULATED platform result',
            result: 'passed',
            note: 'No Runtime checker executed; isolated Agent result only.',
          },
        ],
        knownLimits: [],
      },
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId: name + '-verifier',
    });
    await submitNativePortableVerifierResult({
      paths,
      name,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: name + '-candidate',
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED-platform-fixture',
          executionRef: name + '-verifier',
        }),
        payload: {
          kind: 'final-result',
          result: {
            iteration: state.loop.iteration,
            attempt: state.loop.attempt,
            verdict: 'pass',
            acceptance: state.acceptance.map(({ id }: any) => ({
              id,
              result: 'passed',
              reason: 'SIMULATED isolated fixture observation.',
            })),
            risks: [],
            summary: 'SIMULATED independent fixture verification.',
          },
        },
      }),
    });
    // SIMULATED user acceptance belongs only to this isolated fixture.
    return confirmNativePortableSkillCoordinatedPass({ paths, name });
  }

  async function archiveReady(
    name = 'archive-change',
    specs: Array<[string, string]> = [
      ['sample', '# Sample\n\nRuntime MUST expose the updated behavior.\n'],
    ],
    workspaceBinding?: Parameters<typeof createNativePortableChange>[0]['workspaceBinding'],
    plans?: unknown,
    beforeVerify?: (state: Awaited<ReturnType<typeof confirmNativePortableShape>>) => Promise<void>,
  ) {
    await createNativePortableChange({ paths, name, language: 'en', workspaceBinding });
    if (workspaceBinding && workspaceBinding.isolation !== 'current')
      await setNativePortableWorkspaceFinish({ paths, name, finish: 'merge' });
    const changeDir = nativePortableChangeDir(paths, name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The canonical behavior is updated.\n',
    );
    for (const [capability, source] of specs) {
      await fs.mkdir(path.join(changeDir, 'specs', capability), { recursive: true });
      await fs.writeFile(path.join(changeDir, 'specs', capability, 'spec.md'), source);
    }
    const shaped = await confirmNativePortableShape({ paths, name });
    await beforeVerify?.(shaped);
    return verifyState(shaped, plans);
  }

  function git(args: string[]) {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  async function refreshRuntimePathsAfterGitInit(): Promise<void> {
    // Git 初始化切换 workspace 身份；后续候选和 CLI 必须使用同一个新 Runtime。
    paths = await nativeProjectPaths(root, 'docs');
    await ensureNativeDirectories(paths);
    await ensureCometProjectGitignore(root);
  }

  async function commitHookProject(
    name: string,
    rejectAll = false,
    isolation: 'current' | 'branch' | 'worktree' = 'current',
    objectFormat: 'sha1' | 'sha256' = 'sha1',
    beforeVerify?: () => Promise<void>,
  ) {
    git(['init', `--object-format=${objectFormat}`, '-b', 'main']);
    git(['config', 'user.email', 'native-test@example.com']);
    git(['config', 'user.name', 'Native Test']);
    const hook = path.join(root, '.git/hooks/commit-msg');
    git(['config', 'core.hooksPath', path.dirname(hook)]);
    git(['config', 'commit.gpgsign', 'false']);
    await refreshRuntimePathsAfterGitInit();
    git(['add', '.']);
    git(['commit', '-m', 'PROJ: baseline']);
    const primary = root;
    const changeBranch = `comet/${name}`;
    if (isolation === 'branch') git(['switch', '-c', changeBranch]);
    if (isolation === 'worktree') {
      const secondary = `${root}-worktree`;
      git(['worktree', 'add', '-b', changeBranch, secondary]);
      root = secondary;
      paths = await nativeProjectPaths(root, 'docs');
      await ensureNativeDirectories(paths);
    }
    await beforeVerify?.();
    const state = await archiveReady(
      name,
      undefined,
      isolation === 'current' ? undefined : { isolation, changeBranch, targetBranch: 'main' },
    );
    await fs.writeFile(
      hook,
      '#!/bin/sh\n' +
        (rejectAll
          ? 'test -f .git/accept-commit || { echo PROJECT_COMMIT_MSG_REJECTED >&2; exit 1; }\n'
          : 'grep -q "^PROJ: " "$1" || { echo PROJECT_COMMIT_MSG_REJECTED >&2; exit 1; }\n'),
    );
    await fs.chmod(hook, 0o755);
    return { ...state, primary };
  }

  it('previews and commits Unicode messages through the project commit-msg hook', async () => {
    const state = await commitHookProject('custom-message');
    const message = 'PROJ: 归档需求\n\n保留项目提交规范。';
    const args = [state.name, '--commit-message', message];
    const preview = await nativeArchiveCommand([...args, '--dry-run'], root);
    expect(preview).toMatchObject({
      exitCode: 0,
      data: { ready: true, commitMessages: { commitMessage: message, mergeMessage: null } },
    });
    expect(
      (preview.data as { continuation: { commandArgs: string[] } }).continuation.commandArgs,
    ).toContain(message);
    await expect(nativeArchiveCommand([...args, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 0,
    });
    expect(git(['log', '-1', '--format=%B'])).toBe(message);
  });

  it('diagnoses a rejected archive commit and resumes it with a corrected message', async () => {
    const state = await commitHookProject('hook-rejected');
    const blocked = await nativeArchiveCommand([state.name, '--confirmed'], root);
    expect(blocked).toMatchObject({
      exitCode: 73,
      data: {
        archived: true,
        workspaceFinishResult: {
          status: 'blocked',
          message: expect.stringContaining('PROJECT_COMMIT_MSG_REJECTED'),
        },
      },
    });
    for (const args of [[state.name], [state.name, '--repair'], []]) {
      await expect(nativeDoctorCommand(args, root)).resolves.toMatchObject({
        data: {
          healthy: false,
          workspaceFinishes: expect.arrayContaining([
            expect.objectContaining({
              change: state.name,
              status: 'blocked',
              completed: false,
              recoveryCommandArgs: ['comet', 'native', 'archive', state.name, '--confirmed'],
            }),
          ]),
        },
      });
    }
    await expect(nativeStatusCommand([state.name], root)).resolves.toMatchObject({
      data: {
        status: 'blocked',
        archived: true,
        continuation: {
          status: 'blocked',
          disposition: 'blocked',
          requiresUserDecision: false,
          userCommunication: { required: true, suggestedReply: null },
        },
      },
    });
    const journal = await readNativeWorkspaceFinishJournal(paths, state.name);
    const sealed = await fs.readFile(path.join(journal!.archiveDir!, 'comet-state.yaml'), 'utf8');
    await expect(
      nativeArchiveCommand(
        [state.name, '--confirmed', '--commit-message', 'PROJ: 修正归档说明'],
        root,
      ),
    ).resolves.toMatchObject({ exitCode: 0 });
    expect(git(['log', '-1', '--format=%s'])).toBe('PROJ: 修正归档说明');
    expect(await fs.readFile(path.join(journal!.archiveDir!, 'comet-state.yaml'), 'utf8')).toBe(
      sealed,
    );
    expect(await readNativeWorkspaceFinishJournal(paths, state.name)).toBeNull();
    await expect(nativeDoctorCommand([state.name], root)).resolves.toMatchObject({
      data: { healthy: true },
    });
  });

  it('retains prepared messages across hook failures and retries without message flags', async () => {
    const state = await commitHookProject('message-retry', true);
    const message = 'PROJ: 重试沿用归档说明';
    await expect(
      nativeArchiveCommand([state.name, '--confirmed', '--commit-message', message], root),
    ).resolves.toMatchObject({ exitCode: 73 });
    await fs.writeFile(path.join(root, '.git/accept-commit'), 'accepted\n');
    await expect(nativeArchiveCommand([state.name, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 0,
    });
    expect(git(['log', '-1', '--format=%s'])).toBe(message);
  });

  it('repairs the finish receipt after a verified manual commit without creating another commit', async () => {
    const state = await commitHookProject('manual-finish');
    await expect(nativeArchiveCommand([state.name, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 73,
    });
    git(['commit', '-m', 'PROJ: 人工完成归档']);
    const head = git(['rev-parse', 'HEAD']);
    await expect(nativeDoctorCommand([state.name, '--repair'], root)).resolves.toMatchObject({
      data: { healthy: true, repaired: true },
    });
    expect(git(['rev-parse', 'HEAD'])).toBe(head);
    expect(await readNativeWorkspaceFinishJournal(paths, state.name)).toBeNull();
    await expect(nativeStatusCommand([state.name], root)).resolves.toMatchObject({
      data: { status: 'done', continuation: { status: 'done', disposition: 'done' } },
    });
  });

  it('retries a transient archive directory sharing error and finishes the original transaction', async () => {
    const state = await archiveReady('transient-move');
    const active = nativePortableChangeDir(paths, state.name);
    const target = nativePortableArchiveDirectory(paths, state);
    const rename = fs.rename.bind(fs);
    let attempts = 0;
    const fault = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (source === active && destination === target && attempts++ === 0)
        throw Object.assign(new Error('Windows sharing violation'), { code: 'EPERM' });
      return rename(source, destination);
    });
    try {
      const result = await archiveNativePortableChange({ paths, name: state.name });
      expect(result.archiveDir).toBe(target);
      expect(attempts).toBe(2);
      await expect(fs.stat(active)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await fs.stat(target)).isDirectory()).toBe(true);
      expect(
        await readNativePortableTransaction(paths, { kind: 'archive', change: state.name }),
      ).toBeNull();
      const repeated = await archiveNativePortableChange({ paths, name: state.name });
      expect(repeated.transactionId).toBe(result.transactionId);
      expect(attempts).toBe(2);
    } finally {
      fault.mockRestore();
    }
  });

  it('retains the original archive transaction after persistent sharing errors and resumes it once', async () => {
    const state = await archiveReady('persistent-move');
    const active = nativePortableChangeDir(paths, state.name);
    const target = nativePortableArchiveDirectory(paths, state);
    const rename = fs.rename.bind(fs);
    const failure = Object.assign(new Error('Windows sharing violation'), { code: 'EPERM' });
    const fault = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      if (source === active && destination === target) throw failure;
      return rename(source, destination);
    });
    try {
      await expect(archiveNativePortableChange({ paths, name: state.name })).rejects.toBe(failure);
      expect((await fs.stat(active)).isDirectory()).toBe(true);
      await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
      const pending = await readNativePortableTransaction(paths, {
        kind: 'archive',
        change: state.name,
      });
      expect(pending).toMatchObject({ kind: 'archive', journal: { status: 'report-aligned' } });
      const canonical = path.join(paths.specsDir, 'sample', 'spec.md');
      expect(await fs.readFile(canonical, 'utf8')).toContain('updated behavior');
      await fs.appendFile(canonical, '\nIndependent canonical edit after Spec publication.\n');
      const editedSpec = await fs.readFile(canonical, 'utf8');
      fault.mockRestore();
      const result = await archiveNativePortableChange({ paths, name: state.name });
      expect(result.transactionId).toBe(pending?.journal.id);
      expect(
        await readNativePortableTransaction(paths, { kind: 'archive', change: state.name }),
      ).toBeNull();
      expect((await fs.stat(target)).isDirectory()).toBe(true);
      expect(await fs.readFile(canonical, 'utf8')).toBe(editedSpec);
      const repeated = await archiveNativePortableChange({ paths, name: state.name });
      expect(repeated.transactionId).toBe(pending?.journal.id);
      expect(await fs.readFile(canonical, 'utf8')).toBe(editedSpec);
    } finally {
      fault.mockRestore();
    }
  });

  it.each(['branch', 'worktree'] as const)(
    'recovers a %s merge hook rejection without repeating the archive commit',
    async (isolation) => {
      let primary: string | undefined;
      try {
        const state = await commitHookProject(`merge-hook-${isolation}`, false, isolation);
        primary = state.primary;
        const message = 'PROJ: 归档后保留提交';
        const blocked = await nativeArchiveCommand(
          [state.name, '--confirmed', '--commit-message', message],
          root,
        );
        expect(blocked).toMatchObject({
          exitCode: 73,
          data: {
            workspaceFinishResult: {
              commit: expect.any(String),
              merged: false,
              message: expect.stringContaining('PROJECT_COMMIT_MSG_REJECTED'),
            },
          },
        });
        const archiveCommit = git(['rev-parse', 'HEAD']);
        expect(git(['branch', '--show-current'])).toBe(`comet/${state.name}`);
        expect(() =>
          execFileSync('git', ['rev-parse', '--verify', 'MERGE_HEAD'], {
            cwd: primary,
            stdio: 'ignore',
          }),
        ).toThrow();
        const preview = await nativeArchiveCommand(
          [state.name, '--dry-run', '--merge-message', 'PROJ: 合并归档需求'],
          root,
        );
        expect(preview).toMatchObject({
          data: { commitMessages: { commitMessage: message, mergeMessage: 'PROJ: 合并归档需求' } },
        });
        await expect(
          nativeArchiveCommand(
            [state.name, '--confirmed', '--commit-message', 'PROJ: 不应重写归档提交'],
            root,
          ),
        ).resolves.toMatchObject({ exitCode: 73 });
        expect(git(['rev-parse', 'HEAD'])).toBe(archiveCommit);
        await expect(
          nativeArchiveCommand(
            [state.name, '--confirmed', '--merge-message', 'PROJ: 合并归档需求'],
            root,
          ),
        ).resolves.toMatchObject({
          exitCode: 0,
          data: { workspaceFinishResult: { merged: true, commit: archiveCommit } },
        });
        const log = execFileSync('git', ['log', '-1', '--format=%B'], {
          cwd: primary,
          encoding: 'utf8',
        }).trim();
        expect(log).toBe('PROJ: 合并归档需求');
        expect(
          execFileSync('git', ['rev-list', '--count', 'main'], {
            cwd: primary,
            encoding: 'utf8',
          }).trim(),
        ).toBe('3');
      } finally {
        if (primary && primary !== root) await fs.rm(primary, { recursive: true, force: true });
      }
    },
  );

  it.each(['sha1', 'sha256'] as const)(
    'keeps Git default merge messages in %s repositories when message flags are absent',
    async (objectFormat) => {
      const state = await commitHookProject('default-merge', false, 'branch', objectFormat);
      await fs.unlink(path.join(state.primary, '.git/hooks/commit-msg'));
      git(['config', 'merge.log', objectFormat === 'sha1' ? 'true' : 'false']);
      if (objectFormat === 'sha256') git(['config', 'branch.main.mergeOptions', '--log=5']);
      git(['config', 'merge.suppressDest', 'master']);
      const head = git(['rev-parse', 'HEAD']);
      const index = git(['write-tree']);
      const preview = await nativeArchiveCommand([state.name, '--dry-run'], root);
      const prepared = (preview.data as { commitMessages: { mergeMessage: string } }).commitMessages
        .mergeMessage;
      expect(prepared).toContain("Merge branch 'comet/default-merge' into main");
      expect(prepared.match(/chore\(native\): archive default-merge/gu)).toHaveLength(1);
      expect(git(['rev-parse', 'HEAD'])).toBe(head);
      expect(git(['write-tree'])).toBe(index);
      const command = (preview.data as { continuation: { commandArgs: string[] } }).continuation
        .commandArgs;
      expect(command).toContain(prepared);
      await expect(nativeArchiveCommand(command.slice(3), root)).resolves.toMatchObject({
        exitCode: 0,
      });
      const message = git(['log', '-1', '--format=%B']);
      expect(message).toContain("Merge branch 'comet/default-merge' into main");
      expect(message.match(/chore\(native\): archive default-merge/gu)).toHaveLength(1);
      expect(message).toBe(prepared);
    },
  );

  it('rejects the wrong archived identity before staging or committing a pending finish', async () => {
    const state = await commitHookProject('wrong-archive-identity');
    await nativeArchiveCommand([state.name, '--confirmed'], root);
    const journal = await readNativeWorkspaceFinishJournal(paths, state.name);
    const { commit: _commit, ...pending } = journal!;
    await writeNativeWorkspaceFinishJournal(paths, { ...pending, status: 'pending', result: null });
    const file = path.join(journal!.archiveDir!, 'comet-state.yaml');
    const source = await fs.readFile(file, 'utf8');
    await fs.writeFile(file, source.replace(state.created_at, '2000-01-01T00:00:00.000Z'));
    await fs.unlink(path.join(state.primary, '.git/hooks/commit-msg'));
    const head = git(['rev-parse', 'HEAD']);
    const index = git(['write-tree']);
    await expect(nativeArchiveCommand([state.name, '--confirmed'], root)).rejects.toThrow(
      'does not match a completed Archive record',
    );
    expect(git(['rev-parse', 'HEAD'])).toBe(head);
    expect(git(['write-tree'])).toBe(index);
  });

  it('does not run a global reference-transaction hook during default message preview', async () => {
    const hooks = path.join(root, 'global-hooks');
    const marker = path.join(root, '.git/preview-hook-ran');
    const globalConfig = path.join(root, '.git/preview-global-config');
    const state = await commitHookProject('preview-hooks', false, 'branch', 'sha1', async () => {
      await fs.mkdir(hooks);
      const hook = path.join(hooks, 'reference-transaction');
      await fs.writeFile(
        hook,
        `#!/bin/sh\necho ran > '${marker.replaceAll('\\', '/').replaceAll("'", "'\\''")}'\nexit 1\n`,
      );
      await fs.chmod(hook, 0o755);
      git(['config', '--file', globalConfig, 'core.hooksPath', hooks.replaceAll('\\', '/')]);
      // Keep the global Hook fixture outside the project's finish scope.
      git(['config', '--local', 'core.excludesFile', path.join(root, '.git/preview-excludes')]);
      await fs.writeFile(path.join(root, '.git/preview-excludes'), 'global-hooks/\n');
      vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
    });
    const head = git(['rev-parse', 'HEAD']);
    const index = git(['write-tree']);
    try {
      const preview = await nativeArchiveCommand([state.name, '--dry-run'], root);
      expect((preview.data as { blockers: string[] }).blockers).toEqual([]);
      expect(preview).toMatchObject({
        data: { ready: true, commitMessages: { mergeMessage: expect.any(String) } },
      });
      await expect(fs.stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(git(['rev-parse', 'HEAD'])).toBe(head);
      expect(git(['write-tree'])).toBe(index);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('does not adopt a clean manual commit with altered archived contents', async () => {
    const state = await commitHookProject('wrong-manual-commit');
    await nativeArchiveCommand([state.name, '--confirmed'], root);
    const journal = await readNativeWorkspaceFinishJournal(paths, state.name);
    const spec = path.join(journal!.archiveDir!, 'specs/sample/spec.md');
    await fs.appendFile(spec, '\nUnexpected altered content.\n');
    git(['add', '.']);
    git(['commit', '-m', 'PROJ: 错误归档内容']);
    await expect(nativeDoctorCommand([state.name, '--repair'], root)).resolves.toMatchObject({
      data: { healthy: false, repaired: false },
    });
    await expect(nativeArchiveCommand([state.name, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 73,
    });
    expect(await readNativeWorkspaceFinishJournal(paths, state.name)).not.toBeNull();
  });

  it.each(['sha1', 'sha256'] as const)(
    'checks archived content in bounded Git batches with filters and literal paths (%s)',
    async (objectFormat) => {
      git(['init', `--object-format=${objectFormat}`, '-b', 'main']);
      git(['config', 'user.email', 'native-test@example.com']);
      git(['config', 'user.name', 'Native Test']);
      git(['config', 'commit.gpgsign', 'false']);
      await refreshRuntimePathsAfterGitInit();
      await fs.writeFile(
        path.join(root, '.gitattributes'),
        '*.txt text eol=lf\n*.filter filter=comet-upper\n',
      );
      const filter = path.join(root, 'filter.cjs');
      await fs.writeFile(
        filter,
        "process.stdout.write(require('node:fs').readFileSync(0, 'utf8').toUpperCase());\n",
      );
      git(['config', 'filter.comet-upper.clean', `"${process.execPath}" "${filter}"`]);
      git(['add', '.']);
      git(['commit', '-m', 'baseline']);
      const state = await archiveReady('batch-finish');
      const archived = await archiveNativePortableChange({ paths, name: state.name });
      const files = Array.from({ length: 70 }, (_, index) => `payload-${index}.txt`);
      files.push('[literal].txt', 'space name.txt', 'clean.filter');
      if (process.platform !== 'win32') files.push('tab\tname.txt', 'line\nname.txt');
      for (const file of files) {
        await fs.writeFile(path.join(archived.archiveDir, file), 'lowercase\r\n');
      }
      git(['add', '.']);
      git(['commit', '-m', 'archive with filtered artifacts']);
      const journal = {
        schema: NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA,
        name: state.name,
        transactionId: archived.transactionId,
        archiveDir: archived.archiveDir,
        createdAt: state.created_at,
        status: 'pending' as const,
        result: null,
        updatedAt: new Date().toISOString(),
      };
      const archiveFiles = (
        await fs.readdir(archived.archiveDir, { recursive: true, withFileTypes: true })
      ).filter((entry) => entry.isFile()).length;
      const call = vi.spyOn(gitCommands, 'runGitCommand');
      try {
        await expect(inspectNativeWorkspaceFinishCompletion(paths, journal)).resolves.toBe(true);
        const hashes = call.mock.calls.filter(([, args]) => args[0] === 'hash-object');
        expect(hashes).toHaveLength(Math.ceil((archiveFiles + state.spec_changes.length) / 32));
        expect(hashes.every(([, args]) => args[1] === '--' && args.length <= 34)).toBe(true);
        const results = call.mock.results;
        for (let index = 0; index < call.mock.calls.length; index++) {
          const [cwd, args] = call.mock.calls[index];
          if (args[0] !== 'hash-object') continue;
          const expected = args.slice(2).map((ref) =>
            execFileSync(
              'git',
              ['-C', cwd, 'hash-object', '--path', ref, '--', path.join(cwd, ref)],
              {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
              },
            ).trim(),
          );
          expect(results[index]).toMatchObject({ type: 'return', value: expected.join('\n') });
        }
      } finally {
        call.mockRestore();
      }
      const runGit = gitCommands.runGitCommand;
      let failBatch = true;
      const failedBatch = vi.spyOn(gitCommands, 'runGitCommand').mockImplementation((cwd, args) => {
        if (failBatch && args[0] === 'hash-object' && args[1] === '--' && args.length > 3) {
          failBatch = false;
          throw Object.assign(new Error('simulated host argument limit'), { code: 'E2BIG' });
        }
        return runGit(cwd, args);
      });
      try {
        await expect(inspectNativeWorkspaceFinishCompletion(paths, journal)).resolves.toBe(true);
        expect(failBatch).toBe(false);
        expect(
          failedBatch.mock.calls.some(
            ([, args]) => args[0] === 'hash-object' && args[1] === '--path',
          ),
        ).toBe(true);
      } finally {
        failedBatch.mockRestore();
      }
      if (objectFormat === 'sha1') {
        git(['config', 'core.longpaths', 'true']);
        const longDirectory = path.join(
          archived.archiveDir,
          'a'.repeat(100),
          'b'.repeat(100),
          'c'.repeat(100),
        );
        await fs.mkdir(longDirectory, { recursive: true });
        for (let index = 0; index < 40; index++) {
          await fs.writeFile(path.join(longDirectory, `long-${index}.txt`), 'long path\r\n');
        }
        git(['add', '.']);
        git(['commit', '-m', 'long archived paths']);
        const longCalls = vi.spyOn(gitCommands, 'runGitCommand');
        try {
          await expect(inspectNativeWorkspaceFinishCompletion(paths, journal)).resolves.toBe(true);
          const batches = longCalls.mock.calls.filter(([, args]) => args[0] === 'hash-object');
          expect(
            batches.some(
              ([, args]) => args.length < 34 && args.some((ref) => ref.includes('a'.repeat(100))),
            ),
          ).toBe(true);
          for (const [, args] of batches) {
            expect(
              args
                .slice(2)
                .reduce(
                  (total, ref) => total + Buffer.byteLength(JSON.stringify(ref), 'utf8') + 1,
                  0,
                ),
            ).toBeLessThanOrEqual(8_192);
          }
        } finally {
          longCalls.mockRestore();
        }
      }
      const altered = path.join(archived.archiveDir, files[0]);
      const ref = path.relative(root, altered).replaceAll('\\', '/');
      git(['update-index', '--assume-unchanged', '--', ref]);
      const stat = await fs.stat(altered);
      await fs.writeFile(altered, 'different\r\n');
      await fs.utimes(altered, stat.atime, stat.mtime);
      expect(git(['status', '--porcelain=v1'])).toBe('');
      await expect(inspectNativeWorkspaceFinishCompletion(paths, journal)).resolves.toBe(false);
      git(['update-index', '--no-assume-unchanged', '--', ref]);
      await fs.unlink(altered);
      await expect(inspectNativeWorkspaceFinishCompletion(paths, journal)).resolves.toBe(false);
    },
  );

  it('repairs an older finish journal after a manual commit using the archived files as proof', async () => {
    const state = await commitHookProject('legacy-finish');
    await nativeArchiveCommand([state.name, '--confirmed'], root);
    const journal = await readNativeWorkspaceFinishJournal(paths, state.name);
    const { plan: _plan, commit: _commit, merge: _merge, ...legacy } = journal!;
    await atomicWriteJson(
      path.join(paths.transactionsDir, `workspace-finish-${state.name}.json`),
      legacy,
    );
    git(['commit', '-m', 'PROJ: 完成旧版本归档']);
    await expect(nativeDoctorCommand([state.name, '--repair'], root)).resolves.toMatchObject({
      data: { healthy: true, repaired: true },
    });
    expect(await readNativeWorkspaceFinishJournal(paths, state.name)).toBeNull();
  });

  it.each(['', '  ', 'message\u0000invalid'])(
    'rejects invalid commit messages before touching Archive: %j',
    async (message) => {
      const state = await archiveReady('invalid-message');
      await expect(
        nativeArchiveCommand([state.name, '--confirmed', '--commit-message', message], root),
      ).rejects.toThrow(/commit-message/);
      expect((await readNativePortableChange(paths, state.name)).archived).toBe(false);
      expect(await readNativeWorkspaceFinishJournal(paths, state.name)).toBeNull();
    },
  );

  it('rejects malformed Archive options before dispatching to storage', async () => {
    await expect(
      nativeArchiveCommand(['archive-change', '--serial-first', 'BadName'], root),
    ).rejects.toThrow('--serial-first must be one Native change name');
    await expect(
      nativeArchiveCommand(['archive-change', '--finish', 'invalid'], root),
    ).rejects.toThrow('--finish must be merge, push, pull-request, or keep');
    await expect(
      nativeArchiveCommand(['archive-change', '--serial-first', 'first-change'], root),
    ).rejects.toThrow('--serial-first is only valid for portable Native changes');
    await expect(
      nativeArchiveCommand(['archive-change', '--finish', 'keep'], root),
    ).rejects.toThrow('--finish without --dry-run requires --confirmed');
  });

  it('applies complete create, modify, and remove Spec operations', async () => {
    await fs.mkdir(path.join(paths.specsDir, 'sample'), { recursive: true });
    await fs.writeFile(path.join(paths.specsDir, 'sample', 'spec.md'), '# Old behavior\n');
    const modified = await archiveReady('modify-spec');
    await archiveNativePortableChange({ paths, name: modified.name });
    await expect(
      fs.readFile(path.join(paths.specsDir, 'sample', 'spec.md'), 'utf8'),
    ).resolves.toContain('updated behavior');

    await createNativePortableChange({ paths, name: 'remove-spec', language: 'en' });
    const removeDir = nativePortableChangeDir(paths, 'remove-spec');
    await fs.writeFile(
      path.join(removeDir, 'brief.md'),
      '# Acceptance examples\n- The obsolete capability is removed.\n',
    );
    await markNativePortableSpecRemoval({ paths, name: 'remove-spec', capability: 'sample' });
    const removal = await verifyState(
      await confirmNativePortableShape({ paths, name: 'remove-spec' }),
    );
    await archiveNativePortableChange({ paths, name: removal.name });
    await expect(fs.stat(path.join(paths.specsDir, 'sample', 'spec.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses to remove a canonical Spec through a linked capability directory', async () => {
    const externalCapability = path.join(root, 'external-capability');
    await fs.mkdir(externalCapability, { recursive: true });
    const externalSpec = path.join(externalCapability, 'spec.md');
    await fs.writeFile(externalSpec, '# Must remain\n');
    await fs.cp(externalCapability, path.join(paths.specsDir, 'sample'), { recursive: true });

    await createNativePortableChange({ paths, name: 'linked-remove', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'linked-remove');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The obsolete capability is removed safely.\n',
    );
    await markNativePortableSpecRemoval({ paths, name: 'linked-remove', capability: 'sample' });
    const removal = await verifyState(
      await confirmNativePortableShape({ paths, name: 'linked-remove' }),
    );
    await fs.rm(path.join(paths.specsDir, 'sample'), { recursive: true });
    await fs.symlink(
      externalCapability,
      path.join(paths.specsDir, 'sample'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(archiveNativePortableChange({ paths, name: removal.name })).rejects.toThrow(
      'capability directory is unsafe',
    );
    await expect(fs.readFile(externalSpec, 'utf8')).resolves.toBe('# Must remain\n');
  });

  it('archives in one step with --confirmed --finish without a second full dry-run', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native-test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: root });
    await refreshRuntimePathsAfterGitInit();
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed native archive one-step'], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync('git', ['switch', '-c', 'comet/archive-one-step'], {
      cwd: root,
      stdio: 'ignore',
    });

    const state = await archiveReady('archive-one-step');
    await writeNativePortableState(
      path.join(nativePortableChangeDir(paths, state.name), 'comet-state.yaml'),
      {
        ...state,
        workspace: {
          isolation: 'branch',
          change_branch: 'comet/archive-one-step',
          target_branch: 'main',
          finish: null,
        },
      },
    );

    const archived = await nativeArchiveCommand(
      [state.name, '--confirmed', '--finish', 'keep'],
      root,
    );
    expect(archived).toMatchObject({
      exitCode: 0,
      data: {
        state: { status: 'done', archived: true },
        workspaceFinishResult: { status: 'kept', commit: expect.any(String) },
      },
    });
  });

  it('allows isolated keep finishes to preserve unrelated files while committing change-owned files', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native-test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: root });
    await refreshRuntimePathsAfterGitInit();
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed native archive preflight'], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync('git', ['switch', '-c', 'comet/archive-preflight'], {
      cwd: root,
      stdio: 'ignore',
    });

    await fs.writeFile(path.join(root, 'generated-output.txt'), 'created by a build\n');
    const state = await archiveReady('archive-preflight');
    await writeNativePortableState(
      path.join(nativePortableChangeDir(paths, state.name), 'comet-state.yaml'),
      {
        ...state,
        workspace: {
          isolation: 'branch',
          change_branch: 'comet/archive-preflight',
          target_branch: 'main',
          finish: null,
        },
      },
    );
    await fs.writeFile(path.join(root, 'generated-output.txt'), 'created by a build\n');

    const readyWithUnrelatedFile = await nativeArchiveCommand(
      [state.name, '--dry-run', '--finish', 'keep'],
      root,
    );
    expect(readyWithUnrelatedFile).toMatchObject({
      exitCode: 0,
      data: {
        ready: true,
        blockers: [],
        continuation: {
          disposition: 'continue',
          action: 'archive',
          commandArgs: ['comet', 'native', 'archive', state.name, '--confirmed'],
        },
      },
    });
    expect(await fs.readFile(path.join(root, 'generated-output.txt'), 'utf8')).toContain('build');

    const archived = await nativeArchiveCommand([state.name, '--confirmed'], root);
    expect(archived).toMatchObject({
      exitCode: 0,
      data: {
        state: { status: 'done', archived: true },
        workspaceFinishResult: { status: 'kept', commit: expect.any(String) },
      },
    });
    expect(await fs.readFile(path.join(root, 'generated-output.txt'), 'utf8')).toContain('build');
    expect(execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })).toContain(
      '?? generated-output.txt',
    );
  });

  it('allows current workspace finishes to preserve unrelated files while committing change-owned files', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native-test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: root });
    await refreshRuntimePathsAfterGitInit();
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed current Native archive'], {
      cwd: root,
      stdio: 'ignore',
    });

    await fs.writeFile(path.join(root, 'generated-output.txt'), 'created by a build\n');
    const state = await archiveReady('current-archive');
    await fs.writeFile(path.join(root, 'generated-output.txt'), 'created by a build\n');

    const readyWithUnrelatedFile = await nativeArchiveCommand([state.name, '--dry-run'], root);
    expect(readyWithUnrelatedFile).toMatchObject({
      exitCode: 0,
      data: {
        ready: true,
        blockers: [],
        continuation: {
          disposition: 'continue',
          action: 'archive',
          commandArgs: ['comet', 'native', 'archive', state.name, '--confirmed'],
        },
      },
    });

    const archived = await nativeArchiveCommand([state.name, '--confirmed'], root);
    expect(archived).toMatchObject({
      exitCode: 0,
      data: {
        state: { status: 'done', archived: true },
        workspaceFinishResult: { status: 'kept', commit: expect.any(String) },
      },
    });
    expect(await fs.readFile(path.join(root, 'generated-output.txt'), 'utf8')).toContain('build');
    expect(execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })).toContain(
      '?? generated-output.txt',
    );
  });

  it('completes an interrupted Archive by rerunning the returned recovery command', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native-test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: root });
    await refreshRuntimePathsAfterGitInit();
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed retryable Native archive'], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync('git', ['switch', '-c', 'comet/archive-retry'], {
      cwd: root,
      stdio: 'ignore',
    });

    const remote = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-remote-'));
    await fs.rm(remote, { recursive: true, force: true });
    try {
      execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root });
      execFileSync('git', ['config', 'branch.comet/archive-retry.remote', 'origin'], { cwd: root });
      execFileSync(
        'git',
        ['config', 'branch.comet/archive-retry.merge', 'refs/heads/comet/archive-retry'],
        { cwd: root },
      );

      const state = await archiveReady('archive-retry');
      await writeNativePortableState(
        path.join(nativePortableChangeDir(paths, state.name), 'comet-state.yaml'),
        {
          ...state,
          workspace: {
            isolation: 'branch',
            change_branch: 'comet/archive-retry',
            target_branch: 'main',
            finish: 'push',
          },
        },
      );

      const blocked = await nativeArchiveCommand([state.name, '--confirmed'], root);
      expect(blocked).toMatchObject({
        exitCode: 73,
        data: {
          workspaceFinishResult: {
            status: 'blocked',
            diagnosticArgs: ['git', '-C', root, 'status', '--short'],
            recoveryArgs: ['comet', 'native', 'archive', state.name, '--confirmed'],
          },
          continuation: {
            commandArgs: ['comet', 'native', 'archive', state.name, '--confirmed'],
          },
        },
      });

      execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
      await expect(nativeArchiveCommand([state.name, '--confirmed'], root)).resolves.toMatchObject({
        exitCode: 0,
        data: {
          state: { status: 'done', archived: true },
          workspaceFinishResult: { status: 'completed', pushed: true },
        },
      });
    } finally {
      await fs.rm(remote, { recursive: true, force: true });
    }
  });

  it('applies full specs, finalizes YAML/report, moves the change, and preserves accepted business history', async () => {
    const state = await archiveReady();
    const walkthrough = '<!doctype html><title>Change walkthrough</title><p>Verified change</p>';
    await fs.writeFile(
      path.join(nativePortableChangeDir(paths, state.name), 'walkthrough.html'),
      walkthrough,
    );
    const walkthroughPreview = await inspectNativePortableArchive({ paths, name: state.name });
    expect(walkthroughPreview.blockers).toEqual([]);
    expect(walkthroughPreview).toMatchObject({
      ready: true,
      stateVersion: state.state_version,
    });
    const acceptedReport = await fs.readFile(
      path.join(nativePortableChangeDir(paths, state.name), 'verification.md'),
      'utf8',
    );
    const result = await archiveNativePortableChange({ paths, name: state.name });
    expect(await fs.readFile(path.join(result.archiveDir, 'walkthrough.html'), 'utf8')).toBe(
      walkthrough,
    );

    expect(await fs.readFile(path.join(paths.specsDir, 'sample', 'spec.md'), 'utf8')).toContain(
      'updated behavior',
    );
    expect(await fs.stat(result.archiveDir)).toMatchObject({ isDirectory: expect.any(Function) });
    expect(await fs.readFile(path.join(result.archiveDir, 'comet-state.yaml'), 'utf8')).toContain(
      'status: done',
    );
    // Retired local-execution deletion no longer owns completion. Original accepted business evidence remains.
    expect(result.state.shape_confirmation_hash).toBe(state.shape_confirmation_hash);
    expect(result.state.verifier_action).toEqual(state.verifier_action);
    expect(result.state.verification_result).toBe('pass');
    expect(await fs.readFile(path.join(result.archiveDir, 'verification.md'), 'utf8')).toBe(
      acceptedReport,
    );
    expect(acceptedReport).toContain('generated_from_state_version: ' + state.state_version);
    expect(
      await readNativePortableTransaction(paths, { kind: 'archive', change: state.name }),
    ).toBeNull();
  });

  it('keeps a real rejected Git finish pending when Doctor repairs the archived change', async () => {
    const state = await commitHookProject('doctor-real-pending-finish', true);
    const beforeHead = git(['rev-parse', 'HEAD']);
    const result = await nativeArchiveCommand([state.name, '--confirmed'], root);
    expect(result).toMatchObject({
      exitCode: 73,
      data: { archived: true, workspaceFinishResult: { status: 'blocked' } },
    });
    const journal = (await readNativeWorkspaceFinishJournal(paths, state.name))!;
    expect(journal.status).toBe('blocked');
    const beforeJournal = await fs.readFile(
      path.join(paths.transactionsDir, 'workspace-finish-' + state.name + '.json'),
      'utf8',
    );
    const beforeArchived = await fs.readFile(
      path.join(journal.archiveDir!, 'comet-state.yaml'),
      'utf8',
    );
    const repaired = await nativeDoctorCommand([state.name, '--repair'], root);
    expect(repaired.data).toMatchObject({
      healthy: false,
      repaired: false,
      workspaceFinishes: expect.arrayContaining([
        expect.objectContaining({ change: state.name, completed: false, status: 'blocked' }),
      ]),
    });
    expect(git(['rev-parse', 'HEAD'])).toBe(beforeHead);
    expect(
      await fs.readFile(
        path.join(paths.transactionsDir, 'workspace-finish-' + state.name + '.json'),
        'utf8',
      ),
    ).toBe(beforeJournal);
    expect(await fs.readFile(path.join(journal.archiveDir!, 'comet-state.yaml'), 'utf8')).toBe(
      beforeArchived,
    );
    expect(await readNativeWorkspaceFinishJournal(paths, state.name)).toEqual(journal);
  });
});
