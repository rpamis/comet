import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, it } from 'vitest';

import * as nativeDomain from '../../../domains/comet-native/index.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { createNativePortableState } from '../../../domains/comet-native/native-portable-state.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import {
  collectNativeSdkShapeProposal,
  defineNativeWorkflowApplication,
} from '../../../domains/comet-native/native-sdk-application.js';
import {
  COMET_CHANGE_OWNER_SCHEMA,
  readChangeRuntimeOwner,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function preparedSupervisorBuilder() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-supervisor-portable-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('docs', 'en'));
  const paths = await nativeProjectPaths(root, 'docs');
  const changeDir = path.join(paths.changesDir, 'portable-child');
  await fs.mkdir(path.join(changeDir, 'specs', 'workflow'), { recursive: true });
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Outcome\nShip the API.\n# Scope\nAPI work.\n# Non-goals\nNone.\n# Acceptance examples\n- The API works.\n# Constraints and invariants\nKeep the workflow.\n# Decisions\nNone.\n# Open questions\nNone.\n# Verification expectations\nRun checks.\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'specs', 'workflow', 'spec.md'),
    '# Workflow\nThe API works.\n',
  );
  await fs.writeFile(
    path.join(changeDir, 'children.yaml'),
    'schema: comet.native.children.v2\nchildren:\n  - name: api\n    summary: Build the API\n    depends_on: []\n  - name: ui\n    summary: Build the UI\n    depends_on: [api]\n',
  );
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Comet Test',
      '-c',
      'user.email=comet-test@example.com',
      'commit',
      '-m',
      'base',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  const branch = execFileSync('git', ['branch', '--show-current'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  const initialState = createNativePortableState({
    name: 'portable-child',
    language: 'en',
    workspace: {
      isolation: 'current',
      change_branch: branch,
      target_branch: branch,
      finish: null,
    },
  });
  const runtime = createNativeSdkRuntime(root);
  const application = defineNativeWorkflowApplication();
  let run = await runtime.start({
    runId: 'portable-child',
    workflow: { id: application.workflow.id, version: application.workflow.version },
    input: { name: 'portable-child', artifactRootRef: 'docs' },
    initialState,
  });
  await registerSdkChangeOwner(root, {
    schema: COMET_CHANGE_OWNER_SCHEMA,
    workflow: 'native',
    change: 'portable-child',
    format: 'sdk',
    application: 'native',
    runId: 'portable-child',
  });
  async function completeShape(output: unknown, requestId: string) {
    const action = run.actions.at(-1)!;
    run = await runtime.claim({
      runId: run.runId,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      claimToken: requestId,
      context: { requestId, projectRoot: root },
    });
    run = await runtime.recordOutcome({
      runId: run.runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: requestId,
        outcomeId: requestId,
        status: 'succeeded',
        output,
      },
      context: { requestId, projectRoot: root },
    });
  }
  await completeShape(await collectNativeSdkShapeProposal({ paths, state: initialState }), 'shape');
  const wait = run.waits.at(-1)!;
  expect(wait).toMatchObject({ stepId: 'supervisor.shape.confirm' });
  run = await runtime.resolveWait({
    runId: run.runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'multi-session',
    choice: 'multi-session',
  });
  await completeShape(
    await collectNativeSdkShapeProposal({ paths, state: run.state as typeof initialState }),
    'shape-revalidated',
  );
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'native-supervisor-prepare',
    context: { requestId: 'integration', projectRoot: root },
  });
  run = await runtime.execute({
    runId: run.runId,
    actionId: run.actions.at(-1)!.id,
    executorId: 'native-supervisor-child-prepare',
    context: { requestId: 'child', projectRoot: root },
  });
  expect(run.actions.at(-1)).toMatchObject({
    stepId: 'supervisor.child.builder',
    status: 'pending',
  });
  return { root, run, runtime };
}

