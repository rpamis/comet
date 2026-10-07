import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classicStateCommand } from '../../../domains/comet-classic/classic-state-command.js';
import { classicGuardCommand } from '../../../domains/comet-classic/classic-guard.js';
import { classicCheckCommand } from '../../../domains/comet-classic/classic-check-command.js';
import { classicHandoffCommand } from '../../../domains/comet-classic/classic-handoff-command.js';
import {
  classicDesignEvidenceReceipt,
  classicOpenEvidenceReceipt,
  defineClassicWorkflowApplication,
} from '../../../domains/comet-classic/classic-sdk-application.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { createClassicSdkStateStore } from '../../../domains/comet-classic/classic-sdk-state-store.js';
import {
  createRuntime,
  type WorkflowRun,
  type WorkflowRuntime,
} from '../../../domains/engine/runtime.js';

describe('Classic public argument safety', () => {
  let root: string;
  const options = () => ({ json: false, invocationCwd: root, projectRoot: root });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-args-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
    await fs.mkdir(path.join(root, '.comet'));
    await fs.writeFile(
      path.join(root, '.comet/config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n',
    );
    await fs.mkdir(path.join(root, 'openspec/changes'), { recursive: true });
    const result = await classicStateCommand(
      ['init', 'demo', 'tweak', '--runtime', 'compat'],
      options(),
    );
    expect(result.exitCode, result.stderr).toBe(0);
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  async function approveFullOpen(runtime: WorkflowRuntime, run: WorkflowRun): Promise<WorkflowRun> {
    const confirmation = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: run.runId,
      waitId: confirmation.id,
      proposalHash: confirmation.proposalHash,
      decisionId: `${run.runId}-open-approved`,
      choice: 'approved',
    });
    return runtime.execute({
      runId: run.runId,
      actionId: run.actions.at(-1)!.id,
      executorId: 'comet-classic-open-revalidate',
      context: { requestId: `${run.runId}-open-revalidated`, projectRoot: root },
    });
  }

  it('shows the SDK Design proposal and approval commands in state help', async () => {
    const result = await runClassicCli(['state', '--help'], {}, options());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('propose-design <change-name> --proposal <text>');
    expect(result.stdout).toContain(
      'complete-design <change-name> --design-doc <repo-relative-ref> [--approval-hash <sha256>]',
    );
  });

  it('explains the SDK default and explicit legacy option in Classic state help', async () => {
    const result = await runClassicCli(['state', '--help'], {}, options());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('defaults to sdk');
    expect(result.stdout).toContain('--runtime <compat|sdk>');
  });

  it('shows the SDK Design Guard approval syntax in guard help', async () => {
    const result = await runClassicCli(['guard', '--help'], {}, options());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'guard <change-name> design --design-doc <repo-relative-ref> [--apply --approval-hash <sha256>]',
    );
  });

  it('shows the SDK Build Guard check syntax in guard help', async () => {
    const result = await runClassicCli(['guard', '--help'], {}, options());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'SDK-owned Build: comet guard <change-name> build [--apply [-- <program> [args...]]]',
    );
  });

  it('shows the SDK Verify Guard report and check syntax in guard help', async () => {
    const result = await runClassicCli(['guard', '--help'], {}, options());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      'SDK-owned Verify: comet guard <change-name> verify --report <repo-relative-ref> [--apply -- <program> [args...]]',
    );
  });

  it('shows SDK Archive decision and Guard syntax in help', async () => {
    const state = await runClassicCli(['state', '--help'], {}, options());
    expect(state.exitCode).toBe(0);
    expect(state.stdout).toContain('propose-archive <change-name> --summary <text>');
    expect(state.stdout).toContain('decide-archive <change-name> --proposal-hash <sha256>');
    expect(state.stdout).toContain('complete-delivery <change-name> --commit <sha>');
    const guard = await runClassicCli(['guard', '--help'], {}, options());
    expect(guard.exitCode).toBe(0);
    expect(guard.stdout).toContain(
      'SDK-owned Archive: comet guard <change-name> archive [--apply]',
    );
    expect(guard.stdout).toContain('Compat Guard validates phase requirements');
  });

  it('shows the SDK Build decision commands in state help', async () => {
    const result = await runClassicCli(['state', '--help'], {}, options());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('propose-build <change-name> --file <json>');
    expect(result.stdout).toContain(
      'decide-build <change-name> --proposal-hash <sha256> --choice <approved|rejected>',
    );
    expect(result.stdout).toContain(
      'submit-plan <change-name> --plan <repo-relative-ref> [--pause]',
    );
    expect(result.stdout).toContain('continue-plan <change-name> --proposal-hash <sha256>');
    expect(result.stdout).toContain('complete-build <change-name>');
  });

  it('rejects unsupported dry-run before writing state', async () => {
    const stateFile = path.join(root, 'openspec/changes/demo/.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');
    const result = await classicStateCommand(
      ['set', 'demo', 'verify_result', 'pass', '--dry-run'],
      options(),
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('comet state');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  });

  it.each(['full', 'hotfix', 'tweak'] as const)(
    'creates a Classic %s SDK Run without a second legacy state file',
    async (profile) => {
      const name = `sdk-${profile}`;
      const result = await classicStateCommand(
        ['init', name, profile, '--runtime', 'sdk'],
        options(),
      );
      expect(result.exitCode, result.stderr).toBe(0);
      expect(
        await fs.readFile(path.join(root, 'openspec/changes', name, '.comet.yaml'), 'utf8'),
      ).toContain('phase: open');
      expect(
        JSON.parse(
          await fs.readFile(
            path.join(root, '.comet/runtime/change-owners/classic', `${name}.json`),
            'utf8',
          ),
        ),
      ).toMatchObject({ format: 'sdk', application: `classic-${profile}`, runId: name });
      const runtime = createRuntime({
        store: createClassicSdkStateStore(root),
        workflows: [],
      });
      expect(await runtime.inspect(name)).toMatchObject({
        workflow: { id: `comet-classic-${profile}`, version: '1' },
        state: { workflow: profile, phase: 'open' },
        actions: [expect.objectContaining({ stepId: `${profile}.open`, status: 'pending' })],
      });
    },
  );

  it.each(['full', 'hotfix', 'tweak'] as const)(
    'creates a Classic %s SDK Run when state init omits the runtime option',
    async (profile) => {
      const name = `default-${profile}`;
      const result = await classicStateCommand(['init', name, profile], options());
      expect(result.exitCode, result.stderr).toBe(0);
      expect(
        await fs.readFile(path.join(root, 'openspec/changes', name, '.comet.yaml'), 'utf8'),
      ).toContain('phase: open');
      expect(
        JSON.parse(
          await fs.readFile(
            path.join(root, '.comet/runtime/change-owners/classic', `${name}.json`),
            'utf8',
          ),
        ),
      ).toMatchObject({ format: 'sdk', application: `classic-${profile}`, runId: name });
    },
  );

  it('returns the SDK Run from Classic state init --json', async () => {
    const result = await classicStateCommand(['init', 'sdk-json', 'full', '--runtime', 'sdk'], {
      ...options(),
      json: true,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.data).toMatchObject({
      change: 'sdk-json',
      phase: 'open',
      run: { id: 'sdk-json', revision: 1, status: 'running' },
    });
    await expect(
      fs.access(path.join(root, 'openspec/changes/sdk-json/.comet.yaml')),
    ).resolves.toBeUndefined();
  });

  it('reads Classic state get fields from an SDK Run without creating legacy state', async () => {
    const name = 'sdk-get';
    const initialized = await classicStateCommand(
      ['init', name, 'hotfix', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);

    const phase = await classicStateCommand(['get', name, 'phase'], options());
    const workflow = await classicStateCommand(['get', name, 'workflow'], options());
    const plan = await classicStateCommand(['get', name, 'plan'], options());
    expect(phase.exitCode, phase.stderr).toBe(0);
    expect(phase.stdout).toBe('open\n');
    expect(workflow.stdout).toBe('hotfix\n');
    expect(plan.stdout).toBe('null\n');
    await expect(
      fs.access(path.join(root, 'openspec/changes', name, '.comet.yaml')),
    ).resolves.toBeUndefined();
  });

  it('selects and resolves a Classic SDK change without creating legacy state', async () => {
    const name = 'sdk-select';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);

    const selected = await classicStateCommand(['select', name], options());
    expect(selected.exitCode, selected.stderr).toBe(0);
    const current = await classicStateCommand(['current'], options());
    expect(current.exitCode, current.stderr).toBe(0);
    expect(current.stdout).toBe(`${name}\n`);
    await expect(
      fs.access(path.join(root, 'openspec/changes', name, '.comet.yaml')),
    ).resolves.toBeUndefined();
  });

  it('checks Classic SDK Open artifacts without relying on a legacy state file', async () => {
    const name = 'sdk-artifacts';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);

    const missing = await classicStateCommand(['artifacts', name], options());
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stdout ?? '').toContain('proposal.md');

    const changeDir = path.join(root, 'openspec/changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(path.join(changeDir, file), `# ${file}\n`),
      ),
    );
    const complete = await classicStateCommand(['artifacts', name], options());
    expect(complete.exitCode, complete.stderr).toBe(0);
    expect(complete.stdout).toContain('dependency closure is ready');
    await expect(fs.access(path.join(changeDir, '.comet.yaml'))).resolves.toBeUndefined();
  });

  it('advances Classic SDK full Open only with the artifact hash shown for approval', async () => {
    const name = 'sdk-guard-open';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );

    const preview = await classicGuardCommand([name, 'open'], options());
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(preview.data).toMatchObject({ change: name, phase: 'open' });
    const approvalHash = (preview.data as { approvalHash?: string }).approvalHash;
    expect(approvalHash).toMatch(/^[a-f0-9]{64}$/u);

    const applied = await classicGuardCommand(
      [name, 'open', '--apply', '--approval-hash', approvalHash!],
      options(),
    );
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.data).toMatchObject({
      change: name,
      phase: 'design',
      nextAction: { kind: 'action', stepId: 'full.design.handoff' },
    });
    const phase = await classicStateCommand(['get', name, 'phase'], options());
    expect(phase.stdout).toBe('design\n');
    await expect(fs.access(path.join(changeDir, '.comet.yaml'))).resolves.toBeUndefined();
  });

  it('records a Classic SDK Design proposal with a source-traceable handoff', async () => {
    const name = 'sdk-design-proposal';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );
    const preview = await classicGuardCommand([name, 'open'], options());
    expect(preview.exitCode, preview.stderr).toBe(0);
    const approvalHash = (preview.data as { approvalHash: string }).approvalHash;
    const opened = await classicGuardCommand(
      [name, 'open', '--apply', '--approval-hash', approvalHash],
      options(),
    );
    expect(opened.exitCode, opened.stderr).toBe(0);

    const proposed = await classicStateCommand(
      ['propose-design', name, '--proposal', 'Use a versioned adapter for the runtime'],
      { ...options(), json: true },
    );
    expect(proposed.exitCode, proposed.stderr).toBe(0);
    expect(proposed.data).toMatchObject({
      nextAction: {
        kind: 'decision',
        stepId: 'full.design.confirm',
        waitId: expect.any(String),
        proposalHash: (proposed.data as { wait: { proposalHash: string } }).wait.proposalHash,
        choices: expect.any(Array),
      },
    });
    const next = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(next.data).toMatchObject({
      phase: 'design',
      nextAction: { kind: 'decision', stepId: 'full.design.confirm' },
      configuration: {
        handoffContext: `openspec/changes/${name}/.comet/handoff/design-context.json`,
        handoffHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    const context = JSON.parse(
      await fs.readFile(path.join(changeDir, '.comet/handoff/design-context.json'), 'utf8'),
    );
    expect(context).toMatchObject({
      change: name,
      phase: 'design',
      canonical_spec: 'openspec',
      context_hash: (next.data as { configuration: { handoffHash: string } }).configuration
        .handoffHash,
      files: expect.arrayContaining([
        expect.objectContaining({ path: `openspec/changes/${name}/tasks.md` }),
      ]),
    });
    const markdown = await fs.readFile(
      path.join(changeDir, '.comet/handoff/design-context.md'),
      'utf8',
    );
    expect(markdown).toContain(`- Source: openspec/changes/${name}/tasks.md`);
    expect((next.data as { run: { waits: Array<{ proposalHash: string }> } }).run.waits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: 'full.design.confirm',
          status: 'pending',
          proposalHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      ]),
    );
    await expect(fs.access(path.join(changeDir, '.comet.yaml'))).resolves.toBeUndefined();
    const proposalHash = (proposed.data as { wait: { proposalHash: string } }).wait.proposalHash;
    const stale = await classicStateCommand(
      ['decide-design', name, '--proposal-hash', '0'.repeat(64), '--choice', 'rejected'],
      options(),
    );
    expect(stale.exitCode).not.toBe(0);
    const rejected = await classicStateCommand(
      ['decide-design', name, '--proposal-hash', proposalHash, '--choice', 'rejected'],
      options(),
    );
    expect(rejected.exitCode, rejected.stderr).toBe(0);
    const resumed = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(resumed.data).toMatchObject({
      runtimeFormat: 'sdk',
      phase: 'design',
      nextAction: { kind: 'action', stepId: 'full.design.handoff' },
    });
  });

  it('routes Classic SDK Design Guard preview and approved apply through the Run', async () => {
    const name = 'sdk-design-guard';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );
    const openPreview = await classicGuardCommand([name, 'open'], options());
    expect(openPreview.exitCode, openPreview.stderr).toBe(0);
    const opened = await classicGuardCommand(
      [
        name,
        'open',
        '--apply',
        '--approval-hash',
        (openPreview.data as { approvalHash: string }).approvalHash,
      ],
      options(),
    );
    expect(opened.exitCode, opened.stderr).toBe(0);
    const proposed = await classicStateCommand(
      ['propose-design', name, '--proposal', 'Use a versioned adapter'],
      { ...options(), json: true },
    );
    expect(proposed.exitCode, proposed.stderr).toBe(0);
    const approvalHash = (proposed.data as { wait: { proposalHash: string } }).wait.proposalHash;
    const approved = await classicStateCommand(
      ['decide-design', name, '--proposal-hash', approvalHash, '--choice', 'approved'],
      options(),
    );
    expect(approved.exitCode, approved.stderr).toBe(0);
    const repeatedApproval = await classicStateCommand(
      ['decide-design', name, '--proposal-hash', approvalHash, '--choice', 'approved'],
      options(),
    );
    expect(repeatedApproval.exitCode, repeatedApproval.stderr).toBe(0);
    const designRef = `docs/design/${name}.md`;
    await fs.mkdir(path.join(root, 'docs', 'design'), { recursive: true });
    await fs.writeFile(
      path.join(root, designRef),
      `---\ncomet_change: ${name}\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\n`,
    );

    const preview = await classicGuardCommand(
      [name, 'design', '--design-doc', designRef],
      options(),
    );
    expect(preview.exitCode, preview.stderr).toBe(0);
    expect(preview.data).toMatchObject({
      change: name,
      phase: 'design',
      approvalHash,
      checks: { blocked: false },
    });
    expect((await classicStateCommand(['get', name, 'phase'], options())).stdout).toBe('design\n');

    const missingApproval = await classicGuardCommand(
      [name, 'design', '--design-doc', designRef, '--apply'],
      options(),
    );
    expect(missingApproval.exitCode).not.toBe(0);
    expect((await classicStateCommand(['get', name, 'phase'], options())).stdout).toBe('design\n');

    const applied = await classicGuardCommand(
      [name, 'design', '--design-doc', designRef, '--apply', '--approval-hash', approvalHash],
      options(),
    );
    expect(applied.exitCode, applied.stderr).toBe(0);
    expect(applied.data).toMatchObject({
      change: name,
      phase: 'build',
      nextAction: { kind: 'action', stepId: 'full.build.configure' },
    });
    expect((await classicStateCommand(['get', name, 'phase'], options())).stdout).toBe('build\n');
    await expect(fs.access(path.join(changeDir, '.comet.yaml'))).resolves.toBeUndefined();
  });

  it('keeps Classic SDK Build configuration pending until the current proposal is approved', async () => {
    const name = 'sdk-build-configuration';
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet@example.test',
        'commit',
        '--allow-empty',
        '-m',
        'baseline',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk', '--isolation', 'current'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );
    const openPreview = await classicGuardCommand([name, 'open'], options());
    expect(openPreview.exitCode, openPreview.stderr).toBe(0);
    const opened = await classicGuardCommand(
      [
        name,
        'open',
        '--apply',
        '--approval-hash',
        (openPreview.data as { approvalHash: string }).approvalHash,
      ],
      options(),
    );
    expect(opened.exitCode, opened.stderr).toBe(0);
    const designProposal = await classicStateCommand(
      ['propose-design', name, '--proposal', 'Use a versioned adapter'],
      { ...options(), json: true },
    );
    expect(designProposal.exitCode, designProposal.stderr).toBe(0);
    const designRef = `docs/design/${name}.md`;
    await fs.mkdir(path.join(root, 'docs', 'design'), { recursive: true });
    await fs.writeFile(
      path.join(root, designRef),
      `---\ncomet_change: ${name}\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\n`,
    );
    const designed = await classicGuardCommand(
      [
        name,
        'design',
        '--design-doc',
        designRef,
        '--apply',
        '--approval-hash',
        (designProposal.data as { wait: { proposalHash: string } }).wait.proposalHash,
      ],
      options(),
    );
    expect(designed.exitCode, designed.stderr).toBe(0);

    const configurationRef = 'build-configuration.json';
    const configurationFile = path.join(root, configurationRef);
    await fs.writeFile(
      configurationFile,
      JSON.stringify({
        build_mode: 'autonomous',
        tdd_mode: 'tdd',
        review_mode: 'off',
        subagent_dispatch: null,
      }),
    );
    const invalid = await classicStateCommand(['propose-build', name, '--file', configurationRef], {
      ...options(),
      json: true,
    });
    expect(invalid.exitCode).not.toBe(0);
    expect(
      (await classicStateCommand(['next', name], { ...options(), json: true })).data,
    ).toMatchObject({
      nextAction: { kind: 'action', stepId: 'full.build.configure' },
    });
    await fs.writeFile(
      configurationFile,
      JSON.stringify({
        build_mode: 'executing-plans',
        tdd_mode: 'tdd',
        review_mode: 'standard',
        subagent_dispatch: null,
      }),
    );
    const first = await classicStateCommand(['propose-build', name, '--file', configurationRef], {
      ...options(),
      json: true,
    });
    expect(first.exitCode, first.stderr).toBe(0);
    const firstHash = (first.data as { wait: { proposalHash: string } }).wait.proposalHash;
    const waiting = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(waiting.data).toMatchObject({
      phase: 'build',
      configuration: { buildMode: null, isolation: 'current' },
      nextAction: { kind: 'decision', stepId: 'full.build.confirm' },
    });

    const rejected = await classicStateCommand(
      ['decide-build', name, '--proposal-hash', firstHash, '--choice', 'rejected'],
      { ...options(), json: true },
    );
    expect(rejected.exitCode, rejected.stderr).toBe(0);
    expect(
      (await classicStateCommand(['next', name], { ...options(), json: true })).data,
    ).toMatchObject({
      nextAction: { kind: 'action', stepId: 'full.build.configure' },
    });

    await fs.writeFile(
      configurationFile,
      JSON.stringify({
        build_mode: 'autonomous',
        tdd_mode: 'tdd',
        review_mode: 'thorough',
        subagent_dispatch: null,
      }),
    );
    const revised = await classicStateCommand(['propose-build', name, '--file', configurationRef], {
      ...options(),
      json: true,
    });
    expect(revised.exitCode, revised.stderr).toBe(0);
    const revisedHash = (revised.data as { wait: { proposalHash: string } }).wait.proposalHash;
    expect(revisedHash).not.toBe(firstHash);
    const stale = await classicStateCommand(
      ['decide-build', name, '--proposal-hash', firstHash, '--choice', 'approved'],
      { ...options(), json: true },
    );
    expect(stale.exitCode).not.toBe(0);
    execFileSync('git', ['switch', '-c', 'other-branch'], { cwd: root, stdio: 'ignore' });
    const drifted = await classicStateCommand(
      ['decide-build', name, '--proposal-hash', revisedHash, '--choice', 'approved'],
      { ...options(), json: true },
    );
    expect(drifted.exitCode).not.toBe(0);
    execFileSync('git', ['switch', 'main'], { cwd: root, stdio: 'ignore' });
    const approved = await classicStateCommand(
      ['decide-build', name, '--proposal-hash', revisedHash, '--choice', 'approved'],
      { ...options(), json: true },
    );
    expect(approved.exitCode, approved.stderr).toBe(0);
    expect(approved.data).toMatchObject({
      phase: 'build',
      nextAction: { kind: 'action', stepId: 'full.build.plan', actionId: expect.any(String) },
      configuration: {
        buildMode: 'autonomous',
        tddMode: 'tdd',
        reviewMode: 'thorough',
        isolation: 'current',
      },
    });
    expect(
      (await classicStateCommand(['next', name], { ...options(), json: true })).data,
    ).toMatchObject({
      nextAction: { kind: 'action', stepId: 'full.build.plan' },
    });
    await expect(fs.access(path.join(changeDir, '.comet.yaml'))).resolves.toBeUndefined();
  });

  it('advances a Classic SDK Build through plan pause and completed implementation without replaying planning', async () => {
    const name = 'sdk-build-plan';
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Comet Test',
        '-c',
        'user.email=comet@example.test',
        'commit',
        '--allow-empty',
        '-m',
        'baseline',
      ],
      { cwd: root, stdio: 'ignore' },
    );
    expect(
      (
        await classicStateCommand(
          ['init', name, 'full', '--runtime', 'sdk', '--isolation', 'current'],
          options(),
        )
      ).exitCode,
    ).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md'
            ? '- [ ] Implement the change <!-- comet-task:impl -->\n'
            : `# ${file}\n`,
        ),
      ),
    );
    const openPreview = await classicGuardCommand([name, 'open'], options());
    expect(openPreview.exitCode, openPreview.stderr).toBe(0);
    const opened = await classicGuardCommand(
      [
        name,
        'open',
        '--apply',
        '--approval-hash',
        (openPreview.data as { approvalHash: string }).approvalHash,
      ],
      options(),
    );
    expect(opened.exitCode, opened.stderr).toBe(0);
    const designProposal = await classicStateCommand(
      ['propose-design', name, '--proposal', 'Use a versioned adapter'],
      { ...options(), json: true },
    );
    expect(designProposal.exitCode, designProposal.stderr).toBe(0);
    const designRef = `docs/design/${name}.md`;
    await fs.mkdir(path.join(root, 'docs', 'design'), { recursive: true });
    await fs.writeFile(
      path.join(root, designRef),
      `---\ncomet_change: ${name}\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\n`,
    );
    const designed = await classicGuardCommand(
      [
        name,
        'design',
        '--design-doc',
        designRef,
        '--apply',
        '--approval-hash',
        (designProposal.data as { wait: { proposalHash: string } }).wait.proposalHash,
      ],
      options(),
    );
    expect(designed.exitCode, designed.stderr).toBe(0);
    const configurationRef = 'build-configuration.json';
    await fs.writeFile(
      path.join(root, configurationRef),
      JSON.stringify({
        build_mode: 'executing-plans',
        tdd_mode: 'tdd',
        review_mode: 'standard',
        subagent_dispatch: null,
      }),
    );
    const configuration = await classicStateCommand(
      ['propose-build', name, '--file', configurationRef],
      { ...options(), json: true },
    );
    expect(configuration.exitCode, configuration.stderr).toBe(0);
    const approved = await classicStateCommand(
      [
        'decide-build',
        name,
        '--proposal-hash',
        (configuration.data as { wait: { proposalHash: string } }).wait.proposalHash,
        '--choice',
        'approved',
      ],
      options(),
    );
    expect(approved.exitCode, approved.stderr).toBe(0);

    const planRef = `docs/superpowers/plans/${name}.md`;
    await fs.mkdir(path.join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
    await fs.writeFile(
      path.join(root, planRef),
      `<!-- comet-task-authority: openspec/changes/${name}/tasks.md -->\n# Plan\n<!-- comet-task-ref:impl -->\n`,
    );
    const planned = await classicStateCommand(['submit-plan', name, '--plan', planRef, '--pause'], {
      ...options(),
      json: true,
    });
    expect(planned.exitCode, planned.stderr).toBe(0);
    expect(planned.data).toMatchObject({
      configuration: { plan: planRef, buildPause: 'plan-ready' },
      nextAction: { kind: 'decision', stepId: 'full.build.plan-ready' },
    });
    const pauseHash = (
      planned.data as { run: { waits: Array<{ proposalHash: string }> } }
    ).run.waits.at(-1)!.proposalHash;
    const originalPlan = await fs.readFile(path.join(root, planRef), 'utf8');
    await fs.writeFile(path.join(root, planRef), `${originalPlan}\nA changed plan\n`);
    const drifted = await classicStateCommand(
      ['continue-plan', name, '--proposal-hash', pauseHash],
      { ...options(), json: true },
    );
    expect(drifted.exitCode).not.toBe(0);
    expect(
      (await classicStateCommand(['next', name], { ...options(), json: true })).data,
    ).toMatchObject({ nextAction: { kind: 'decision', stepId: 'full.build.plan-ready' } });
    await fs.writeFile(path.join(root, planRef), originalPlan);
    const continued = await classicStateCommand(
      ['continue-plan', name, '--proposal-hash', pauseHash],
      { ...options(), json: true },
    );
    expect(continued.exitCode, continued.stderr).toBe(0);
    expect(continued.data).toMatchObject({
      configuration: { plan: planRef, buildPause: null },
      nextAction: { kind: 'action', stepId: 'full.build.execute' },
    });
    const premature = await classicStateCommand(['complete-build', name], {
      ...options(),
      json: true,
    });
    expect(premature.exitCode).not.toBe(0);
    expect(
      (await classicStateCommand(['next', name], { ...options(), json: true })).data,
    ).toMatchObject({ nextAction: { kind: 'action', stepId: 'full.build.execute' } });
    await fs.writeFile(
      path.join(changeDir, 'tasks.md'),
      '- [x] Implement the change <!-- comet-task:impl -->\n',
    );
    const implemented = await classicStateCommand(['complete-build', name], {
      ...options(),
      json: true,
    });
    expect(implemented.exitCode, implemented.stderr).toBe(0);
    expect(implemented.data).toMatchObject({
      phase: 'build',
      nextAction: { kind: 'action', stepId: 'full.build.check' },
    });
    const checked = await classicCheckCommand(
      ['run', name, 'build', '--', process.execPath, '-e', 'console.log("sdk-build-ok")'],
      options(),
    );
    expect(checked.exitCode, checked.stderr).toBe(0);
    expect(checked.data).toMatchObject({
      phase: 'verify',
      run: { id: name, revision: expect.any(Number) },
      nextAction: { kind: 'action', stepId: 'full.verify.run', actionId: expect.any(String) },
    });
    expect(
      (await classicStateCommand(['next', name], { ...options(), json: true })).data,
    ).toMatchObject({
      phase: 'verify',
      nextAction: { kind: 'action', stepId: 'full.verify.run' },
    });
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [],
    });
    const run = await runtime.inspect(name);
    expect(run.actions.filter((action) => action.stepId === 'full.build.plan')).toHaveLength(1);
    expect(run.actions.filter((action) => action.stepId === 'full.build.execute')).toHaveLength(1);
  });

  it.each([
    ['literal', false],
    ['inferred', true],
    ['failed-shadow', false],
  ] as const)(
    'routes Classic SDK Build Guard preview and a real check through the same Run (%s)',
    async (mode, inferred) => {
      const name = `sdk-build-guard-${mode}`;
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet@example.test',
          'commit',
          '--allow-empty',
          '-m',
          'baseline',
        ],
        { cwd: root, stdio: 'ignore' },
      );
      expect(
        (
          await classicStateCommand(
            ['init', name, 'full', '--runtime', 'sdk', '--isolation', 'current'],
            options(),
          )
        ).exitCode,
      ).toBe(0);
      const changeDir = path.join(root, 'openspec', 'changes', name);
      await Promise.all(
        ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
          fs.writeFile(
            path.join(changeDir, file),
            file === 'tasks.md'
              ? '- [ ] Implement the change <!-- comet-task:impl -->\n'
              : `# ${file}\n`,
          ),
        ),
      );
      const openPreview = await classicGuardCommand([name, 'open'], options());
      expect(openPreview.exitCode, openPreview.stderr).toBe(0);
      expect(
        (
          await classicGuardCommand(
            [
              name,
              'open',
              '--apply',
              '--approval-hash',
              (openPreview.data as { approvalHash: string }).approvalHash,
            ],
            options(),
          )
        ).exitCode,
      ).toBe(0);
      const designProposal = await classicStateCommand(
        ['propose-design', name, '--proposal', 'Use a versioned adapter'],
        { ...options(), json: true },
      );
      expect(designProposal.exitCode, designProposal.stderr).toBe(0);
      const designRef = `docs/design/${name}.md`;
      await fs.mkdir(path.join(root, 'docs', 'design'), { recursive: true });
      await fs.writeFile(
        path.join(root, designRef),
        `---\ncomet_change: ${name}\nrole: technical-design\ncanonical_spec: openspec\n---\n# Technical design\n`,
      );
      expect(
        (
          await classicGuardCommand(
            [
              name,
              'design',
              '--design-doc',
              designRef,
              '--apply',
              '--approval-hash',
              (designProposal.data as { wait: { proposalHash: string } }).wait.proposalHash,
            ],
            options(),
          )
        ).exitCode,
      ).toBe(0);
      const configurationRef = 'build-configuration.json';
      await fs.writeFile(
        path.join(root, configurationRef),
        JSON.stringify({
          build_mode: 'executing-plans',
          tdd_mode: 'tdd',
          review_mode: 'standard',
          subagent_dispatch: null,
        }),
      );
      const configuration = await classicStateCommand(
        ['propose-build', name, '--file', configurationRef],
        { ...options(), json: true },
      );
      expect(configuration.exitCode, configuration.stderr).toBe(0);
      expect(
        (
          await classicStateCommand(
            [
              'decide-build',
              name,
              '--proposal-hash',
              (configuration.data as { wait: { proposalHash: string } }).wait.proposalHash,
              '--choice',
              'approved',
            ],
            options(),
          )
        ).exitCode,
      ).toBe(0);
      const planRef = `docs/superpowers/plans/${name}.md`;
      await fs.mkdir(path.join(root, 'docs', 'superpowers', 'plans'), { recursive: true });
      await fs.writeFile(
        path.join(root, planRef),
        `<!-- comet-task-authority: openspec/changes/${name}/tasks.md -->\n# Plan\n<!-- comet-task-ref:impl -->\n`,
      );
      expect(
        (await classicStateCommand(['submit-plan', name, '--plan', planRef], options())).exitCode,
      ).toBe(0);

      const incomplete = await classicGuardCommand([name, 'build'], options());
      expect(incomplete.exitCode).not.toBe(0);
      expect(
        (await classicStateCommand(['next', name], { ...options(), json: true })).data,
      ).toMatchObject({ nextAction: { kind: 'action', stepId: 'full.build.execute' } });
      await fs.writeFile(
        path.join(changeDir, 'tasks.md'),
        '- [x] Implement the change <!-- comet-task:impl -->\n',
      );
      const acceptedPlan = await fs.readFile(path.join(root, planRef), 'utf8');
      await fs.writeFile(path.join(root, planRef), `${acceptedPlan}\nChanged after approval.\n`);
      const drifted = await classicGuardCommand([name, 'build'], options());
      expect(drifted.exitCode).not.toBe(0);
      expect(
        (await classicStateCommand(['next', name], { ...options(), json: true })).data,
      ).toMatchObject({ nextAction: { kind: 'action', stepId: 'full.build.execute' } });
      await fs.writeFile(path.join(root, planRef), acceptedPlan);
      const preview = await classicGuardCommand([name, 'build'], options());
      expect(preview.exitCode, preview.stderr).toBe(0);
      expect(
        (await classicStateCommand(['next', name], { ...options(), json: true })).data,
      ).toMatchObject({
        phase: 'build',
        nextAction: { kind: 'action', stepId: 'full.build.execute' },
      });

      if (inferred || mode === 'failed-shadow') {
        await fs.writeFile(
          path.join(root, 'package.json'),
          JSON.stringify({ scripts: { build: 'node -e "console.log(\'sdk-guard-ok\')"' } }),
        );
      }
      if (mode === 'failed-shadow') {
        const failed = await classicGuardCommand(
          [name, 'build', '--apply', '--', process.execPath, '-e', 'process.exit(1)'],
          options(),
        );
        expect(failed.exitCode).not.toBe(0);
        const guessed = await classicGuardCommand([name, 'build', '--apply'], options());
        expect(guessed.exitCode).not.toBe(0);
        expect(
          (await classicStateCommand(['next', name], { ...options(), json: true })).data,
        ).toMatchObject({
          phase: 'build',
          nextAction: { kind: 'action', stepId: 'full.build.execute' },
        });
      }
      const applied = await classicGuardCommand(
        inferred
          ? [name, 'build', '--apply']
          : [name, 'build', '--apply', '--', process.execPath, '-e', 'console.log("sdk-guard-ok")'],
        options(),
      );
      expect(applied.exitCode, applied.stderr).toBe(0);
      expect(applied.data).toMatchObject({
        change: name,
        phase: 'verify',
        nextAction: { kind: 'action', stepId: 'full.verify.run' },
      });
      expect(
        (await classicStateCommand(['next', name], { ...options(), json: true })).data,
      ).toMatchObject({
        phase: 'verify',
        nextAction: { kind: 'action', stepId: 'full.verify.run' },
      });
      await expect(fs.access(path.join(changeDir, '.comet.yaml'))).resolves.toBeUndefined();
    },
  );

  it.each(['hotfix', 'tweak'] as const)(
    'routes Classic SDK %s Build Guard through a real check without legacy state',
    async (profile) => {
      const name = `sdk-${profile}-build-guard`;
      execFileSync(
        'git',
        [
          '-c',
          'user.name=Comet Test',
          '-c',
          'user.email=comet@example.test',
          'commit',
          '--allow-empty',
          '-m',
          'baseline',
        ],
        { cwd: root, stdio: 'ignore' },
      );
      expect(
        (
          await classicStateCommand(
            ['init', name, profile, '--runtime', 'sdk', '--isolation', 'current'],
            options(),
          )
        ).exitCode,
      ).toBe(0);
      const changeDir = path.join(root, 'openspec', 'changes', name);
      if (profile === 'hotfix') {
        expect(
          (await classicStateCommand(['set', name, 'language', 'zh-CN'], options())).exitCode,
        ).toBe(0);
      }
      await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Change\n');
      await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n');
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Implement the change\n');
      const preview = await classicGuardCommand([name, 'open'], options());
      expect(preview.exitCode, preview.stderr).toBe(0);
      const opened = await classicGuardCommand(
        [
          name,
          'open',
          '--apply',
          '--approval-hash',
          (preview.data as { approvalHash: string }).approvalHash,
        ],
        options(),
      );
      expect(opened.exitCode, opened.stderr).toBe(0);
      expect(
        (await classicStateCommand(['next', name], { ...options(), json: true })).data,
      ).toMatchObject({ phase: 'build', nextAction: { stepId: `${profile}.build.execute` } });
      await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [x] Implement the change\n');
      const built = await classicGuardCommand(
        [name, 'build', '--apply', '--', process.execPath, '-e', 'console.log("preset-build-ok")'],
        options(),
      );
      expect(built.exitCode, built.stderr).toBe(0);
      expect(built.data).toMatchObject({ change: name, phase: 'verify' });
      expect(
        (await classicStateCommand(['next', name], { ...options(), json: true })).data,
      ).toMatchObject({ phase: 'verify', nextAction: { stepId: `${profile}.verify.run` } });
      const reportRef = `docs/superpowers/reports/${name}.md`;
      await fs.mkdir(path.join(root, 'docs', 'superpowers', 'reports'), { recursive: true });
      if (profile === 'hotfix') {
        expect((await classicStateCommand(['get', name, 'language'], options())).stdout).toBe(
          'zh-CN\n',
        );
        await fs.writeFile(
          path.join(root, reportRef),
          '# Verification report\nThis verification report records the completed implementation and checks the build output against the expected behavior across the project before it proceeds to archive.\n',
        );
        const wrongLanguage = await classicGuardCommand(
          [name, 'verify', '--report', reportRef],
          options(),
        );
        expect(wrongLanguage.exitCode).not.toBe(0);
        expect(wrongLanguage.stderr).toContain('configured language is zh-CN');
      }
      await fs.writeFile(path.join(root, reportRef), '# Verification\nAll checks passed.\n');
      const verifyPreview = await classicGuardCommand(
        [name, 'verify', '--report', reportRef],
        options(),
      );
      expect(verifyPreview.exitCode, verifyPreview.stderr).toBe(0);
      const verified = await classicGuardCommand(
        [
          name,
          'verify',
          '--report',
          reportRef,
          '--apply',
          '--',
          process.execPath,
          '-e',
          'console.log("preset-verify-ok")',
        ],
        options(),
      );
      expect(verified.exitCode, verified.stderr).toBe(0);
      expect(verified.data).toMatchObject({
        change: name,
        phase: 'archive',
        nextAction: { kind: 'action', stepId: `${profile}.archive.prepare` },
      });
      await expect(fs.access(path.join(changeDir, '.comet.yaml'))).resolves.toBeUndefined();
    },
  );

  it('completes Classic SDK Design after a rejected proposal is revised', async () => {
    const name = 'sdk-complete-design';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );
    const preview = await classicGuardCommand([name, 'open'], options());
    expect(preview.exitCode, preview.stderr).toBe(0);
    const openHash = (preview.data as { approvalHash: string }).approvalHash;
    const opened = await classicGuardCommand(
      [name, 'open', '--apply', '--approval-hash', openHash],
      options(),
    );
    expect(opened.exitCode, opened.stderr).toBe(0);
    const rejectedProposal = await classicStateCommand(
      ['propose-design', name, '--proposal', 'Use the original adapter'],
      { ...options(), json: true },
    );
    expect(rejectedProposal.exitCode, rejectedProposal.stderr).toBe(0);
    const application = defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
      executors: application.executors,
    });
    const beforeRevision = await runtime.inspect(name);
    const rejectedWait = beforeRevision.waits.at(-1)!;
    await runtime.resolveWait({
      runId: name,
      expectedRevision: beforeRevision.revision,
      waitId: rejectedWait.id,
      proposalHash: rejectedWait.proposalHash,
      decisionId: 'design-rejected',
      choice: 'rejected',
    });
    const proposed = await classicStateCommand(
      ['propose-design', name, '--proposal', 'Use a versioned adapter for the runtime'],
      { ...options(), json: true },
    );
    expect(proposed.exitCode, proposed.stderr).toBe(0);
    const approvalHash = (proposed.data as { wait: { proposalHash: string } }).wait.proposalHash;
    const designRef = `docs/design/${name}.md`;
    await fs.mkdir(path.join(root, 'docs', 'design'), { recursive: true });
    await fs.writeFile(
      path.join(root, designRef),
      `---\ncomet_change: ${name}\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\n`,
    );

    const handoffFile = path.join(changeDir, '.comet', 'handoff', 'design-context.json');
    const handoffJson = await fs.readFile(handoffFile, 'utf8');
    await fs.writeFile(
      handoffFile,
      handoffJson.replace(
        /"context_hash": "[a-f0-9]{64}"/u,
        '"context_hash": "' + '0'.repeat(64) + '"',
      ),
    );
    const tampered = await classicStateCommand(
      ['complete-design', name, '--design-doc', designRef, '--approval-hash', approvalHash],
      { ...options(), json: true },
    );
    expect(tampered.exitCode).not.toBe(0);
    expect(tampered.stderr).toMatch(/handoff/i);
    await fs.writeFile(handoffFile, handoffJson);

    const completed = await classicStateCommand(
      ['complete-design', name, '--design-doc', designRef, '--approval-hash', approvalHash],
      { ...options(), json: true },
    );
    expect(completed.exitCode, completed.stderr).toBe(0);
    expect(completed.data).toMatchObject({ change: name, phase: 'build' });
    const phase = await classicStateCommand(['get', name, 'phase'], options());
    expect(phase.stdout).toBe('build\n');
    const design = await classicStateCommand(['get', name, 'design_doc'], options());
    expect(design.stdout).toBe(`${designRef}\n`);
    await expect(fs.access(path.join(changeDir, '.comet.yaml'))).resolves.toBeUndefined();
  });

  it('keeps Classic SDK Design pending when OpenSpec changes after the proposal', async () => {
    const name = 'sdk-design-drift';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );
    const preview = await classicGuardCommand([name, 'open'], options());
    expect(preview.exitCode, preview.stderr).toBe(0);
    const openHash = (preview.data as { approvalHash: string }).approvalHash;
    const opened = await classicGuardCommand(
      [name, 'open', '--apply', '--approval-hash', openHash],
      options(),
    );
    expect(opened.exitCode, opened.stderr).toBe(0);
    const proposed = await classicStateCommand(
      ['propose-design', name, '--proposal', 'Use a versioned adapter'],
      { ...options(), json: true },
    );
    expect(proposed.exitCode, proposed.stderr).toBe(0);
    const approvalHash = (proposed.data as { wait: { proposalHash: string } }).wait.proposalHash;
    const designRef = `docs/design/${name}.md`;
    await fs.mkdir(path.join(root, 'docs', 'design'), { recursive: true });
    await fs.writeFile(
      path.join(root, designRef),
      `---\ncomet_change: ${name}\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\n`,
    );
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Changed requirement\n');

    const staleDecision = await classicStateCommand(
      ['decide-design', name, '--proposal-hash', approvalHash, '--choice', 'approved'],
      options(),
    );
    expect(staleDecision.exitCode).not.toBe(0);
    expect(staleDecision.stderr).toContain('OpenSpec');

    const completed = await classicStateCommand(
      ['complete-design', name, '--design-doc', designRef, '--approval-hash', approvalHash],
      { ...options(), json: true },
    );
    expect(completed.exitCode).not.toBe(0);
    expect(completed.stderr).toContain('OpenSpec');
    const next = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(next.data).toMatchObject({
      phase: 'design',
      nextAction: { kind: 'decision', stepId: 'full.design.confirm' },
    });
  });

  it('rejects Classic SDK Open approval after a required artifact changes', async () => {
    const name = 'sdk-guard-drift';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );
    const preview = await classicGuardCommand([name, 'open'], options());
    expect(preview.exitCode, preview.stderr).toBe(0);
    const approvalHash = (preview.data as { approvalHash?: string }).approvalHash;
    expect(approvalHash).toMatch(/^[a-f0-9]{64}$/u);
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Changed task\n');

    const rejected = await classicGuardCommand(
      [name, 'open', '--apply', '--approval-hash', approvalHash!],
      options(),
    );
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stderr).toContain('changed');
    const phase = await classicStateCommand(['get', name, 'phase'], options());
    expect(phase.stdout).toBe('open\n');
    const next = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(next.data).toMatchObject({ nextAction: { kind: 'action', stepId: 'full.open' } });
  });

  it('blocks Classic SDK Open when tasks.md contains no task', async () => {
    const name = 'sdk-guard-empty-tasks';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(path.join(changeDir, file), `# ${file}\n`),
      ),
    );

    const preview = await classicGuardCommand([name, 'open'], options());
    expect(preview.exitCode).not.toBe(0);
    expect(preview.stderr).toContain('tasks.md has no task');
    const next = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(next.data).toMatchObject({ nextAction: { kind: 'action', stepId: 'full.open' } });
  });

  it('blocks Classic SDK Open when the proposal language differs from the change language', async () => {
    const name = 'sdk-guard-language';
    await fs.writeFile(
      path.join(root, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: legacy\n  language: en\n',
    );
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec', 'changes', name);
    await fs.writeFile(
      path.join(changeDir, 'proposal.md'),
      '# 变更提案\n本次变更需要验证文档语言保持一致，并且在用户确认之前阻止错误语言的提案进入下一个阶段。\n',
    );
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] Implement the change\n');

    const preview = await classicGuardCommand([name, 'open'], options());
    expect(preview.exitCode).not.toBe(0);
    expect(preview.stderr).toContain('appears to be Chinese-dominant');
    const next = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(next.data).toMatchObject({ nextAction: { kind: 'action', stepId: 'full.open' } });
  });

  it('checks the requested Classic SDK entry phase against its Run', async () => {
    const name = 'sdk-entry';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);

    const open = await classicStateCommand(['check', name, 'open'], {
      ...options(),
      json: true,
    });
    expect(open.exitCode, open.stderr).toBe(0);
    expect(open.data).toMatchObject({
      change: name,
      phase: 'open',
      checks: { blocked: false },
    });

    const design = await classicStateCommand(['check', name, 'design'], {
      ...options(),
      json: true,
    });
    expect(design.exitCode).not.toBe(0);
    expect(design.data).toMatchObject({ checks: { blocked: true } });
    await expect(
      fs.access(path.join(root, 'openspec/changes', name, '.comet.yaml')),
    ).resolves.toBeUndefined();
  });

  it('blocks Classic SDK Open entry when its Skill Action has an unknown outcome', async () => {
    const name = 'sdk-entry-claimed';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const application = defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    const run = await runtime.inspect(name);
    const action = run.actions[0];
    await runtime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      claimToken: 'claimed-entry',
    });

    const entry = await classicStateCommand(['check', name, 'open'], {
      ...options(),
      json: true,
    });
    expect(entry.exitCode).not.toBe(0);
    expect(entry.data).toMatchObject({ checks: { blocked: true } });
    expect(entry.stdout).toContain('unknown outcome');
  });

  it('recovers a claimed Classic SDK Action from the Run without legacy state', async () => {
    const name = 'sdk-recover-claimed';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const application = defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    const run = await runtime.inspect(name);
    const action = run.actions[0];
    await runtime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      claimToken: 'recover-claimed',
    });

    const recovered = await classicStateCommand(['check', name, 'open', '--recover'], {
      ...options(),
      json: true,
    });
    expect(recovered.exitCode, recovered.stderr).toBe(1);
    expect(recovered.data).toMatchObject({
      change: name,
      phase: 'open',
      nextAction: { kind: 'reconcile', stepId: 'full.open' },
      checks: { blocked: true },
      recovery: { claim: { executorId: 'classic-host', token: 'recover-claimed' } },
    });
    await expect(
      fs.access(path.join(root, 'openspec/changes', name, '.comet.yaml')),
    ).resolves.toBeUndefined();
  });

  it('rejects Classic SDK recovery for a phase other than the Run phase', async () => {
    const name = 'sdk-recover-phase';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);

    const recovered = await classicStateCommand(['check', name, 'design', '--recover'], {
      ...options(),
      json: true,
    });
    expect(recovered.exitCode).not.toBe(0);
    expect(recovered.stderr).toContain('in open, not design');
  });

  it('checks Classic SDK Design entry after verified Open artifacts', async () => {
    const name = 'sdk-design-entry';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec/changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );
    const application = defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
      executors: application.executors,
    });
    let run = await runtime.inspect(name);
    const action = run.actions[0];
    await runtime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      claimToken: 'design-entry-open',
    });
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'design-entry-open',
        outcomeId: 'design-entry-open-result',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    const receipt = await classicOpenEvidenceReceipt(root, `openspec/changes/${name}`);
    run = await runtime.recordEvidence({
      runId: name,
      evidenceId: run.evidenceWaits![0].id,
      kind: 'classic-open-artifacts',
      ...receipt,
      submissionId: 'design-entry-open-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'design-entry-open-evidence', projectRoot: root },
    });
    run = await approveFullOpen(runtime, run);
    expect(run.state).toMatchObject({ phase: 'design' });

    const entry = await classicStateCommand(['check', name, 'design'], {
      ...options(),
      json: true,
    });
    expect(entry.exitCode, entry.stderr).toBe(0);
    expect(entry.data).toMatchObject({
      change: name,
      phase: 'design',
      checks: { blocked: false },
    });
  });

  it('checks Classic SDK preset Build entry against its verified Open artifacts', async () => {
    const name = 'sdk-build-entry';
    const initialized = await classicStateCommand(
      ['init', name, 'hotfix', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeDir = path.join(root, 'openspec/changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );
    const application = defineClassicWorkflowApplication('hotfix');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    let run = await runtime.inspect(name);
    const action = run.actions[0];
    await runtime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      claimToken: 'build-entry-open',
    });
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'build-entry-open',
        outcomeId: 'build-entry-open-result',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    const receipt = await classicOpenEvidenceReceipt(root, `openspec/changes/${name}`);
    run = await runtime.recordEvidence({
      runId: name,
      evidenceId: run.evidenceWaits![0].id,
      kind: 'classic-open-artifacts',
      ...receipt,
      submissionId: 'build-entry-open-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'build-entry-open-evidence', projectRoot: root },
    });
    expect(run.state).toMatchObject({ phase: 'build' });

    const entry = await classicStateCommand(['check', name, 'build'], {
      ...options(),
      json: true,
    });
    expect(entry.exitCode, entry.stderr).toBe(0);
    expect(entry.data).toMatchObject({
      change: name,
      phase: 'build',
      checks: { blocked: false },
    });

    const proposed = await classicStateCommand(
      ['propose-escalation', name, '--reason', 'The repair requires a new public API'],
      { ...options(), json: true },
    );
    expect(proposed.exitCode, proposed.stderr).toBe(0);
    const proposalHash = (proposed.data as { wait: { proposalHash: string } }).wait.proposalHash;
    const stale = await classicStateCommand(
      ['decide-escalation', name, '--proposal-hash', '0'.repeat(64), '--choice', 'upgrade'],
      { ...options(), json: true },
    );
    expect(stale.exitCode).not.toBe(0);
    const upgraded = await classicStateCommand(
      ['decide-escalation', name, '--proposal-hash', proposalHash, '--choice', 'upgrade'],
      { ...options(), json: true },
    );
    expect(upgraded.exitCode, upgraded.stderr).toBe(0);
    expect(upgraded.data).toMatchObject({
      runtimeFormat: 'sdk',
      phase: 'design',
      configuration: { workflow: 'full' },
      nextAction: { kind: 'action', stepId: 'full.design.handoff' },
    });
    expect((await runtime.inspect(name)).runId).toBe(name);
    await expect(fs.access(path.join(changeDir, '.comet.yaml'))).resolves.toBeUndefined();
    const designProposal = await classicStateCommand(
      ['propose-design', name, '--proposal', 'Design the required public API'],
      { ...options(), json: true },
    );
    expect(designProposal.exitCode, designProposal.stderr).toBe(0);
    expect(designProposal.data).toMatchObject({
      phase: 'design',
      wait: { choices: ['approved', 'rejected'] },
    });
  });

  it('checks Classic SDK full Build entry after verified Design evidence', async () => {
    const name = 'sdk-full-build-entry';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const changeRef = `openspec/changes/${name}`;
    const changeDir = path.join(root, 'openspec/changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md'
            ? '- [ ] Implement the change\n'
            : file === 'design.md'
              ? `---\ncomet_change: ${name}\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\n`
              : `# ${file}\n`,
        ),
      ),
    );
    const application = defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
      executors: application.executors,
    });
    let run = await runtime.inspect(name);
    const open = run.actions[0];
    await runtime.claim({
      runId: name,
      actionId: open.id,
      attempt: open.attempt,
      inputHash: open.inputHash,
      executorId: 'classic-host',
      claimToken: 'full-build-open',
    });
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: open.id,
        attempt: open.attempt,
        inputHash: open.inputHash,
        claimToken: 'full-build-open',
        outcomeId: 'full-build-open-result',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    run = await runtime.recordEvidence({
      runId: name,
      evidenceId: run.evidenceWaits![0].id,
      kind: 'classic-open-artifacts',
      ...(await classicOpenEvidenceReceipt(root, changeRef)),
      submissionId: 'full-build-open-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'full-build-open-evidence', projectRoot: root },
    });
    run = await approveFullOpen(runtime, run);
    const proposed = await classicStateCommand(
      ['propose-design', name, '--proposal', 'Use the design'],
      options(),
    );
    expect(proposed.exitCode, proposed.stderr).toBe(0);
    run = await runtime.inspect(name);
    const decision = run.waits.at(-1)!;
    run = await runtime.resolveWait({
      runId: name,
      waitId: decision.id,
      proposalHash: decision.proposalHash,
      decisionId: 'full-build-design-approved',
      choice: 'approved',
    });
    const document = run.actions.at(-1)!;
    await runtime.claim({
      runId: name,
      actionId: document.id,
      attempt: document.attempt,
      inputHash: document.inputHash,
      executorId: 'classic-host',
      claimToken: 'full-build-document',
    });
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: document.id,
        attempt: document.attempt,
        inputHash: document.inputHash,
        claimToken: 'full-build-document',
        outcomeId: 'full-build-document-result',
        status: 'succeeded',
        output: { designDoc: `${changeRef}/design.md` },
      },
    });
    run = await runtime.recordEvidence({
      runId: name,
      evidenceId: run.evidenceWaits!.at(-1)!.id,
      kind: 'classic-design-document',
      ...(await classicDesignEvidenceReceipt(root, `${changeRef}/design.md`)),
      submissionId: 'full-build-design-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'full-build-design-evidence', projectRoot: root },
    });
    expect(run.state).toMatchObject({ phase: 'build', designDoc: `${changeRef}/design.md` });

    const entry = await classicStateCommand(['check', name, 'build'], {
      ...options(),
      json: true,
    });
    expect(entry.exitCode, entry.stderr).toBe(0);
    expect(entry.data).toMatchObject({
      change: name,
      phase: 'build',
      checks: { blocked: false },
    });
  });

  it('reads the next Classic SDK Action from its Run after initialization', async () => {
    const initialized = await classicStateCommand(
      ['init', 'sdk-next', 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);

    const next = await classicStateCommand(['next', 'sdk-next'], { ...options(), json: true });
    expect(next.exitCode, next.stderr).toBe(0);
    expect(next.data).toMatchObject({
      change: 'sdk-next',
      runtimeFormat: 'sdk',
      phase: 'open',
      run: {
        id: 'sdk-next',
        actions: [expect.objectContaining({ stepId: 'full.open', status: 'pending' })],
      },
    });
  });

  it('marks the legacy Classic next result without treating it as an SDK Run', async () => {
    const initialized = await classicStateCommand(
      ['init', 'legacy-next', 'full', '--runtime', 'compat'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);

    const next = await classicStateCommand(['next', 'legacy-next'], { ...options(), json: true });
    expect(next.exitCode, next.stderr).toBe(0);
    expect(next.data).toMatchObject({
      change: 'legacy-next',
      runtimeFormat: 'compat',
      phase: 'open',
    });
  });

  it('does not offer a claimed Classic SDK Skill Action for automatic replay', async () => {
    const name = 'sdk-claimed';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const application = defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    const run = await runtime.inspect(name);
    const action = run.actions[0];
    await runtime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      claimToken: 'claimed-open',
    });

    const next = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(next.exitCode, next.stderr).toBe(0);
    expect(next.data).toMatchObject({ nextAction: { kind: 'reconcile', stepId: 'full.open' } });
    expect(next.stdout).not.toContain('SKILL: comet-open');
  });

  it('reports the pending Classic SDK evidence instead of requesting the Open Skill again', async () => {
    const name = 'sdk-evidence';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const application = defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    const run = await runtime.inspect(name);
    const action = run.actions[0];
    await runtime.claim({
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      claimToken: 'evidence-open',
    });
    await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'evidence-open',
        outcomeId: 'evidence-open-result',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });

    const next = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(next.exitCode, next.stderr).toBe(0);
    expect(next.data).toMatchObject({
      nextAction: {
        kind: 'evidence',
        stepId: 'full.open.evidence',
        evidenceKind: 'classic-open-artifacts',
      },
    });
    expect(next.stdout).not.toContain('SKILL: comet-open');
  });

  it('reports the pending Classic SDK Open decision from its Run', async () => {
    const name = 'sdk-decision';
    const initialized = await classicStateCommand(
      ['init', name, 'full', '--runtime', 'sdk'],
      options(),
    );
    expect(initialized.exitCode, initialized.stderr).toBe(0);
    const application = defineClassicWorkflowApplication('full');
    const runtime = createRuntime({
      store: createClassicSdkStateStore(root),
      workflows: [application.workflow],
      transitionHandlers: [application.transitionHandler],
      evidenceValidators: application.evidenceValidators,
      validators: application.validators,
    });
    const changeDir = path.join(root, 'openspec/changes', name);
    await Promise.all(
      ['proposal.md', 'design.md', 'tasks.md'].map((file) =>
        fs.writeFile(
          path.join(changeDir, file),
          file === 'tasks.md' ? '- [ ] Implement the change\n' : `# ${file}\n`,
        ),
      ),
    );
    let run = await runtime.inspect(name);
    const openAction = run.actions[0];
    await runtime.claim({
      runId: name,
      actionId: openAction.id,
      attempt: openAction.attempt,
      inputHash: openAction.inputHash,
      executorId: 'classic-host',
      claimToken: 'decision-open',
    });
    run = await runtime.recordOutcome({
      runId: name,
      outcome: {
        actionId: openAction.id,
        attempt: openAction.attempt,
        inputHash: openAction.inputHash,
        claimToken: 'decision-open',
        outcomeId: 'decision-open-result',
        status: 'succeeded',
        output: { event: 'open-complete' },
      },
    });
    const receipt = await classicOpenEvidenceReceipt(root, `openspec/changes/${name}`);
    run = await runtime.recordEvidence({
      runId: name,
      evidenceId: run.evidenceWaits![0].id,
      kind: 'classic-open-artifacts',
      ...receipt,
      submissionId: 'decision-open-evidence',
      expectedRevision: run.revision,
      context: { requestId: 'decision-open-evidence', projectRoot: root },
    });

    const next = await classicStateCommand(['next', name], { ...options(), json: true });
    expect(next.exitCode, next.stderr).toBe(0);
    expect(next.data).toMatchObject({
      nextAction: { kind: 'decision', stepId: 'full.open.confirm' },
      run: { waits: [expect.objectContaining({ status: 'pending' })] },
    });
    expect(next.stdout).not.toContain('SKILL: comet-open');
  });

  it('rejects a misspelled apply flag before Guard work', async () => {
    const result = await classicGuardCommand(['demo', 'open', '--aplly'], options());
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('Usage: comet guard');
    expect(result.stderr).not.toContain('ALL CHECKS PASSED');
  });

  it('rejects a delivery input file that collides with the Runtime record path', async () => {
    const record = path.join(root, 'openspec/changes/demo/.comet/delivery.json');
    await fs.mkdir(path.dirname(record), { recursive: true });
    await fs.writeFile(record, '{"action":"local","targetBranch":"main"}');
    const absolute = await classicStateCommand(['delivery', 'demo', '--file', record], options());
    expect(absolute.exitCode).not.toBe(0);
    expect(absolute.stderr).toContain('collides with the Runtime record path');
    const relative = await classicStateCommand(
      ['delivery', 'demo', '--file', 'openspec/changes/demo/.comet/delivery.json'],
      options(),
    );
    expect(relative.exitCode).not.toBe(0);
    expect(relative.stderr).toContain('collides with the Runtime record path');
  });

  it('rejects a delivery input path alias that resolves to the Runtime record', async () => {
    const record = path.join(root, 'openspec/changes/demo/.comet/delivery.json');
    await fs.mkdir(path.dirname(record), { recursive: true });
    await fs.writeFile(record, '{"action":"local","targetBranch":"main"}');
    const aliasRoot = `${root}-alias`;
    await fs.symlink(root, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      const alias = path.join(aliasRoot, 'openspec/changes/demo/.comet/delivery.json');
      const result = await classicStateCommand(['delivery', 'demo', '--file', alias], options());
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('collides with the Runtime record path');
    } finally {
      await fs.rm(aliasRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['demo'],
    ['demo', 'design'],
    ['demo', 'design', '--write', '--bogus'],
    ['demo', '--hash-only', '--write'],
  ])('rejects unsupported handoff form %j before looking up artifacts', async (...args) => {
    const stateFile = path.join(root, 'openspec/changes/demo/.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');
    const result = await classicHandoffCommand(args, options());
    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain('Usage: comet handoff');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
  });

  it.each(['state', 'guard', 'handoff', 'archive', 'validate', 'workspace'])(
    'provides useful %s help without interpreting it as a change',
    async (command) => {
      const result = await runClassicCli([command, '--help']);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stdout).toContain('Usage: comet');
      expect(result.stdout).not.toContain('.mjs');
    },
  );
});
