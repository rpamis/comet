import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
  nativePreferredChangeRuntimeDir,
} from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  nativePortableChangeDir,
  prepareNativePortableShapeConfirmation,
  confirmNativePortableShape,
  submitNativePortableBuilderCandidate,
  executeNativePortableCheckPlan,
  dispatchNativePortableVerifier,
  submitNativePortableVerifierResult,
  confirmNativePortableSkillCoordinatedPass,
  readNativePortableChange,
  syncNativePortableSpecReferences,
  inspectNativePortableAcceptanceDrift,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { archiveNativePortableChange } from '../../../domains/comet-native/native-portable-archive.js';
import {
  inspectDiscoveredNativeStatus,
  listDiscoveredNativeStatusPage,
} from '../../../domains/comet-native/native-status-discovery.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  applyNativeRunnerInput,
  parseNativeRunnerInput,
} from '../../../domains/comet-native/native-runner-input.js';
import {
  dispatchNativeSupervisorReadyTasks,
  readNativeSupervisorState,
  nativeSupervisorStateFile,
} from '../../../domains/comet-native/native-supervisor.js';
import { executeNativeSupervisorChecks } from '../../../domains/comet-native/native-supervisor-evidence.js';

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
const git = (root: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
const plan = (id = 'test', code = 'process.exit(0)') => ({
  id,
  name: id,
  executable: process.execPath,
  argv: ['-e', code],
  cwdRef: '.',
  timeoutMs: 10000,
  repeatable: true,
});
async function project() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-reliability-'));
  roots.push(root);
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
    name: 'change',
    language: 'en',
    workspaceBinding: { isolation: 'current', changeBranch: 'main', targetBranch: 'main' },
  });
  const changeDir = nativePortableChangeDir(paths, 'change');
  await fs.writeFile(
    path.join(changeDir, 'brief.md'),
    '# Acceptance examples\n- The first behavior works.\n- The second behavior works.\n',
  );
  return { root, paths, changeDir };
}
async function shape(paths: Awaited<ReturnType<typeof nativeProjectPaths>>) {
  await prepareNativePortableShapeConfirmation({ paths, name: 'change' });
  return confirmNativePortableShape({ paths, name: 'change' });
}
async function verify(paths: Awaited<ReturnType<typeof nativeProjectPaths>>, failSecond = false) {
  const runner = createNativeRunnerChannel();
  const initial = await readNativePortableChange(paths, 'change');
  await submitNativePortableBuilderCandidate({
    paths,
    name: 'change',
    input: {
      identity: runner.captureExecutionIdentity({
        identityProvider: 'test-host',
        executionRef: 'builder',
      }),
      candidateId: 'candidate',
      summary: 'Implemented.',
      addressedAcceptanceIds: initial.acceptance.map(({ id }) => id),
      review: {
        status: 'passed',
        summary: 'Independently reviewed.',
        reviewerExecutionRef: 'reviewer',
      },
    },
  });
  const executed = await executeNativePortableCheckPlan({ paths, name: 'change', plans: [plan()] });
  const state = await dispatchNativePortableVerifier({
    paths,
    name: 'change',
    checks: executed.checks,
  });
  return submitNativePortableVerifierResult({
    paths,
    name: 'change',
    checks: executed.checks,
    maxVerifyFailures: 5,
    envelope: runner.envelopeVerifierResponse({
      candidateId: 'candidate',
      identity: runner.captureExecutionIdentity({
        identityProvider: 'test-host',
        executionRef: 'verifier',
      }),
      payload: {
        kind: 'final-result',
        result: {
          iteration: state.loop.iteration,
          attempt: state.loop.attempt,
          verdict: failSecond ? 'fail' : 'pass',
          acceptance: state.acceptance.map(({ id }) => ({
            id,
            result: failSecond && id === 'A2' ? 'failed' : 'passed',
            reason: 'Independently checked.',
          })),
          risks: [],
          summary: 'Checked.',
        },
      },
    }),
  });
}

