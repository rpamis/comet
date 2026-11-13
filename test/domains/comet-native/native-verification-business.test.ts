import '../../helpers/isolated-agent-home.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
  nativeProjectPaths,
  nativeChangeRuntimeDir,
} from '../../../domains/comet-native/native-paths.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  createNativePortableChange,
  readNativePortableChange,
  submitNativePortableBuilderCandidate,
  dispatchNativePortableVerifier,
  submitNativePortableVerifierResult,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { createNativeRunnerChannel } from '../../../domains/comet-native/native-runner-protocol.js';
import { confirmNativePortableShape } from '../../helpers/native-portable-confirmed-transition.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { collectNativeDashboardProjection } from '../../../domains/dashboard/native-collector.js';
import { continueNativeTransition } from '../../../domains/comet-native/native-transition-journal.js';
import { writeNativeWorkspaceIdentity } from '../../../domains/comet-native/native-workspace.js';
import { readSdkChangeOwner } from '../../../domains/workflow-contract/change-runtime-owner.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture(
  name = 'current-report',
  options: { shape?: boolean; failedCheck?: boolean; summary?: string } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-current-report-business-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.'),
    runner = createNativeRunnerChannel();
  await createNativePortableChange({ paths, name, language: 'en' });
  const dir = path.join(paths.changesDir, name);
  await fs.writeFile(
    path.join(dir, 'brief.md'),
    '# Acceptance examples\n- First behavior is implemented.\n- Second behavior is implemented.\n',
  );
  let state = await readNativePortableChange(paths, name);
  if (!options.shape) {
    state = await confirmNativePortableShape({ paths, name });
    if (options.failedCheck) {
      try {
        execFileSync(process.execPath, ['-e', 'process.exit(7)'], {
          stdio: 'ignore',
        });
        throw Error('expected actual Node7');
      } catch (error) {
        expect((error as { status?: number }).status).toBe(7);
      }
    }
    state = await submitNativePortableBuilderCandidate({
      paths,
      name,
      input: {
        identity: runner.captureExecutionIdentity({
          identityProvider: 'SIMULATED platform',
          executionRef: 'SIMULATED builder',
        }),
        summary: options.summary ?? 'SIMULATED Agent implemented the confirmed goal',
        addressedAcceptanceIds: ['A1', 'A2'],
        acceptanceReview: fixtureAcceptanceReview(['A1', 'A2']),
        checks: options.failedCheck
          ? [
              {
                name: 'Actual Node7 platform check',
                result: 'failed',
                note: 'The Agent executed an ordinary Node command; actual exit7',
              },
            ]
          : [],
        review: {
          status: 'passed',
          summary: 'SIMULATED independent read-only review',
          reviewerExecutionRef: 'SIMULATED reviewer',
        },
      },
    });
    state = await dispatchNativePortableVerifier({
      paths,
      name,
      verifierExecutionId: 'SIMULATED verifier',
    });
  }
  return { root, paths, name, dir, state, runner };
}
function result(
  acceptance: any[] = [
    { id: 'A1', result: 'passed', reason: 'Observed first' },
    { id: 'A2', result: 'passed', reason: 'Observed second' },
  ],
  verdict = 'pass',
) {
  return {
    kind: 'final-result',
    result: {
      iteration: 1,
      attempt: 1,
      verdict,
      acceptance,
      risks: [] as string[],
      summary: 'SIMULATED actual independent report',
    },
  };
}
async function submit(
  f: Awaited<ReturnType<typeof fixture>>,
  payload: unknown,
  bindings: { candidateId?: string; ref?: string } = {},
) {
  const current = await readNativePortableChange(f.paths, f.name);
  return submitNativePortableVerifierResult({
    paths: f.paths,
    name: f.name,
    maxVerifyFailures: 5,
    envelope: f.runner.envelopeVerifierResponse({
      candidateId: bindings.candidateId ?? current.builder_handoff!.candidate_id,
      identity: f.runner.captureExecutionIdentity({
        identityProvider: 'SIMULATED platform',
        executionRef: bindings.ref ?? 'SIMULATED verifier',
      }),
      payload,
    }),
  });
}
async function tree(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  async function visit(base: string) {
    for (const x of await fs.readdir(base, { withFileTypes: true })) {
      const file = path.join(base, x.name);
      if (x.isDirectory()) await visit(file);
      else
        out[path.relative(dir, file).replaceAll('\\', '/')] = (await fs.readFile(file)).toString(
          'base64',
        );
    }
  }
  await visit(dir);
  return out;
}
it.each([false, true])(
  'accepts complete current acceptance in either report order without a typed evidence envelope (reversed %s)',
  async (reverse) => {
    const f = await fixture(),
      payload = result();
    if (reverse) payload.result.acceptance.reverse();
    const accepted = await submit(f, payload);
    expect(accepted.state).toMatchObject({
      phase: 'verify',
      status: 'await-user',
      verification_result: 'pass',
    });
    expect(accepted.state.acceptance.map(({ id, result }) => ({ id, result }))).toEqual([
      { id: 'A1', result: 'passed' },
      { id: 'A2', result: 'passed' },
    ]);
    expect(accepted.state.verification!.checks).toEqual([]);
    expect(accepted.state).not.toHaveProperty('verification_evidence');
  },
);
it.each(['missing', 'unknown', 'duplicate', 'ambiguous', 'skipped'] as const)(
  'rejects a current %s acceptance report before changing state or an existing user report',
  async (kind) => {
    const f = await fixture(),
      file = path.join(f.dir, 'verification.md');
    await fs.writeFile(file, 'SIMULATED USER existing report notes\r\n');
    const before = await tree(f.dir),
      payload: any = result();
    if (kind === 'missing') payload.result.acceptance.pop();
    if (kind === 'unknown') payload.result.acceptance[1].id = 'another-candidate-A3';
    if (kind === 'duplicate') payload.result.acceptance[1].id = 'A1';
    if (kind === 'ambiguous') payload.result.acceptance[0].evidence_refs = ['.npmrc'];
    if (kind === 'skipped') payload.result.acceptance[0].result = 'skipped';
    await expect(submit(f, payload)).rejects.toThrow();
    expect(await tree(f.dir)).toEqual(before);
    if (kind === 'missing' || kind === 'skipped') {
      const accept = await runNativeCli([
        'next',
        f.name,
        '--accept-result',
        '--summary',
        'SIMULATED USER may not turn an incomplete report into a passed result',
        '--expected-state-version',
        String(f.state.state_version),
        '--expected-action',
        'accept-result',
        '--project-root',
        f.root,
        '--json',
      ]);
      expect(accept.exitCode).not.toBe(0);
      expect(await tree(f.dir)).toEqual(before);
    }
  },
);
it('rejects an incomplete failed matrix without inventing missing results and preserves an explicit complete failed and blocked report', async () => {
  const f = await fixture(),
    partial = result([{ id: 'A1', result: 'failed', reason: 'Actual failure observed' }], 'fail'),
    before = await tree(f.dir);
  await expect(submit(f, partial)).rejects.toThrow(/missing/);
  expect(await tree(f.dir)).toEqual(before);
  const failed = await submit(
    f,
    result(
      [
        { id: 'A1', result: 'failed', reason: 'Actual failure observed' },
        {
          id: 'A2',
          result: 'blocked',
          reason: 'Not checked because the first behavior failed',
        },
      ],
      'fail',
    ),
  );
  expect(failed.state).toMatchObject({
    phase: 'build',
    verification_result: 'fail',
  });
  expect(
    failed.state.acceptance.map(({ id, result, reason }) => ({
      id,
      result,
      reason: reason?.text,
    })),
  ).toEqual([
    { id: 'A1', result: 'failed', reason: 'Actual failure observed' },
    {
      id: 'A2',
      result: 'blocked',
      reason: 'Not checked because the first behavior failed',
    },
  ]);
  expect(failed.state.history.at(-1)).toMatchObject({
    outcome: 'fail',
    unresolved_ids: ['A1', 'A2'],
  });
});
it('never upgrades a real failed platform check to pass and retains it with the accepted failed report', async () => {
  const f = await fixture('actual-failed-report', { failedCheck: true }),
    before = await tree(f.dir);
  await expect(submit(f, result())).rejects.toThrow(/required check/);
  expect(await tree(f.dir)).toEqual(before);
  const failed = await submit(
    f,
    result(
      [
        { id: 'A1', result: 'failed', reason: 'Actual Node command exited7' },
        { id: 'A2', result: 'passed', reason: 'Second observed' },
      ],
      'fail',
    ),
  );
  expect(failed.state).toMatchObject({
    phase: 'build',
    verification_result: 'fail',
  });
  expect(failed.state.verification!.reported_checks).toEqual(failed.state.builder_handoff!.checks);
  expect(failed.state.verification!.reported_checks![0]).toMatchObject({
    result: 'failed',
  });
  expect(failed.state.verification!.reported_checks![0].note!.text).toContain('exit7');
});
it.each(['candidate', 'task'] as const)(
  'rejects a foreign %s result before writing report or state for the current Run',
  async (kind) => {
    const f = await fixture(),
      before = await tree(f.dir);
    await expect(
      submit(
        f,
        result(),
        kind === 'candidate'
          ? { candidateId: 'foreign-candidate' }
          : { ref: 'foreign-Verifier-session' },
      ),
    ).rejects.toThrow();
    expect(await tree(f.dir)).toEqual(before);
    expect((await readNativePortableChange(f.paths, f.name)).verifier_action).toEqual(
      f.state.verifier_action,
    );
  },
);
it('rejects Verify input in Shape through the public CLI before persisting any verification result', async () => {
  const f = await fixture('shape-not-verified', { shape: true }),
    before = await tree(f.dir),
    file = path.join(f.root, 'SIMULATED-verifier-input.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      kind: 'verifier-response',
      candidateId: 'no-approved-candidate',
      verifierExecutionRef: 'unbound',
      response: result(),
    }),
  );
  const rejected = await runNativeCli([
    'next',
    f.name,
    '--runner-input',
    file,
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(rejected.exitCode).not.toBe(0);
  expect(await tree(f.dir)).toEqual(before);
  await expect(fs.stat(path.join(f.dir, 'verification.md'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});
it('does not read a caller-supplied credential ref as typed evidence or leak its contents on rejection', async () => {
  const f = await fixture(),
    secret = 'SIMULATED-PRIVATE-REGISTRY-TOKEN',
    file = path.join(f.root, '.npmrc');
  await fs.writeFile(file, '//registry.invalid/:_authToken=' + secret);
  const payload: any = result();
  payload.result.acceptance[0].evidence_refs = ['.npmrc'];
  let error = '';
  try {
    await submit(f, payload);
  } catch (e) {
    error = String(e);
  }
  expect(error).toMatch(/unknown|unsupported|field/);
  expect(error).not.toContain(secret);
  expect(await fs.readFile(file, 'utf8')).toContain(secret);
  expect((await readNativePortableChange(f.paths, f.name)).verification_result).toBe('pending');
});
it('retains failed verification history and its report while a new candidate resets only current acceptance and results', async () => {
  const f = await fixture(),
    failed = await submit(
      f,
      result(
        [
          { id: 'A1', result: 'failed', reason: 'First needs repair' },
          { id: 'A2', result: 'passed', reason: 'Second observed' },
        ],
        'fail',
      ),
    ),
    report = path.join(f.dir, 'verification.md'),
    failedBytes = await fs.readFile(report);
  const next = await submitNativePortableBuilderCandidate({
    paths: f.paths,
    name: f.name,
    input: {
      identity: f.runner.captureExecutionIdentity({
        identityProvider: 'SIMULATED platform',
        executionRef: 'SIMULATED repair builder',
      }),
      summary: 'SIMULATED repaired first behavior',
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1', 'A2']),
      checks: [],
      review: null,
    },
  });
  expect(next).toMatchObject({
    phase: 'verify',
    verification_result: 'pending',
    verification_report: null,
    verification: null,
  });
  expect(next.builder_handoff!.candidate_id).not.toBe(failed.state.builder_handoff!.candidate_id);
  expect(next.history).toEqual(failed.state.history);
  expect(next.acceptance.every((a) => a.result === 'pending')).toBe(true);
  expect(await fs.readFile(report)).toEqual(failedBytes);
});
it('keeps an explicitly accepted Archive result unchanged through an ordinary public next continuation', async () => {
  const f = await fixture(),
    pass = await submit(f, result());
  const accepted = await runNativeCli([
    'next',
    f.name,
    '--accept-result',
    '--summary',
    'SIMULATED USER accepts the original independent result',
    '--expected-state-version',
    String(pass.state.state_version),
    '--expected-action',
    'accept-result',
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(accepted.exitCode, accepted.stdout).toBe(0);
  const before = await tree(f.dir),
    state = await readNativePortableChange(f.paths, f.name);
  expect(state.phase).toBe('archive');
  const ordinary = await runNativeCli(['next', f.name, '--project-root', f.root, '--json']);
  expect(ordinary.exitCode, ordinary.stdout).toBe(0);
  expect(await tree(f.dir)).toEqual(before);
  expect(await readNativePortableChange(f.paths, f.name)).toEqual(state);
});
it('keeps an invalid actual published trajectory from importing or writing a new Verify result', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-invalid-old-trajectory-no-result-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.'),
    old = JSON.parse(
      await fs.readFile(
        path.resolve('test/fixtures/native-052-transition-journal/remove-after-recovery.json'),
        'utf8',
      ),
    );
  for (const item of old.materials.files) {
    const file = path.join(paths.nativeRoot, ...item.ref.split('/'));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(item.bytesBase64, 'base64'));
  }
  const runtime = nativeChangeRuntimeDir(paths, old.name);
  await fs.mkdir(runtime, { recursive: true });
  await fs.writeFile(path.join(runtime, 'transition.json'), old.journalText);
  await writeNativeWorkspaceIdentity({
    paths,
    name: old.name,
    revision: old.originalState.revision,
  });
  await continueNativeTransition(paths, old.name);
  const trajectory = path.join(runtime, 'trajectory.jsonl');
  await fs.appendFile(trajectory, '{invalid complete JSON line}\n');
  const dir = path.join(paths.changesDir, old.name),
    before = await tree(dir),
    beforeTrajectory = await fs.readFile(trajectory),
    next = await runNativeCli([
      'next',
      old.name,
      '--summary',
      'SIMULATED continue must stop on invalid original trajectory',
      '--project-root',
      root,
      '--json',
    ]);
  expect(next.exitCode).not.toBe(0);
  expect(await tree(dir)).toEqual(before);
  expect(await fs.readFile(trajectory)).toEqual(beforeTrajectory);
  expect(await readSdkChangeOwner(root, 'native', old.name)).toBeNull();
});
it('keeps a real legacy archive visible and all original files unchanged without treating old envelope counters as authority', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-legacy-archive-readonly-counter-'));
  roots.push(root);
  await writeProjectConfig(root, defaultProjectConfig('.', 'en'));
  const paths = await nativeProjectPaths(root, '.'),
    name = '2026-07-21-classic-config-block',
    dir = path.join(paths.archiveDir, name);
  await fs.mkdir(paths.archiveDir, { recursive: true });
  await fs.cp(path.resolve('docs/comet/archive', name), dir, {
    recursive: true,
  });
  const state = parse(await fs.readFile(path.join(dir, 'comet-state.yaml'), 'utf8')),
    file = path.join(dir, state.verification_evidence);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({
      schema: 'comet.native.verification-evidence.v1',
      change: state.name,
      envelopeHash: path.basename(file, '.json'),
      acceptanceTrace: {
        schema: 'comet.native.acceptance-trace.v1',
        total: 3,
        evidenced: 2,
        skipped: 1,
      },
      note: 'SIMULATED old auxiliary counter document; original archive state/materials are actual repository history',
    }),
  );
  const before = await tree(dir),
    configBefore = await fs.readFile(paths.configFile);
  const projection = await collectNativeDashboardProjection(root),
    item = projection.changes.find((c) => c.name === state.name)!;
  expect(item).toMatchObject({
    status: 'archived',
    legacy: true,
    verificationResult: 'pass',
    acceptance: null,
    acceptanceItems: [],
    migration: { status: 'legacy-read-only' },
  });
  expect(await tree(dir)).toEqual(before);
  expect(await fs.readFile(paths.configFile)).toEqual(configBefore);
  expect(await readSdkChangeOwner(root, 'native', state.name)).toBeNull();
});

it.each(['transition', 'no-code'] as const)(
  'preserves credential redaction for a current %s public Builder report',
  async (kind) => {
    const f = await fixture('current-redaction-' + kind, { shape: true });
    await confirmNativePortableShape({ paths: f.paths, name: f.name });
    const summary =
        kind === 'transition'
          ? 'Valid credentials remain ordinary prose; Bearer transition-secret-value'
          : 'Documented credentials semantics with password=summary-secret-value',
      limits =
        kind === 'transition'
          ? ['Exclude unrelated work with api_key=partial-secret-value']
          : ['No project edit is required; access_token=no-code-secret-value'];
    const input = path.join(f.root, 'SIMULATED-user-input.json');
    await fs.writeFile(
      input,
      JSON.stringify({
        kind: 'builder-handoff',
        summary,
        addressed_acceptance_ids: ['A1', 'A2'],
        acceptance_review: fixtureAcceptanceReview(['A1', 'A2']),
        checks: [],
        known_limits: limits,
        review: null,
      }),
    );
    const result = await runNativeCli([
      'next',
      f.name,
      '--runner-input',
      input,
      '--project-root',
      f.root,
      '--json',
    ]);
    expect(result.exitCode, result.stdout).toBe(0);
    const state = await readNativePortableChange(f.paths, f.name);

    const persisted = JSON.stringify(state),
      returned = JSON.stringify(result);
    for (const marker of [
      'transition-secret-value',
      'partial-secret-value',
      'summary-secret-value',
      'no-code-secret-value',
    ]) {
      expect(persisted).not.toContain(marker);
      expect(returned).not.toContain(marker);
    }
    expect(state.builder_handoff!.summary.text).toContain('[REDACTED]');
  },
);
it('redacts Native Verifier summary risks and acceptance reasons in current state and its generated report through the public CLI', async () => {
  const f = await fixture('current-verifier-redaction'),
    payload = result([
      {
        id: 'A1',
        result: 'passed',
        reason: 'Observed behavior; access_token=verifier-reason-secret-value',
      },
      { id: 'A2', result: 'passed', reason: 'Second observed' },
    ]);
  payload.result.summary = 'Actual verification summary; Bearer verifier-summary-secret-value';
  payload.result.risks = ['Current limitation; password=verifier-risk-secret-value'];
  const file = path.join(f.root, 'SIMULATED-verifier-input.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      kind: 'verifier-response',
      candidateId: f.state.builder_handoff!.candidate_id,
      verifierExecutionRef: 'SIMULATED verifier',
      response: payload,
    }),
  );
  const submitted = await runNativeCli([
    'next',
    f.name,
    '--runner-input',
    file,
    '--project-root',
    f.root,
    '--json',
  ]);
  expect(submitted.exitCode, submitted.stdout).toBe(0);
  const state = await readNativePortableChange(f.paths, f.name),
    report = await fs.readFile(path.join(f.dir, 'verification.md'), 'utf8');
  expect(state).toMatchObject({
    phase: 'verify',
    status: 'await-user',
    verification_result: 'pass',
  });
  for (const marker of [
    'verifier-summary-secret-value',
    'verifier-reason-secret-value',
    'verifier-risk-secret-value',
  ]) {
    expect(JSON.stringify(state)).not.toContain(marker);
    expect(report).not.toContain(marker);
    expect(submitted.stdout).not.toContain(marker);
  }
  expect(state.verification!.summary.text).toContain('[REDACTED]');
  expect(state.acceptance[0].reason!.text).toContain('[REDACTED]');
  expect(report).toContain('[REDACTED]');
  expect(await fs.readFile(file, 'utf8')).toContain('verifier-summary-secret-value');
});
