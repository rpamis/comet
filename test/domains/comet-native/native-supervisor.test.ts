import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  createNativeSupervisorState,
  createNativeSupervisorTask,
  applyNativeSupervisorBuilderResult,
  applyNativeSupervisorVerifierResult,
  integrateNativeSupervisorChild,
  markNativeSupervisorChildVerified,
  nativeSupervisorRuntimeDir,
  nativeSupervisorStateFile,
  integrateNativeSupervisorChildWorkspace,
  finalizeNativeSupervisorDelivery,
  recordNativeSupervisorFinalVerification,
  reconcileNativeSupervisorState,
  rebuildNativeSupervisorStateFromFacts,
  nativeSupervisorIntegrationBranch,
  nativeSupervisorIntegrationWorktree,
  projectNativeSupervisorChildren,
  reconnectNativeSupervisorTask,
  reconnectNativeSupervisorTaskWithState,
  cancelNativeSupervisorTask,
  dispatchNativeSupervisorReadyTasks,
  prepareNativeSupervisorChildWorkspace,
  prepareNativeSupervisorIntegrationWorkspace,
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { parseNativeChildrenContract } from '../../../domains/comet-native/native-children.js';
import {
  applyNativeRunnerInput,
  parseNativeRunnerInput,
} from '../../../domains/comet-native/native-runner-input.js';
import {
  confirmNativePortableShape,
  createNativePortableChange,
  nativePortableChangeDir,
  readNativePortableChange,
  inspectNativeSupervisorParentReviewReadiness,
  returnNativePortableChangeToShape,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { inspectNativePortableStatus } from '../../../domains/comet-native/native-portable-status.js';
import { nativeNextCommand } from '../../../domains/comet-native/native-next-command.js';

const CONTRACT = parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Owns the parent integration branch.
    depends_on: []
  - name: dashboard
    summary: Connects the read-only status view.
    depends_on: [integration-core]
`);

describe('Native Supervisor v2 state', () => {
  it('advances a reviewed parent and keeps verification in its integration workspace', async () => {
    const repository = await fs.mkdtemp(path.join(process.cwd(), '.tmp-supervisor-auto-advance-'));
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      git(['add', '.']);
      git(['commit', '-m', 'seed']);
      const paths = await nativeProjectPaths(repository, 'docs');
      await ensureNativeDirectories(paths);
      await createNativePortableChange({
        paths,
        name: 'parent',
        language: 'en',
        workspaceBinding: {
          isolation: 'current',
          changeBranch: 'main',
          targetBranch: 'main',
        },
      });
      const changeDir = nativePortableChangeDir(paths, 'parent');
      await fs.writeFile(
        path.join(changeDir, 'brief.md'),
        '# Acceptance examples\n- The integrated behavior is available.\n',
      );
      await fs.mkdir(path.join(changeDir, 'specs', 'supervisor'), { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'specs', 'supervisor', 'spec.md'),
        '# Requirement\n\nThe integrated behavior MUST be available.\n',
      );
      await fs.writeFile(
        path.join(changeDir, 'children.yaml'),
        'schema: comet.native.children.v2\nchildren:\n  - name: core\n    summary: Core behavior.\n    depends_on: []\n',
      );
      const shaped = await confirmNativePortableShape({ paths, name: 'parent' });
      const supervisor = await readNativeSupervisorState(paths, 'parent');
      expect(supervisor).not.toBeNull();
      const targetCommit = git(['rev-parse', 'main']);
      const verified = markNativeSupervisorChildVerified(supervisor!, {
        name: 'core',
        baseCommit: targetCommit,
        verifiedCommit: targetCommit,
        evidence: { summary: 'verified', checks: ['child test'] },
      });
      await writeNativeSupervisorState(
        paths,
        integrateNativeSupervisorChild(verified, {
          name: 'core',
          integrationCommit: targetCommit,
          checks: [{ name: 'integration test', status: 'passed' }],
        }),
      );
      const integrationRoot = supervisor!.integration.worktree;
      await fs.writeFile(path.join(integrationRoot, 'parent-fix.txt'), 'parent fix\n');
      execFileSync('git', ['add', 'parent-fix.txt'], { cwd: integrationRoot });
      execFileSync('git', ['commit', '-m', 'fix parent candidate'], { cwd: integrationRoot });
      await fs.writeFile(path.join(integrationRoot, 'parent-follow-up.txt'), 'follow-up\n');
      execFileSync('git', ['add', 'parent-follow-up.txt'], { cwd: integrationRoot });
      execFileSync('git', ['commit', '-m', 'fix parent follow-up'], { cwd: integrationRoot });
      const verifiedIntegrationHead = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: integrationRoot,
        encoding: 'utf8',
      }).trim();

      const advanced = await inspectNativeSupervisorParentReviewReadiness({
        paths,
        name: shaped.name,
        trigger: 'v2-integrate',
      });
      expect(advanced.parentAdvance).toMatchObject({
        advanced: false,
        parent: 'parent',
        message:
          'All Children are complete; the Supervisor parent candidate needs an independent code review before verification.',
      });
      expect(advanced.state).toMatchObject({ phase: 'build', status: 'active' });

      const reviewed = await applyNativeRunnerInput({
        paths,
        name: 'parent',
        maxVerifyFailures: 5,
        input: parseNativeRunnerInput({
          kind: 'builder-handoff',
          summary: 'Reviewed the integrated parent candidate.',
          addressed_acceptance_ids: ['A1'],
          checks: [],
          known_limits: [],
          review: {
            status: 'passed',
            summary: 'An independent reviewer inspected the integrated parent diff.',
            reviewer_execution_ref: 'parent-review-run-1',
          },
        }),
      });
      expect(reviewed.state).toMatchObject({ phase: 'verify', status: 'active' });
      expect(reviewed.state.builder_handoff?.review).toMatchObject({
        status: 'passed',
        reviewer_execution_ref: 'parent-review-run-1',
      });
      const repeated = await inspectNativeSupervisorParentReviewReadiness({
        paths,
        name: 'parent',
        trigger: 'recovery',
      });
      expect(repeated.parentAdvance.advanced).toBe(false);
      expect(repeated.state.state_version).toBe(reviewed.state.state_version);

      const check = {
        id: 'integration-root',
        name: 'Check the integrated candidate',
        executable: process.execPath,
        argv: [
          '-e',
          `require('node:assert/strict').equal(process.cwd(), ${JSON.stringify(integrationRoot)})`,
        ],
        cwdRef: '.',
        timeoutMs: 120000,
        repeatable: true,
      };
      await expect(
        applyNativeRunnerInput({
          paths,
          name: 'parent',
          maxVerifyFailures: 5,
          input: { kind: 'dispatch-verifier', checks: [] },
        }),
      ).rejects.toThrow('requires at least one check');
      const dispatched = await applyNativeRunnerInput({
        paths,
        name: 'parent',
        maxVerifyFailures: 5,
        input: { kind: 'dispatch-verifier', checks: [check] },
      });
      const location = {
        projectRoot: paths.projectRoot,
        verificationRoot: integrationRoot,
        changeDir,
        supervisorStateRef: nativeSupervisorStateFile(paths, 'parent'),
        detailsPageArgs: [
          'comet',
          'native',
          'status',
          'parent',
          '--details',
          '--json',
          '--project-root',
          paths.projectRoot,
        ],
      };
      expect(dispatched.verifierDispatch).toMatchObject(location);
      expect(dispatched.checks).toMatchObject([{ id: check.id, status: 'passed' }]);
      expect(
        await fs.readFile(path.join(changeDir, dispatched.verifierDispatch!.briefRef), 'utf8'),
      ).toContain('integrated behavior');
      expect(dispatched.verifierDispatch!.specRefs).toMatchObject([
        { ref: 'specs/supervisor/spec.md' },
      ]);

      const requested = await applyNativeRunnerInput({
        paths,
        name: 'parent',
        maxVerifyFailures: 5,
        input: {
          kind: 'verifier-response',
          response: {
            kind: 'request-checks',
            iteration: dispatched.state.loop.iteration,
            attempt: dispatched.state.loop.attempt,
            checks: [
              {
                ...check,
                id: 'integration-readme',
                argv: [
                  '-e',
                  `${check.argv[1]}; require('node:assert/strict').equal(require('node:fs').readFileSync('README.md', 'utf8').trim(), 'seed')`,
                ],
              },
            ],
          },
        },
      });
      expect(requested.checks).toMatchObject([
        { id: 'integration-root', status: 'passed' },
        { id: 'integration-readme', status: 'passed' },
      ]);
      expect(requested.verifierDispatch).toMatchObject({
        ...location,
        verifierExecutionRef: dispatched.verifierDispatch!.verifierExecutionRef,
      });
      expect(await readNativeSupervisorState(paths, 'parent')).toMatchObject({
        integration: { headCommit: targetCommit },
        finalVerification: { status: 'pending' },
      });
      expect(requested.continuation.action).toBe('await-verifier');

      const verifiedParent = await applyNativeRunnerInput({
        paths,
        name: 'parent',
        maxVerifyFailures: 5,
        input: {
          kind: 'verifier-response',
          response: {
            kind: 'final-result',
            result: {
              iteration: requested.state.loop.iteration,
              attempt: requested.state.loop.attempt,
              verdict: 'pass',
              acceptance: requested.state.acceptance.map(({ id }) => ({
                id,
                result: 'passed',
                reason: 'The integrated behavior was verified.',
              })),
              risks: [],
              summary: 'Parent integration verification passed.',
            },
          },
        },
      });
      expect(verifiedParent.state).toMatchObject({
        status: 'await-user',
        verification_result: 'pass',
      });
      expect(await readNativeSupervisorState(paths, 'parent')).toMatchObject({
        integration: { headCommit: verifiedIntegrationHead },
        finalVerification: {
          status: 'passed',
          layers: { childVerification: 'complete', parentIntegration: 'complete' },
        },
      });
      const interruptedSupervisor = (await readNativeSupervisorState(paths, 'parent'))!;
      interruptedSupervisor.integration.headCommit = targetCommit;
      interruptedSupervisor.finalVerification = { status: 'pending', summary: null };
      await writeNativeSupervisorState(paths, interruptedSupervisor);

      await fs.writeFile(path.join(integrationRoot, 'uncommitted-recovery.txt'), 'dirty\n');
      await expect(
        nativeNextCommand(['parent', '--summary', 'Resume with a dirty workspace.'], repository),
      ).rejects.toThrow('integration worktree must be clean');
      await fs.rm(path.join(integrationRoot, 'uncommitted-recovery.txt'));

      const integrationBranch = execFileSync('git', ['branch', '--show-current'], {
        cwd: integrationRoot,
        encoding: 'utf8',
      }).trim();
      execFileSync('git', ['switch', '-c', 'recovery-wrong-branch'], { cwd: integrationRoot });
      await expect(
        nativeNextCommand(['parent', '--summary', 'Resume from the wrong branch.'], repository),
      ).rejects.toThrow('integration branch mismatch');
      execFileSync('git', ['switch', integrationBranch], { cwd: integrationRoot });

      const divergentSupervisor = (await readNativeSupervisorState(paths, 'parent'))!;
      divergentSupervisor.integration.headCommit = verifiedIntegrationHead;
      await writeNativeSupervisorState(paths, divergentSupervisor);
      execFileSync('git', ['reset', '--hard', targetCommit], { cwd: integrationRoot });
      await fs.writeFile(path.join(integrationRoot, 'divergent-recovery.txt'), 'divergent\n');
      execFileSync('git', ['add', 'divergent-recovery.txt'], { cwd: integrationRoot });
      execFileSync('git', ['commit', '-m', 'create divergent recovery candidate'], {
        cwd: integrationRoot,
      });
      await expect(
        nativeNextCommand(['parent', '--summary', 'Resume a divergent workspace.'], repository),
      ).rejects.toThrow('is not a descendant of the recorded integration head');
      execFileSync('git', ['reset', '--hard', verifiedIntegrationHead], { cwd: integrationRoot });

      await writeNativeSupervisorState(paths, interruptedSupervisor);
      const resumed = await nativeNextCommand(
        ['parent', '--summary', 'Continue the interrupted workflow.'],
        repository,
      );
      expect(resumed).toMatchObject({
        exitCode: 0,
        data: {
          state: {
            phase: 'verify',
            status: 'active',
            verification_result: 'pending',
            loop: { stage: 'verify-ready', next_action: 'run-final-full-verification' },
          },
          continuation: { action: 'dispatch-verifier' },
        },
      });
      expect(await readNativeSupervisorState(paths, 'parent')).toMatchObject({
        integration: { headCommit: targetCommit },
        finalVerification: { status: 'pending' },
      });
      const redispatched = await applyNativeRunnerInput({
        paths,
        name: 'parent',
        maxVerifyFailures: 5,
        input: { kind: 'dispatch-verifier', checks: [check] },
      });
      await applyNativeRunnerInput({
        paths,
        name: 'parent',
        maxVerifyFailures: 5,
        input: {
          kind: 'verifier-response',
          response: {
            kind: 'final-result',
            result: {
              iteration: redispatched.state.loop.iteration,
              attempt: redispatched.state.loop.attempt,
              verdict: 'pass',
              acceptance: redispatched.state.acceptance.map(({ id }) => ({
                id,
                result: 'passed',
                reason: 'The integrated behavior was reverified.',
              })),
              risks: [],
              summary: 'Recovered parent integration verification passed.',
            },
          },
        },
      });
      expect(await readNativeSupervisorState(paths, 'parent')).toMatchObject({
        integration: { headCommit: verifiedIntegrationHead },
        finalVerification: { status: 'passed' },
      });
    } finally {
      try {
        execFileSync(
          'git',
          [
            'worktree',
            'remove',
            '--force',
            path.join(repository, '.worktrees', 'parent-integration'),
          ],
          {
            cwd: repository,
            stdio: 'ignore',
          },
        );
      } catch {
        // Preserve the assertion failure when setup did not reach a worktree.
      }
      await fs.rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('parses persisted coordination recovery inputs with strict run identity', () => {
    expect(
      parseNativeRunnerInput({
        kind: 'supervisor-reconnect',
        child: 'integration-core',
        runId: 'run-1',
      }),
    ).toEqual({
      kind: 'supervisor-reconnect',
      child: 'integration-core',
      runId: 'run-1',
    });
    expect(
      parseNativeRunnerInput({
        kind: 'supervisor-builder-failure',
        child: 'integration-core',
        runId: 'run-1',
        reason: 'worker exited',
      }),
    ).toEqual({
      kind: 'supervisor-builder-failure',
      child: 'integration-core',
      runId: 'run-1',
      reason: 'worker exited',
    });
    expect(() =>
      parseNativeRunnerInput({
        kind: 'supervisor-cancel',
        child: 'integration-core',
        runId: 'run-1',
        reason: '',
      }),
    ).toThrow(/reason/iu);
  });

  it('persists a multi-child coordination choice for recovery', async () => {
    const repository = await fs.mkdtemp(path.join(process.cwd(), '.tmp-supervisor-coordination-'));
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      git(['add', '.']);
      git(['commit', '-m', 'seed']);

      const paths = await nativeProjectPaths(repository, 'docs');
      await ensureNativeDirectories(paths);
      await createNativePortableChange({
        paths,
        name: 'coordinated-parent',
        language: 'en',
        workspaceBinding: {
          isolation: 'current',
          changeBranch: 'main',
          targetBranch: 'main',
        },
      });
      const changeDir = nativePortableChangeDir(paths, 'coordinated-parent');
      await fs.writeFile(
        path.join(changeDir, 'brief.md'),
        '# Acceptance examples\n- The coordinated behavior is available.\n',
      );
      await fs.writeFile(
        path.join(changeDir, 'children.yaml'),
        `schema: comet.native.children.v2
children:
  - name: core
    summary: Core behavior.
    depends_on: []
  - name: docs
    summary: Documentation behavior.
    depends_on: []
`,
      );

      const shaped = await confirmNativePortableShape({
        paths,
        name: 'coordinated-parent',
        coordinationMode: 'multi-session',
      });
      expect(shaped).toMatchObject({
        phase: 'build',
        coordination_mode: 'multi-session',
      });
      await expect(readNativePortableChange(paths, 'coordinated-parent')).resolves.toMatchObject({
        coordination_mode: 'multi-session',
      });
      await expect(
        inspectNativePortableStatus({ paths, name: 'coordinated-parent' }),
      ).resolves.toMatchObject({
        coordinationMode: 'multi-session',
        continuation: { action: 'advance-children' },
      });

      const reshaped = await returnNativePortableChangeToShape({
        paths,
        name: 'coordinated-parent',
        reason: 'The confirmed requirements changed.',
      });
      expect(reshaped.coordination_mode).toBe('multi-session');
      const reconfirmed = await confirmNativePortableShape({
        paths,
        name: 'coordinated-parent',
      });
      expect(reconfirmed).toMatchObject({
        phase: 'build',
        coordination_mode: 'multi-session',
      });
    } finally {
      try {
        execFileSync(
          'git',
          [
            'worktree',
            'remove',
            '--force',
            path.join(repository, '.worktrees', 'coordinated-parent-integration'),
          ],
          { cwd: repository, stdio: 'ignore' },
        );
      } catch {
        // Preserve the assertion failure when setup did not reach a worktree.
      }
      await fs.rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
  it('keeps machine state under the central Native Runtime directory', () => {
    const paths = {
      changesRuntimeDir: 'D:/project/.comet/runtime/native/changes',
    } as { changesRuntimeDir: string };

    expect(nativeSupervisorRuntimeDir(paths, 'parent')).toBe(
      path.join('D:/project/.comet/runtime/native/changes', 'parent', 'supervisor'),
    );
    expect(nativeSupervisorStateFile(paths, 'parent')).toBe(
      path.join('D:/project/.comet/runtime/native/changes', 'parent', 'supervisor', 'state.json'),
    );
  });

  it('derives a dedicated integration branch and worktree from the parent', () => {
    expect(nativeSupervisorIntegrationBranch('parent')).toBe('comet/supervisor/parent/integration');
    expect(nativeSupervisorIntegrationWorktree('D:/project', 'parent')).toBe(
      path.join('D:/project', '.worktrees', 'parent-integration'),
    );
  });

  it('prepares a dedicated linked integration workspace from the target branch', async () => {
    const repository = await fs.mkdtemp(path.join(process.cwd(), '.tmp-supervisor-repo-'));
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' });
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await fs.mkdir(path.join(repository, 'docs'), { recursive: true });
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      await writeProjectConfig(repository, config);
      git(['add', '.']);
      git(['commit', '-m', 'seed']);

      const prepared = await prepareNativeSupervisorIntegrationWorkspace({
        projectRoot: repository,
        parent: 'parent',
        targetBranch: 'main',
        sourceConfig: config,
      });
      expect(prepared.binding).toMatchObject({
        isolation: 'worktree',
        changeBranch: 'comet/supervisor/parent/integration',
        targetBranch: 'main',
      });
      expect(prepared.projectRoot).toBe(nativeSupervisorIntegrationWorktree(repository, 'parent'));
      expect(
        git(['show-ref', '--verify', 'refs/heads/comet/supervisor/parent/integration']),
      ).toBeTruthy();
      const paths = await nativeProjectPaths(repository, 'docs');
      const rebuilt = await rebuildNativeSupervisorStateFromFacts({
        paths,
        parent: 'parent',
        targetBranch: 'main',
        contract: CONTRACT,
      });
      expect(rebuilt?.integration.headCommit).toBe(git(['rev-parse', 'main']).trim());
      expect(rebuilt?.children[0]).toMatchObject({ name: 'integration-core', status: 'ready' });
      await fs.writeFile(path.join(prepared.projectRoot, 'integration-only.txt'), 'change\n');
      execFileSync('git', ['add', '.'], { cwd: prepared.projectRoot });
      execFileSync('git', ['commit', '-m', 'integration-only'], { cwd: prepared.projectRoot });
      const rebuiltAfterProgress = await rebuildNativeSupervisorStateFromFacts({
        paths,
        parent: 'parent',
        targetBranch: 'main',
        contract: CONTRACT,
      });
      expect(rebuiltAfterProgress?.children[0]).toMatchObject({
        status: 'blocked',
        blocker: expect.stringContaining('Runtime was lost'),
      });
      const childPrepared = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'integration-core',
        targetBranch: 'comet/supervisor/parent/integration',
        sourceConfig: config,
      });
      expect(childPrepared.binding).toMatchObject({
        isolation: 'worktree',
        targetBranch: 'comet/supervisor/parent/integration',
      });
      expect(childPrepared.projectRoot).toBe(
        path.join(repository, '.worktrees', 'parent-integration-core'),
      );
    } finally {
      try {
        execFileSync(
          'git',
          [
            'worktree',
            'remove',
            '--force',
            path.join(repository, '.worktrees', 'parent-integration-core'),
          ],
          { cwd: repository, stdio: 'ignore' },
        );
      } catch {
        // Preserve the useful assertion failure.
      }
      try {
        execFileSync(
          'git',
          [
            'worktree',
            'remove',
            '--force',
            path.join(repository, '.worktrees', 'parent-integration'),
          ],
          {
            cwd: repository,
            stdio: 'ignore',
          },
        );
      } catch {
        // The assertion remains the useful failure if setup did not reach a worktree.
      }
      await fs.rm(repository, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

  it('creates a ready frontier from a v2 dependency graph', () => {
    const state = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'beta20',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: 'D:/worktrees/parent-integration',
      contract: CONTRACT,
    });

    expect(state).toMatchObject({
      schema: 'comet.native.supervisor.v2',
      parent: 'parent',
      integration: {
        branch: 'comet/supervisor/parent/integration',
        worktree: 'D:/worktrees/parent-integration',
        targetBranch: 'beta20',
        targetCommit: 'a'.repeat(40),
      },
      children: [
        { name: 'integration-core', status: 'ready', dependsOn: [] },
        { name: 'dashboard', status: 'pending', dependsOn: ['integration-core'] },
      ],
    });
  });

  it('persists supervisor state only in the central runtime', async () => {
    const root = await fs.mkdtemp(path.join(process.cwd(), '.tmp-supervisor-'));
    try {
      const paths = { changesRuntimeDir: path.join(root, 'changes') } as {
        changesRuntimeDir: string;
      };
      const state = createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'beta20',
        targetCommit: 'a'.repeat(40),
        integrationBranch: 'comet/supervisor/parent/integration',
        integrationWorktree: 'D:/worktrees/parent-integration',
        contract: CONTRACT,
      });

      await writeNativeSupervisorState(paths, state);

      await expect(readNativeSupervisorState(paths, 'parent')).resolves.toEqual(state);
      await expect(fs.stat(nativeSupervisorStateFile(paths, 'parent'))).resolves.toMatchObject({
        isFile: expect.any(Function),
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('requires the verified commit and evidence before marking a child verified', () => {
    const state = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'beta20',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: 'D:/worktrees/parent-integration',
      contract: CONTRACT,
    });

    expect(() =>
      markNativeSupervisorChildVerified(state, {
        name: 'dashboard',
        baseCommit: 'b'.repeat(40),
        verifiedCommit: 'c'.repeat(40),
        evidence: { summary: 'passed', checks: ['native test'] },
      }),
    ).toThrow(/not ready|dependency/iu);

    const ready = markNativeSupervisorChildVerified(state, {
      name: 'integration-core',
      baseCommit: 'a'.repeat(40),
      verifiedCommit: 'b'.repeat(40),
      evidence: { summary: 'passed', checks: ['native test'] },
    });
    expect(ready.children[0]).toMatchObject({
      name: 'integration-core',
      status: 'verified',
      baseCommit: 'a'.repeat(40),
      verifiedCommit: 'b'.repeat(40),
    });
  });

  it('integrates only a verified child and unlocks its dependents', () => {
    const state = markNativeSupervisorChildVerified(
      createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'beta20',
        targetCommit: 'a'.repeat(40),
        integrationBranch: 'comet/supervisor/parent/integration',
        integrationWorktree: 'D:/worktrees/parent-integration',
        contract: CONTRACT,
      }),
      {
        name: 'integration-core',
        baseCommit: 'a'.repeat(40),
        verifiedCommit: 'b'.repeat(40),
        evidence: { summary: 'passed', checks: ['native test'] },
      },
    );

    const integrated = integrateNativeSupervisorChild(state, {
      name: 'integration-core',
      integrationCommit: 'c'.repeat(40),
      checks: [{ name: 'native test', status: 'passed' }],
    });

    expect(integrated.children).toEqual([
      expect.objectContaining({ name: 'integration-core', status: 'integrated' }),
      expect.objectContaining({ name: 'dashboard', status: 'ready' }),
    ]);
    expect(integrated.integration.headCommit).toBe('c'.repeat(40));
  });

  it('projects compact child status without exposing acceptance ownership', () => {
    const state = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'beta20',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: 'D:/worktrees/parent-integration',
      contract: CONTRACT,
    });

    expect(projectNativeSupervisorChildren(state)).toMatchObject({
      readyChildren: ['integration-core'],
      allDone: false,
      children: [
        {
          name: 'integration-core',
          summary: 'Owns the parent integration branch.',
          status: 'ready',
          covers: [],
        },
        { name: 'dashboard', status: 'pending', covers: [] },
      ],
    });
  });

  it('creates one task package per child and binds the builder to the integration base', () => {
    const state = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'beta20',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: 'D:/worktrees/parent-integration',
      contract: CONTRACT,
    });

    const dispatched = createNativeSupervisorTask(state, {
      role: 'builder',
      child: 'integration-core',
      projectRoot: 'D:/worktrees/integration-core',
      runId: 'run-1',
    });

    expect(dispatched.task).toEqual({
      role: 'builder',
      child: 'integration-core',
      projectRoot: 'D:/worktrees/integration-core',
      baseCommit: 'a'.repeat(40),
      runId: 'run-1',
    });
    expect(dispatched.state.children[0]).toMatchObject({ status: 'active' });
    expect(() =>
      createNativeSupervisorTask(dispatched.state, {
        role: 'builder',
        child: 'integration-core',
        projectRoot: 'D:/worktrees/integration-core',
        runId: 'run-2',
      }),
    ).toThrow(/active task/iu);
  });

  it('requires the current runId before accepting Builder and Verifier results', () => {
    const state = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'beta20',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: 'D:/worktrees/parent-integration',
      contract: CONTRACT,
    });
    const builder = createNativeSupervisorTask(state, {
      role: 'builder',
      child: 'integration-core',
      projectRoot: 'D:/worktrees/integration-core',
      runId: 'builder-run',
    });
    expect(() =>
      applyNativeSupervisorBuilderResult(builder.state, {
        child: 'integration-core',
        runId: 'old-run',
        candidateCommit: 'b'.repeat(40),
      }),
    ).toThrow(/runId/iu);

    const candidate = applyNativeSupervisorBuilderResult(builder.state, {
      child: 'integration-core',
      runId: 'builder-run',
      candidateCommit: 'b'.repeat(40),
    });
    const verifier = createNativeSupervisorTask(candidate, {
      role: 'verifier',
      child: 'integration-core',
      projectRoot: 'D:/worktrees/integration-core',
      runId: 'verifier-run',
    });
    const verified = applyNativeSupervisorVerifierResult(verifier.state, {
      child: 'integration-core',
      runId: 'verifier-run',
      verdict: 'pass',
      evidence: { summary: 'verified', checks: ['native test'] },
    });
    expect(verified.children[0]).toMatchObject({
      status: 'verified',
      candidateCommit: 'b'.repeat(40),
      verifiedCommit: 'b'.repeat(40),
      task: null,
    });
  });

  it('reconnects the current task and requires cancellation before redispatch', () => {
    const state = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'beta20',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: 'D:/worktrees/parent-integration',
      contract: CONTRACT,
    });
    const dispatched = createNativeSupervisorTask(state, {
      role: 'builder',
      child: 'integration-core',
      projectRoot: 'D:/worktrees/integration-core',
      runId: 'run-1',
    });
    expect(
      reconnectNativeSupervisorTask(dispatched.state, {
        child: 'integration-core',
        runId: 'run-1',
      }),
    ).toEqual(dispatched.task);
    expect(() =>
      reconnectNativeSupervisorTask(dispatched.state, {
        child: 'integration-core',
        runId: 'stale-run',
      }),
    ).toThrow(/runId/iu);
    const cancelled = cancelNativeSupervisorTask(dispatched.state, {
      child: 'integration-core',
      runId: 'run-1',
      reason: 'worker exited',
    });
    expect(cancelled.children[0]).toMatchObject({
      status: 'ready',
      task: null,
      blocker: 'worker exited',
    });
    expect(cancelled.history.at(-1)).toMatchObject({
      kind: 'task-cancelled',
      runId: 'run-1',
    });
    const reconnected = reconnectNativeSupervisorTaskWithState(dispatched.state, {
      child: 'integration-core',
      runId: 'run-1',
    });
    expect(reconnected.task).toEqual(dispatched.task);
    expect(reconnected.state.history.at(-1)).toMatchObject({
      kind: 'task-reconnected',
      runId: 'run-1',
    });
  });

  it('allows a failed verifier candidate to be re-verified without rebuilding it', () => {
    const initial = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'beta20',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: 'D:/worktrees/parent-integration',
      contract: parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Core integration.
    depends_on: []
`),
    });
    const builder = createNativeSupervisorTask(initial, {
      role: 'builder',
      child: 'integration-core',
      projectRoot: 'D:/worktrees/integration-core',
      runId: 'builder-run',
    });
    const candidate = applyNativeSupervisorBuilderResult(builder.state, {
      child: 'integration-core',
      runId: 'builder-run',
      candidateCommit: 'b'.repeat(40),
    });
    const verifier = createNativeSupervisorTask(candidate, {
      role: 'verifier',
      child: 'integration-core',
      projectRoot: 'D:/worktrees/integration-core',
      runId: 'verifier-run',
    });
    const failed = applyNativeSupervisorVerifierResult(verifier.state, {
      child: 'integration-core',
      runId: 'verifier-run',
      verdict: 'incomplete',
      evidence: { summary: 'environment unavailable', checks: [] },
    });
    expect(failed.children[0]).toMatchObject({
      status: 'needs-reverify',
      candidateCommit: 'b'.repeat(40),
      task: null,
    });
    const retry = createNativeSupervisorTask(failed, {
      role: 'verifier',
      child: 'integration-core',
      projectRoot: 'D:/worktrees/integration-core',
      runId: 'verifier-retry',
    });
    expect(retry.task).toMatchObject({
      role: 'verifier',
      baseCommit: 'b'.repeat(40),
      runId: 'verifier-retry',
    });
    const reverified = applyNativeSupervisorVerifierResult(retry.state, {
      child: 'integration-core',
      runId: 'verifier-retry',
      verdict: 'pass',
      evidence: { summary: 'verified after retry', checks: ['native test'] },
    });
    expect(reverified.children[0]).toMatchObject({
      status: 'verified',
      verifiedCommit: 'b'.repeat(40),
      task: null,
    });
    const cancelledVerifier = cancelNativeSupervisorTask(verifier.state, {
      child: 'integration-core',
      runId: 'verifier-run',
      reason: 'verifier disconnected',
    });
    expect(cancelledVerifier.children[0]).toMatchObject({
      status: 'needs-reverify',
      candidateCommit: 'b'.repeat(40),
      task: null,
    });
  });

  it('refreshes a reused Builder worktree to the current integration base', async () => {
    const repository = await fs.mkdtemp(path.join(process.cwd(), '.tmp-supervisor-dispatch-'));
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      git(['add', '.']);
      git(['commit', '-m', 'seed']);
      const prepared = await prepareNativeSupervisorIntegrationWorkspace({
        projectRoot: repository,
        parent: 'parent',
        targetBranch: 'main',
        sourceConfig: config,
      });
      const childPrepared = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'integration-core',
        targetBranch: prepared.binding.changeBranch!,
        sourceConfig: config,
      });
      const paths = await nativeProjectPaths(repository, 'docs');
      const state = createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'main',
        targetCommit: git(['rev-parse', 'main']),
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        contract: parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Core integration.
    depends_on: []
