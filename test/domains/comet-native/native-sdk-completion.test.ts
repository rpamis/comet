import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';
import { settleNativeSdkCompletion } from '../../../domains/comet-native/native-sdk-completion-cleanup.js';
import * as selectionModule from '../../../domains/workflow-contract/current-selection.js';
import { readCometCurrentSelection } from '../../../domains/workflow-contract/current-selection.js';
import type { WorkflowRun } from '../../../domains/engine/runtime.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-completion-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const name = 'archive-settled';
  const cli = async (args: string[]) => {
    const result = await runNativeCli([...args, '--project-root', root, '--json']);
    return JSON.parse(result.stdout!);
  };
  expect((await cli(['new', name])).exitCode).toBe(0);
  const { artifactRootRef } = await inspectNativeSdkRun(root, name);
  const completedRun = {
    runId: name,
    status: 'completed',
    input: { artifactRootRef },
  } as unknown as WorkflowRun;
  return { root, name, cli, completedRun };
}

describe('Native SDK completion selection release', () => {
  it('releases the current selection once the archived Run settles as completed', async () => {
    const f = await fixture();
    expect((await readCometCurrentSelection(f.root)).status).toBe('selected');

    await settleNativeSdkCompletion({ projectRoot: f.root, run: f.completedRun });

    expect((await readCometCurrentSelection(f.root)).status).toBe('missing');
  });

  it('keeps a selection that points at a different change', async () => {
    const f = await fixture();
    const other = { ...f.completedRun, runId: 'another-change' } as WorkflowRun;

    await settleNativeSdkCompletion({ projectRoot: f.root, run: other });

    const selected = await readCometCurrentSelection(f.root);
    expect(selected.status).toBe('selected');
    expect(selected.selection.change).toBe(f.name);
  });

  it('does nothing for a Run that has not settled as completed', async () => {
    const f = await fixture();
    const running = { ...f.completedRun, status: 'running' } as WorkflowRun;

    await settleNativeSdkCompletion({ projectRoot: f.root, run: running });

    expect((await readCometCurrentSelection(f.root)).status).toBe('selected');
  });

  it('surfaces a failed selection release and repairs it without changing an unrelated selection', async () => {
    const f = await fixture();
    const selected = await readCometCurrentSelection(f.root);
    const release = vi
      .spyOn(selectionModule, 'clearCometCurrentSelectionIf')
      .mockRejectedValueOnce(new Error('SIMULATED selection publication failure'));
    await expect(
      settleNativeSdkCompletion({ projectRoot: f.root, run: f.completedRun }),
    ).rejects.toThrow(/current selection release remains pending/);
    expect(await readCometCurrentSelection(f.root)).toEqual(selected);
    release.mockRestore();
    await settleNativeSdkCompletion({ projectRoot: f.root, run: f.completedRun });
    expect((await readCometCurrentSelection(f.root)).status).toBe('missing');
  });
});
