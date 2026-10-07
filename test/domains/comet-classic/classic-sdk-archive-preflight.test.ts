import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import {
  createClassicSdkArchiveExecutor,
  executeClassicSdkArchive,
} from '../../../domains/comet-classic/classic-sdk-archive.js';
import { executeClassicSdkArchivePreflight } from '../../../domains/comet-classic/classic-sdk-archive-preflight.js';
import { createRuntime } from '../../../domains/engine/runtime.js';
import { defineClassicWorkflowApplication } from '../../../domains/comet-classic/classic-sdk-application.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function fixture(options: { metadata?: boolean } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-sdk-archive-preflight-'));
  roots.push(root);
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'openspec', 'changes'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, '.comet', 'config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n  language: en\n  context_compression: off\n  review_mode: off\n  auto_transition: true\n',
  );
  await fs.writeFile(path.join(projectRoot, 'openspec', 'config.yaml'), 'schema: spec-driven\n');
  await fs.writeFile(path.join(projectRoot, 'README.md'), '# Example\n');
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: projectRoot });
  execFileSync(
    'git',
    ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'],
    { cwd: projectRoot, stdio: 'ignore' },
  );
  const executable = path.join(root, 'openspec.mjs');
  const count = path.join(root, 'archive-invocations');
  const install = async (suffix = '', statusSuffix = '') => {
    await fs.writeFile(
      executable,
      [
        `#!${process.execPath}`,
        "import fs from 'node:fs';",
        "import path from 'node:path';",
        "if (process.argv[2] === 'status') {",
        statusSuffix,
        `console.log(JSON.stringify({ changeRoot: path.join(process.cwd(), 'openspec', 'changes', 'example'), applyRequires: ['tasks'], artifacts: ${JSON.stringify(['proposal', 'design', 'tasks'].map((id) => ({ id, outputPath: `${id}.md`, status: 'done', requires: [] })))} }));`,
        '} else {',
        `fs.appendFileSync(${JSON.stringify(count)}, 'archive\\n');`,
        "const active = path.join(process.cwd(), 'openspec', 'changes', 'example');",
        "const archived = path.join(process.cwd(), 'openspec', 'changes', 'archive', '2026-10-07-example');",
        'fs.mkdirSync(path.dirname(archived), { recursive: true });',
        'fs.renameSync(active, archived);',
        suffix,
        '}',
      ].join('\n'),
    );
    await fs.chmod(executable, 0o755);
  };
  const cli = async (...args: string[]) => {
    const result = await runClassicCli([...args, '--json'], undefined, {
      invocationCwd: projectRoot,
    });
    expect(result.exitCode, result.stderr ?? result.stdout).toBe(0);
    return JSON.parse(result.stdout ?? '{}').data as {
      approvalHash: string;
      wait: { proposalHash: string };
    };
  };
  await cli('state', 'init', 'example', 'tweak', '--isolation', 'current');
  const active = path.join(projectRoot, 'openspec', 'changes', 'example');
  await fs.writeFile(path.join(active, 'proposal.md'), '# Proposal\nCorrect the example.\n');
  await fs.writeFile(path.join(active, 'design.md'), '# Design\nKeep the existing behavior.\n');
  await fs.writeFile(path.join(active, 'tasks.md'), '- [x] Example checked\n');
  if (options.metadata) {
    await install();
    vi.stubEnv('COMET_OPENSPEC', executable);
    await fs.writeFile(path.join(active, '.openspec.yaml'), 'schema: spec-driven\n');
  }
  const preview = await cli('guard', 'example', 'open');
  await cli('guard', 'example', 'open', '--apply', '--approval-hash', preview.approvalHash);
  // 命令分隔符后的参数属于被检查进程；直接调用避免追加 --json。
  const checked = await runClassicCli(
    [
      'guard',
      'example',
      'build',
      '--apply',
      '--json',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    ],
    undefined,
    { invocationCwd: projectRoot },
  );
  expect(checked.exitCode, checked.stderr).toBe(0);
  const report = 'docs/superpowers/reports/verify.md';
  await fs.mkdir(path.dirname(path.join(projectRoot, report)), { recursive: true });
  await fs.writeFile(path.join(projectRoot, report), '# Verification\nPASS\n');
  const verified = await runClassicCli(
    [
      'guard',
      'example',
      'verify',
      '--report',
      report,
      '--apply',
      '--json',
      '--',
      process.execPath,
      '-e',
      'process.exit(0)',
    ],
    undefined,
    { invocationCwd: projectRoot },
  );
  expect(verified.exitCode, verified.stderr).toBe(0);
  const proposed = await cli(
    'state',
    'propose-archive',
    'example',
    '--summary',
    'Archive the verified example',
  );
  await cli(
    'state',
    'decide-archive',
    'example',
    '--proposal-hash',
    proposed.wait.proposalHash,
    '--choice',
    'local',
  );
  const { runtime, run } = await inspectClassicSdkRun(projectRoot, 'example');
  const ready = await executeClassicSdkArchivePreflight(runtime, { runId: run.runId, projectRoot });
  return { root, projectRoot, runtime, run: ready, executable, count, install, cli, active };
}

