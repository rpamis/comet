import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { parseDocument } from 'yaml';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  createNativeSdkRuntime,
  inspectNativeSdkRun,
} from '../../../domains/comet-native/native-runtime-ownership.js';
import { loadOwnedNativeSdkRuntime } from '../../../domains/comet-native/native-runtime-ownership.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { createNativeSdkStateStore } from '../../../domains/comet-native/native-sdk-state-store.js';
import * as sdkStatus from '../../../domains/comet-native/native-sdk-status.js';
import { nativeSdkTaskResultTemplate } from '../../../domains/comet-native/native-sdk-continuation.js';
import * as stateStores from '../../../domains/comet-native/native-sdk-state-store.js';
import { inspectNativeSdkDefinitionUpgrade } from '../../../domains/comet-native/native-runtime-ownership.js';
import { defineNativeWorkflowApplication } from '../../../domains/comet-native/native-sdk-application.js';
import {
  createFileRuntimeStore,
  defineWorkflow,
  hashRuntimeValue,
} from '../../../domains/engine/runtime.js';
import * as sdkReport from '../../../domains/comet-native/native-sdk-report.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

it('creates an agent-managed Native Run without a project content snapshot', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-agent-checks-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  const created = await runNativeCli(['new', 'agent-checks', '--project-root', root, '--json']);
  expect(created.exitCode, created.stderr || created.stdout).toBe(0);
  const { run } = await inspectNativeSdkRun(root, 'agent-checks');
  expect(run.workflow.version).toBe('4');
  expect(run.actions.some((action) => action.stepId.includes('checks'))).toBe(false);
  expect(
    run.actions.some((action) => ['shape.revalidate', 'verify.revalidate'].includes(action.stepId)),
  ).toBe(false);
});

async function builderFixture(boundary: 'source' | 'bundle' = 'source', branch?: string) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-agent-report-'));
  roots.push(root);
  if (branch) {
    for (const args of [
      ['init', '-b', branch],
      ['config', 'user.name', 'Fixture'],
      ['config', 'user.email', 'fixture@example.invalid'],
      ['commit', '--allow-empty', '-m', 'baseline'],
    ]) {
      const git = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
      expect(git.status, git.stderr).toBe(0);
    }
  } else await fs.mkdir(path.join(root, '.git'));
  const name = 'agent-report';
  const cli = async (args: string[]) => {
    const argv = [
      ...args,
      ...(args.includes('--project-root') ? [] : ['--project-root', root]),
      ...(args.includes('--json') ? [] : ['--json']),
    ];
    const child =
      boundary === 'bundle'
        ? spawnSync(
            process.execPath,
            [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...argv],
            { cwd: root, encoding: 'utf8', windowsHide: true },
          )
        : null;
    const result = child
      ? { exitCode: child.status ?? 1, stdout: child.stdout, stderr: child.stderr }
      : await runNativeCli(argv);
    return { ...result, envelope: JSON.parse(result.stdout) };
  };
  expect((await cli(['new', name])).exitCode).toBe(0);
  const change = path.join(root, 'docs/comet/changes', name);
  await fs.writeFile(path.join(change, 'brief.md'), 'Implement the approved workflow behavior.');
  await fs.mkdir(path.join(change, 'specs/workflow'), { recursive: true });
  await fs.writeFile(path.join(change, 'specs/workflow/spec.md'), 'The workflow works.');
  const file = path.join(root, 'result.json');
  const submit = async (action: string, output: unknown, extra: string[] = []) => {
    await fs.writeFile(file, JSON.stringify({ status: 'succeeded', output }));
    return cli([
      'next',
      name,
      '--action',
      action,
      '--session',
      'actual-agent',
      '--result',
      file,
      ...extra,
    ]);
  };
  const shape = await cli(['next', name, '--session', 'actual-agent']);
  expect(shape.exitCode, shape.stdout).toBe(0);
  const prepared = await submit(shape.envelope.data.task.actionId, {
    acceptance: [{ source: 'specs/workflow/spec.md', text: 'The workflow works.' }],
  });
  expect(prepared.exitCode, prepared.stdout).toBe(0);
  const { runtime } = await loadOwnedNativeSdkRuntime(root, name);
  const run = await runtime.inspect(name);
  const wait = run.waits.find((entry) => entry.status === 'pending')!;
  expect(wait.status).toBe('pending');
  const choices = prepared.envelope.data.next.commandAlternatives;
  const confirmation = choices?.find((choice: { commandArgs?: string[] }) =>
    choice.commandArgs?.includes('--confirmed'),
  );
  expect(confirmation, prepared.stdout).toBeDefined();
  expect(prepared.envelope.data.next.askUser).toBeTruthy();
  expect(confirmation.commandArgs).toContain('--expected-state-version');
  // 这次批准只属于隔离夹具，不能替代真实用户批准。
  const confirmed = await cli(
    confirmation.commandArgs
      .slice(2)
      .map((value: string) =>
        value === '<summary>' ? 'Fixture user approved the complete Shape.' : value,
      ),
  );
  expect(confirmed.exitCode, confirmed.stdout).toBe(0);
  const builder = await cli(['next', name, '--session', 'actual-agent']);
  expect(builder.exitCode, builder.stdout).toBe(0);
  return { root, name, cli, submit, runtime, builder: builder.envelope.data };
}

