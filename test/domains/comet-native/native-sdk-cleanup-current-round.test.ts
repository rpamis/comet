import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { WorkflowRun } from '../../../domains/engine/runtime.js';

const virtual = vi.hoisted(() => ({
  registered: new Set<string>(),
  branches: new Map<string, string>(),
  calls: [] as string[][],
  removedConfigs: [] as string[],
  targetRoot: '',
  targetBranch: '',
  targetCommit: '',
}));
vi.mock('../../../platform/paths/git-worktree.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../platform/paths/git-worktree.js')>();
  return {
    ...original,
    listGitWorktreeRoots: () => [...virtual.registered],
    inspectGitWorktree: (root: string) => ({ currentBranch: virtual.branches.get(root) }),
    resolveGitRef: () => virtual.targetCommit,
  };
});
vi.mock('../../../platform/process/git.js', () => ({
  runGitCommand: (_root: string, args: string[]) => {
    virtual.calls.push(args);
    if (
      args[0] === 'show-ref' &&
      ![...virtual.branches.values()].includes(args.at(-1)!.replace('refs/heads/', ''))
    )
      throw new Error('virtual branch absent');
    if (args[0] === 'worktree' && args[1] === 'remove') {
      virtual.registered.delete(args[2]);
    }
    if (args[0] === 'branch' && args[1] === '-d') {
      for (const [root, branch] of virtual.branches)
        if (branch === args[2]) virtual.branches.delete(root);
    }
    return '';
  },
}));
vi.mock('../../../domains/comet-native/native-workspace-config.js', () => ({
  nativeWorkspaceIsClean: () => true,
  removeNativeWorkspaceConfig: async (root: string) => {
    virtual.removedConfigs.push(root);
  },
}));

import { nativeSdkSupervisorCleanupExecutor } from '../../../domains/comet-native/native-sdk-supervisor-cleanup.js';
import { currentNativeSdkSupervisorActions } from '../../../domains/comet-native/native-sdk-supervisor-plan.js';
let saved: WorkflowRun;
beforeAll(async () => {
  const fixture = JSON.parse(
    await fs.readFile(
      new URL('../../fixtures/native-cleanup-after-reshape.json', import.meta.url),
      'utf8',
    ),
  );
  const projectRoot = path.join(os.tmpdir(), 'comet-native-cleanup-isolated-fixture');
  const bind = (value: unknown): unknown => {
    if (typeof value === 'string' && value.startsWith('$PROJECT_ROOT'))
      return path.join(
        projectRoot,
        ...value.slice('$PROJECT_ROOT'.length).split('/').filter(Boolean),
      );
    if (Array.isArray(value)) return value.map(bind);
    if (value && typeof value === 'object')
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, bind(entry)]));
    return value;
  };
  saved = bind(fixture.run) as WorkflowRun;
});
beforeEach(() => {
  virtual.registered.clear();
  virtual.branches.clear();
  virtual.calls.length = 0;
  virtual.removedConfigs.length = 0;
  const delivered = saved.actions.find(
    (action) => action.stepId === 'supervisor.parent.deliver' && action.status === 'succeeded',
  )!.outcome!.output as { targetRoot: string; targetBranch: string; targetCommit: string };
  virtual.targetRoot = delivered.targetRoot;
  virtual.targetBranch = delivered.targetBranch;
  virtual.targetCommit = delivered.targetCommit;
  virtual.registered.add(delivered.targetRoot);
  virtual.branches.set(delivered.targetRoot, delivered.targetBranch);
  for (const action of currentNativeSdkSupervisorActions(saved).filter(
    (action) => action.stepId === 'supervisor.child.prepare' && action.status === 'succeeded',
  )) {
    const receipt = action.outcome!.output as { worktree: string; branch: string };
    virtual.registered.add(receipt.worktree);
    virtual.branches.set(receipt.worktree, receipt.branch);
  }
  const integration = saved.actions
    .filter((action) => action.stepId === 'supervisor.prepare' && action.status === 'succeeded')
    .at(-1)!.outcome!.output as { integrationWorktree: string; integrationBranch: string };
  virtual.registered.add(integration.integrationWorktree);
  virtual.branches.set(integration.integrationWorktree, integration.integrationBranch);
});
it('retires historical prepare receipts after Shape revalidation while cleaning only the seven current Children and integration', async () => {
  const run = structuredClone(saved);
  const action = run.actions.find((action) => action.id === 'comet-any-sdk:105')!;
  expect(
    run.actions.filter(
      (action) => action.stepId === 'supervisor.child.prepare' && action.status === 'succeeded',
    ).length,
  ).toBe(10);
  const originalActions = JSON.stringify(run.actions);
  const outcome = await nativeSdkSupervisorCleanupExecutor.execute(
    action,
    { requestId: 'isolated-current-round-cleanup', projectRoot: virtual.targetRoot },
    run,
  );
  expect(outcome).toMatchObject({
    status: 'succeeded',
    output: { targetBranch: '045', targetCommit: virtual.targetCommit },
  });
  expect(
    virtual.calls.filter((args) => args[0] === 'worktree' && args[1] === 'remove'),
  ).toHaveLength(8);
  expect(virtual.calls.filter((args) => args[0] === 'branch' && args[1] === '-d')).toHaveLength(8);
  expect(virtual.removedConfigs).toHaveLength(8);
  expect([...virtual.registered]).toEqual([virtual.targetRoot]);
  expect(JSON.stringify(run.actions)).toBe(originalActions);
});
it('still rejects a mismatched current prepare receipt before removing any workspace or managed config', async () => {
  const run = structuredClone(saved);
  const receipt = currentNativeSdkSupervisorActions(run).find(
    (action) => action.stepId === 'supervisor.child.prepare' && action.status === 'succeeded',
  )!.outcome!.output as { contractHash: string };
  receipt.contractHash = 'ed7b24c19f4724ffc9e5edf13f9aa803e5f1d817c0a7d5cb150eabe10fcd7fcd';
  const action = run.actions.find((action) => action.id === 'comet-any-sdk:105')!;
  await expect(
    nativeSdkSupervisorCleanupExecutor.execute(
      action,
      { requestId: 'isolated-current-round-bad-receipt', projectRoot: virtual.targetRoot },
      run,
    ),
  ).rejects.toThrow('mismatched Child receipt');
  expect(
    virtual.calls.filter((args) => args[0] === 'worktree' && args[1] === 'remove'),
  ).toHaveLength(0);
  expect(virtual.removedConfigs).toHaveLength(0);
  expect(virtual.registered.size).toBe(9);
});
