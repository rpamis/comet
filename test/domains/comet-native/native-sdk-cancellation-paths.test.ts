import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  nativeSdkChangeCancellationPaths,
  nativeSdkChangeRunPaths,
} from '../../../domains/comet-native/native-sdk-cancellation.js';
import { fingerprintDashboardFiles } from '../../../domains/dashboard/source-version.js';
import {
  createFileRuntimeStore,
  createRuntime,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import { cometCurrentSelectionFile } from '../../../domains/workflow-contract/current-selection.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function cancelledParentWithClaimedChild() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cancel-paths-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const runtime = createRuntime({
    store: createFileRuntimeStore<WorkflowRun>({
      singleWriter: true,
      rootDir: path.join(resolveWorkspaceRuntimeRootSync(root), 'sdk-runs/native'),
    }),
    workflows: [
      {
        id: 'parent',
        version: '1',
        entry: 'child',
        steps: { child: { type: 'child_workflow', workflow: { id: 'child', version: '1' } } },
      },
      {
        id: 'child',
        version: '1',
        entry: 'host',
        steps: { host: { type: 'handoff', ref: 'host' } },
      },
    ],
  });
  await registerSdkChangeOwner(root, {
    schema: COMET_CHANGE_OWNER_SCHEMA,
    workflow: 'native',
    change: 'demo',
    format: 'sdk',
    application: 'native',
    runId: 'demo',
  });
  await runtime.start({ runId: 'demo', workflow: { id: 'parent', version: '1' }, input: null });
  const advanced = await runtime.next({ runId: 'demo' });
  const childRunId = advanced.children[0].runId;
  // The child's handoff is claimed by an executor before the change is cancelled.
  const [action] = (await runtime.next({ runId: childRunId })).actions;
  await runtime.claim({
    runId: childRunId,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'host',
    sessionId: 'session',
    claimToken: 'claim-token',
  });
  await runtime.cancel({ runId: 'demo', reason: 'Stop the change' });
  const acknowledgeChildStop = () =>
    runtime.cancel({
      runId: childRunId,
      reason: 'Executor stopped',
      stoppedActions: [
        {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'claim-token',
          evidence: 'The executor exited.',
        },
      ],
    });
  return { root, runtime, childRunId, acknowledgeChildStop };
}

// Issue #557 review: the Dashboard index must refresh when only a record the
// cancellation check reads changes (a child Run, the current selection).
describe('Native SDK cancellation paths for the Dashboard index', () => {
  it('includes the child Runs of a cancelled change, and the current selection', async () => {
    const { root, childRunId } = await cancelledParentWithClaimedChild();
    const paths = await nativeSdkChangeCancellationPaths(root, 'demo');
    expect(paths).toEqual(
      expect.arrayContaining([
        ...nativeSdkChangeRunPaths(root, 'demo'),
        ...nativeSdkChangeRunPaths(root, childRunId),
        cometCurrentSelectionFile(root),
      ]),
    );
  });

  it('changes the fingerprint when only the child Run record changes', async () => {
    const { root, runtime, childRunId, acknowledgeChildStop } =
      await cancelledParentWithClaimedChild();
    const parentRevision = (await runtime.inspect('demo')).revision;
    const paths = await nativeSdkChangeCancellationPaths(root, 'demo');
    const rootOnly = nativeSdkChangeRunPaths(root, 'demo');
    const before = await fingerprintDashboardFiles(paths, 'test');
    const rootOnlyBefore = await fingerprintDashboardFiles(rootOnly, 'test');

    // Only the child's record moves; the parent Run is untouched.
    const childRevision = (await runtime.inspect(childRunId)).revision;
    expect((await acknowledgeChildStop()).revision).toBe(childRevision + 1);
    expect((await runtime.inspect('demo')).revision).toBe(parentRevision);

    expect(await fingerprintDashboardFiles(rootOnly, 'test')).toBe(rootOnlyBefore);
    expect(await fingerprintDashboardFiles(paths, 'test')).not.toBe(before);
  });

  it('does not read child Runs while the change is not cancelled', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cancel-paths-active-'));
    roots.push(root);
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    expect(await nativeSdkChangeCancellationPaths(root, 'demo')).toEqual([
      ...nativeSdkChangeRunPaths(root, 'demo'),
      cometCurrentSelectionFile(root),
    ]);
  });
});