it('does not restore a Supervisor Builder from the parent checkpoint without its Child worktree', async () => {
  const { root } = await preparedSupervisorBuilder();
  const copy = path.join(root, 'new-device');
  execFileSync('git', ['clone', root, copy], { cwd: root, stdio: 'ignore' });
  await fs.mkdir(path.join(copy, '.comet'), { recursive: true });
  await fs.copyFile(
    path.join(root, '.comet', 'config.yaml'),
    path.join(copy, '.comet', 'config.yaml'),
  );
  await fs.cp(path.join(root, 'docs'), path.join(copy, 'docs'), { recursive: true, force: true });

  const result = await runNativeCli(['status', 'portable-child', '--json', '--project-root', copy]);
  const response = JSON.parse(result.stdout!) as {
    exitCode: number;
    error?: { message: string };
  };
  expect(response.exitCode).not.toBe(0);
  expect(response.error?.message).toMatch(/Supervisor.*worktree.*unavailable/iu);
  expect(await readChangeRuntimeOwner(copy, 'native', 'portable-child')).toBeNull();
  await expect(inspectNativeSdkRun(copy, 'portable-child')).rejects.toThrow();
});

it('transfers an uncommitted Child Builder to a new checkout without reporting its outcome', async () => {
  const { root, run, runtime } = await preparedSupervisorBuilder();
  const builder = run.actions.at(-1)!;
  await runtime.claim({
    runId: run.runId,
    actionId: builder.id,
    attempt: builder.attempt,
    inputHash: builder.inputHash,
    executorId: 'native-host',
    sessionId: 'original-builder',
    claimToken: 'original-builder-claim',
    context: { requestId: 'original-builder', projectRoot: root },
  });
  const childRoot = path.join(root, '.worktrees', 'portable-child-api');
  await fs.writeFile(path.join(childRoot, 'committed.txt'), 'committed API\n');
  execFileSync('git', ['add', 'committed.txt'], { cwd: childRoot, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Comet Test',
      '-c',
      'user.email=comet-test@example.com',
      'commit',
      '-m',
      'child code',
    ],
    { cwd: childRoot, stdio: 'ignore' },
  );
  await fs.writeFile(path.join(childRoot, 'committed.txt'), 'committed API with partial edit\n');
  await fs.writeFile(path.join(childRoot, 'api.txt'), 'half-written API\n');

  const transfer = nativeDomain as Record<string, unknown>;
  expect(transfer.exportNativeSupervisorTransfer).toBeTypeOf('function');
  expect(transfer.importNativeSupervisorTransfer).toBeTypeOf('function');
  const exportTransfer = transfer.exportNativeSupervisorTransfer as (options: {
    projectRoot: string;
    name: string;
    outputDir: string;
    confirmedStopped: boolean;
  }) => Promise<unknown>;
  const importTransfer = transfer.importNativeSupervisorTransfer as (options: {
    projectRoot: string;
    inputDir: string;
  }) => Promise<unknown>;
  const packageDir = path.join(root, 'transfer-package');
  await exportTransfer({
    projectRoot: root,
    name: 'portable-child',
    outputDir: packageDir,
    confirmedStopped: true,
  });

  const copy = path.join(root, 'new-device');
  execFileSync('git', ['clone', root, copy], { cwd: root, stdio: 'ignore' });
  await fs.mkdir(path.join(copy, '.comet'), { recursive: true });
  await fs.copyFile(
    path.join(root, '.comet', 'config.yaml'),
    path.join(copy, '.comet', 'config.yaml'),
  );
  await importTransfer({ projectRoot: copy, inputDir: packageDir });

  const restoredChild = path.join(copy, '.worktrees', 'portable-child-api');
  expect(await fs.readFile(path.join(restoredChild, 'api.txt'), 'utf8')).toBe('half-written API\n');
  expect(await fs.readFile(path.join(restoredChild, 'committed.txt'), 'utf8')).toBe(
    'committed API with partial edit\n',
  );
  expect(
    execFileSync('git', ['log', '-1', '--format=%s'], {
      cwd: restoredChild,
      encoding: 'utf8',
    }).trim(),
  ).toBe('child code');
  const restored = await inspectNativeSdkRun(copy, 'portable-child');
  expect(restored.run.actions.find((action) => action.id === builder.id)).toMatchObject({
    stepId: 'supervisor.child.builder',
    status: 'unknown',
    input: { activation: { worktree: restoredChild } },
  });
  const status = await runNativeCli(['status', 'portable-child', '--json', '--project-root', copy]);
  expect(JSON.parse(status.stdout!) as { exitCode: number }).toMatchObject({ exitCode: 0 });
  expect(await fs.readFile(path.join(childRoot, 'api.txt'), 'utf8')).toBe('half-written API\n');
  const manifest = JSON.parse(
    await fs.readFile(path.join(packageDir, 'manifest.json'), 'utf8'),
  ) as { checkpointHash: string };
  const receipt = JSON.parse(
    await fs.readFile(
      path.join(copy, '.comet', 'runtime', 'transfers', 'native', 'portable-child.json'),
      'utf8',
    ),
  ) as { sourceCheckpointHash: string; importedCheckpointHash: string };
  expect(receipt.sourceCheckpointHash).toBe(manifest.checkpointHash);
  expect(receipt.importedCheckpointHash).toMatch(/^[a-f0-9]{64}$/u);
});

