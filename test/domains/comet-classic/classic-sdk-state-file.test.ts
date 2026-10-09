import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import {
  classicOpenEvidenceReceipt,
  defineClassicWorkflowApplication,
} from '../../../domains/comet-classic/classic-sdk-application.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import {
  COMET_RESUME_PROBE_SCHEMA_VERSION,
  resolveCometResumeProbe,
} from '../../../domains/comet-classic/classic-resume-probe.js';
import { createRuntime } from '../../../domains/engine/runtime.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import {
  readChangeRuntimeOwner,
  registerSdkChangeOwner,
} from '../../../domains/workflow-contract/change-runtime-owner.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { recoverClassicSdkArchive } from '../../../domains/comet-classic/classic-sdk-archive.js';
import {
  writeClassicState,
  readClassicState,
} from '../../../domains/comet-classic/classic-store.js';
import { ensureClassicRuntimeRun } from '../../../domains/comet-classic/classic-runtime-run.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic SDK state file contract', () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function project() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-sdk-state-'));
    roots.push(root);
    await prepareClassicLegacyProject(root);
    const cli = (...args: string[]) =>
      withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
        runClassicCli([
          'state',
          ...args,
          ...(args[0] === 'init' && !args.includes('--runtime') ? ['--runtime', 'sdk'] : []),
          '--json',
        ]),
      );
    return { root, cli, stateFile: path.join(root, 'openspec', 'changes', 'demo', '.comet.yaml') };
  }

  it('creates the familiar state file for an explicitly selected SDK change', async () => {
    const { cli, stateFile } = await project();
    const created = await cli('init', 'demo', 'full');
    expect(created.exitCode, created.stderr).toBe(0);
    expect(parse(await fs.readFile(stateFile, 'utf8'))).toMatchObject({
      workflow: 'full',
      phase: 'open',
      verify_result: 'pending',
      archived: false,
    });
  });

  it.each(['\n', '\r\n'])(
    'rejects compat writes before changing an SDK state file or creating a compat Run (%j)',
    async (newline) => {
      const { root, cli, stateFile } = await project();
      expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
      const before = (await fs.readFile(stateFile, 'utf8')).replace(/\r?\n/gu, newline);
      await fs.writeFile(stateFile, before);
      const projection = await readClassicState(path.dirname(stateFile));
      await expect(
        writeClassicState(path.dirname(stateFile), {
          ...projection,
          classic: { ...projection.classic!, classicMigration: 1, classicProfile: 'full' },
        }),
      ).rejects.toThrow(/SDK|managed Run/u);
      expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
      const contents = await fs.readdir(path.dirname(stateFile));
      await expect(ensureClassicRuntimeRun(path.dirname(stateFile))).rejects.toThrow(/SDK/u);
      expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
      expect(await fs.readdir(path.dirname(stateFile))).toEqual(contents);
      expect((await inspectClassicSdkRun(root, 'demo')).state.classicMigration).toBeNull();
      await expect(
        fs.access(path.join(path.dirname(stateFile), '.comet/run-state.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  it('recognizes a CRLF archived SDK marker but still rejects an unmatched checkpoint', async () => {
    const { root, cli, stateFile } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    const { run, runtime } = await inspectClassicSdkRun(root, 'demo');
    const pending = run.actions[0];
    const claimed = await runtime.claim({
      runId: run.runId,
      actionId: pending.id,
      attempt: pending.attempt,
      inputHash: pending.inputHash,
      executorId: 'comet-classic-archive',
      claimToken: 'archive-claim',
    });
    const lost = {
      ...claimed.actions[0],
      stepId: 'full.archive.execute',
      status: 'unknown' as const,
    };
    const archived = path.join(root, 'openspec', 'changes', 'archive', '2026-10-01-demo');
    await fs.rename(path.dirname(stateFile), archived);
    const archivedFile = path.join(archived, '.comet.yaml');
    await fs.writeFile(
      archivedFile,
      (await fs.readFile(archivedFile, 'utf8')).replace(/\r?\n/gu, '\r\n'),
    );
    await expect(
      recoverClassicSdkArchive(
        {
          inspect: async () => ({
            ...claimed,
            state: { ...(claimed.state as object), phase: 'archive' },
            actions: [lost],
          }),
          recordOutcome: async () => {
            throw new Error('An unmatched checkpoint must not be accepted');
          },
        },
        { runId: run.runId, projectRoot: root },
      ),
    ).rejects.toThrow('Classic archived state does not match the lost Archive Action');
  });

  it('returns a read-only scale assessment for an SDK change', async () => {
    const { root, cli, stateFile } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    await fs.writeFile(path.join(path.dirname(stateFile), 'tasks.md'), '- [ ] Implement\n');
    const before = await inspectClassicSdkRun(root, 'demo');
    const source = await fs.readFile(stateFile, 'utf8');
    const result = await cli('scale', 'demo');
    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout!).data).toMatchObject({
      recommendation: 'light',
      selected: null,
      metrics: { tasks: 1, deltaSpecs: 0 },
    });
    expect((await inspectClassicSdkRun(root, 'demo')).run.revision).toBe(before.run.revision);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(source);
  });

  it('does not let the handoff command migrate an SDK Design change to compat', async () => {
    const { root, cli, stateFile } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    const store = createClassicSdkStateStore(root);
    const run = (await store.read('demo'))!;
    await store.compareAndSwap('demo', run.revision, {
      ...run,
      revision: run.revision + 1,
      state: { ...(run.state as object), phase: 'design' },
    });
    for (const file of ['proposal.md', 'design.md', 'tasks.md'])
      await fs.writeFile(path.join(path.dirname(stateFile), file), '# Source\n');
    const source = await fs.readFile(stateFile, 'utf8');
    const result = await withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(['handoff', 'demo', 'design', '--write']),
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/propose-design/u);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(source);
    expect((await cli('next', 'demo')).exitCode).toBe(0);
    const hash = await withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(['handoff', 'demo', '--hash-only']),
    );
    expect(hash.exitCode, hash.stderr).toBe(0);
    expect(hash.stdout?.trim()).toMatch(/^[a-f0-9]{64}$/u);
    expect(hash.stderr).toContain('comet state next demo --json');
    expect(hash.stderr).not.toContain('NEXT: comet handoff');
    await expect(
      fs.access(path.join(path.dirname(stateFile), '.comet/run-state.json')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reuses a source-current SDK handoff without changing an approval or state', async () => {
    const { root, cli, stateFile } = await project();
    expect((await cli('init', 'demo', 'full', '--isolation', 'current')).exitCode).toBe(0);
    expect((await cli('set', 'demo', 'language', 'en')).exitCode).toBe(0);
    const changeDir = path.dirname(stateFile);
    for (const file of ['proposal.md', 'design.md', 'tasks.md'])
      await fs.writeFile(
        path.join(changeDir, file),
        file === 'tasks.md' ? '- [ ] Implement\n' : '# Source\n',
      );
    const { runtime } = await inspectClassicSdkRun(root, 'demo');
    let run = await runtime.inspect('demo');
    const open = run.actions[0];
    run = await runtime.claim({
      runId: 'demo',
      actionId: open.id,
      attempt: open.attempt,
      inputHash: open.inputHash,
      executorId: 'classic-host',
      claimToken: 'sdk-open',
    });
    run = await runtime.recordOutcome({
      runId: 'demo',
      outcome: {
        actionId: open.id,
        attempt: open.attempt,
        inputHash: open.inputHash,
        claimToken: 'sdk-open',
        outcomeId: 'sdk-open-result',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    run = await runtime.recordEvidence({
      runId: 'demo',
      evidenceId: run.evidenceWaits![0].id,
      kind: 'classic-open-artifacts',
      ...(await classicOpenEvidenceReceipt(root, 'openspec/changes/demo')),
      submissionId: 'sdk-open-evidence',
      context: { projectRoot: root, requestId: 'sdk-open-evidence' },
    });
    const wait = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: 'demo',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'sdk-open-decision',
      choice: 'approved',
    });
    await runtime.execute({
      runId: 'demo',
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-classic-open-revalidate',
      context: { projectRoot: root, requestId: 'sdk-open-revalidate' },
    });
    const proposal = await cli(
      'propose-design',
      'demo',
      '--proposal',
      'Implement the approved source',
    );
    expect(proposal.exitCode, proposal.stderr).toBe(0);
    const before = await inspectClassicSdkRun(root, 'demo');
    const source = await fs.readFile(stateFile, 'utf8');
    const handoff = await withClassicCommandContext(
      { projectRoot: root, invocationCwd: root },
      () => runClassicCli(['handoff', 'demo', 'design', '--write']),
    );
    expect(handoff.exitCode, handoff.stderr).toBe(0);
    expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(before.run);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(source);
    await fs.appendFile(path.join(changeDir, 'tasks.md'), '- [ ] New requirement\n');
    const stale = await withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(['handoff', 'demo', 'design', '--write']),
    );
    expect(stale.exitCode).not.toBe(0);
    expect(stale.stderr).toMatch(/changed|approval/u);
    expect((await inspectClassicSdkRun(root, 'demo')).run).toEqual(before.run);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(source);
  });

  it('binds a running SDK change after Git is initialized without resetting its Run', async () => {
    const { root, cli, stateFile } = await project();
    expect((await cli('init', 'demo', 'full', '--isolation', 'current')).exitCode).toBe(0);
    const before = await inspectClassicSdkRun(root, 'demo');
    expect(before.state).toMatchObject({ isolation: 'current', boundBranch: null });

    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });

    const selected = await cli('select', 'demo');
    expect(selected.exitCode, selected.stderr).toBe(0);
    const resumed = await inspectClassicSdkRun(root, 'demo');
    expect(resumed.state.boundBranch).toBe('main');
    expect(resumed.run.actions.map((action) => action.id)).toEqual(
      before.run.actions.map((action) => action.id),
    );
    expect(parse(await fs.readFile(stateFile, 'utf8'))).toMatchObject({
      bound_branch: 'main',
      run_checkpoint: { run: { state: { boundBranch: 'main' } } },
    });
    expect((await cli('next', 'demo')).exitCode).toBe(0);
  });

  it('uses compat for the previous Runtime option without accepting an unpublished legacy alias', async () => {
    const { cli } = await project();
    expect((await cli('init', 'compat-change', 'full', '--runtime', 'compat')).exitCode).toBe(0);
    expect((await cli('init', 'legacy-alias', 'full', '--runtime', 'legacy')).exitCode).not.toBe(0);
  });

  it('keeps a user-editable configuration field available through the existing command', async () => {
    const { cli, stateFile } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    const changed = await cli('set', 'demo', 'auto_transition', 'false');
    expect(changed.exitCode, changed.stderr).toBe(0);
    expect(parse(await fs.readFile(stateFile, 'utf8')).auto_transition).toBe(false);
    const next = await cli('next', 'demo');
    expect(next.exitCode, next.stderr).toBe(0);
    expect(JSON.parse(next.stdout!).data.configuration.autoTransition).toBe(false);
  });

  it('accepts a direct edit to a documented user-owned setting without discarding it', async () => {
    const { cli, stateFile } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    const original = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(
      stateFile,
      original.replace('auto_transition: true', 'auto_transition: false'),
    );
    const next = await cli('next', 'demo');
    expect(next.exitCode, next.stderr).toBe(0);
    expect(JSON.parse(next.stdout!).data.configuration.autoTransition).toBe(false);
    expect(parse(await fs.readFile(stateFile, 'utf8')).auto_transition).toBe(false);
  });

  it('does not accept a direct phase edit as an SDK transition', async () => {
    const { cli, stateFile } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    const original = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(stateFile, original.replace('phase: open', 'phase: archive'));
    const next = await cli('next', 'demo');
    expect(next.exitCode).not.toBe(0);
    expect(await fs.readFile(stateFile, 'utf8')).toContain('phase: archive');
  });

  it('continues an untouched SDK change from its state file in a fresh checkout', async () => {
    const { root, cli } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    const restoredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-restored-'));
    roots.push(restoredRoot);
    await prepareClassicLegacyProject(restoredRoot);
    await fs.cp(
      path.join(root, 'openspec', 'changes', 'demo'),
      path.join(restoredRoot, 'openspec', 'changes', 'demo'),
      { recursive: true },
    );

    const next = await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => runClassicCli(['state', 'next', 'demo', '--json']),
    );
    expect(next.exitCode, next.stderr).toBe(0);
    expect(JSON.parse(next.stdout!).data).toMatchObject({
      change: 'demo',
      run: { actions: [{ stepId: 'full.open' }] },
    });
  });

  it('continues a copied Classic change with work already in its Open action', async () => {
    const { root, cli } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    const original = await inspectClassicSdkRun(root, 'demo');
    expect(
      parse(
        await fs.readFile(path.join(root, 'openspec', 'changes', 'demo', '.comet.yaml'), 'utf8'),
      ).run_checkpoint,
    ).toBeDefined();
    await fs.writeFile(
      path.join(root, 'openspec', 'changes', 'demo', 'proposal.md'),
      '# Work already started\n',
    );
    const restoredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-open-resume-'));
    roots.push(restoredRoot);
    await prepareClassicLegacyProject(restoredRoot);
    await fs.cp(
      path.join(root, 'openspec', 'changes', 'demo'),
      path.join(restoredRoot, 'openspec', 'changes', 'demo'),
      { recursive: true },
    );

    const selected = await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => runClassicCli(['state', 'select', 'demo', '--json']),
    );
    expect(selected.exitCode, JSON.stringify(selected)).toBe(0);
    const resumed = await inspectClassicSdkRun(restoredRoot, 'demo');
    expect(resumed.state.phase).toBe('open');
    expect(resumed.run.actions.map((action) => action.id)).toEqual(
      original.run.actions.map((action) => action.id),
    );
    expect(
      await fs.readFile(
        path.join(restoredRoot, 'openspec', 'changes', 'demo', 'proposal.md'),
        'utf8',
      ),
    ).toContain('Work already started');
  });

  it('resumes Classic Build from a copied state file without replaying Open', async () => {
    const { root, cli } = await project();
    expect((await cli('init', 'demo', 'hotfix')).exitCode).toBe(0);
    const changeRef = 'openspec/changes/demo';
    const changeDir = path.join(root, changeRef);
    for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
      await fs.writeFile(
        path.join(changeDir, file),
        file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
      );
    }
    const application = defineClassicWorkflowApplication('hotfix');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    let run = await runtime.inspect('demo');
    const action = run.actions[0];
    await runtime.claim({
      runId: 'demo',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      claimToken: 'portable-build-open',
    });
    run = await runtime.recordOutcome({
      runId: 'demo',
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'portable-build-open',
        outcomeId: 'portable-build-open-result',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    run = await runtime.recordEvidence({
      runId: 'demo',
      evidenceId: run.evidenceWaits![0].id,
      kind: 'classic-open-artifacts',
      ...(await classicOpenEvidenceReceipt(root, changeRef)),
      submissionId: 'portable-build-open-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'portable-build-open-evidence', projectRoot: root },
    });
    expect(run.state).toMatchObject({ phase: 'build' });
    await fs.writeFile(path.join(root, 'implementation.txt'), 'completed source work\n');

    const restoredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-build-resume-'));
    roots.push(restoredRoot);
    await prepareClassicLegacyProject(restoredRoot);
    await fs.cp(changeDir, path.join(restoredRoot, changeRef), { recursive: true });
    await fs.cp(
      path.join(root, 'implementation.txt'),
      path.join(restoredRoot, 'implementation.txt'),
    );

    const probe = await resolveCometResumeProbe(restoredRoot, {
      schema_version: COMET_RESUME_PROBE_SCHEMA_VERSION,
      utterance: '继续 demo',
      locale: 'zh-CN',
      agent_context: { non_trivial_work: true, already_in_comet_flow: false },
    });
    expect(probe).toMatchObject({ action: 'auto_resume', changeName: 'demo', phase: 'build' });
    expect(await readChangeRuntimeOwner(restoredRoot, 'classic', 'demo')).toBeNull();

    const selected = await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => runClassicCli(['state', 'select', 'demo', '--json']),
    );
    expect(selected.exitCode, selected.stderr).toBe(0);
    const resumed = await inspectClassicSdkRun(restoredRoot, 'demo');
    expect(resumed.state.phase).toBe('build');
    expect(resumed.run.actions.map((item) => item.id)).toEqual(run.actions.map((item) => item.id));
    expect(await fs.readFile(path.join(restoredRoot, 'implementation.txt'), 'utf8')).toBe(
      'completed source work\n',
    );
  });

  it('does not select a copied SDK change with missing Run history as an old change', async () => {
    const { root, cli } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    await fs.writeFile(
      path.join(root, 'openspec', 'changes', 'demo', 'proposal.md'),
      '# Work already started\n',
    );
    const restoredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-progressed-'));
    roots.push(restoredRoot);
    await prepareClassicLegacyProject(restoredRoot);
    await fs.cp(
      path.join(root, 'openspec', 'changes', 'demo'),
      path.join(restoredRoot, 'openspec', 'changes', 'demo'),
      { recursive: true },
    );
    const copiedStateFile = path.join(restoredRoot, 'openspec', 'changes', 'demo', '.comet.yaml');
    const priorFormat = parse(await fs.readFile(copiedStateFile, 'utf8')) as Record<
      string,
      unknown
    >;
    delete priorFormat.run_checkpoint;
    await fs.writeFile(
      copiedStateFile,
      `# comet-execution: managed-run\n${stringify(priorFormat)}`,
    );

    const selected = await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => runClassicCli(['state', 'select', 'demo', '--json']),
    );
    expect(selected.exitCode).not.toBe(0);
    expect(JSON.stringify(selected)).toMatch(/Run history/);
    expect(await readChangeRuntimeOwner(restoredRoot, 'classic', 'demo')).toBeNull();

    const unconfirmed = await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => runClassicCli(['state', 'restore', 'demo', '--json']),
    );
    expect(unconfirmed.exitCode).not.toBe(0);
    expect(await readChangeRuntimeOwner(restoredRoot, 'classic', 'demo')).toBeNull();

    const previousState = await fs.readFile(
      path.join(restoredRoot, 'openspec', 'changes', 'demo', '.comet.yaml'),
      'utf8',
    );

    const recovered = await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => runClassicCli(['state', 'restore', 'demo', '--confirmed', '--json']),
    );
    expect(recovered.exitCode, recovered.stderr).toBe(0);
    expect(JSON.parse(recovered.stdout!).data).toMatchObject({
      change: 'demo',
      phase: 'open',
      run: { actions: [{ stepId: 'full.open' }] },
    });
    expect(
      await fs.readFile(
        path.join(restoredRoot, 'openspec', 'changes', 'demo', 'proposal.md'),
        'utf8',
      ),
    ).toContain('Work already started');
    expect(await readChangeRuntimeOwner(restoredRoot, 'classic', 'demo')).toMatchObject({
      format: 'sdk',
    });
    expect((await inspectClassicSdkRun(restoredRoot, 'demo')).run.input).toMatchObject({
      recoverySource: previousState,
    });
    expect(
      parse(
        await fs.readFile(
          path.join(restoredRoot, 'openspec', 'changes', 'demo', '.comet.yaml'),
          'utf8',
        ),
      ),
    ).toMatchObject({ phase: 'open', verify_result: 'pending' });
    const resumed = await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => runClassicCli(['state', 'next', 'demo', '--json']),
    );
    expect(resumed.exitCode, resumed.stderr).toBe(0);
  });

  it('restores when ownership was published but the Run commit was interrupted', async () => {
    const { root, cli } = await project();
    expect((await cli('init', 'demo', 'full')).exitCode).toBe(0);
    const restoredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-owner-gap-'));
    roots.push(restoredRoot);
    await prepareClassicLegacyProject(restoredRoot);
    await fs.cp(
      path.join(root, 'openspec', 'changes', 'demo'),
      path.join(restoredRoot, 'openspec', 'changes', 'demo'),
      { recursive: true },
    );
    const owner = await readChangeRuntimeOwner(root, 'classic', 'demo');
    if (owner?.format !== 'sdk') throw new Error('Expected SDK ownership');
    await registerSdkChangeOwner(restoredRoot, owner);

    const recovered = await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => runClassicCli(['state', 'restore', 'demo', '--confirmed', '--json']),
    );
    expect(recovered.exitCode, recovered.stderr).toBe(0);
    expect((await inspectClassicSdkRun(restoredRoot, 'demo')).run.actions[0].stepId).toBe(
      'full.open',
    );
  });

  it('does not convert an existing Classic state file when its local records are lost', async () => {
    const { root, cli } = await project();
    expect((await cli('init', 'demo', 'full', '--runtime', 'compat')).exitCode).toBe(0);
    const restoredRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-original-'));
    roots.push(restoredRoot);
    await prepareClassicLegacyProject(restoredRoot);
    await fs.cp(
      path.join(root, 'openspec', 'changes', 'demo'),
      path.join(restoredRoot, 'openspec', 'changes', 'demo'),
      { recursive: true },
    );

    await withClassicCommandContext(
      { projectRoot: restoredRoot, invocationCwd: restoredRoot },
      () => runClassicCli(['state', 'next', 'demo', '--json']),
    );
    expect(await readChangeRuntimeOwner(restoredRoot, 'classic', 'demo')).toMatchObject({
      format: 'compat',
    });
  });
});