`),
      });
      await fs.writeFile(path.join(prepared.projectRoot, 'integration.txt'), 'integrated\n');
      execFileSync('git', ['add', '.'], { cwd: prepared.projectRoot });
      execFileSync('git', ['commit', '-m', 'advance integration'], {
        cwd: prepared.projectRoot,
      });
      state.integration.headCommit = git([
        '--git-dir',
        path.join(repository, '.git'),
        'rev-parse',
        prepared.binding.changeBranch!,
      ]);
      await writeNativeSupervisorState(paths, state);

      const dispatched = await dispatchNativeSupervisorReadyTasks({
        paths,
        parent: 'parent',
        maxParallel: 1,
      });
      expect(dispatched.tasks[0]).toMatchObject({
        role: 'builder',
        baseCommit: state.integration.headCommit,
      });
      expect(git(['rev-parse', '--verify', `comet/supervisor/parent/integration-core`])).toBe(
        state.integration.headCommit,
      );
      expect(git(['rev-parse', '--git-dir'])).toBe('.git');
      expect(
        execFileSync('git', ['rev-parse', 'HEAD'], {
          cwd: childPrepared.projectRoot,
          encoding: 'utf8',
        }).trim(),
      ).toBe(state.integration.headCommit);
    } finally {
      for (const worktree of [
        path.join(repository, '.worktrees', 'parent-integration-core'),
        path.join(repository, '.worktrees', 'parent-integration'),
      ]) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktree], {
            cwd: repository,
            stdio: 'ignore',
          });
        } catch {
          // Preserve the assertion failure when setup did not reach a worktree.
        }
      }
      await fs.rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('serially merges a verified commit into integration while protecting target', async () => {
    const repository = await fs.mkdtemp(path.join(process.cwd(), '.tmp-supervisor-merge-'));
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      git(['add', '.']);
      git(['commit', '-m', 'seed']);
      const targetCommit = git(['rev-parse', 'main']);
      const prepared = await prepareNativeSupervisorIntegrationWorkspace({
        projectRoot: repository,
        parent: 'parent',
        targetBranch: 'main',
        sourceConfig: config,
      });
      const childPrepared = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'integration-core',
        targetBranch: prepared.binding.changeBranch!,
        sourceConfig: config,
      });
      await fs.writeFile(path.join(childPrepared.projectRoot, 'feature.txt'), 'feature\n');
      execFileSync('git', ['add', '.'], { cwd: childPrepared.projectRoot });
      execFileSync('git', ['commit', '-m', 'child'], { cwd: childPrepared.projectRoot });
      const candidateCommit = git([
        '--git-dir',
        path.join(repository, '.git'),
        'rev-parse',
        'comet/supervisor/parent/integration-core',
      ]);
      const state = createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'main',
        targetCommit,
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        contract: CONTRACT,
      });
      const candidate = applyNativeSupervisorBuilderResult(
        createNativeSupervisorTask(state, {
          role: 'builder',
          child: 'integration-core',
          projectRoot: childPrepared.projectRoot,
          runId: 'builder-run',
        }).state,
        { child: 'integration-core', runId: 'builder-run', candidateCommit },
      );
      const withVerifier = createNativeSupervisorTask(candidate, {
        role: 'verifier',
        child: 'integration-core',
        projectRoot: childPrepared.projectRoot,
        runId: 'verifier-run',
      }).state;
      const verified = applyNativeSupervisorVerifierResult(withVerifier, {
        child: 'integration-core',
        runId: 'verifier-run',
        verdict: 'pass',
        evidence: { summary: 'verified', checks: ['child test'] },
      });
      // Simulate a process interruption after Git created the merge commit but
      // before the Supervisor state write. Recovery must reconcile the Git fact.
      execFileSync('git', ['merge', '--no-ff', '--no-edit', candidateCommit], {
        cwd: prepared.projectRoot,
        stdio: 'ignore',
      });
      const paths = await nativeProjectPaths(repository, 'docs');
      const integrated = await integrateNativeSupervisorChildWorkspace({
        paths,
        state: verified,
        name: 'integration-core',
        checks: [{ name: 'child test', status: 'passed' }],
      });
      expect(integrated.children[0]).toMatchObject({
        status: 'integrated',
        integrationCommit: expect.stringMatching(/^[a-f0-9]{40}$/u),
      });
      expect(git(['rev-parse', 'main'])).toBe(targetCommit);
      expect(git(['rev-parse', prepared.binding.changeBranch!])).toBe(
        integrated.integration.headCommit,
      );
    } finally {
      for (const worktree of [
        path.join(repository, '.worktrees', 'parent-integration-core'),
        path.join(repository, '.worktrees', 'parent-integration'),
      ]) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktree], {
            cwd: repository,
            stdio: 'ignore',
          });
        } catch {
          // Preserve the assertion failure when setup did not reach a worktree.
        }
      }
      await fs.rm(repository, { recursive: true, force: true });
    }
  });

  it('integrates a dependency before a non-topological declaration and keeps the order stable', async () => {
    const repository = await fs.mkdtemp(path.join(process.cwd(), '.tmp-supervisor-order-'));
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      git(['add', '.']);
      git(['commit', '-m', 'seed']);
      const targetCommit = git(['rev-parse', 'main']);
      const prepared = await prepareNativeSupervisorIntegrationWorkspace({
        projectRoot: repository,
        parent: 'parent',
        targetBranch: 'main',
        sourceConfig: config,
      });
      const upstream = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'upstream',
        targetBranch: prepared.binding.changeBranch!,
        sourceConfig: config,
      });
      await fs.writeFile(path.join(upstream.projectRoot, 'upstream.txt'), 'upstream\n');
      execFileSync('git', ['add', '.'], { cwd: upstream.projectRoot });
      execFileSync('git', ['commit', '-m', 'upstream'], { cwd: upstream.projectRoot });
      const candidateCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: upstream.projectRoot,
        encoding: 'utf8',
      }).trim();
      const contract = parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: downstream
    summary: Depends on upstream.
    depends_on: [upstream]
  - name: upstream
    summary: Independent implementation.
    depends_on: []
`);
      const state = createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'main',
        targetCommit,
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        contract,
      });
      const verified = markNativeSupervisorChildVerified(state, {
        name: 'upstream',
        baseCommit: targetCommit,
        verifiedCommit: candidateCommit,
        evidence: { summary: 'upstream verified', checks: ['child test'] },
      });
      const paths = await nativeProjectPaths(repository, 'docs');
      await writeNativeSupervisorState(paths, verified);
      const integrated = await integrateNativeSupervisorChildWorkspace({
        paths,
        state: verified,
        name: 'upstream',
        checks: [{ name: 'integration test', status: 'passed' }],
      });
      expect(integrated.children.find(({ name }) => name === 'upstream')).toMatchObject({
        status: 'integrated',
        integrationCommit: expect.stringMatching(/^[a-f0-9]{40}$/u),
      });
      expect(integrated.children.find(({ name }) => name === 'downstream')?.status).toBe('ready');
    } finally {
      for (const worktree of [
        path.join(repository, '.worktrees', 'parent-upstream'),
        path.join(repository, '.worktrees', 'parent-integration'),
      ]) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktree], {
            cwd: repository,
            stdio: 'ignore',
          });
        } catch {
          // Preserve the assertion failure when setup did not reach a worktree.
        }
      }
      await fs.rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('delivers a fully verified integration branch once and archives children together', async () => {
    const repository = await fs.mkdtemp(path.join(process.cwd(), '.tmp-supervisor-delivery-'));
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      await fs.writeFile(path.join(repository, '.gitignore'), '.comet/runtime/\n');
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      git(['add', '.']);
      git(['commit', '-m', 'seed']);
      const targetCommit = git(['rev-parse', 'main']);
      const prepared = await prepareNativeSupervisorIntegrationWorkspace({
        projectRoot: repository,
        parent: 'parent',
        targetBranch: 'main',
        sourceConfig: config,
      });
      const childPrepared = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'integration-core',
        targetBranch: prepared.binding.changeBranch!,
        sourceConfig: config,
      });
      const contract = parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Owns the integrated result.
    depends_on: []
