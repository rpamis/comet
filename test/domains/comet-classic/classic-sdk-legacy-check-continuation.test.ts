import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { writeClassicProjectText } from '../../../domains/comet-classic/classic-protected-path.js';
import { assertVerifyEvidenceCurrent } from '../../../domains/comet-classic/classic-sdk-archive-preflight.js';
import {
  classicSdkCheckDirectoryRef,
  recordClassicSdkCheckReceipt,
} from '../../../domains/comet-classic/classic-sdk-check-record.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import type { ClassicState } from '../../../domains/comet-classic/classic-state.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

// Preserve the original v1 managed-check contract; default v2 Runs have separate public CLI coverage.
vi.mock('../../../domains/comet-classic/classic-sdk-application.js', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../../../domains/comet-classic/classic-sdk-application.js')
    >();
  return {
    ...actual,
    defineClassicAgentWorkflowApplication: actual.defineClassicWorkflowApplication,
  };
});

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(entry: 'source' | 'generated') {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-legacy-check-'));
  roots.push(base);
  const root = path.join(base, 'project'),
    home = path.join(base, 'home');
  await fs.mkdir(home);
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('COMET_DATA_DIR', path.join(base, 'runtime'));
  await prepareClassicLegacyProject(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  const invoke = async (...args: string[]) => {
    const separator = args.indexOf('--');
    args.splice(separator < 0 ? args.length : separator, 0, '--json');
    if (entry === 'source' || (args[0] === 'state' && args[1] === 'init'))
      return runClassicCli(args, undefined, { invocationCwd: root });
    const result = spawnSync(
      process.execPath,
      [path.resolve('assets/skills/comet/scripts/comet-runtime.mjs'), ...args],
      { cwd: root, encoding: 'utf8', windowsHide: true },
    );
    return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  };
  const cli = async (...args: string[]) => {
    const result = await invoke(...args);
    expect(result.exitCode, result.stdout ?? result.stderr).toBe(0);
    return JSON.parse(result.stdout!).data;
  };
  await cli('state', 'init', 'demo', 'tweak', '--runtime', 'sdk', '--isolation', 'current');
  const change = path.join(root, 'openspec/changes/demo');
  for (const [file, text] of Object.entries({
    'proposal.md': 'Keep the selected behavior.\n',
    'design.md': 'Reuse the public interface.\n',
    'tasks.md': '- [x] Keep behavior <!-- comet-task:worker -->\n',
  }))
    await fs.writeFile(path.join(change, file), text);
  // 批准仅属于隔离测试夹具，不代表真实用户授权。
  const open = await cli('guard', 'demo', 'open');
  await cli('guard', 'demo', 'open', '--apply', '--approval-hash', open.approvalHash);
  await cli('guard', 'demo', 'build', '--apply', '--', process.execPath, '-e', 'process.exit(0)');
  const report = 'docs/superpowers/reports/verify.md';
  await fs.mkdir(path.dirname(path.join(root, report)), { recursive: true });
  await fs.writeFile(path.join(root, report), 'The expected behavior passes.\n');
  let { run, runtime } = await inspectClassicSdkRun(root, 'demo');
  const verifier = run.actions.find(
    (a) => a.stepId === 'tweak.verify.run' && a.status === 'pending',
  )!;
  const verifierToken = randomUUID();
  run = await runtime.claim({
    runId: run.runId,
    expectedRevision: run.revision,
    actionId: verifier.id,
    attempt: verifier.attempt,
    inputHash: verifier.inputHash,
    executorId: 'fixture-verifier',
    claimToken: verifierToken,
  });
  await runtime.recordOutcome({
    runId: run.runId,
    expectedRevision: run.revision,
    outcome: {
      actionId: verifier.id,
      attempt: verifier.attempt,
      inputHash: verifier.inputHash,
      claimToken: verifierToken,
      outcomeId: randomUUID(),
      status: 'succeeded',
      output: { event: 'verification-ready', verificationReport: report },
    },
    context: { projectRoot: root, requestId: randomUUID() },
  });
  await cli('state', 'next', 'demo', '--continue');
  ({ run, runtime } = await inspectClassicSdkRun(root, 'demo'));
  const action = run.actions.find(
    (a) => a.stepId === 'tweak.verify.check' && a.status === 'pending',
  )!;
  const token = randomUUID();
  run = await runtime.claim({
    runId: run.runId,
    expectedRevision: run.revision,
    actionId: action.id,
    attempt: action.attempt,
    inputHash: action.inputHash,
    executorId: 'comet-classic-check',
    claimToken: token,
  });
  const claimed = run.actions.find((a) => a.id === action.id)!;
  await fs.writeFile(
    path.join(root, 'verify.cjs'),
    "require('node:fs').appendFileSync('verify-count','x');console.log('verify old')",
  );
  const argv = [process.execPath, 'verify.cjs'];
  const stdout = execFileSync(argv[0], argv.slice(1), { cwd: root, encoding: 'utf8' });
  const receiptRef = classicSdkCheckDirectoryRef(run) + '/legacy.log';
  await writeClassicProjectText(root, receiptRef, stdout, { label: 'Legacy check log' });
  // 旧版结果结构取自 5426c4cb 的真实执行；命令实际执行，原 SDK 持久化收据。
  // 固定历史字段只模拟旧格式，不在产品中恢复日志或项目内容摘要。
  const result = {
    status: 'succeeded' as const,
    output: {
      scope: 'verify',
      exitCode: 0,
      tier: 'full',
      argv,
      cwd: '.',
      timeoutMs: 300000,
      reusable: false,
      reused: false,
      checkEpoch: (run.state as unknown as ClassicState).checkEpoch,
      receiptRef,
      contentHash: '9d7c3bab8872793750f3fca987acd307805d174dbd19cecda26cfb8e656ba8d8',
    },
  };
  await recordClassicSdkCheckReceipt(root, run, claimed, result);
  run = await runtime.recordOutcome({
    runId: run.runId,
    expectedRevision: run.revision,
    outcome: {
      actionId: claimed.id,
      attempt: claimed.attempt,
      inputHash: claimed.inputHash,
      claimToken: token,
      outcomeId: randomUUID(),
      ...result,
    },
    context: { projectRoot: root, requestId: randomUUID() },
  });
  const original = run.actions.find((a) => a.id === claimed.id)!;
  expect(
    run.evidenceWaits?.some(
      (wait) => wait.kind === 'classic-verify-check' && wait.status === 'pending',
    ),
  ).toBe(true);
  await cli('state', 'next', 'demo', '--continue');
  await cli('state', 'next', 'demo', '--continue');
  const continued = (await inspectClassicSdkRun(root, 'demo')).run;
  expect(continued.runId).toBe(run.runId);
  expect(continued.actions.find((a) => a.id === original.id)).toEqual(original);
  expect(await fs.readFile(path.join(root, 'verify-count'), 'utf8')).toBe('x');
  return { root, run: continued, cli, original };
}

it.each(['source', 'generated'] as const)(
  'accepts an original legacy Verify receipt after business continuation through %s without repeating the command',
  async (entry) => {
    const f = await fixture(entry);
    const proposal = await f.cli(
      'state',
      'propose-archive',
      'demo',
      '--summary',
      'Archive the verified result.',
    );
    const approved = await f.cli(
      'state',
      'decide-archive',
      'demo',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    expect(approved.phase).toBe('archive');
    const run = (await inspectClassicSdkRun(f.root, 'demo')).run;
    expect(run.waits.find((wait) => wait.id === proposal.wait.id)?.decision?.choice).toBe('local');
    expect(run.actions.find((a) => a.id === f.original.id)).toEqual(f.original);
    expect(await fs.readFile(path.join(f.root, 'verify-count'), 'utf8')).toBe('x');
  },
  120000,
);

it.each(['source', 'generated'] as const)(
  'continues a committed Classic Verify through %s after losing auxiliary receipts without replay',
  async (entry) => {
    const f = await fixture(entry);
    await fs.rm(path.join(resolveWorkspaceRuntimeRootSync(f.root), 'check-receipts'), {
      recursive: true,
    });
    const proposal = await f.cli(
      'state',
      'propose-archive',
      'demo',
      '--summary',
      'Archive the original result.',
    );
    await f.cli(
      'state',
      'decide-archive',
      'demo',
      '--proposal-hash',
      proposal.wait.proposalHash,
      '--choice',
      'local',
    );
    const current = (await inspectClassicSdkRun(f.root, 'demo')).run;
    expect(current.runId).toBe(f.run.runId);
    expect(current.actions.find((action) => action.id === f.original.id)).toEqual(f.original);
    expect(await fs.readFile(path.join(f.root, 'verify-count'), 'utf8')).toBe('x');
  },
);

it('retains original receipt, latest failure, and pending user decision checks for legacy continuation', async () => {
  const f = await fixture('source');
  const state = f.run.state as unknown as ClassicState;
  await assertVerifyEvidenceCurrent(f.run, f.root, state, 1);
  const legacy = structuredClone(f.run);
  const evidence = legacy.evidenceWaits!.find((wait) => wait.kind === 'classic-verify-check')!;
  evidence.receipt!.contentHash = (
    f.original.outcome!.output as { contentHash: string }
  ).contentHash;
  await assertVerifyEvidenceCurrent(legacy, f.root, state, 1);
  for (const kind of [
    'wrong-reference',
    'wrong-request',
    'latest-failure',
    'missing-original-receipt',
  ] as const) {
    const changed = structuredClone(f.run);
    const check = changed.actions.find((a) => a.id === f.original.id)!;
    const receipt = changed.evidenceWaits!.find(
      (wait) => wait.kind === 'classic-verify-check',
    )!.receipt!;
    if (kind === 'wrong-reference') receipt.ref += '.other';
    if (kind === 'wrong-request') receipt.contentHash = '0'.repeat(64);
    if (kind === 'latest-failure') {
      check.status = 'failed';
      check.outcome!.status = 'failed';
    }
    if (kind === 'missing-original-receipt') check.claim!.token = 'another-claim';
    await expect(assertVerifyEvidenceCurrent(changed, f.root, state, 1), kind).rejects.toThrow();
  }
  expect(
    f.run.waits.filter(
      (wait) => wait.stepId === 'tweak.archive.confirm' && wait.status === 'resolved',
    ),
  ).toEqual([]);
  expect(await fs.readFile(path.join(f.root, 'verify-count'), 'utf8')).toBe('x');
}, 120000);
