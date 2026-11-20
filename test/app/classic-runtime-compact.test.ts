import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { ensureCliBuilt } from '../helpers/ensure-cli-built.js';
import { prepareClassicLegacyProject } from '../helpers/classic-project.js';

it('keeps Classic CLI history out of compact tool replies while preserving current decisions, claims and full inspection', async () => {
  const repository = process.env.COMET_TEST_PACKAGE_ROOT ?? path.resolve('.');
  if (!process.env.COMET_TEST_PACKAGE_ROOT) await ensureCliBuilt(repository);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-compact-tool-'));
  const project = path.join(root, 'project');
  const home = path.join(root, 'home');
  await fs.mkdir(home);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    LOCALAPPDATA: home,
    COMET_DATA_DIR: path.join(home, 'data'),
    CODEX_HOME: path.join(home, 'codex'),
    XDG_DATA_HOME: path.join(home, 'xdg-data'),
    XDG_STATE_HOME: path.join(home, 'xdg-state'),
    XDG_CACHE_HOME: path.join(home, 'xdg-cache'),
    XDG_CONFIG_HOME: path.join(home, 'xdg-config'),
    COMET_DAEMON: '0',
  };
  let sequence = 0;
  const cli = (...args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [path.join(repository, 'bin/comet.js'), ...args, '--json'],
      { cwd: project, env, encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    expect(result.status, result.stderr || result.stdout).toBe(0);
    return JSON.parse(result.stdout);
  };
  const dispatch = async (request: unknown, details = false) => {
    const file = path.join(root, `request-${++sequence}.json`);
    await fs.writeFile(file, JSON.stringify(request));
    return cli(
      'runtime',
      'dispatch',
      '--application',
      'classic-full',
      '--project-root',
      project,
      '--request',
      file,
      ...(details ? ['--details'] : []),
    );
  };
  try {
    await prepareClassicLegacyProject(project);
    execFileSync('git', ['init', '-b', 'main'], { cwd: project, stdio: 'ignore' });
    cli('state', 'init', 'compact-demo', 'full', '--runtime', 'sdk', '--isolation', 'current');
    const directory = path.join(project, 'openspec/changes/compact-demo');
    for (const file of ['proposal.md', 'design.md', 'tasks.md'])
      await fs.writeFile(
        path.join(directory, file),
        file === 'tasks.md'
          ? '- [ ] Implement the approved change\n'
          : '# Approved workflow\nKeep the complete requested scope.\n',
      );
    const open = cli('guard', 'compact-demo', 'open');
    // 批准和拒绝仅模拟本隔离夹具的用户决定，不代表真实项目授权。
    cli('guard', 'compact-demo', 'open', '--apply', '--approval-hash', open.data.approvalHash);
    for (const marker of ['OLD_DESIGN_ONE', 'OLD_DESIGN_TWO']) {
      const proposal = cli(
        'state',
        'propose-design',
        'compact-demo',
        '--proposal',
        marker + ' ' + 'retained design rationale '.repeat(350),
      );
      cli(
        'state',
        'decide-design',
        'compact-demo',
        '--proposal-hash',
        proposal.data.wait.proposalHash,
        '--choice',
        'rejected',
      );
    }
    cli(
      'state',
      'propose-design',
      'compact-demo',
      '--proposal',
      'CURRENT_COMPLETE_DESIGN ' + 'current decision '.repeat(100),
    );
    const inspected = await dispatch({ operation: 'inspect', runId: 'compact-demo' });
    const compact = await dispatch({ operation: 'next', runId: 'compact-demo' });
    const text = JSON.stringify(compact);
    const decisionCopies = text.split('CURRENT_COMPLETE_DESIGN').length - 1;
    if (process.env.COMET_TEST_CONTEXT_METRICS_FILE) {
      await fs.writeFile(
        process.env.COMET_TEST_CONTEXT_METRICS_FILE,
        JSON.stringify({
          compactBytes: Buffer.byteLength(text),
          inspectBytes: Buffer.byteLength(JSON.stringify(inspected)),
          decisionCopies,
        }),
      );
    }
    expect(JSON.stringify(inspected)).toContain('OLD_DESIGN_ONE');
    expect(JSON.stringify(inspected)).toContain('OLD_DESIGN_TWO');
    expect(text).not.toContain('OLD_DESIGN_ONE');
    expect(text).not.toContain('OLD_DESIGN_TWO');
    for (const field of [
      'actions',
      'actionContexts',
      'outputs',
      'state',
      'input',
      'waits',
      'definitionHashes',
    ])
      expect(compact.data).not.toHaveProperty(field);
    const current = compact.data.continuation.current.waits[0];
    const original = inspected.data.waits.find(
      (wait: { status: string }) => wait.status === 'pending',
    );
    expect(decisionCopies).toBe(1);
    expect(compact.data.run.waits[0]).toMatchObject({
      id: current.id,
      proposalRef: '/data/continuation/current/waits/0/proposal',
    });
    expect(current.proposal).toEqual(original.proposal);
    expect(current.proposalHash).toBe(original.proposalHash);
    expect(current.request).toMatchObject({
      waitId: original.id,
      expectedRevision: inspected.data.revision,
    });
    expect(JSON.stringify(current.proposal), JSON.stringify(compact.data.continuation)).toContain(
      'CURRENT_COMPLETE_DESIGN',
    );
    const detailed = await dispatch({ operation: 'next', runId: 'compact-demo' }, true);
    expect(detailed.data).toEqual(inspected.data);
    const approved = await dispatch({
      ...current.request,
      decisionId: 'fixture-user-approved-current-design',
      choice: 'approved',
    });
    const action = approved.data.continuation.current.actions[0];
    const claimed = await dispatch({
      operation: 'claim',
      runId: 'compact-demo',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'classic-host',
      sessionId: 'actual-design-receiver',
      claimToken: 'current-design-claim',
    });
    expect(claimed.data.contextDelivery.sessionId).toBe('actual-design-receiver');
    expect(claimed.data.continuation.current.actions[0]).toMatchObject({
      id: action.id,
      status: 'running',
      claim: { sessionId: 'actual-design-receiver' },
    });
    expect(claimed.data.configuration.phase).toBe('design');
    const fullClaim = await dispatch({ operation: 'inspect', runId: 'compact-demo' });
    const originalAction = fullClaim.data.actions.find(
      (entry: { id: string }) => entry.id === action.id,
    );
    expect(originalAction.inputHash).toBe(action.inputHash);
    expect(claimed.data.continuation.current.actions[0].inputSummary.scope).toEqual(
      originalAction.input.input,
    );
    const approval = claimed.data.continuation.current.approvals.find(
      (wait: { id: string }) => wait.id === current.id,
    );
    expect(approval).toMatchObject({
      proposal: original.proposal,
      proposalHash: original.proposalHash,
      decision: { choice: 'approved' },
    });
    expect(claimed.data.configuration).toEqual(fullClaim.data.state);
    expect(JSON.stringify(claimed)).not.toContain('OLD_DESIGN_ONE');
    expect(JSON.stringify(claimed)).not.toContain('OLD_DESIGN_TWO');
    expect(Buffer.byteLength(JSON.stringify(claimed))).toBeLessThan(
      Buffer.byteLength(JSON.stringify(fullClaim)),
    );
    const designDoc = 'docs/approved-design.md';
    await fs.mkdir(path.join(project, 'docs'), { recursive: true });
    await fs.writeFile(
      path.join(project, designDoc),
      '---\ncomet_change: compact-demo\nrole: technical-design\ncanonical_spec: openspec\n---\n' +
        '# Approved design\nImplement the complete requested scope.\n',
    );
    const recorded = await dispatch({
      operation: 'record-outcome',
      runId: 'compact-demo',
      expectedRevision: claimed.data.revision,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'current-design-claim',
        outcomeId: 'fixture-design-document-created',
        status: 'succeeded',
        output: { designDoc },
      },
    });
    expect(recorded.data.continuation.current.evidenceWaits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'classic-design-document', status: 'pending' }),
      ]),
    );
    const after = await dispatch({ operation: 'inspect', runId: 'compact-demo' });
    expect(
      after.data.actions.find((entry: { id: string }) => entry.id === action.id),
    ).toMatchObject({
      status: 'succeeded',
      outcome: { output: { designDoc } },
    });
    const resumed = cli('state', 'next', 'compact-demo', '--continue');
    expect(resumed.data.phase).toBe('build');
    expect(resumed.data.workspace.projectRoot).toBe(project);
    const config = 'build-configuration.json';
    await fs.writeFile(
      path.join(project, config),
      JSON.stringify({
        build_mode: 'executing-plans',
        tdd_mode: 'tdd',
        review_mode: 'standard',
        subagent_dispatch: null,
      }),
    );
    const plan = 'docs/superpowers/plans/plan.md';
    await fs.mkdir(path.dirname(path.join(project, plan)), { recursive: true });
    await fs.writeFile(
      path.join(directory, 'tasks.md'),
      '- [x] Implement the approved change <!-- comet-task:impl -->\n',
    );
    await fs.writeFile(
      path.join(project, plan),
      '<!-- comet-task-authority: openspec/changes/compact-demo/tasks.md -->\n' +
        '# Plan\n<!-- comet-task-ref:impl -->\nImplement and verify the approved change.\n',
    );
    const configuration = cli('state', 'propose-build', 'compact-demo', '--file', config);
    cli(
      'state',
      'decide-build',
      'compact-demo',
      '--proposal-hash',
      configuration.data.wait.proposalHash,
      '--choice',
      'approved',
    );
    cli('state', 'submit-plan', 'compact-demo', '--plan', plan);
    const checks = '.comet/agent-checks.json';
    const recordCheck = async (name: string, argv: string[]) => {
      execFileSync(process.execPath, argv, { cwd: project, stdio: 'ignore' });
      await fs.writeFile(
        path.join(project, checks),
        JSON.stringify({
          checks: [{ name, result: 'passed', note: `Observed successful ${name} command.` }],
        }),
      );
    };
    await fs.writeFile(path.join(project, 'result.cjs'), 'module.exports = 1;\n');
    await recordCheck('build syntax', ['--check', 'result.cjs']);
    cli(
      'state',
      'complete-build',
      'compact-demo',
      '--checks',
      checks,
      '--session',
      'fixture-builder',
    );
    const verify = cli('state', 'next', 'compact-demo');
    expect(verify.data.phase).toBe('verify');
    const pendingVerify = verify.data.continuation.current.actions[0];
    expect(pendingVerify).toMatchObject({
      stepId: 'full.verify.run',
      status: 'pending',
    });
    // The fixture uses distinct Builder and Verifier execution references.
    const verifying = await dispatch({
      operation: 'claim',
      runId: 'compact-demo',
      actionId: pendingVerify.id,
      attempt: pendingVerify.attempt,
      inputHash: pendingVerify.inputHash,
      executorId: 'classic-host',
      sessionId: 'fixture-verifier',
      claimToken: 'fixture-verifier-claim',
    });
    await recordCheck('verify behavior', [
      '-e',
      'require("node:assert").strictEqual(require("./result.cjs"), 1)',
    ]);
    const report = 'docs/superpowers/reports/verify.md';
    await fs.mkdir(path.dirname(path.join(project, report)), { recursive: true });
    await fs.writeFile(
      path.join(project, report),
      '# Verification\nIndependent CLI behavior assertion passed.\n',
    );
    const actualChecks = JSON.parse(await fs.readFile(path.join(project, checks), 'utf8'));
    await dispatch({
      operation: 'record-outcome',
      runId: 'compact-demo',
      expectedRevision: verifying.data.revision,
      outcome: {
        actionId: pendingVerify.id,
        attempt: pendingVerify.attempt,
        inputHash: pendingVerify.inputHash,
        claimToken: 'fixture-verifier-claim',
        outcomeId: 'fixture-verifier-result',
        status: 'succeeded',
        output: { event: 'verification-ready', verificationReport: report, ...actualChecks },
      },
    });
    cli('guard', 'compact-demo', 'verify', '--report', report, '--apply', '--checks', checks);
    const verified = await dispatch({ operation: 'inspect', runId: 'compact-demo' });
    expect(verified.data.state).toMatchObject({ phase: 'archive', verifyResult: 'pass' });
    const builderAction = verified.data.actions.find(
      (entry: { stepId: string }) => entry.stepId === 'full.build.execute',
    );
    const verifierAction = verified.data.actions.find(
      (entry: { stepId: string }) => entry.stepId === 'full.verify.run',
    );
    expect(builderAction.claim.sessionId).toBe('fixture-builder');
    expect(verifierAction).toMatchObject({
      status: 'succeeded',
      claim: { sessionId: 'fixture-verifier' },
      outcome: { output: actualChecks },
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 120_000);