it.each(['source', 'bundle'] as const)(
  'returns guarded Shape choices without another status query (%s)',
  async (boundary) => {
    const f = await builderFixture(boundary);
    expect(f.builder.task).toMatchObject({ role: 'build', session: 'actual-agent' });
    const run = await f.runtime.inspect(f.name);
    expect(run.waits.filter((wait) => wait.status === 'resolved')).toHaveLength(1);
    expect(run.actions.filter((action) => action.stepId === 'shape.prepare')).toHaveLength(1);
  },
);

it('projects a repeated current-session task once without advancing or replacing its claim', async () => {
  const f = await builderFixture();
  const before = await f.runtime.inspect(f.name);
  const projection = vi.spyOn(sdkStatus, 'projectNativeSdkTaskStatus');
  const result = await f.cli(['next', f.name, '--session', 'actual-agent']);
  expect(result.exitCode, result.stdout).toBe(0);
  expect(result.envelope.data.task).toMatchObject({
    actionId: f.builder.task.actionId,
    session: 'actual-agent',
    status: 'running',
  });
  expect((await f.runtime.inspect(f.name)).revision).toBe(before.revision);
  expect(projection).toHaveBeenCalledTimes(1);
});

it('claims Shape using the inspected Run without a redundant checkpoint read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-shape-read-'));
  roots.push(root);
  await fs.mkdir(path.join(root, '.git'));
  expect(
    (await runNativeCli(['new', 'shape-read', '--project-root', root, '--json'])).exitCode,
  ).toBe(0);
  const open = vi.spyOn(fs, 'open');
  const result = await runNativeCli([
    'next',
    'shape-read',
    '--session',
    'actual-shaper',
    '--project-root',
    root,
    '--json',
  ]);
  expect(result.exitCode, result.stdout).toBe(0);
  expect(JSON.parse(result.stdout).data.task).toMatchObject({
    role: 'shape',
    session: 'actual-shaper',
    status: 'running',
  });
  const checkpointReads = open.mock.calls.filter(
    ([file, flags]) => String(file).endsWith('checkpoint.json') && flags === 'r',
  );
  expect(checkpointReads.length).toBeLessThanOrEqual(3);
  open.mockClear();
  const repeated = await runNativeCli([
    'next',
    'shape-read',
    '--session',
    'actual-shaper',
    '--project-root',
    root,
    '--json',
  ]);
  expect(repeated.exitCode, repeated.stdout).toBe(0);
  expect(JSON.parse(repeated.stdout).data.task.actionId).toBe(
    JSON.parse(result.stdout).data.task.actionId,
  );
  expect(
    open.mock.calls.filter(
      ([file, flags]) => String(file).endsWith('checkpoint.json') && flags === 'r',
    ).length,
  ).toBeLessThanOrEqual(1);
});

it('does not derive legacy Runtime check plans for a v4 task template', async () => {
  const f = await builderFixture();
  const run = await f.runtime.inspect(f.name);
  const builder = run.actions.find((action) => action.id === f.builder.task.actionId)!;
  const previous = {
    ...builder,
    id: 'previous-builder',
    status: 'succeeded',
    outcome: { status: 'succeeded', output: { verificationChecks: [] } },
  } as typeof builder;
  const template = nativeSdkTaskResultTemplate(
    { ...run, actions: [previous, ...run.actions] },
    builder,
  );
  expect(template.output).not.toHaveProperty('verificationChecks');
  expect(run.actions.some((action) => action.stepId === 'verify.checks')).toBe(false);
});