it('refuses to write a transfer package inside a source Child worktree', async () => {
  const { root } = await preparedSupervisorBuilder();
  const childRoot = path.join(root, '.worktrees', 'portable-child-api');
  const outputDir = path.join(childRoot, 'transfer-package');
  await expect(
    nativeDomain.exportNativeSupervisorTransfer({
      projectRoot: root,
      name: 'portable-child',
      outputDir,
      confirmedStopped: true,
    }),
  ).rejects.toThrow(/cannot be inside a source workspace/u);
  await expect(fs.stat(outputDir)).rejects.toMatchObject({ code: 'ENOENT' });
});

it('continues an import after the integration worktree was created but before the Run was restored', async () => {
  const { root } = await preparedSupervisorBuilder();
  const packageDir = path.join(root, 'transfer-package');
  await nativeDomain.exportNativeSupervisorTransfer({
    projectRoot: root,
    name: 'portable-child',
    outputDir: packageDir,
    confirmedStopped: true,
  });
  const copy = path.join(root, 'new-device');
  execFileSync('git', ['clone', root, copy], { cwd: root, stdio: 'ignore' });
  await fs.mkdir(path.join(copy, '.comet'), { recursive: true });
  await fs.copyFile(
    path.join(root, '.comet', 'config.yaml'),
    path.join(copy, '.comet', 'config.yaml'),
  );
  execFileSync(
    'git',
    [
      'fetch',
      '--no-tags',
      path.join(packageDir, 'branches.bundle'),
      'refs/heads/comet/supervisor/portable-child/integration:refs/heads/comet/supervisor/portable-child/integration',
    ],
    { cwd: copy, stdio: 'ignore' },
  );
  const integration = path.join(copy, '.worktrees', 'portable-child-integration');
  execFileSync(
    'git',
    ['worktree', 'add', integration, 'comet/supervisor/portable-child/integration'],
    { cwd: copy, stdio: 'ignore' },
  );

  await nativeDomain.importNativeSupervisorTransfer({ projectRoot: copy, inputDir: packageDir });
  expect((await inspectNativeSdkRun(copy, 'portable-child')).run.actions.at(-1)).toMatchObject({
    stepId: 'supervisor.child.builder',
    status: 'pending',
  });
  expect(
    execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: copy, encoding: 'utf8' }),
  ).toContain(path.join(copy, '.worktrees', 'portable-child-api').replaceAll('\\', '/'));
});

