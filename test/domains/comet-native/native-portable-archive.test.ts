import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { markNativeSupervisorChildVerified } from '../../helpers/native-supervisor-results.js';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nativeArchiveCommand } from '../../../domains/comet-native/native-archive-command.js';
import { atomicWriteJson } from '../../../domains/comet-native/native-atomic-file.js';
import {
  createNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import { nativeStatusCommand } from '../../../domains/comet-native/native-status-command.js';
import {
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
  executeNativePortableCheckPlan,
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

  async function verifyState(state: Awaited<ReturnType<typeof confirmNativePortableShape>>) {
    const name = state.name;
    const runner = createNativeRunnerChannel();
    await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: `${name}-builder`,
        }),
        candidateId: `${name}-candidate`,
        summary: 'Implemented.',
        addressedAcceptanceIds: state.acceptance.map(({ id }) => id),
        acceptanceReview: fixtureAcceptanceReview(state.acceptance.map(({ id }) => id)),
        review: passedReview(`${name}-reviewer`),
      },
    });
    const executed = await executeNativePortableCheckPlan({
      paths,
      name,
      plans: [
        {
          id: 'test',
          name: 'Tests',
          executable: process.execPath,
          argv: ['-e', 'process.exit(0)'],
          cwdRef: '.',
          timeoutMs: 10_000,
          repeatable: true,
        },
      ],
    });
    state = await dispatchNativePortableVerifier({ paths, name, checks: executed.checks });
    await submitNativePortableVerifierResult({
      paths,
      name,
      checks: executed.checks,
      maxVerifyFailures: 5,
      envelope: runner.envelopeVerifierResponse({
        candidateId: `${name}-candidate`,
        identity: runner.captureExecutionIdentity({
          identityProvider: 'test-host',
          executionRef: `${name}-verifier`,
        }),
        payload: {
          kind: 'final-result',
          result: {
            iteration: 1,
            attempt: 1,
            verdict: 'pass',
            acceptance: state.acceptance.map(({ id }) => ({
              id,
              result: 'passed',
              reason: 'Verified.',
            })),
            risks: [],
            summary: 'Passed.',
          },
        },
      }),
    });
    return confirmNativePortableSkillCoordinatedPass({ paths, name });
  }

  async function archiveReady(
    name = 'archive-change',
    specs: Array<[string, string]> = [
      ['sample', '# Sample\n\nRuntime MUST expose the updated behavior.\n'],
    ],
    workspaceBinding?: Parameters<typeof createNativePortableChange>[0]['workspaceBinding'],
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
    return verifyState(await confirmNativePortableShape({ paths, name }));
  }

  function git(args: string[]) {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }

  async function commitHookProject(
    name: string,
    rejectAll = false,
    isolation: 'current' | 'branch' | 'worktree' = 'current',
    objectFormat: 'sha1' | 'sha256' = 'sha1',
  ) {
    git(['init', `--object-format=${objectFormat}`, '-b', 'main']);
    git(['config', 'user.email', 'native-test@example.com']);
    git(['config', 'user.name', 'Native Test']);
    const hook = path.join(root, '.git/hooks/commit-msg');
    git(['config', 'core.hooksPath', path.dirname(hook)]);
    git(['config', 'commit.gpgsign', 'false']);
    await fs.writeFile(
      path.join(root, '.gitignore'),
      '.comet/runtime/\n.comet/current-change.json\n',
    );
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
          findings: expect.arrayContaining([
            expect.objectContaining({ code: 'workspace-finish-incomplete' }),
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
    const state = await commitHookProject('preview-hooks', false, 'branch');
    const hooks = path.join(root, 'global-hooks');
    const marker = path.join(root, '.git/preview-hook-ran');
    const globalConfig = path.join(root, '.git/preview-global-config');
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
    const head = git(['rev-parse', 'HEAD']);
    const index = git(['write-tree']);
    vi.stubEnv('GIT_CONFIG_GLOBAL', globalConfig);
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

  it.each([
    ['afterMove', true],
    ['afterRuntimeCleanup', false],
  ] as const)('keeps workspace finish pending after Doctor repairs %s', async (hook, named) => {
    const state = await commitHookProject(`doctor-finish-${named ? 'named' : 'project'}`);
    await writeNativeWorkspaceFinishJournal(paths, {
      schema: NATIVE_WORKSPACE_FINISH_JOURNAL_SCHEMA,
      name: state.name,
      transactionId: 'interrupted-archive',
      archiveDir: nativePortableArchiveDirectory(paths, state),
      createdAt: state.created_at,
      status: 'pending',
      result: null,
      updatedAt: new Date().toISOString(),
    });
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { [hook]: () => Promise.reject(new Error('interrupted-archive')) },
      }),
    ).rejects.toThrow('interrupted-archive');
    const head = git(['rev-parse', 'HEAD']);
    await expect(
      nativeDoctorCommand([...(named ? [state.name] : []), '--repair'], root),
    ).resolves.toMatchObject({
      exitCode: 65,
      data: {
        healthy: false,
        findings: expect.arrayContaining([
          expect.objectContaining({ code: 'workspace-finish-incomplete' }),
        ]),
      },
    });
    expect(git(['rev-parse', 'HEAD'])).toBe(head);
    expect(await readNativeWorkspaceFinishJournal(paths, state.name)).not.toBeNull();
    await expect(
      nativeArchiveCommand(
        [state.name, '--confirmed', '--commit-message', 'PROJ: 完成恢复的归档'],
        root,
      ),
    ).resolves.toMatchObject({ exitCode: 0 });
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

  it('applies full specs, finalizes YAML/report, moves the change, and removes local Runtime', async () => {
    const state = await archiveReady();
    expect(await inspectNativePortableArchive({ paths, name: state.name })).toMatchObject({
      ready: true,
      stateVersion: state.state_version,
    });
    const result = await archiveNativePortableChange({ paths, name: state.name });

    expect(await fs.readFile(path.join(paths.specsDir, 'sample', 'spec.md'), 'utf8')).toContain(
      'updated behavior',
    );
    expect(await fs.stat(result.archiveDir)).toMatchObject({ isDirectory: expect.any(Function) });
    expect(await fs.readFile(path.join(result.archiveDir, 'comet-state.yaml'), 'utf8')).toContain(
      'status: done',
    );
    await expect(fs.stat(path.join(paths.changesRuntimeDir, state.name))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('continues normally after target refresh interrupts a prepared Supervisor archive', async () => {
    const git = (args: string[], cwd = root) =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'native@example.test']);
    git(['config', 'user.name', 'Native Test']);
    await fs.writeFile(path.join(root, '.gitignore'), '.comet/runtime/\n');
    const portable = await archiveReady('archive-target-refresh');
    await writeNativePortableState(
      path.join(nativePortableChangeDir(paths, portable.name), 'comet-state.yaml'),
      {
        ...portable,
        workspace: {
          isolation: 'current',
          change_branch: 'main',
          target_branch: 'main',
          finish: null,
        },
      },
    );
    git(['add', '.']);
    git(['commit', '-m', 'prepare archive']);
    const targetCommit = git(['rev-parse', 'HEAD']);
    const prepared = await prepareNativeSupervisorIntegrationWorkspace({
      projectRoot: root,
      parent: portable.name,
      targetBranch: 'main',
      sourceConfig: defaultProjectConfig('docs', 'en'),
    });

    try {
      const contract = parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: implementation
    summary: Implements the change.
    depends_on: []
`);
      let supervisor =
        (await readNativeSupervisorState(paths, portable.name)) ??
        createNativeSupervisorState({
          parent: portable.name,
          targetBranch: 'main',
          targetCommit,
          integrationBranch: prepared.binding.changeBranch!,
          integrationWorktree: prepared.projectRoot,
          contract,
        });
      supervisor = markNativeSupervisorChildVerified(supervisor, {
        name: 'implementation',
        baseCommit: targetCommit,
        verifiedCommit: targetCommit,
        evidence: { summary: 'verified', checks: ['child test'] },
      });
      await fs.writeFile(path.join(prepared.projectRoot, 'integration.txt'), 'integrated change\n');
      git(['add', 'integration.txt'], prepared.projectRoot);
      git(['commit', '-m', 'integrate change'], prepared.projectRoot);
      const integrationCommit = git(['rev-parse', 'HEAD'], prepared.projectRoot);
      supervisor = integrateNativeSupervisorChild(supervisor, {
        name: 'implementation',
        integrationCommit,
        checks: [{ name: 'integration test', status: 'passed' }],
      });
      supervisor = recordNativeSupervisorFinalVerification(supervisor, {
        status: 'passed',
        summary: 'parent checks passed',
        headCommit: integrationCommit,
        layers: {
          childVerification: 'complete',
          parentIntegration: 'complete',
          parentChecks: ['parent test'],
          notRerun: ['child test'],
          incomplete: [],
        },
      });
      await writeNativeSupervisorState(paths, supervisor);

      await fs.writeFile(path.join(root, 'target-update.txt'), 'target moved\n');
      git(['add', 'target-update.txt']);
      git(['commit', '-m', 'move target']);

      await expect(archiveNativePortableChange({ paths, name: portable.name })).rejects.toThrow(
        /target changed|rerun/iu,
      );
      await expect(
        readNativePortableTransaction(paths, { kind: 'archive', change: portable.name }),
      ).resolves.toMatchObject({
        kind: 'archive',
        journal: { status: 'prepared', next_spec_index: 0 },
      });

      git(['switch', '-c', 'wrong-caller-branch']);
      const wrongWorkspace = await nativeNextCommand(
        [portable.name, '--summary', 'Continue from the wrong branch.'],
        root,
      );
      expect(wrongWorkspace).toMatchObject({
        exitCode: 0,
        data: {
          state: { phase: 'archive', verification_result: 'pass' },
          recovery: { action: 'await-user', reason: 'workspace-mismatch' },
        },
      });
      await expect(
        readNativePortableTransaction(paths, { kind: 'archive', change: portable.name }),
      ).resolves.toMatchObject({
        kind: 'archive',
        journal: { status: 'prepared', next_spec_index: 0 },
      });
      git(['switch', 'main']);

      const transactionFile = nativePortableTransactionFile(paths, {
        kind: 'archive',
        change: portable.name,
      });
      const remove = fs.rm.bind(fs);
      const removeSpy = vi.spyOn(fs, 'rm').mockImplementation(async (target, options) => {
        if (path.resolve(String(target)) === path.resolve(transactionFile)) {
          throw new Error('simulated interruption after portable recovery');
        }
        return remove(target, options);
      });
      try {
        await expect(
          nativeNextCommand(
            [portable.name, '--summary', 'Continue after the interrupted archive.'],
            root,
          ),
        ).rejects.toThrow('simulated interruption after portable recovery');
      } finally {
        removeSpy.mockRestore();
      }
      await expect(readNativePortableChange(paths, portable.name)).resolves.toMatchObject({
        phase: 'verify',
        status: 'active',
        verification_result: 'pending',
        loop: { stage: 'verify-ready', next_action: 'run-final-full-verification' },
      });
      await expect(fs.stat(transactionFile)).resolves.toBeDefined();

      const continued = await nativeNextCommand(
        [portable.name, '--summary', 'Continue once more after interruption.'],
        root,
      );
      expect(continued).toMatchObject({
        exitCode: 0,
        data: {
          state: {
            phase: 'verify',
            status: 'active',
            verification_result: 'pending',
            loop: { stage: 'verify-ready', next_action: 'run-final-full-verification' },
          },
        },
      });
      await expect(fs.stat(transactionFile)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      try {
        git(['worktree', 'remove', '--force', prepared.projectRoot]);
      } catch {
        // Preserve the assertion failure if setup did not finish cleanly.
      }
    }
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
    await fs.symlink(
      externalCapability,
      path.join(paths.specsDir, 'sample'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

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

    await expect(archiveNativePortableChange({ paths, name: removal.name })).rejects.toThrow(
      'capability directory is unsafe',
    );
    await expect(fs.readFile(externalSpec, 'utf8')).resolves.toBe('# Must remain\n');
  });

  it('returns an archive-ready change to Shape when formal requirements drift', async () => {
    const state = await archiveReady('archive-formal-drift');
    await fs.writeFile(
      path.join(nativePortableChangeDir(paths, state.name), 'brief.md'),
      '# Acceptance examples\n- The canonical behavior is updated.\n- A new requirement is added.\n',
    );

    await expect(archiveNativePortableChange({ paths, name: state.name })).rejects.toThrow(
      'returned to Shape',
    );
    await expect(readNativePortableChange(paths, state.name)).resolves.toMatchObject({
      phase: 'shape',
      verification_result: 'pending',
      builder_handoff: null,
    });
    await expect(fs.stat(path.join(paths.specsDir, 'sample', 'spec.md'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('clears a pre-Archive workspace finish journal when verification becomes stale', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native-test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: root });
    await fs.writeFile(path.join(root, '.gitignore'), '.comet/runtime/\n');
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed stale finish recovery'], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync('git', ['switch', '-c', 'comet/stale-finish'], {
      cwd: root,
      stdio: 'ignore',
    });

    const state = await archiveReady('stale-finish');
    await writeNativePortableState(
      path.join(nativePortableChangeDir(paths, state.name), 'comet-state.yaml'),
      {
        ...state,
        workspace: {
          isolation: 'branch',
          change_branch: 'comet/stale-finish',
          target_branch: 'main',
          finish: 'keep',
        },
      },
    );
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { afterSpecApplied: () => Promise.reject(new Error('pause-before-finish')) },
      }),
    ).rejects.toThrow('pause-before-finish');
    await fs.writeFile(
      path.join(paths.specsDir, 'sample', 'spec.md'),
      '# Sample\n\nThe canonical behavior changed after verification.\n',
    );

    await expect(nativeArchiveCommand([state.name, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: { archived: false, recovery: { action: 'reverify' } },
    });
    await expect(
      fs.stat(path.join(paths.transactionsDir, `workspace-finish-${state.name}.json`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('resumes after final YAML and after directory move without rerunning verification', async () => {
    for (const hook of ['afterFinalState', 'afterMove'] as const) {
      const name = `resume-${hook === 'afterFinalState' ? 'state' : 'move'}`;
      await archiveReady(name);
      await expect(
        archiveNativePortableChange({
          paths,
          name,
          hooks: { [hook]: () => Promise.reject(new Error(`crash-${hook}`)) },
        }),
      ).rejects.toThrow(`crash-${hook}`);
      const resumed = await archiveNativePortableChange({ paths, name });
      expect(resumed.state.status).toBe('done');
      expect(await fs.readFile(path.join(resumed.archiveDir, 'verification.md'), 'utf8')).toContain(
        `generated_from_state_version: ${resumed.state.state_version}`,
      );
    }
  });

  it('routes public Archive through portable recovery before reusing a pass', async () => {
    const state = await archiveReady('missing-local-runtime');
    await fs.rm(path.join(paths.changesRuntimeDir, state.name), {
      recursive: true,
      force: true,
    });

    await expect(nativeArchiveCommand([state.name, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        archived: false,
        state: { phase: 'verify', verification_result: 'pending' },
        recovery: { action: 'reverify' },
      },
    });
    await expect(fs.stat(nativePortableChangeDir(paths, state.name))).resolves.toBeDefined();
  });

  it('resumes a moved portable Archive transaction through the public command', async () => {
    const state = await archiveReady('public-move-recovery');
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { afterMove: () => Promise.reject(new Error('public-after-move')) },
      }),
    ).rejects.toThrow('public-after-move');

    await expect(nativeArchiveCommand([state.name, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: { state: { status: 'done', archived: true } },
    });
  });

  it('resumes an active portable Archive transaction through the public command', async () => {
    const state = await archiveReady('public-active-recovery');
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { afterSpecApplied: () => Promise.reject(new Error('public-after-spec')) },
      }),
    ).rejects.toThrow('public-after-spec');

    await expect(nativeArchiveCommand([state.name, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: { state: { status: 'done', archived: true } },
    });
    await expect(
      fs.stat(path.join(paths.transactionsDir, `portable-archive-${state.name}.json`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('recovers deterministically when the local Archive transaction is lost', async () => {
    const activeName = 'lost-after-state';
    await archiveReady(activeName);
    await expect(
      archiveNativePortableChange({
        paths,
        name: activeName,
        hooks: { afterFinalState: () => Promise.reject(new Error('lost-state-transaction')) },
      }),
    ).rejects.toThrow('lost-state-transaction');
    await fs.rm(path.join(paths.transactionsDir, `portable-archive-${activeName}.json`), {
      force: true,
    });
    const activeRecovered = await archiveNativePortableChange({ paths, name: activeName });
    expect(activeRecovered.state.status).toBe('done');
    await expect(fs.stat(nativePortableChangeDir(paths, activeName))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const movedName = 'lost-after-move';
    await archiveReady(movedName);
    await expect(
      archiveNativePortableChange({
        paths,
        name: movedName,
        hooks: { afterMove: () => Promise.reject(new Error('lost-move-transaction')) },
      }),
    ).rejects.toThrow('lost-move-transaction');
    await fs.rm(path.join(paths.transactionsDir, `portable-archive-${movedName}.json`), {
      force: true,
    });
    const movedRecovered = await archiveNativePortableChange({ paths, name: movedName });
    expect(movedRecovered.transactionId).toMatch(/^recovered-/u);
    expect(movedRecovered.state.status).toBe('done');
    await expect(fs.stat(path.join(paths.changesRuntimeDir, movedName))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('blocks other mutations after an interrupted spec apply and lets Archive resume itself', async () => {
    const state = await archiveReady('blocked-by-archive');
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { afterSpecApplied: () => Promise.reject(new Error('pause-after-spec')) },
      }),
    ).rejects.toThrow('pause-after-spec');

    await expect(
      returnNativePortableChangeToShape({
        paths,
        name: state.name,
        reason: 'Requirements changed while Archive was interrupted.',
      }),
    ).rejects.toThrow('transaction recovery is required');
    await expect(
      createNativePortableChange({ paths, name: 'unrelated-change', language: 'en' }),
    ).rejects.toThrow('transaction recovery is required');

    await expect(archiveNativePortableChange({ paths, name: state.name })).resolves.toMatchObject({
      state: { status: 'done', archived: true },
    });
  });

  it('resumes from frozen Spec contents after a later active Spec edit', async () => {
    const originalBeta = '# Beta\n\nRuntime MUST preserve the confirmed beta behavior.\n';
    const state = await archiveReady('frozen-specs', [
      ['alpha', '# Alpha\n\nRuntime MUST preserve the confirmed alpha behavior.\n'],
      ['beta', originalBeta],
    ]);
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: {
          afterSpecApplied: (index) => {
            if (index === 0) throw new Error('pause-after-first-spec');
          },
        },
      }),
    ).rejects.toThrow('pause-after-first-spec');

    await fs.writeFile(
      path.join(nativePortableChangeDir(paths, state.name), 'specs', 'beta', 'spec.md'),
      '# Beta\n\nRuntime MUST use an unconfirmed replacement.\n',
    );
    const resumed = await archiveNativePortableChange({ paths, name: state.name });

    await expect(fs.readFile(path.join(paths.specsDir, 'beta', 'spec.md'), 'utf8')).resolves.toBe(
      originalBeta,
    );
    await expect(
      fs.readFile(path.join(resumed.archiveDir, 'specs', 'beta', 'spec.md'), 'utf8'),
    ).resolves.toBe(originalBeta);
  });

  it('preserves a concurrent canonical Spec edit when recovering an interrupted Archive', async () => {
    const state = await archiveReady('canonical-edit-recovery');
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { afterSpecApplied: () => Promise.reject(new Error('pause-after-spec')) },
      }),
    ).rejects.toThrow('pause-after-spec');
    const file = path.join(paths.specsDir, 'sample', 'spec.md');
    const edited = '# Sample\n\nConcurrent user change.\n';
    await fs.writeFile(file, edited);
    await expect(archiveNativePortableChange({ paths, name: state.name })).rejects.toThrow(
      /fresh verification/iu,
    );
    expect(await fs.readFile(file, 'utf8')).toBe(edited);
    expect((await readNativePortableChange(paths, state.name)).archived).toBe(false);
  });

  it('does not resume an old full-Spec journal without canonical target bindings', async () => {
    const state = await archiveReady('legacy-full-journal');
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { afterSpecApplied: () => Promise.reject(new Error('pause-after-spec')) },
      }),
    ).rejects.toThrow('pause-after-spec');
    const transaction = await readNativePortableTransaction(paths, {
      kind: 'archive',
      change: state.name,
    });
    expect(transaction?.kind).toBe('archive');
    if (!transaction || transaction.kind !== 'archive') throw new Error('transaction missing');
    await atomicWriteJson(
      transaction.file,
      {
        ...transaction.journal,
        spec_changes: transaction.journal.spec_changes.map((change) => {
          const legacy = { ...change };
          delete legacy.expected_target_hash;
          delete legacy.result_hash;
          return legacy;
        }),
      },
      { containedRoot: paths.runtimeDir },
    );
    const file = path.join(paths.specsDir, 'sample', 'spec.md');
    const edited = '# Sample\n\nConcurrent legacy journal edit.\n';
    await fs.writeFile(file, edited);

    await expect(nativeArchiveCommand([state.name, '--dry-run'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        archived: false,
        ready: false,
        recovery: { action: 'reverify' },
      },
    });
    await expect(archiveNativePortableChange({ paths, name: state.name })).rejects.toThrow(
      /fresh verification/iu,
    );
    expect(await fs.readFile(file, 'utf8')).toBe(edited);
    await expect(readNativePortableChange(paths, state.name)).resolves.toMatchObject({
      phase: 'verify',
      verification_result: 'pending',
    });
  });

  it('does not treat an old remove journal as safe merely because the target is absent', async () => {
    await fs.mkdir(path.join(paths.specsDir, 'sample'), { recursive: true });
    await fs.writeFile(path.join(paths.specsDir, 'sample', 'spec.md'), '# Obsolete behavior\n');
    await createNativePortableChange({ paths, name: 'legacy-remove-journal', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'legacy-remove-journal');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      '# Acceptance examples\n- The obsolete capability is removed.\n',
    );
    await markNativePortableSpecRemoval({
      paths,
      name: 'legacy-remove-journal',
      capability: 'sample',
    });
    const state = await verifyState(
      await confirmNativePortableShape({ paths, name: 'legacy-remove-journal' }),
    );
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { afterSpecApplied: () => Promise.reject(new Error('pause-after-remove')) },
      }),
    ).rejects.toThrow('pause-after-remove');
    const transaction = await readNativePortableTransaction(paths, {
      kind: 'archive',
      change: state.name,
    });
    expect(transaction?.kind).toBe('archive');
    if (!transaction || transaction.kind !== 'archive') throw new Error('transaction missing');
    await atomicWriteJson(
      transaction.file,
      {
        ...transaction.journal,
        spec_changes: transaction.journal.spec_changes.map((change) => {
          const legacy = { ...change };
          delete legacy.expected_target_hash;
          return legacy;
        }),
      },
      { containedRoot: paths.runtimeDir },
    );

    await expect(nativeArchiveCommand([state.name, '--dry-run'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        archived: false,
        ready: false,
        recovery: { action: 'reverify' },
      },
    });
  });

  it('reports interrupted Archive transactions in named and project-wide Doctor and repairs them', async () => {
    const state = await archiveReady('doctor-archive');
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { afterSpecApplied: () => Promise.reject(new Error('doctor-after-spec')) },
      }),
    ).rejects.toThrow('doctor-after-spec');

    for (const args of [[state.name], []]) {
      await expect(nativeDoctorCommand(args, root)).resolves.toMatchObject({
        exitCode: 65,
        data: {
          healthy: false,
          findings: expect.arrayContaining([
            expect.objectContaining({
              code: 'portable-archive-transaction-incomplete',
              repair: 'continue',
            }),
          ]),
        },
      });
    }

    await expect(nativeDoctorCommand([state.name, '--repair'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        workflow: 'native-portable',
        change: state.name,
        repaired: true,
        archive: { recovered: true },
        state: { status: 'done', archived: true },
      },
    });
  });

  it('repairs a moved Archive transaction after the active directory is gone', async () => {
    const state = await archiveReady('doctor-moved-archive');
    await expect(
      archiveNativePortableChange({
        paths,
        name: state.name,
        hooks: { afterMove: () => Promise.reject(new Error('doctor-after-move')) },
      }),
    ).rejects.toThrow('doctor-after-move');
    await expect(fs.stat(nativePortableChangeDir(paths, state.name))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    await expect(nativeDoctorCommand([state.name], root)).resolves.toMatchObject({
      exitCode: 65,
      data: {
        findings: [expect.objectContaining({ code: 'portable-archive-transaction-incomplete' })],
      },
    });
    await expect(nativeDoctorCommand([state.name, '--repair'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        healthy: true,
        archive: { recovered: true },
        state: { status: 'done', archived: true },
      },
    });
  });

  it('keeps Archive ready while requiring one explicit serial capability choice', async () => {
    const first = await archiveReady('serial-first');
    const secondDir = nativePortableChangeDir(paths, 'serial-second');
    await fs.cp(nativePortableChangeDir(paths, first.name), secondDir, { recursive: true });
    const secondState = { ...first, name: 'serial-second' };
    delete secondState.verifier_action;
    await writeNativePortableState(path.join(secondDir, 'comet-state.yaml'), secondState, {
      containedRoot: paths.nativeRoot,
    });

    await expect(inspectNativePortableArchive({ paths, name: first.name })).resolves.toMatchObject({
      ready: false,
      capabilityPeers: ['serial-second'],
    });
    await expect(
      nativeArchiveCommand(
        [first.name, '--dry-run', '--commit-message', 'PROJ: serial archive'],
        root,
      ),
    ).resolves.toMatchObject({
      exitCode: 0,
      data: {
        capabilityPeers: ['serial-second'],
        continuation: {
          disposition: 'await-user',
          requiredInputs: ['choose-first-archive'],
          commandAlternatives: [
            expect.objectContaining({
              commandArgs: expect.arrayContaining(['--commit-message', 'PROJ: serial archive']),
            }),
          ],
        },
      },
    });
    await expect(archiveNativePortableChange({ paths, name: first.name })).rejects.toMatchObject({
      name: 'NativePortableArchiveOrderRequiredError',
      peers: ['serial-second'],
    });
    await expect(readNativePortableChange(paths, first.name)).resolves.toMatchObject({
      phase: 'archive',
      status: 'active',
      loop: { stage: 'archive-ready' },
    });
    await expect(nativeArchiveCommand([first.name, '--confirmed'], root)).resolves.toMatchObject({
      exitCode: 73,
      data: {
        capabilityPeers: ['serial-second'],
        continuation: {
          disposition: 'await-user',
          commandArgs: expect.arrayContaining(['--serial-first', first.name]),
        },
      },
    });

    await expect(
      nativeArchiveCommand([first.name, '--confirmed', '--serial-first', first.name], root),
    ).resolves.toMatchObject({ exitCode: 0, data: { state: { status: 'done' } } });
  });

  it('archives in one step with --confirmed --finish without a second full dry-run', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native-test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: root });
    await fs.writeFile(path.join(root, '.gitignore'), '.comet/runtime/\n');
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
    await fs.writeFile(path.join(root, '.gitignore'), '.comet/runtime/\n');
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed native archive preflight'], {
      cwd: root,
      stdio: 'ignore',
    });
    execFileSync('git', ['switch', '-c', 'comet/archive-preflight'], {
      cwd: root,
      stdio: 'ignore',
    });

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
    await fs.writeFile(path.join(root, '.gitignore'), '.comet/runtime/\n');
    execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'seed current Native archive'], {
      cwd: root,
      stdio: 'ignore',
    });

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
    await fs.writeFile(path.join(root, '.gitignore'), '.comet/runtime/\n');
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

  it('detects capability owners in another registered Git worktree', async () => {
    const first = await archiveReady('primary-owner');
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'native-test@example.com'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'Native Test'], { cwd: root });
    execFileSync('git', ['add', '.'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'test: seed portable change'], {
      cwd: root,
      stdio: 'ignore',
    });

    const secondary = path.join(root, '.worktrees', 'secondary');
    execFileSync('git', ['worktree', 'add', '-b', 'secondary-owner', secondary, 'HEAD'], {
      cwd: root,
      stdio: 'ignore',
    });
    const secondaryPaths = await nativeProjectPaths(secondary, 'docs');
    await ensureNativeDirectories(secondaryPaths);
    await fs.rm(nativePortableChangeDir(secondaryPaths, first.name), {
      recursive: true,
      force: true,
    });
    await createNativePortableChange({
      paths: secondaryPaths,
      name: 'secondary-owner',
      language: 'en',
    });
    const secondaryChange = nativePortableChangeDir(secondaryPaths, 'secondary-owner');
    await fs.writeFile(
      path.join(secondaryChange, 'brief.md'),
      '# Acceptance examples\n- The secondary behavior is updated.\n',
    );
    await fs.mkdir(path.join(secondaryChange, 'specs', 'sample'), { recursive: true });
    await fs.writeFile(
      path.join(secondaryChange, 'specs', 'sample', 'spec.md'),
      '# Sample\n\nRuntime MUST expose the secondary behavior.\n',
    );
    await confirmNativePortableShape({ paths: secondaryPaths, name: 'secondary-owner' });

    await expect(inspectNativePortableArchive({ paths, name: first.name })).resolves.toMatchObject({
      ready: false,
      capabilityPeers: ['secondary-owner'],
    });
  });

  it('requires serial ordering when a legacy active change owns the capability', async () => {
    const portable = await archiveReady('portable-owner');
    const legacy = await createNativeChange({
      paths,
      verificationProtocol: 'legacy-v1',
      name: 'legacy-owner',
      language: 'en',
    });
    const source = path.join(paths.changesDir, legacy.name, 'specs', 'sample', 'spec.md');
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, '# Sample\n\nLegacy change owns this capability.\n');
    await writeNativeChange(paths, {
      ...legacy,
      spec_changes: [
        {
          capability: 'sample',
          operation: 'create',
          source: 'specs/sample/spec.md',
          base_hash: null,
        },
      ],
    });

    await expect(
      inspectNativePortableArchive({ paths, name: portable.name }),
    ).resolves.toMatchObject({
      ready: false,
      capabilityPeers: ['legacy-owner'],
    });
  });
});