it('projects once when a Builder report claims Verify and retains the committed session and result template', async () => {
  const f = await builderFixture();
  const projection = vi.spyOn(sdkStatus, 'projectNativeSdkTaskStatus');
  vi.spyOn(sdkReport, 'refreshNativeSdkVerificationReport').mockRejectedValueOnce(
    new Error('fixture report publication unavailable'),
  );
  const built = await f.submit(f.builder.task.actionId, {
    summary: 'Implemented.',
    addressedAcceptanceIds: ['A1'],
    checks: [],
    knownLimits: [],
  });
  expect(built.exitCode, built.stdout).toBe(0);
  expect(built.envelope.data.task).toMatchObject({
    role: 'verify',
    status: 'running',
    session: 'actual-agent',
    readOnly: true,
  });
  expect(built.envelope.data.resultTemplate.output.response.kind).toBe('final-result');
  expect(built.envelope.data.warning).toEqual({
    code: 'NATIVE_REPORT_PENDING',
    message: 'fixture report publication unavailable',
  });
  const run = await f.runtime.inspect(f.name);
  expect(
    run.actions.find((action) => action.id === built.envelope.data.task.actionId)?.claim?.sessionId,
  ).toBe('actual-agent');
  expect(projection).toHaveBeenCalledTimes(1);
});