`);
      const initial = createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'main',
        targetCommit,
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        contract,
      });
      const verified = markNativeSupervisorChildVerified(initial, {
        name: 'integration-core',
        baseCommit: targetCommit,
        verifiedCommit: targetCommit,
        evidence: { summary: 'verified', checks: ['child test'] },
      });
      await fs.writeFile(path.join(prepared.projectRoot, 'feature.txt'), 'feature\n');
      execFileSync('git', ['add', '.'], { cwd: prepared.projectRoot });
      execFileSync('git', ['commit', '-m', 'integrated feature'], {
        cwd: prepared.projectRoot,
      });
      const integrationCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: prepared.projectRoot,
        encoding: 'utf8',
      }).trim();
      const integrated = integrateNativeSupervisorChild(verified, {
        name: 'integration-core',
        integrationCommit,
        checks: [{ name: 'integration test', status: 'passed' }],
      });
      const finalVerified = recordNativeSupervisorFinalVerification(integrated, {
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
      const paths = await nativeProjectPaths(repository, 'docs');
      await fs.writeFile(path.join(repository, 'target-update.txt'), 'target moved\n');
      execFileSync('git', ['add', '.'], { cwd: repository });
      execFileSync('git', ['commit', '-m', 'target moved'], { cwd: repository });
      await expect(
        finalizeNativeSupervisorDelivery({ paths, state: finalVerified }),
      ).rejects.toThrow(/target changed|rerun/i);
      const refreshed = await readNativeSupervisorState(paths, 'parent');
      expect(refreshed).toMatchObject({
        finalVerification: { status: 'pending' },
      });
      const reverified = recordNativeSupervisorFinalVerification(refreshed!, {
        status: 'passed',
        summary: 'parent checks rerun after target refresh',
        headCommit: refreshed!.integration.headCommit,
        layers: {
          childVerification: 'complete',
          parentIntegration: 'complete',
          parentChecks: ['parent test'],
          notRerun: ['child test'],
          incomplete: [],
        },
      });
      await writeNativeSupervisorState(paths, reverified);
      const expectedChildBranch = 'comet/supervisor/parent/integration-core';
      const targetBeforeDelivery = git(['rev-parse', 'main']);
      execFileSync('git', ['switch', '-c', 'comet/supervisor/parent/unrelated'], {
        cwd: childPrepared.projectRoot,
        stdio: 'ignore',
      });
      await expect(finalizeNativeSupervisorDelivery({ paths, state: reverified })).rejects.toThrow(
        /unexpected branch/iu,
      );
      expect(git(['rev-parse', 'main'])).toBe(targetBeforeDelivery);
      execFileSync('git', ['switch', expectedChildBranch], {
        cwd: childPrepared.projectRoot,
        stdio: 'ignore',
      });
      const delivered = await finalizeNativeSupervisorDelivery({ paths, state: reverified });
      expect(delivered.state.children[0]).toMatchObject({ status: 'archived' });
      expect(delivered.state.integration.headCommit).toBe(reverified.integration.headCommit);
      expect(git(['rev-parse', 'main'])).toBe(reverified.integration.headCommit);
      const redelivered = await finalizeNativeSupervisorDelivery({
        paths,
        state: delivered.state,
      });
      expect(redelivered.state.children[0]).toMatchObject({ status: 'archived' });
      expect(git(['rev-parse', 'main'])).toBe(reverified.integration.headCommit);
    } finally {
      try {
        for (const worktree of [
          path.join(repository, '.worktrees', 'parent-integration'),
          path.join(repository, '.worktrees', 'parent-integration-core'),
        ]) {
          try {
            execFileSync('git', ['worktree', 'remove', '--force', worktree], {
              cwd: repository,
              stdio: 'ignore',
            });
          } catch {
            // Preserve the assertion failure when setup did not reach a worktree.
          }
        }
      } catch {
        // Preserve the assertion failure when setup did not reach a worktree.
      }
      await fs.rm(repository, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    }
  });

  it('persists blockers when every ready child workspace fails preparation', async () => {
    const repository = await fs.mkdtemp(
      path.join(process.cwd(), '.tmp-supervisor-dispatch-blocker-'),
    );
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      git(['add', '.']);
      git(['commit', '-m', 'seed']);
      const targetCommit = git(['rev-parse', 'main']);
      const prepared = await prepareNativeSupervisorIntegrationWorkspace({
        projectRoot: repository,
        parent: 'parent',
        targetBranch: 'main',
        sourceConfig: config,
      });
      const child = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'core',
        targetBranch: prepared.binding.changeBranch!,
        sourceConfig: config,
      });
      await fs.writeFile(path.join(child.projectRoot, 'uncommitted.txt'), 'block dispatch\n');
      const state = createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'main',
        targetCommit,
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        contract: parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: core
    summary: Core implementation.
    depends_on: []
`),
      });
      const paths = await nativeProjectPaths(repository, 'docs');
      await writeNativeSupervisorState(paths, state);
      const dispatched = await dispatchNativeSupervisorReadyTasks({
        paths,
        parent: 'parent',
        maxParallel: 1,
      });
      expect(dispatched.tasks).toHaveLength(0);
      expect(dispatched.state.stateVersion).toBeGreaterThan(state.stateVersion);
      expect(dispatched.state.children[0]).toMatchObject({
        status: 'ready',
        blocker: expect.stringMatching(/not clean|worktree/iu),
        task: null,
      });
      expect((await readNativeSupervisorState(paths, 'parent'))?.children[0]).toMatchObject({
        blocker: dispatched.state.children[0].blocker,
      });
    } finally {
      for (const worktree of [
        path.join(repository, '.worktrees', 'parent-core'),
        path.join(repository, '.worktrees', 'parent-integration'),
      ]) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktree], {
            cwd: repository,
            stdio: 'ignore',
          });
        } catch {
          // Preserve the assertion failure when setup did not reach a worktree.
        }
      }
      await fs.rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('persists a blocker when reconnecting a diverged Builder worktree', async () => {
    const repository = await fs.mkdtemp(
      path.join(process.cwd(), '.tmp-supervisor-reconnect-builder-'),
    );
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      git(['add', '.']);
      git(['commit', '-m', 'seed']);
      const targetCommit = git(['rev-parse', 'main']);
      const prepared = await prepareNativeSupervisorIntegrationWorkspace({
        projectRoot: repository,
        parent: 'parent',
        targetBranch: 'main',
        sourceConfig: config,
      });
      const child = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'core',
        targetBranch: prepared.binding.changeBranch!,
        sourceConfig: config,
      });
      const state = createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'main',
        targetCommit,
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        contract: parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: core
    summary: Core implementation.
    depends_on: []
