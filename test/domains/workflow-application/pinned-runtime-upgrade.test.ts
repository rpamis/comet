import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime.js';
import { loadWorkflowApplication } from '../../../domains/workflow-application/index.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';

const version = vi.hoisted(() => ({ current: '' }));
vi.mock('../../../platform/version/version.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../platform/version/version.js')>();
  return {
    ...original,
    getCurrentVersion: () => version.current || original.getCurrentVersion(),
  };
});

const roots: string[] = [];
afterEach(async () => {
  version.current = '';
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

// The 0.5.4 version bump must not strand Runs started with a fixed Native or
// Classic package pinned to an earlier published Runtime.
describe('fixed packages pinned to an earlier published Runtime', () => {
  it.each([
    ['0.5.2', 'native'],
    ['0.5.3', 'native'],
    ['0.5.2', 'classic-hotfix'],
    ['0.5.3', 'classic-hotfix'],
  ] as const)('inspects and resumes a Run pinned to %s (%s) on 0.5.4', async (pinned, base) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pinned-runtime-upgrade-'));
    roots.push(root);
    version.current = pinned;
    const disk = await createDiskApplication(root);
    disk.manifest.base = base;
    await fs.writeFile(disk.file, JSON.stringify(disk.manifest));
    expect(disk.manifest.runtimeVersion).toBe(pinned);
    const before = await loadWorkflowApplication({ file: disk.file, projectRoot: root });
    const started = await createRuntime({ ...before.implementation, store: before.store }).start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input: { topic: 'Actual topic' },
    });

    version.current = '0.5.4';
    const after = await loadWorkflowApplication({
      file: disk.file,
      projectRoot: root,
      runId: 'report',
    });
    expect(after.identity.runtimeVersion).toBe(pinned);
    const runtime = createRuntime({ ...after.implementation, store: after.store });
    expect(await runtime.inspect('report')).toEqual(started);
    const action = started.actions[0];
    const claimed = await runtime.claim({
      runId: 'report',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'local-skill',
      claimToken: 'resume-claim',
      capabilities: ['skill-script'],
    });
    expect(claimed.revision).toBe(started.revision + 1);
    expect(claimed.actions[0].claim).toBeDefined();

    // A new Run still needs the current Runtime.
    await expect(loadWorkflowApplication({ file: disk.file, projectRoot: root })).rejects.toThrow(
      `应用要求 Runtime ${pinned}`,
    );
  });
});