it.each(['source', 'bundle'] as const)(
  'accepts platform check reports and completes authorized Archive without Runtime check actions (%s)',
  async (boundary) => {
    const f = await builderFixture(boundary, 'archive-origin');
    expect(f.builder.resultTemplate.output).not.toHaveProperty('verificationChecks');
    const checks = [
      {
        name: 'Targeted test',
        result: 'passed',
        note: 'node test.mjs exited 0 in the project; original platform log retained.',
      },
    ];
    const built = await f.submit(f.builder.task.actionId, {
      summary: 'Implemented.',
      addressedAcceptanceIds: ['A1'],
      checks,
      knownLimits: [],
    });
    expect(built.exitCode, built.stdout).toBe(0);
    expect(built.envelope.data.task.role).toBe('verify');
    expect(built.envelope.data.task.checks).toEqual(checks);
    const output = built.envelope.data.resultTemplate.output;
    expect(output.checks).toEqual(checks);
    output.checks = checks;
    Object.assign(output.response.result, {
      verdict: 'pass',
      acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed the approved behavior.' }],
      risks: [],
      summary: 'Approved behavior verified.',
    });
    const completed = await f.submit(built.envelope.data.task.actionId, output, [
      '--accept-on-pass',
      'Test user explicitly delegated acceptance and Archive after passing.',
    ]);
    expect(completed.exitCode, completed.stdout).toBe(0);
    const run = await f.runtime.inspect(f.name);
    expect(run.status).toBe('completed');
    expect(
      run.actions.some((action) =>
        ['build.checks', 'verify.checks', 'verify.requested-checks'].includes(action.stepId),
      ),
    ).toBe(false);
    expect(JSON.stringify(run.state)).toContain('original platform log retained');
    const changed = spawnSync('git', ['switch', '-c', 'after-archive'], {
      cwd: f.root,
      encoding: 'utf8',
      windowsHide: true,
    });
    expect(changed.status, changed.stderr).toBe(0);
    if (boundary === 'source') {
      // Read-only compatibility observation: completed archives keep their original business records.
      // The fixture is never persisted or used to manufacture a workflow transition.
      const definition = defineWorkflow(defineNativeWorkflowApplication().workflow);
      const hash = hashRuntimeValue(definition);
      const legacy = {
        ...run,
        workflow: { id: definition.id, version: definition.version, hash },
        definitionHashes: {
          ...run.definitionHashes,
          [JSON.stringify([definition.id, definition.version])]: hash,
        },
      };
      const projectionRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), 'native-legacy-archive-projection-'),
      );
      roots.push(projectionRoot);
      await fs.mkdir(path.join(projectionRoot, '.comet'));
      await fs.copyFile(
        path.join(f.root, '.comet/config.yaml'),
        path.join(projectionRoot, '.comet/config.yaml'),
      );
      const receipt = run.outputs['archive.finalize'].value as { archiveRef: string };
      const projectionDir = path.join(projectionRoot, 'docs/comet/archive', receipt.archiveRef);
      await fs.cp(path.join(f.root, 'docs/comet/archive', receipt.archiveRef), projectionDir, {
        recursive: true,
      });
      const projectionFile = path.join(projectionDir, 'comet-state.yaml');
      const document = parseDocument(await fs.readFile(projectionFile, 'utf8'));
      document.delete('archive_receipt'); // Simulate a legacy projection; authority remains read-only.
      await fs.writeFile(projectionFile, document.toString());
      const writeRun = vi.fn();
      await createNativeSdkStateStore(projectionRoot, {
        store: { read: async () => legacy, compareAndSwap: writeRun },
      }).read(f.name);
      expect(
        parseDocument(await fs.readFile(projectionFile, 'utf8'))
          .get('archive_receipt', true)
          ?.toJSON(),
      ).toBeUndefined();
      expect(legacy.outputs['archive.finalize'].value).toEqual(receipt);
      expect(writeRun).not.toHaveBeenCalled();
      const invalidReceipt = parseDocument(await fs.readFile(projectionFile, 'utf8'));
      invalidReceipt.set('archive_receipt', null);
      invalidReceipt.delete('run_checkpoint');
      await fs.writeFile(projectionFile, invalidReceipt.toString());
      await createNativeSdkStateStore(projectionRoot, {
        store: { read: async () => legacy, compareAndSwap: writeRun },
      }).read(f.name);
      expect(
        parseDocument(await fs.readFile(projectionFile, 'utf8')).toJS().archive_receipt,
      ).toBeNull();
      expect(writeRun).not.toHaveBeenCalled();
      const commit = vi.fn();
      const store = vi
        .spyOn(stateStores, 'createNativeSdkStateStore')
        .mockReturnValue({ read: async () => legacy, compareAndSwap: commit } as ReturnType<
          typeof stateStores.createNativeSdkStateStore
        >);
      try {
        expect(await inspectNativeSdkDefinitionUpgrade(f.root, f.name, true)).toBeNull();
        expect(commit).not.toHaveBeenCalled();
      } finally {
        store.mockRestore();
      }
    }
    const beforeArchive = await f.cli(['status', f.name]);
    expect(beforeArchive.exitCode, beforeArchive.stdout).toBe(0);
    const archiveDir = path.join(f.root, 'docs/comet/archive');
    const [archiveName] = await fs.readdir(archiveDir);
    const checkpointFile = path.join(archiveDir, archiveName, 'comet-state.yaml');
    // Git may convert YAML to CRLF on another Windows checkout.
    await fs.writeFile(
      checkpointFile,
      (await fs.readFile(checkpointFile, 'utf8')).replace(/\r?\n/gu, '\r\n'),
    );
    const checkpoint = await fs.readFile(checkpointFile, 'utf8');
    const ids = run.actions.map((action) => action.id);
    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs/native'), {
      recursive: true,
    });
    const paths = await nativeProjectPaths(f.root, 'docs', { change: f.name, readOnly: true });
    await fs.rm(path.join(paths.runtimeDir, 'sdk-archive-receipts'), {
      recursive: true,
      force: true,
    });
    const repaired = await f.cli(['doctor', f.name, '--repair', '--confirmed']);
    expect(repaired.exitCode, repaired.stdout).toBe(0);
    const resumed = await f.runtime.inspect(f.name);
    expect(resumed.status).toBe('completed');
    expect(resumed.actions.map((action) => action.id)).toEqual(ids);
    expect(resumed.state).toEqual(run.state);
    expect(
      await createFileRuntimeStore({
        rootDir: path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs/native'),
      }).readPartitionMetadata(f.name),
    ).toBe('closed');
    expect(await fs.readFile(checkpointFile, 'utf8')).toBe(checkpoint);
    expect((await f.cli(['doctor', f.name])).envelope.data.healthy).toBe(true);
  },
  120_000,
);