`),
      });
      const dispatched = createNativeSupervisorTask(state, {
        role: 'builder',
        child: 'core',
        projectRoot: child.projectRoot,
        runId: 'builder-run',
      });
      const paths = await nativeProjectPaths(repository, 'docs');
      await ensureNativeDirectories(paths);
      await createNativePortableChange({ paths, name: 'parent', language: 'en' });
      await writeNativeSupervisorState(paths, dispatched.state);
      execFileSync('git', ['checkout', '--orphan', 'unrelated'], { cwd: child.projectRoot });
      execFileSync('git', ['rm', '-rf', '.'], { cwd: child.projectRoot, stdio: 'ignore' });
      await fs.writeFile(path.join(child.projectRoot, 'unrelated.txt'), 'unrelated\n');
      execFileSync('git', ['add', '.'], { cwd: child.projectRoot });
      execFileSync('git', ['commit', '-m', 'unrelated'], { cwd: child.projectRoot });
      execFileSync('git', ['branch', '-M', 'comet/supervisor/parent/core'], {
        cwd: child.projectRoot,
      });

      await expect(
        applyNativeRunnerInput({
          paths,
          name: 'parent',
          input: { kind: 'supervisor-reconnect', child: 'core', runId: 'builder-run' },
          maxVerifyFailures: 5,
        }),
      ).rejects.toThrow(/base commit is not an ancestor/iu);
      const blocked = await readNativeSupervisorState(paths, 'parent');
      expect(blocked?.children[0]).toMatchObject({
        blocker: expect.stringMatching(/base commit is not an ancestor/iu),
        task: { role: 'builder', runId: 'builder-run' },
      });
    } finally {
      for (const worktree of [
        path.join(repository, '.worktrees', 'parent-core'),
        path.join(repository, '.worktrees', 'parent-integration'),
      ]) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktree], {
            cwd: repository,
            stdio: 'ignore',
          });
        } catch {
          // Preserve the assertion failure when setup did not reach a worktree.
        }
      }
      await fs.rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('persists a blocker when reconnecting a dirty Verifier worktree', async () => {
    const repository = await fs.mkdtemp(
      path.join(process.cwd(), '.tmp-supervisor-reconnect-verifier-'),
    );
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      git(['add', '.']);
      git(['commit', '-m', 'seed']);
      const targetCommit = git(['rev-parse', 'main']);
      const prepared = await prepareNativeSupervisorIntegrationWorkspace({
        projectRoot: repository,
        parent: 'parent',
        targetBranch: 'main',
        sourceConfig: config,
      });
      const child = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'core',
        targetBranch: prepared.binding.changeBranch!,
        sourceConfig: config,
      });
      await fs.writeFile(path.join(child.projectRoot, 'candidate.txt'), 'candidate\n');
      execFileSync('git', ['add', '.'], { cwd: child.projectRoot });
      execFileSync('git', ['commit', '-m', 'candidate'], { cwd: child.projectRoot });
      const candidateCommit = git([
        '--git-dir',
        path.join(repository, '.git'),
        'rev-parse',
        'comet/supervisor/parent/core',
      ]);
      const state = createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'main',
        targetCommit,
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        contract: parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: core
    summary: Core implementation.
    depends_on: []
`),
      });
      const builder = createNativeSupervisorTask(state, {
        role: 'builder',
        child: 'core',
        projectRoot: child.projectRoot,
        runId: 'builder-run',
      });
      const candidate = applyNativeSupervisorBuilderResult(builder.state, {
        child: 'core',
        runId: 'builder-run',
        candidateCommit,
      });
      const verifier = createNativeSupervisorTask(candidate, {
        role: 'verifier',
        child: 'core',
        projectRoot: child.projectRoot,
        runId: 'verifier-run',
      });
      const paths = await nativeProjectPaths(repository, 'docs');
      await ensureNativeDirectories(paths);
      await createNativePortableChange({ paths, name: 'parent', language: 'en' });
      await writeNativeSupervisorState(paths, verifier.state);
      await fs.writeFile(path.join(child.projectRoot, 'dirty.txt'), 'dirty\n');

      await expect(
        applyNativeRunnerInput({
          paths,
          name: 'parent',
          input: { kind: 'supervisor-reconnect', child: 'core', runId: 'verifier-run' },
          maxVerifyFailures: 5,
        }),
      ).rejects.toThrow(/Verifier task worktree is not at its candidate commit/iu);
      const blocked = await readNativeSupervisorState(paths, 'parent');
      expect(blocked?.children[0]).toMatchObject({
        blocker: expect.stringMatching(/Verifier task worktree is not at its candidate commit/iu),
        task: { role: 'verifier', runId: 'verifier-run', baseCommit: candidateCommit },
      });
    } finally {
      for (const worktree of [
        path.join(repository, '.worktrees', 'parent-core'),
        path.join(repository, '.worktrees', 'parent-integration'),
      ]) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktree], {
            cwd: repository,
            stdio: 'ignore',
          });
        } catch {
          // Preserve the assertion failure when setup did not reach a worktree.
        }
      }
      await fs.rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('preflights every cleanup target and preserves integrated state on a blocker', async () => {
    const repository = await fs.mkdtemp(path.join(process.cwd(), '.tmp-supervisor-cleanup-'));
    try {
      const git = (args: string[]) =>
        execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
      git(['init', '-b', 'main']);
      git(['config', 'user.email', 'native@example.test']);
      git(['config', 'user.name', 'Native Test']);
      const config = defaultProjectConfig('docs', 'en');
      config.workflows = ['native'];
      config.default_workflow = 'native';
      await writeProjectConfig(repository, config);
      await fs.writeFile(path.join(repository, 'README.md'), 'seed\n');
      git(['add', '.']);
      git(['commit', '-m', 'seed']);
      const targetCommit = git(['rev-parse', 'main']);
      const prepared = await prepareNativeSupervisorIntegrationWorkspace({
        projectRoot: repository,
        parent: 'parent',
        targetBranch: 'main',
        sourceConfig: config,
      });
      const core = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'integration-core',
        targetBranch: prepared.binding.changeBranch!,
        sourceConfig: config,
      });
      const dashboard = await prepareNativeSupervisorChildWorkspace({
        projectRoot: repository,
        parent: 'parent',
        child: 'dashboard',
        targetBranch: prepared.binding.changeBranch!,
        sourceConfig: config,
      });
      await fs.writeFile(path.join(prepared.projectRoot, 'integrated.txt'), 'done\n');
      execFileSync('git', ['add', '.'], { cwd: prepared.projectRoot });
      execFileSync('git', ['commit', '-m', 'integrated'], { cwd: prepared.projectRoot });
      const integrationCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: prepared.projectRoot,
        encoding: 'utf8',
      }).trim();
      const contract = parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Core integration.
    depends_on: []
  - name: dashboard
    summary: Dashboard integration.
    depends_on: []