it('rejects an existing worktree directory link instead of restoring files outside it', async () => {
  const { root } = await preparedSupervisorBuilder();
  const sourceIntegration = path.join(root, '.worktrees', 'portable-child-integration');
  await fs.mkdir(path.join(sourceIntegration, 'scratch'));
  await fs.writeFile(path.join(sourceIntegration, 'scratch', 'code.txt'), 'private code\n');
  const packageDir = path.join(root, 'transfer-package');
  await nativeDomain.exportNativeSupervisorTransfer({
    projectRoot: root,
    name: 'portable-child',
    outputDir: packageDir,
    confirmedStopped: true,
  });
  const copy = path.join(root, 'new-device');
  execFileSync('git', ['clone', root, copy], { cwd: root, stdio: 'ignore' });
  await fs.mkdir(path.join(copy, '.comet'), { recursive: true });
  await fs.copyFile(
    path.join(root, '.comet', 'config.yaml'),
    path.join(copy, '.comet', 'config.yaml'),
  );
  execFileSync(
    'git',
    [
      'fetch',
      '--no-tags',
      path.join(packageDir, 'branches.bundle'),
      'refs/heads/comet/supervisor/portable-child/integration:refs/heads/comet/supervisor/portable-child/integration',
    ],
    { cwd: copy, stdio: 'ignore' },
  );
  const integration = path.join(copy, '.worktrees', 'portable-child-integration');
  execFileSync(
    'git',
    ['worktree', 'add', integration, 'comet/supervisor/portable-child/integration'],
    { cwd: copy, stdio: 'ignore' },
  );
  const outside = path.join(root, 'outside-target');
  await fs.mkdir(outside);
  await fs.symlink(
    outside,
    path.join(integration, 'scratch'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  await expect(
    nativeDomain.importNativeSupervisorTransfer({ projectRoot: copy, inputDir: packageDir }),
  ).rejects.toThrow(/symlink|junction|outside|contained/iu);
  await expect(fs.stat(path.join(outside, 'code.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
});

it('exports and imports a Supervisor transfer through the public Native CLI', async () => {
  const { root } = await preparedSupervisorBuilder();
  const packageDir = path.join(root, 'transfer-package');
  const exported = await runNativeCli([
    'transfer',
    'export',
    'portable-child',
    '--output',
    packageDir,
    '--confirmed-stopped',
    '--json',
    '--project-root',
    root,
  ]);
  expect(JSON.parse(exported.stdout!) as { exitCode: number }).toMatchObject({ exitCode: 0 });
  expect(await fs.stat(path.join(packageDir, 'manifest.json'))).toBeTruthy();

  const copy = path.join(root, 'new-device');
  execFileSync('git', ['clone', root, copy], { cwd: root, stdio: 'ignore' });
  await fs.mkdir(path.join(copy, '.comet'), { recursive: true });
  await fs.copyFile(
    path.join(root, '.comet', 'config.yaml'),
    path.join(copy, '.comet', 'config.yaml'),
  );
  const imported = await runNativeCli([
    'transfer',
    'import',
    '--input',
    packageDir,
    '--json',
    '--project-root',
    copy,
  ]);
  expect(JSON.parse(imported.stdout!) as { exitCode: number }).toMatchObject({ exitCode: 0 });
  expect(await readChangeRuntimeOwner(copy, 'native', 'portable-child')).toMatchObject({
    format: 'sdk',
    runId: 'portable-child',
  });
});

it('rejects a forged branch head before creating a destination branch', async () => {
  const { root } = await preparedSupervisorBuilder();
  const packageDir = path.join(root, 'transfer-package');
  await nativeDomain.exportNativeSupervisorTransfer({
    projectRoot: root,
    name: 'portable-child',
    outputDir: packageDir,
    confirmedStopped: true,
  });
  const manifestFile = path.join(packageDir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')) as {
    workspaces: Array<{ head: string }>;
  };
  manifest.workspaces[0].head = 'f'.repeat(40);
  await fs.writeFile(manifestFile, JSON.stringify(manifest));
  const copy = path.join(root, 'new-device');
  execFileSync('git', ['clone', root, copy], { cwd: root, stdio: 'ignore' });
  await fs.mkdir(path.join(copy, '.comet'), { recursive: true });
  await fs.copyFile(
    path.join(root, '.comet', 'config.yaml'),
    path.join(copy, '.comet', 'config.yaml'),
  );

  await expect(
    nativeDomain.importNativeSupervisorTransfer({ projectRoot: copy, inputDir: packageDir }),
  ).rejects.toThrow(/branch|bundle/iu);
  expect(() =>
    execFileSync(
      'git',
      ['show-ref', '--verify', '--quiet', 'refs/heads/comet/supervisor/portable-child/integration'],
      { cwd: copy, stdio: 'ignore' },
    ),
  ).toThrow();
  expect(await readChangeRuntimeOwner(copy, 'native', 'portable-child')).toBeNull();
});