it('keeps active Native recovery bound to its original branch', async () => {
  const f = await builderFixture('source', 'build-origin');
  const original = await f.runtime.inspect(f.name);
  const file = path.join(f.root, 'docs/comet/changes', f.name, 'comet-state.yaml');
  const checkpoint = await fs.readFile(file, 'utf8');
  const changed = spawnSync('git', ['switch', '-c', 'unrelated-branch'], {
    cwd: f.root,
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(changed.status, changed.stderr).toBe(0);
  await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(f.root), 'sdk-runs/native'), {
    recursive: true,
  });
  const rejected = await f.cli(['doctor', f.name, '--repair', '--confirmed']);
  expect(rejected.exitCode).not.toBe(0);
  expect(rejected.stdout).toContain('does not match the current branch');
  expect(await fs.readFile(file, 'utf8')).toBe(checkpoint);
  expect(
    original.actions.some(
      (action) => action.status === 'running' && action.claim?.sessionId === 'actual-agent',
    ),
  ).toBe(true);
});

it.each(['failed', 'not-run'])(
  'does not pass acceptance with a %s platform check',
  async (result) => {
    const f = await builderFixture();
    const built = await f.submit(f.builder.task.actionId, {
      summary: 'Implemented.',
      addressedAcceptanceIds: ['A1'],
      checks: [],
      knownLimits: [],
    });
    expect(built.exitCode, built.stdout).toBe(0);
    const output = built.envelope.data.resultTemplate.output;
    output.checks = [{ name: 'Required test', result, note: 'The required check did not pass.' }];
    Object.assign(output.response.result, {
      verdict: 'pass',
      acceptance: [{ id: 'A1', result: 'passed', reason: 'Claimed pass.' }],
      risks: [],
      summary: 'Claimed pass.',
    });
    const rejected = await f.submit(built.envelope.data.task.actionId, output);
    expect(rejected.exitCode).not.toBe(0);
    expect((await f.runtime.inspect(f.name)).status).not.toBe('completed');
  },
);

it('waits for user acceptance and rejects another session reporting the original task', async () => {
  const f = await builderFixture();
  const built = await f.submit(f.builder.task.actionId, {
    summary: 'Implemented.',
    addressedAcceptanceIds: ['A1'],
    checks: [],
    knownLimits: [],
  });
  expect(built.exitCode, built.stdout).toBe(0);
  const output = built.envelope.data.resultTemplate.output;
  Object.assign(output.response.result, {
    verdict: 'pass',
    acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed actual behavior.' }],
    risks: [],
    summary: 'Verified.',
  });
  const file = path.join(f.root, 'wrong-result.json');
  await fs.writeFile(file, JSON.stringify({ status: 'succeeded', output }));
  const wrong = await f.cli([
    'next',
    f.name,
    '--action',
    built.envelope.data.task.actionId,
    '--session',
    'unrelated-agent',
    '--result',
    file,
  ]);
  expect(wrong.exitCode).not.toBe(0);
  const passed = await f.submit(built.envelope.data.task.actionId, output);
  expect(passed.exitCode, passed.stdout).toBe(0);
  const run = await f.runtime.inspect(f.name);
  expect(run.status).not.toBe('completed');
  expect(
    run.waits.find((wait) => wait.stepId === 'verify.confirm' && wait.status === 'pending'),
  ).toBeDefined();
  expect(run.actions.some((action) => action.stepId.startsWith('archive.'))).toBe(false);
});

it('retains an explicit independent review requirement', async () => {
  const f = await builderFixture();
  const built = await f.submit(
    f.builder.task.actionId,
    {
      summary: 'Implemented.',
      addressedAcceptanceIds: ['A1'],
      checks: [],
      knownLimits: [],
      requireIndependentReview: true,
    },
    ['--review', 'independent'],
  );
  expect(built.exitCode, built.stdout).toBe(0);
  const denied = await f.cli(['next', f.name, '--session', 'actual-agent']);
  expect(denied.exitCode).not.toBe(0);
  const received = await f.cli(['next', f.name, '--session', 'independent-reviewer']);
  expect(received.exitCode, received.stdout).toBe(0);
  expect(received.envelope.data.task).toMatchObject({
    role: 'verify',
    session: 'independent-reviewer',
    requireIndependentReview: true,
  });
  const detailed = await f.cli(['next', f.name, '--session', 'independent-reviewer', '--details']);
  expect(detailed.exitCode, detailed.stdout).toBe(0);
  const current = detailed.envelope.data.details.activeActions.find(
    (action: { id: string }) => action.id === received.envelope.data.task.actionId,
  );
  expect(received.envelope.data.task.contextRequest).toEqual(current.contextRequest);
  expect(detailed.envelope.data.task.contextRequest).toEqual(current.contextRequest);
  expect(current.claim.sessionId).toBe('independent-reviewer');
});