`);
      let state = createNativeSupervisorState({
        parent: 'parent',
        targetBranch: 'main',
        targetCommit,
        integrationBranch: prepared.binding.changeBranch!,
        integrationWorktree: prepared.projectRoot,
        contract,
      });
      for (const child of ['integration-core', 'dashboard']) {
        state = markNativeSupervisorChildVerified(state, {
          name: child,
          baseCommit: state.integration.headCommit,
          verifiedCommit: targetCommit,
          evidence: { summary: `${child} verified`, checks: ['child test'] },
        });
        state = integrateNativeSupervisorChild(state, {
          name: child,
          integrationCommit,
          checks: [{ name: 'integration test', status: 'passed' }],
        });
      }
      state = recordNativeSupervisorFinalVerification(state, {
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
      const paths = await nativeProjectPaths(repository, 'docs');
      await writeNativeSupervisorState(paths, state);
      await fs.writeFile(path.join(dashboard.projectRoot, 'uncommitted.txt'), 'keep me\n');

      await expect(finalizeNativeSupervisorDelivery({ paths, state })).rejects.toThrow(
        /clean worktree|cleanup/i,
      );
      expect(git(['rev-parse', 'main'])).toBe(targetCommit);
      await expect(fs.stat(path.join(core.projectRoot, 'README.md'))).resolves.toBeDefined();
      await expect(fs.stat(path.join(prepared.projectRoot, 'README.md'))).resolves.toBeDefined();
      await expect(
        fs.stat(path.join(dashboard.projectRoot, 'uncommitted.txt')),
      ).resolves.toBeDefined();
      expect((await readNativeSupervisorState(paths, 'parent'))?.children).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'integration-core', status: 'integrated' }),
          expect.objectContaining({ name: 'dashboard', status: 'integrated' }),
        ]),
      );
    } finally {
      for (const worktree of [
        path.join(repository, '.worktrees', 'parent-dashboard'),
        path.join(repository, '.worktrees', 'parent-integration-core'),
        path.join(repository, '.worktrees', 'parent-integration'),
      ]) {
        try {
          execFileSync('git', ['worktree', 'remove', '--force', worktree], {
            cwd: repository,
            stdio: 'ignore',
          });
        } catch {
          // Preserve the assertion failure when setup did not reach a worktree.
        }
      }
      await fs.rm(repository, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it('adds a repair child without rewriting integrated history', () => {
    const initial = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'beta20',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: 'D:/worktrees/parent-integration',
      contract: parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Core integration.
    depends_on: []
`),
    });
    const integrated = integrateNativeSupervisorChild(
      markNativeSupervisorChildVerified(initial, {
        name: 'integration-core',
        baseCommit: 'a'.repeat(40),
        verifiedCommit: 'b'.repeat(40),
        evidence: { summary: 'verified', checks: ['core'] },
      }),
      {
        name: 'integration-core',
        integrationCommit: 'c'.repeat(40),
        checks: [{ name: 'core', status: 'passed' }],
      },
    );
    const expanded = parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Core integration.
    depends_on: []
  - name: repair-core
    summary: Fixes the confirmed integration failure.
    depends_on: [integration-core]
