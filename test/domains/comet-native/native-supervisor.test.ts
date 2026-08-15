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
  prepareNativeSupervisorChildWorkspace,
  prepareNativeSupervisorIntegrationWorkspace,
  readNativeSupervisorState,
  writeNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { parseNativeChildrenContract } from '../../../domains/comet-native/native-children.js';

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
        status: 'needs-reverify',
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
      const delivered = await finalizeNativeSupervisorDelivery({ paths, state: reverified });
      expect(delivered.state.children[0]).toMatchObject({ status: 'archived' });
      expect(delivered.state.integration.headCommit).toBe(reverified.integration.headCommit);
      expect(git(['rev-parse', 'main'])).toBe(reverified.integration.headCommit);
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
          { cwd: repository, stdio: 'ignore' },
        );
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
