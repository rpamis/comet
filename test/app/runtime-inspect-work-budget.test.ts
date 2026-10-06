import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import * as nativeStore from '../../domains/comet-native/native-sdk-state-store.js';

// The public command still validates the owner and Run before returning its snapshot.
describe('Runtime built-in inspect work budget', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-inspect-budget-'));
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    execFileSync('git', ['init', '-b', 'main', root], { stdio: 'ignore' });
    execFileSync('git', ['-C', root, 'config', 'user.name', 'Runtime Test']);
    execFileSync('git', ['-C', root, 'config', 'user.email', 'runtime@example.test']);
    await fs.writeFile(path.join(root, 'README.md'), '# Project\n');
    execFileSync('git', ['-C', root, 'add', 'README.md']);
    execFileSync('git', ['-C', root, 'commit', '-m', 'initial'], { stdio: 'ignore' });
    const initialized = await runNativeCli([
      'new',
      'inspect-budget',
      '--project-root',
      root,
      '--json',
    ]);
    expect(initialized.exitCode, initialized.stderr).toBe(0);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reads the validated Run once per invocation and does not retain it across requests', async () => {
    const createStore = nativeStore.createNativeSdkStateStore;
    const reads = vi.fn();
    vi.spyOn(nativeStore, 'createNativeSdkStateStore').mockImplementation((projectRoot) => {
      const store = createStore(projectRoot);
      return {
        ...store,
        read: async (runId) => {
          reads(runId);
          return store.read(runId);
        },
      };
    });
    const request = path.join(root, 'request.json');
    await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: 'inspect-budget' }));
    const options = { request, application: 'native', projectRoot: root };
    const first = await runtimeDispatchCommand(options);
    expect(first.exitCode, JSON.stringify(first.response)).toBe(0);
    expect(reads).toHaveBeenCalledTimes(1);
    const second = await runtimeDispatchCommand(options);
    expect(second.response).toEqual({ ...first.response, requestId: second.response.requestId });
    expect(reads).toHaveBeenCalledTimes(2);

    await fs.writeFile(
      path.join(root, '.comet/runtime/change-owners/native/inspect-budget.json'),
      '{}',
    );
    const invalidOwner = await runtimeDispatchCommand(options);
    expect(invalidOwner.exitCode).not.toBe(0);
    expect(invalidOwner.response.status).toBe('failed');
    expect(reads).toHaveBeenCalledTimes(2);
  });
});