it('reads the submitted platform report once before committing its result', async () => {
  const f = await builderFixture();
  const open = vi.spyOn(fs, 'open');
  const built = await f.submit(f.builder.task.actionId, {
    summary: 'Implemented.',
    addressedAcceptanceIds: ['A1'],
    checks: [],
    knownLimits: [],
  });
  expect(built.exitCode, built.stdout).toBe(0);
  expect(
    open.mock.calls.filter(([file]) => String(file) === path.join(f.root, 'result.json')),
  ).toHaveLength(1);
});

it('preserves the original agent task as unknown when recovering a v4 checkpoint', async () => {
  const f = await builderFixture();
  const original = await f.runtime.inspect(f.name);
  const runtimeRoot = resolveWorkspaceRuntimeRootSync(f.root);
  const directory = path.join(runtimeRoot, 'sdk-runs', 'native');
  expect(path.relative(runtimeRoot, directory)).toBe(path.join('sdk-runs', 'native'));
  await fs.rm(directory, { recursive: true });
  await expect(createNativeSdkStateStore(f.root, { readOnly: true }).read(f.name)).rejects.toThrow(
    'checkpoint recovery',
  );
  const repair = await f.cli(['doctor', f.name, '--repair', '--confirmed']);
  expect(repair.exitCode, repair.stdout).toBe(0);
  const restored = await createNativeSdkStateStore(f.root, { readOnly: true }).read(f.name);
  expect(restored?.revision).toBe(original.revision);
  expect(restored?.actions.at(-1)).toMatchObject({
    id: f.builder.task.actionId,
    status: 'unknown',
    claim: { sessionId: 'actual-agent' },
  });
  expect(restored?.actions.filter((action) => action.stepId === 'build.builder')).toHaveLength(1);
});

it('dispatches the Verifier directly when the user requests another review', async () => {
  const f = await builderFixture();
  const built = await f.submit(f.builder.task.actionId, {
    summary: 'Implemented.',
    addressedAcceptanceIds: ['A1'],
    checks: [],
    knownLimits: [],
  });
  const output = built.envelope.data.resultTemplate.output;
  Object.assign(output.response.result, {
    verdict: 'pass',
    acceptance: [{ id: 'A1', result: 'passed', reason: 'Observed behavior.' }],
    risks: [],
    summary: 'Verified.',
  });
  expect((await f.submit(built.envelope.data.task.actionId, output)).exitCode).toBe(0);
  const run = await f.runtime.inspect(f.name);
  const wait = run.waits.find(
    (item) => item.stepId === 'verify.confirm' && item.status === 'pending',
  )!;
  const reviewed = await createNativeSdkRuntime(f.root).resolveWait({
    runId: f.name,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: 'test-user-reverify',
    choice: 'reverify',
    context: { requestId: 'test-user-reverify', projectRoot: f.root },
  });
  expect(reviewed.actions.at(-1)?.stepId).toBe('verify.verifier');
  expect(reviewed.actions.filter((item) => item.stepId === 'verify.verifier')).toHaveLength(2);
  expect(reviewed.actions.some((item) => item.stepId.includes('checks'))).toBe(false);
  const claimed = await f.cli(['next', f.name, '--session', 'actual-agent']);
  expect(claimed.exitCode, claimed.stdout).toBe(0);
  const secondOutput = claimed.envelope.data.resultTemplate.output;
  const { iteration: _iteration, attempt: _attempt, ...conclusion } = output.response.result;
  Object.assign(secondOutput.response.result, conclusion);
  const completed = await f.submit(claimed.envelope.data.task.actionId, secondOutput, [
    '--accept-on-pass',
    'The user delegated acceptance after the requested second review passes.',
  ]);
  expect(completed.exitCode, completed.stdout).toBe(0);
  expect((await f.runtime.inspect(f.name)).status).toBe('completed');
});
