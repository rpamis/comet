import '../../helpers/isolated-agent-home.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import { archiveNativePortableChange } from '../../../domains/comet-native/native-portable-archive.js';
import {
  confirmNativePortableShape,
  confirmNativePortableSkillCoordinatedPass,
  createNativePortableChange,
  dispatchNativePortableVerifier,
  nativePortableChangeDir,
  prepareNativePortableShapeConfirmation,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
  submitNativePortableVerifierResult,
  syncNativePortableSpecReferences,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import {
  inspectDiscoveredNativeStatus,
  listDiscoveredNativeStatusPage,
} from '../../../domains/comet-native/native-status-discovery.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
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
  const runner = createNativeRunnerChannel(),
    initial = await readNativePortableChange(paths, 'change'),
    observed = execFileSync(
      process.execPath,
      ['-e', 'process.stdout.write("real-platform-check")'],
      { cwd: paths.projectRoot, encoding: 'utf8' },
    );
  expect(observed).toBe('real-platform-check');
  const checks = [
    {
      name: 'Actual Agent-platform Node probe',
      result: 'passed' as const,
      note: 'Actual process exited 0 and printed real-platform-check.',
    },
  ];
  await submitNativePortableBuilderCandidate({
    paths,
    name: 'change',
    input: {
      identity: runner.captureExecutionIdentity({
        identityProvider: 'SIMULATED-Agent',
        executionRef: 'builder',
      }),
      candidateId: 'candidate',
      summary: 'SIMULATED implementation with actual platform probe.',
      addressedAcceptanceIds: initial.acceptance.map((a) => a.id),
      acceptanceReview: fixtureAcceptanceReview(initial.acceptance.map((a) => a.id)),
      checks,
      review: {
        status: 'passed',
        summary: 'SIMULATED independent review.',
        reviewerExecutionRef: 'reviewer',
      },
    },
  });
  const state = await dispatchNativePortableVerifier({
    paths,
    name: 'change',
    verifierExecutionId: 'verifier',
  });
  return submitNativePortableVerifierResult({
    paths,
    name: 'change',
    checks,
    maxVerifyFailures: 5,
    envelope: runner.envelopeVerifierResponse({
      candidateId: 'candidate',
      identity: runner.captureExecutionIdentity({
        identityProvider: 'SIMULATED-Agent',
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
            reason: 'SIMULATED independent inspection of the requested behavior.',
          })),
          risks: [],
          summary: 'SIMULATED complete independent result with actual platform observation.',
        },
      },
    }),
  });
}
describe('Native reliability issue regressions', () => {
  it('reads explicitly selected and imported archives while preserving local provenance and isolating corrupt records', async () => {
    const { root, paths, changeDir } = await project();
    await shape(paths);
    git(root, 'add', 'docs');
    git(root, 'commit', '-m', 'active');
    const old = path.join(root, '.worktrees', 'old');
    git(root, 'worktree', 'add', '-b', 'old', old);
    await verify(paths);
    // SIMULATED USER explicitly accepts the independently verified current result.
    await confirmNativePortableSkillCoordinatedPass({ paths, name: 'change' });
    const archive = await archiveNativePortableChange({ paths, name: 'change' });
    git(root, 'add', 'docs');
    git(root, 'commit', '-m', 'archive');
    await fs.writeFile(path.join(old, 'unrelated.txt'), 'unrelated');
    git(old, 'add', 'unrelated.txt');
    git(old, 'commit', '-m', 'unrelated');
    const oldOnly = await inspectDiscoveredNativeStatus({
      projectRoot: old,
      name: 'change',
      details: true,
    });
    expect(oldOnly.status).not.toBe('done');
    const query = () =>
      inspectDiscoveredNativeStatus({ projectRoot: root, name: 'change', details: true });
    const queryLocal = () =>
      inspectDiscoveredNativeStatus({ projectRoot: old, name: 'change', details: true });
    expect(await query()).toMatchObject({
      status: 'done',
      archived: true,
      acceptance: { passed: 2, total: 2 },
      continuation: { disposition: 'done' },
    });
    const copy = path.join(old, path.relative(root, archive.archiveDir));
    await fs.cp(archive.archiveDir, copy, { recursive: true });
    git(old, 'add', path.relative(old, copy));
    git(old, 'commit', '-m', 'SIMULATED explicit business archive import');
    expect(await queryLocal()).toMatchObject({ status: 'done', archived: true });
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
    for (const schema of ['comet.native.v99', 'missing']) {
      await fs.writeFile(
        path.join(bad, 'comet-state.yaml'),
        schema === 'missing' ? 'name: broken' : `schema: ${schema}`,
      );
      expect((await listDiscoveredNativeStatusPage({ projectRoot: root })).items).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'broken', status: 'blocked' })]),
      );
    }
    await fs.writeFile(path.join(bad, 'comet-state.yaml'), 'schema: comet.native.v3');
    expect(
      (await listDiscoveredNativeStatusPage({ projectRoot: root })).items.map(({ name }) => name),
    ).not.toContain('broken');
    const staleFile = path.join(old, path.relative(root, changeDir), 'comet-state.yaml');
    await fs.writeFile(
      staleFile,
      (await fs.readFile(staleFile, 'utf8')).replace('state_version: 3', 'state_version: 4'),
    );
    expect(await queryLocal()).toMatchObject({
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
    const syncFile = path.join(root, 'spec-sync-input.json');
    const commandInput = {
      actor: input.actor,
      reason: input.reason,
      expectedStateVersion: input.expectedStateVersion,
      affectedAcceptanceIds: input.affectedAcceptanceIds,
      replacements: input.replacements,
    };
    const syncCli = async () =>
      JSON.parse(
        (
          await runNativeCli([
            'spec',
            'sync',
            'change',
            'feature',
            '--input',
            syncFile,
            '--project-root',
            root,
            '--json',
          ])
        ).stdout!,
      );
    expect(await syncCli()).toMatchObject({ exitCode: 64 });
    await fs.writeFile(syncFile, '{invalid json');
    expect(await syncCli()).toMatchObject({ exitCode: 64 });
    for (const invalid of [
      { ...commandInput, unexpected: true },
      { ...commandInput, expectedStateVersion: 'old' },
      { ...commandInput, replacements: [{ from: 'old.md' }] },
    ]) {
      await fs.writeFile(syncFile, JSON.stringify(invalid));
      expect(await syncCli()).toMatchObject({ exitCode: 64 });
      expect((await readNativePortableChange(paths, 'change')).state_version).toBe(
        before.state_version,
      );
    }
    await fs.writeFile(syncFile, 'x'.repeat(1024 * 1024 + 1));
    expect(await syncCli()).toMatchObject({ exitCode: 64 });
    expect((await readNativePortableChange(paths, 'change')).state_version).toBe(
      before.state_version,
    );
    await fs.writeFile(syncFile, JSON.stringify(commandInput));
    expect(await syncCli()).toMatchObject({ exitCode: 0 });
    await fs.rm(syncFile);
    const synced = await readNativePortableChange(paths, 'change');
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
    expect(result.error.message).toContain('comet native doctor change --repair');
    const diagnosed = JSON.parse(
      (await runNativeCli(['status', 'change', '--project-root', root, '--json'])).stdout!,
    ).data;
    expect(diagnosed).toMatchObject({
      phase: 'invalid',
      schema: 'comet.native.v99',
      nextCommand: null,
    });
    expect(diagnosed.error).toContain('protocol');
  }, 120000);
});
