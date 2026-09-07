import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  nativePortableChangeDir,
} from '../../../domains/comet-native/native-portable-runtime.js';
import {
  dispatchNativeSupervisorReadyTasks,
  integrateNativeSupervisorChildWorkspace,
  nativeSupervisorStateFile,
  readNativeSupervisorState,
} from '../../../domains/comet-native/native-supervisor.js';
import { applyNativeRunnerInput } from '../../../domains/comet-native/native-runner-input.js';
import { executeNativeSupervisorChecks } from '../../../domains/comet-native/native-supervisor-evidence.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const plan = (id: string, code = 'process.exit(0)', args: string[] = []) => ({
  id,
  name: id,
  executable: process.execPath,
  argv: ['-e', code, ...args],
  cwdRef: '.',
  timeoutMs: 20000,
  repeatable: true,
});

async function verifiedSupervisor() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-integration-execution-'));
  roots.push(root);
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'native@example.test');
  git(root, 'config', 'user.name', 'Native Test');
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  await fs.writeFile(
    path.join(root, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n.worktrees/\n',
  );
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'seed');
  const paths = await nativeProjectPaths(root, 'docs');
  await ensureNativeDirectories(paths);
  await createNativePortableChange({
    paths,
    name: 'parent',
    language: 'en',
    workspaceBinding: { isolation: 'current', changeBranch: 'main', targetBranch: 'main' },
  });
  const changeDir = nativePortableChangeDir(paths, 'parent');
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Acceptance examples\n- The behavior works.\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'children.yaml'),
    'schema: comet.native.children.v2\nchildren:\n  - name: core\n    summary: Core behavior.\n    depends_on: []\n',
  );
  await confirmNativePortableShape({ paths, name: 'parent' });
  const dispatched = await dispatchNativeSupervisorReadyTasks({
    paths,
    parent: 'parent',
    maxParallel: 1,
  });
  const builder = dispatched.tasks[0];
  await fs.writeFile(path.join(builder.projectRoot, 'feature.txt'), 'implemented');
  git(builder.projectRoot, 'add', 'feature.txt');
  git(builder.projectRoot, 'commit', '-m', 'implement');
  const result = await applyNativeRunnerInput({
    paths,
    name: 'parent',
    maxVerifyFailures: 5,
    input: {
      kind: 'supervisor-builder-result',
      child: 'core',
      runId: builder.runId,
      candidateCommit: git(builder.projectRoot, 'rev-parse', 'HEAD'),
    },
  });
  const verifier = result.supervisorTask!;
  const checked = await executeNativeSupervisorChecks({
    paths,
    parent: 'parent',
    child: 'core',
    runId: verifier.runId,
    plans: [plan('child')],
    materials: [],
  });
  await applyNativeRunnerInput({
    paths,
    name: 'parent',
    maxVerifyFailures: 5,
    input: {
      kind: 'supervisor-verifier-result',
      child: 'core',
      runId: verifier.runId,
      verdict: 'pass',
      evidence: {
        summary: 'Verified.',
        checks: ['child'],
        receiptRef: checked.receiptRef,
        acceptance: [{ id: 'child:core', result: 'passed', reason: 'Checked.' }],
      },
    },
  });
  return { root, paths, state: (await readNativeSupervisorState(paths, 'parent'))! };
}

describe('Supervisor integration check execution', () => {
  it('reserves the integration worktree before running checks with competing plans', async () => {
    const { root, paths, state } = await verifiedSupervisor();
    const marker = path.join(root, '.comet/runtime/integration-started');
    const release = path.join(root, '.comet/runtime/integration-release');
    const first = integrateNativeSupervisorChildWorkspace({
      paths,
      state,
      name: 'core',
      checks: [],
      checkPlans: [
        plan(
          'first',
          "const fs=require('node:fs');fs.writeFileSync(process.argv[1],'started');const timer=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(timer);process.exit(0)}},20)",
          [marker, release],
        ),
      ],
    });
    // Attach a handler while the competing request is inspected.
    const settled = first.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    try {
      await expect
        .poll(
          async () =>
            fs.access(marker).then(
              () => true,
              () => false,
            ),
          { timeout: 10000 },
        )
        .toBe(true);
      await expect(
        integrateNativeSupervisorChildWorkspace({
          paths,
          state,
          name: 'core',
          checks: [],
          checkPlans: [plan('different')],
        }),
      ).rejects.toThrow(/running|state changed/);
      const latest = (await readNativeSupervisorState(paths, 'parent'))!;
      await expect(
        integrateNativeSupervisorChildWorkspace({
          paths,
          state: latest,
          name: 'core',
          checks: [],
          checkPlans: [plan('different')],
        }),
      ).rejects.toThrow(/running/);
      await expect
        .poll(
          async () =>
            (await readNativeSupervisorState(paths, 'parent'))?.integration.checkExecution
              ?.activeProcess?.status,
          { timeout: 10000 },
        )
        .toBe('running');
      const orphaned = (await readNativeSupervisorState(paths, 'parent'))!;
      // A recovered overlay may refer to an exited owner while its real check is alive.
      orphaned.integration.checkExecution!.ownerIdentity = 'previous-owner-instance';
      await fs.writeFile(nativeSupervisorStateFile(paths, 'parent'), JSON.stringify(orphaned));
      await expect(
        integrateNativeSupervisorChildWorkspace({
          paths,
          state: orphaned,
          name: 'core',
          checks: [],
          checkPlans: [plan('orphan-retry')],
        }),
      ).rejects.toThrow('check process is still running');
    } finally {
      await fs.writeFile(release, 'release');
      await settled;
    }
    expect(await settled).toMatchObject({
      value: {
        children: [{ status: 'integrated', checks: [{ name: 'first', status: 'passed' }] }],
      },
    });
  }, 120000);

  it('preserves a failed integration receipt and retries against the already merged candidate', async () => {
    const { paths, state } = await verifiedSupervisor();
    await expect(
      integrateNativeSupervisorChildWorkspace({
        paths,
        state,
        name: 'core',
        checks: [],
        checkPlans: [plan('fails', 'process.exit(1)')],
      }),
    ).rejects.toThrow('did not pass');
    const failed = (await readNativeSupervisorState(paths, 'parent'))!;
    expect(failed.children[0].status).toBe('verified');
    expect(failed.integration.checkExecution).toMatchObject({
      status: 'interrupted',
      activeProcess: null,
      receiptRef: expect.stringContaining('runtime/evidence/reports/'),
      checks: [{ name: 'fails', status: 'failed' }],
    });
    const completed = await integrateNativeSupervisorChildWorkspace({
      paths,
      state: failed,
      name: 'core',
      checks: [],
      checkPlans: [plan('retry')],
    });
    expect(completed.children[0]).toMatchObject({
      status: 'integrated',
      checks: [{ name: 'retry', status: 'passed' }],
    });
    expect(completed.integration.checkExecution).toMatchObject({
      status: 'completed',
      activeProcess: null,
    });
    expect(completed.integration.checkExecution!.operationId).not.toBe(
      failed.integration.checkExecution!.operationId,
    );
  }, 120000);
});