describe('Classic SDK Archive dependency preflight', () => {
  it('leaves a missing dependency pending and archives exactly once after it is repaired', async () => {
    const f = await fixture();
    vi.stubEnv('COMET_OPENSPEC', f.executable);
    await expect(
      executeClassicSdkArchive(f.runtime, { runId: f.run.runId, projectRoot: f.projectRoot }),
    ).rejects.toThrow('OpenSpec CLI unavailable');
    expect(await f.runtime.inspect(f.run.runId)).toEqual(f.run);
    await f.install();
    const completed = await executeClassicSdkArchive(f.runtime, {
      runId: f.run.runId,
      projectRoot: f.projectRoot,
    });
    expect(completed.state).toMatchObject({ archived: true });
    expect(completed.actions.at(-1)).toMatchObject({
      stepId: 'tweak.archive.deliver',
      status: 'pending',
    });
    await expect(
      executeClassicSdkArchive(f.runtime, { runId: f.run.runId, projectRoot: f.projectRoot }),
    ).rejects.toThrow('no preflighted Archive Action');
    expect(await fs.readFile(f.count, 'utf8')).toBe('archive\n');
  });

  it('checks the dependency before the bound Runtime executor persists a claim', async () => {
    const f = await fixture();
    const application = defineClassicWorkflowApplication('tweak');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(f.projectRoot),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
      executors: [createClassicSdkArchiveExecutor(f.projectRoot)],
    });
    vi.stubEnv('COMET_OPENSPEC', f.executable);
    const command = {
      runId: f.run.runId,
      actionId: f.run.actions.at(-1)!.id,
      executorId: 'comet-classic-archive',
      expectedRevision: f.run.revision,
      context: { requestId: 'archive-port', projectRoot: f.projectRoot },
    };
    await expect(runtime.execute(command)).rejects.toThrow('OpenSpec CLI unavailable');
    expect(await runtime.inspect(f.run.runId)).toEqual(f.run);
    await f.install();
    const completed = await runtime.execute(command);
    expect(completed.state).toMatchObject({ archived: true });
    await expect(runtime.execute(command)).rejects.toMatchObject({
      code: 'ACTION_ALREADY_CLAIMED',
    });
    expect(await fs.readFile(f.count, 'utf8')).toBe('archive\n');
  });

  it.skipIf(process.platform === 'win32')(
    'leaves a non-executable dependency pending until permissions are repaired',
    async () => {
      const f = await fixture();
      await f.install();
      await fs.chmod(f.executable, 0o644);
      vi.stubEnv('COMET_OPENSPEC', f.executable);
      await expect(
        executeClassicSdkArchive(f.runtime, { runId: f.run.runId, projectRoot: f.projectRoot }),
      ).rejects.toThrow('not executable');
      expect(await f.runtime.inspect(f.run.runId)).toEqual(f.run);
      await fs.chmod(f.executable, 0o755);
      await executeClassicSdkArchive(f.runtime, { runId: f.run.runId, projectRoot: f.projectRoot });
      expect(await fs.readFile(f.count, 'utf8')).toBe('archive\n');
    },
  );

  it('records a receipt when the dependency disappears after claim and retries only after explicit reconciliation', async () => {
    const f = await fixture();
    await f.install();
    vi.stubEnv('COMET_OPENSPEC', f.executable);
    const runtime = {
      inspect: f.runtime.inspect,
      recordOutcome: f.runtime.recordOutcome,
      markUnknown: f.runtime.markUnknown,
      claim: async (...args: Parameters<typeof f.runtime.claim>) => {
        const claimed = await f.runtime.claim(...args);
        await fs.unlink(f.executable);
        return claimed;
      },
    };
    const failed = await executeClassicSdkArchive(runtime, {
      runId: f.run.runId,
      projectRoot: f.projectRoot,
    });
    const action = failed.actions.at(-1)!;
    expect(action).toMatchObject({
      id: f.run.actions.at(-1)!.id,
      status: 'failed',
      attempt: 1,
      outcome: {
        status: 'failed',
        output: {
          archiveStarted: false,
          reason: expect.stringContaining('OpenSpec CLI unavailable'),
        },
      },
    });
    expect(action.receipts).toHaveLength(1);
    expect(action.outcome!.claimToken).toBe(action.claim!.token);
    await expect(fs.access(f.count)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      f.runtime.retry({ runId: failed.runId, actionId: action.id, attempt: action.attempt }),
    ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
    await f.install();
    await f.runtime.retry({
      runId: failed.runId,
      actionId: action.id,
      attempt: action.attempt,
      expectedRevision: failed.revision,
      reconciliation: {
        resolution: 'not-executed',
        evidence: { outcomeId: action.outcome!.outcomeId, archiveStarted: false },
      },
    });
    const completed = await executeClassicSdkArchive(f.runtime, {
      runId: failed.runId,
      projectRoot: f.projectRoot,
    });
    expect(completed.actions.find((entry) => entry.id === action.id)).toMatchObject({
      status: 'succeeded',
      attempt: 2,
    });
    expect(await fs.readFile(f.count, 'utf8')).toBe('archive\n');
  });

  it.skipIf(process.platform === 'win32')(
    'records an operating-system launch failure as known not started',
    async () => {
      const f = await fixture();
      await fs.writeFile(f.executable, '#!/definitely-missing-comet-test-interpreter\n');
      await fs.chmod(f.executable, 0o755);
      vi.stubEnv('COMET_OPENSPEC', f.executable);
      const failed = await executeClassicSdkArchive(f.runtime, {
        runId: f.run.runId,
        projectRoot: f.projectRoot,
      });
      expect(failed.actions.at(-1)).toMatchObject({
        status: 'failed',
        outcome: { status: 'failed', output: { archiveStarted: false } },
      });
      expect(failed.actions.at(-1)!.receipts).toHaveLength(1);
      await expect(fs.access(f.active)).resolves.toBeUndefined();
      await expect(fs.access(f.count)).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('retains unknown when a started process changes files then reports a missing dependency', async () => {
    const f = await fixture();
    await f.install(
      "process.stderr.write('OpenSpec CLI not found: dependency'); process.exit(127);",
    );
    vi.stubEnv('COMET_OPENSPEC', f.executable);
    await expect(
      executeClassicSdkArchive(f.runtime, { runId: f.run.runId, projectRoot: f.projectRoot }),
    ).rejects.toThrow('OpenSpec CLI not found');
    const unknown = await f.runtime.inspect(f.run.runId);
    expect(unknown.actions.at(-1)).toMatchObject({ status: 'unknown', attempt: 1 });
    expect(unknown.actions.at(-1)!.claim).toBeDefined();
    await expect(fs.access(f.active)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      executeClassicSdkArchive(f.runtime, { runId: f.run.runId, projectRoot: f.projectRoot }),
    ).rejects.toThrow('no preflighted Archive Action');
    expect(await fs.readFile(f.count, 'utf8')).toBe('archive\n');
  });

  it('rechecks deterministic requirement metadata when a launch failure is explicitly retried', async () => {
    const f = await fixture({ metadata: true });
    await f.install('', 'fs.unlinkSync(process.argv[1]);');
    const failed = await executeClassicSdkArchive(f.runtime, {
      runId: f.run.runId,
      projectRoot: f.projectRoot,
    });
    const action = failed.actions.at(-1)!;
    expect(action).toMatchObject({
      status: 'failed',
      outcome: { output: { archiveStarted: false } },
    });
    const metadata = await fs.readFile(
      path.join(f.active, '.comet', 'archive-requirements.json'),
      'utf8',
    );
    expect(JSON.parse(metadata)).toEqual({
      schema: 'comet.classic.archive-requirements.v1',
      files: ['tasks.md', 'proposal.md'],
    });
    await f.install();
    await f.runtime.retry({
      runId: failed.runId,
      actionId: action.id,
      attempt: action.attempt,
      expectedRevision: failed.revision,
      reconciliation: {
        resolution: 'not-executed',
        evidence: { outcomeId: action.outcome!.outcomeId, archiveStarted: false },
      },
    });
    const completed = await executeClassicSdkArchive(f.runtime, {
      runId: failed.runId,
      projectRoot: f.projectRoot,
    });
    expect(completed.state).toMatchObject({ archived: true });
    expect(
      await fs.readFile(
        path.join(
          f.projectRoot,
          'openspec',
          'changes',
          'archive',
          '2026-10-07-example',
          '.comet',
          'archive-requirements.json',
        ),
        'utf8',
      ),
    ).toBe(metadata);
    expect(await fs.readFile(f.count, 'utf8')).toBe('archive\n');
  });
});
