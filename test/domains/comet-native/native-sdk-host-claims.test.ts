import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  inspectNativeSdkRun,
  loadOwnedNativeSdkRuntime,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { advanceNativeSdkChange } from '../../../domains/comet-native/native-sdk-next.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { projectNativeSdkContinuation } from '../../../domains/comet-native/native-sdk-continuation.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) {
    const actual = await fs.realpath(root);
    if (
      path.dirname(actual) !== (await fs.realpath(os.tmpdir())) ||
      !path.basename(actual).startsWith('native-sdk-host-claims-')
    )
      throw new Error('Unexpected fixture cleanup target');
    await fs.rm(actual, { recursive: true, force: true });
  }
});

it('claims independent Supervisor work from one response and safely acknowledges the same claim again', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-sdk-host-claims-'));
  roots.push(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Comet Test');
  git('config', 'user.email', 'test@example.invalid');
  const name = 'parallel';
  const created = await runNativeCli([
    'new',
    name,
    '--runtime',
    'sdk',
    '--project-root',
    root,
    '--json',
  ]);
  expect(created.exitCode, created.stderr).toBe(0);
  let inspection = await inspectNativeSdkRun(root, name);
  const paths = await nativeProjectPaths(root, inspection.artifactRootRef);
  const dir = path.join(paths.changesDir, name);
  await fs.writeFile(
    path.join(dir, 'brief.md'),
    '# Outcome\nShip both files.\n# Scope\nTwo independent children.\n# Non-goals\nPublishing.\n# Acceptance examples\n- Both files are present.\n# Directory structure\n## Created\n- left.txt\n- right.txt\n## Modified\nNone.\n## Deleted\nNone.\n## Not created\nNo service.\n',
  );
  await fs.mkdir(path.join(dir, 'specs/workflow'), { recursive: true });
  await fs.writeFile(
    path.join(dir, 'specs/workflow/spec.md'),
    '# Workflow\nBoth files are present.\n',
  );
  await fs.writeFile(
    path.join(dir, 'children.yaml'),
    'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: Both files are present.\nchildren:\n  - name: left\n    depends_on: []\n    covers: [A1]\n  - name: right\n    depends_on: []\n    covers: [A1]\n',
  );
  await fs.writeFile(
    path.join(root, '.gitignore'),
    '.comet/\n.worktrees/\n**/comet-state.yaml\n**/verification.md\n',
  );
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
  await advanceNativeSdkChange(root, name);
  inspection = await inspectNativeSdkRun(root, name);
  await advanceNativeSdkChange(root, name, {
    expectedAction: 'confirm-shape',
    expectedStateVersion: inspection.state.state_version,
    coordinationMode: 'multi-session',
    summary: 'Confirm the isolated fixture.',
  });
  for (let n = 0; n < 8; n++) {
    inspection = await inspectNativeSdkRun(root, name);
    if (
      inspection.run.actions.filter(
        (a) => a.stepId === 'supervisor.child.builder' && a.status === 'pending',
      ).length === 2
    )
      break;
    const next = await advanceNativeSdkChange(root, name);
    expect(next.exitCode).toBe(0);
  }
  const view = await projectNativeSdkContinuation({
    run: inspection.run,
    state: inspection.state,
    projectRoot: root,
  });
  const pending = view.pendingActions!.filter((a) => a.stepId === 'supervisor.child.builder');
  expect(pending).toHaveLength(2);
  const { runtime } = await loadOwnedNativeSdkRuntime(root, name);
  const claims = pending.map((a, index) => ({
    ...a.claimRequest!,
    sessionId: `child-${index}`,
    claimToken: `claim-${index}`,
    context: { projectRoot: root },
  }));
  for (const claim of claims) await runtime.claim(claim);
  const before = await runtime.inspect(name);
  expect(before.actions.filter((a) => a.status === 'running')).toHaveLength(2);
  expect(await runtime.claim(claims[0])).toEqual(before);
  await expect(runtime.claim({ ...claims[0], claimToken: 'another-owner' })).rejects.toThrow();
  await expect(runtime.claim({ ...claims[1], inputHash: 'changed-input' })).rejects.toThrow();
});