describe('Native reliability issue regressions', () => {
  it('selects a proven archive across worktrees, preserves duplicate provenance and isolates corrupt archives', async () => {
    const { root, paths, changeDir } = await project();
    await shape(paths);
    git(root, 'add', 'docs');
    git(root, 'commit', '-m', 'active');
    const old = path.join(root, '.worktrees', 'old');
    git(root, 'worktree', 'add', '-b', 'old', old);
    await verify(paths);
    await confirmNativePortableSkillCoordinatedPass({ paths, name: 'change' });
    const archive = await archiveNativePortableChange({ paths, name: 'change' });
    git(root, 'add', 'docs');
    git(root, 'commit', '-m', 'archive');
    await fs.writeFile(path.join(old, 'unrelated.txt'), 'unrelated');
    git(old, 'add', 'unrelated.txt');
    git(old, 'commit', '-m', 'unrelated');
    const query = () =>
      inspectDiscoveredNativeStatus({ projectRoot: old, name: 'change', details: true });
    expect(await query()).toMatchObject({
      status: 'done',
      archived: true,
      acceptance: { passed: 2, total: 2 },
      localExecution: { status: 'not-expected' },
      continuation: { disposition: 'done' },
    });
    const copy = path.join(old, path.relative(root, archive.archiveDir));
    await fs.cp(archive.archiveDir, copy, { recursive: true });
    expect(await query()).toMatchObject({ status: 'done' });
    const bad = path.join(paths.archiveDir, '2026-01-01-broken');
    await fs.mkdir(bad);
    await fs.writeFile(path.join(bad, 'comet-state.yaml'), 'broken: [');
    expect(await query()).toMatchObject({ status: 'done' });
    expect((await listDiscoveredNativeStatusPage({ projectRoot: root })).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'broken', status: 'blocked' }),
        expect.objectContaining({ name: 'change', status: 'done' }),
      ]),
    );
    const staleFile = path.join(old, path.relative(root, changeDir), 'comet-state.yaml');
    await fs.writeFile(
      staleFile,
      (await fs.readFile(staleFile, 'utf8')).replace('state_version: 3', 'state_version: 4'),
    );
    expect(await query()).toMatchObject({
      status: 'blocked',
      inspectionError: expect.stringContaining('supersession'),
    });
  }, 120000);

  it('audits reference sync and preserves unaffected passes while rejecting semantic and stale updates', async () => {
    const { root, paths, changeDir } = await project();
    const specDir = path.join(changeDir, 'specs', 'feature');
    await fs.mkdir(specDir, { recursive: true });
    const spec =
      '# Requirement\nThe two behaviors MUST work. See [decision](old.md).\n\n````md\n```\n[example](old.md)\n```\n````\n> ```md\n> [quoted-example](old.md)\n> ```\n';
    await fs.writeFile(path.join(specDir, 'spec.md'), spec);
    await shape(paths);
    await verify(paths, true);
    const before = await readNativePortableChange(paths, 'change');
    const input = {
      paths,
      name: 'change',
      capability: 'feature',
      actor: 'reviewer',
      reason: 'Correct accepted ADR reference',
      expectedStateVersion: before.state_version,
      affectedAcceptanceIds: ['A2'],
      replacements: [{ from: 'old.md', to: 'new.md' }],
    };
    const synced = await syncNativePortableSpecReferences(input);
    expect(synced).toMatchObject({
      phase: 'build',
      acceptance: [
        { id: 'A1', result: 'passed' },
        { id: 'A2', result: 'pending' },
      ],
    });
    expect(synced.loop.previous_unresolved_ids).toEqual(['A2']);
    expect(await fs.readFile(path.join(specDir, 'spec.md'), 'utf8')).toContain(
      '[decision](new.md)',
    );
    expect(await fs.readFile(path.join(specDir, 'spec.md'), 'utf8')).toContain('[example](old.md)');
    expect(await fs.readFile(path.join(specDir, 'spec.md'), 'utf8')).toContain(
      '[quoted-example](old.md)',
    );
    expect(synced.history.at(-1)?.summary.text).toContain('reviewer');
    expect(await inspectNativePortableAcceptanceDrift({ paths, state: synced })).toEqual({
      drifted: false,
      reason: null,
    });
    await expect(syncNativePortableSpecReferences(input)).rejects.toThrow('stale');
    await expect(
      syncNativePortableSpecReferences({
        ...input,
        expectedStateVersion: synced.state_version,
        replacements: [{ from: 'The two behaviors MUST work.', to: 'No behavior required.' }],
      }),
    ).rejects.toThrow('Markdown reference');
    const stateFile = path.join(changeDir, 'comet-state.yaml');
    await fs.writeFile(
      stateFile,
      (await fs.readFile(stateFile, 'utf8')).replace('comet.native.v4', 'comet.native.v99'),
    );
    const result = JSON.parse(
      (
        await runNativeCli([
          'next',
          'change',
          '--summary',
          'resume',
          '--project-root',
          root,
          '--json',
        ])
      ).stdout!,
    );
    expect(result.exitCode).toBe(65);
    expect(result.error.message).toContain('comet.native.v99');
    expect(result.error.message).toContain('protocol');
  }, 120000);

  it.each(['fail', 'blocked'] as const)(
    'records %s without a check receipt and rejects unsafe check plans',
    async (verdict) => {
      const { root, paths, changeDir } = await project();
      await fs.writeFile(
        path.join(changeDir, 'children.yaml'),
        'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: The first behavior works.\n  A2:\n    source: brief.md\n    text: The second behavior works.\nchildren:\n  - name: core\n    depends_on: []\n    covers: [A1, A2]\n',
      );
      await shape(paths);
      const dispatch = await dispatchNativeSupervisorReadyTasks({ paths, parent: 'change' });
      const builder = dispatch.tasks[0];
      expect(builder.acceptance?.map(({ id }) => id)).toEqual(['A1', 'A2']);
      expect(builder.checksReason).toBe('not-run');
      await fs.writeFile(path.join(builder.projectRoot, 'feature.txt'), 'implemented');
      git(builder.projectRoot, 'add', 'feature.txt');
      git(builder.projectRoot, 'commit', '-m', 'implement');
      const candidateCommit = git(builder.projectRoot, 'rev-parse', 'HEAD');
      const buildResult = await applyNativeRunnerInput({
        paths,
        name: 'change',
        maxVerifyFailures: 5,
        input: {
          kind: 'supervisor-builder-result',
          child: 'core',
          runId: builder.runId,
          candidateCommit,
        },
      });
      const task = buildResult.supervisorTask!;

      const before = await readNativeSupervisorState(paths, 'change');
      await expect(
        executeNativeSupervisorChecks({
          paths,
          parent: 'change',
          child: 'core',
          runId: task.runId,
          plans: [{ ...plan(), repeatable: false }],
          materials: [],
        }),
      ).rejects.toThrow('repeatable');
      expect(await readNativeSupervisorState(paths, 'change')).toEqual(before);
      const failed = await applyNativeRunnerInput({
        paths,
        name: 'change',
        maxVerifyFailures: 5,
        input: parseNativeRunnerInput({
          kind: 'supervisor-verifier-result',
          child: 'core',
          runId: task.runId,
          verdict,
          evidence: {
            summary: 'Cannot confirm behavior.',
            checks: [],
            receiptRef: null,
            acceptance: [
              {
                id: 'A1',
                result: verdict === 'fail' ? 'failed' : 'blocked',
                reason: 'Behavior unavailable.',
              },
              { id: 'A2', result: 'passed', reason: 'Inspected.' },
            ],
          },
        }),
      });
      expect(failed.supervisorState!.children[0]).toMatchObject({
        status: 'needs-reverify',
        task: null,
        verifiedCommit: null,
      });
      expect(failed.supervisorState!.children[0].verification?.checks).toEqual([]);
    },
    120000,
  );

  it('requires Runtime checks and complete child acceptance, binds immutable material and integrates with executed checks', async () => {
    const { root, paths, changeDir } = await project();
    await fs.writeFile(
      path.join(changeDir, 'children.yaml'),
      'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: The first behavior works.\n  A2:\n    source: brief.md\n    text: The second behavior works.\nchildren:\n  - name: core\n    depends_on: []\n    covers: [A1, A2]\n',
    );
    await shape(paths);
    const dispatch = await dispatchNativeSupervisorReadyTasks({ paths, parent: 'change' });
    const builder = dispatch.tasks[0];
    expect(builder.acceptance?.map(({ id }) => id)).toEqual(['A1', 'A2']);
    expect(builder.checksReason).toBe('not-run');
    await fs.writeFile(path.join(builder.projectRoot, 'feature.txt'), 'implemented');
    git(builder.projectRoot, 'add', 'feature.txt');
    git(builder.projectRoot, 'commit', '-m', 'implement');
    const candidateCommit = git(builder.projectRoot, 'rev-parse', 'HEAD');
    const buildResult = await applyNativeRunnerInput({
      paths,
      name: 'change',
      maxVerifyFailures: 5,
      input: {
        kind: 'supervisor-builder-result',
        child: 'core',
        runId: builder.runId,
        candidateCommit,
      },
    });
    const task = buildResult.supervisorTask!;
    // Simulate an in-flight rc.5 overlay without newly introduced scope fields.
    const legacyFile = nativeSupervisorStateFile(paths, 'change');
    const legacy = JSON.parse(await fs.readFile(legacyFile, 'utf8'));
    for (const child of legacy.children) {
      delete child.acceptanceScope;
      delete child.contractHash;
      if (child.task) {
        delete child.task.acceptance;
        delete child.task.contractHash;
      }
    }
    await fs.writeFile(legacyFile, JSON.stringify(legacy));
    expect(
      (await readNativeSupervisorState(paths, 'change'))!.children[0].task!.acceptance?.map(
        ({ id }) => id,
      ),
    ).toEqual(['A1', 'A2']);
    const options = {
      paths,
      parent: 'change',
      child: 'core',
      runId: task.runId,
      plans: [plan()],
      materials: [{ name: 'probe', content: 'Current candidate probe.' }],
    };
    const receipt = await executeNativeSupervisorChecks(options);
    expect(receipt.status).toBe('completed');
    expect(await executeNativeSupervisorChecks(options)).toEqual(receipt);
    const evidence = {
      summary: 'Verified both behaviors.',
      checks: ['non-formal note'],
      receiptRef: receipt.receiptRef!,
      acceptance: [
        { id: 'A1', result: 'passed', reason: 'Checked first.' },
        { id: 'A2', result: 'passed', reason: 'Checked second.' },
      ],
    };
    const input = (acceptance = evidence.acceptance) =>
      parseNativeRunnerInput({
        kind: 'supervisor-verifier-result',
        child: 'core',
        runId: task.runId,
        verdict: 'pass',
        evidence: { ...evidence, acceptance },
      });
    await expect(
      applyNativeRunnerInput({
        paths,
        name: 'change',
        maxVerifyFailures: 5,
        input: input(evidence.acceptance.slice(0, 1)),
      }),
    ).rejects.toThrow('missing: A2');
    await expect(
      applyNativeRunnerInput({
        paths,
        name: 'change',
        maxVerifyFailures: 5,
        input: input([...evidence.acceptance, evidence.acceptance[0]]),
      }),
    ).rejects.toThrow('duplicate: A1');
    await expect(
      applyNativeRunnerInput({
        paths,
        name: 'change',
        maxVerifyFailures: 5,
        input: input([{ ...evidence.acceptance[0], result: 'failed' }, evidence.acceptance[1]]),
      }),
    ).rejects.toThrow('every acceptance');
    const file = path.join(
      nativePreferredChangeRuntimeDir(paths, 'change'),
      receipt.receiptRef!.replace(/^runtime\//u, ''),
    );
    const original = await fs.readFile(file, 'utf8');
    await fs.writeFile(
      file,
      original.replace('Current candidate probe.', 'Tampered candidate probe.'),
    );
    await expect(
      applyNativeRunnerInput({ paths, name: 'change', maxVerifyFailures: 5, input: input() }),
    ).rejects.toThrow('hash');
    await fs.writeFile(file, original);
    await applyNativeRunnerInput({ paths, name: 'change', maxVerifyFailures: 5, input: input() });
    expect((await readNativeSupervisorState(paths, 'change'))!.children[0].status).toBe('verified');
    await expect(
      applyNativeRunnerInput({ paths, name: 'change', maxVerifyFailures: 5, input: input() }),
    ).rejects.toThrow('not active');
    const integrationState = await readNativeSupervisorState(paths, 'change');
    const integrationHead = git(integrationState!.integration.worktree, 'rev-parse', 'HEAD');
    await expect(
      applyNativeRunnerInput({
        paths,
        name: 'change',
        maxVerifyFailures: 5,
        input: parseNativeRunnerInput({
          kind: 'supervisor-integrate',
          child: 'core',
          checks: [{ ...plan('unsafe-integration'), repeatable: false }],
        }),
      }),
    ).rejects.toThrow('repeatable');
    expect(git(integrationState!.integration.worktree, 'rev-parse', 'HEAD')).toBe(integrationHead);
    const integrated = await applyNativeRunnerInput({
      paths,
      name: 'change',
      maxVerifyFailures: 5,
      input: parseNativeRunnerInput({
        kind: 'supervisor-integrate',
        child: 'core',
        checks: [plan('integration')],
      }),
    });
    expect(integrated.supervisorState!.children[0]).toMatchObject({
      status: 'integrated',
      checks: [{ status: 'passed', receiptRef: expect.any(String) }],
    });
    expect(git(root, 'rev-parse', 'main')).not.toBe(candidateCommit);
  }, 120000);
});
