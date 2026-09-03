import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { nativeArchiveCommand } from '../../../domains/comet-native/native-archive-command.js';
import {
  createNativeChange,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeDoctorCommand } from '../../../domains/comet-native/native-doctor-command.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  archiveNativePortableChange,
  inspectNativePortableArchive,
} from '../../../domains/comet-native/native-portable-archive.js';
import { parseNativeChildrenContract } from '../../../domains/comet-native/native-children.js';
import { nativeNextCommand } from '../../../domains/comet-native/native-next-command.js';
import {
  confirmNativePortableShape,
  confirmNativePortableSkillCoordinatedPass,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  executeNativePortableCheckPlan,
  markNativePortableSpecRemoval,
  nativePortableChangeDir,
  readNativePortableChange,
  returnNativePortableChangeToShape,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { writeNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import {
  createNativeSupervisorState,
  integrateNativeSupervisorChild,
  markNativeSupervisorChildVerified,
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
  ) {
    await createNativePortableChange({ paths, name, language: 'en' });
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
    ).rejects.toThrow('--finish is only valid with --dry-run');
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
    await writeNativePortableState(
      path.join(secondDir, 'comet-state.yaml'),
      { ...first, name: 'serial-second' },
      { containedRoot: paths.nativeRoot },
    );

    await expect(inspectNativePortableArchive({ paths, name: first.name })).resolves.toMatchObject({
      ready: false,
      capabilityPeers: ['serial-second'],
    });
    await expect(nativeArchiveCommand([first.name, '--dry-run'], root)).resolves.toMatchObject({
      exitCode: 0,
      data: {
        capabilityPeers: ['serial-second'],
        continuation: {
          disposition: 'await-user',
          requiredInputs: ['choose-first-archive'],
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

  it('reports isolated workspace blockers during dry-run and lets Archive commit change-owned files', async () => {
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

    const blocked = await nativeArchiveCommand([state.name, '--dry-run', '--finish', 'keep'], root);
    expect(blocked).toMatchObject({
      exitCode: 0,
      data: {
        ready: false,
        blockers: [expect.stringContaining('generated-output.txt')],
        continuation: {
          disposition: 'blocked',
          action: 'archive',
          commandArgs: null,
          requiredInputs: ['archive-blocker-resolution'],
        },
      },
    });
    expect(await fs.readFile(path.join(root, 'generated-output.txt'), 'utf8')).toContain('build');

    await fs.rm(path.join(root, 'generated-output.txt'));
    const ready = await nativeArchiveCommand([state.name, '--dry-run'], root);
    expect(ready).toMatchObject({
      exitCode: 0,
      data: {
        ready: true,
        blockers: [],
        continuation: {
          disposition: 'continue',
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
    expect(execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })).toBe('');
  });

  it('reports current workspace blockers during dry-run and commits change-owned files', async () => {
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

    const blocked = await nativeArchiveCommand([state.name, '--dry-run'], root);
    expect(blocked).toMatchObject({
      exitCode: 0,
      data: {
        ready: false,
        blockers: [expect.stringContaining('generated-output.txt')],
        workspaceFinishBlockers: [{ paths: [expect.stringContaining('generated-output.txt')] }],
        continuation: {
          disposition: 'blocked',
          action: 'archive',
          commandArgs: null,
        },
      },
    });

    await fs.rm(path.join(root, 'generated-output.txt'));
    const ready = await nativeArchiveCommand([state.name, '--dry-run'], root);
    expect(ready).toMatchObject({
      exitCode: 0,
      data: {
        ready: true,
        blockers: [],
        continuation: {
          disposition: 'continue',
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
    expect(execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })).toBe('');
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