`);
    const repaired = reconcileNativeSupervisorState({ state: integrated, contract: expanded });
    expect(repaired.children).toEqual([
      expect.objectContaining({
        name: 'integration-core',
        status: 'integrated',
        integrationCommit: 'c'.repeat(40),
      }),
      expect.objectContaining({ name: 'repair-core', status: 'ready' }),
    ]);
  });

  it('rejects a passed parent verification with no executed parent checks', () => {
    const initial = createNativeSupervisorState({
      parent: 'parent',
      targetBranch: 'beta20',
      targetCommit: 'a'.repeat(40),
      integrationBranch: 'comet/supervisor/parent/integration',
      integrationWorktree: 'D:/worktrees/parent-integration',
      contract: parseNativeChildrenContract(`
schema: comet.native.children.v2
children:
  - name: integration-core
    summary: Core integration.
    depends_on: []
`),
    });
    const integrated = integrateNativeSupervisorChild(
      markNativeSupervisorChildVerified(initial, {
        name: 'integration-core',
        baseCommit: 'a'.repeat(40),
        verifiedCommit: 'b'.repeat(40),
        evidence: { summary: 'verified', checks: ['child'] },
      }),
      {
        name: 'integration-core',
        integrationCommit: 'c'.repeat(40),
        checks: [{ name: 'integration', status: 'passed' }],
      },
    );
    expect(() =>
      recordNativeSupervisorFinalVerification(integrated, {
        status: 'passed',
        summary: 'claimed pass',
        headCommit: 'c'.repeat(40),
        layers: {
          childVerification: 'complete',
          parentIntegration: 'complete',
          parentChecks: [],
          notRerun: ['child'],
          incomplete: [],
        },
      }),
    ).toThrow(/parent.*checks/iu);
  });
});
