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
    if (process.env.COMET_TEST_CONTEXT_METRICS_FILE) {
      await fs.writeFile(
        process.env.COMET_TEST_CONTEXT_METRICS_FILE,
        JSON.stringify({
          compactBytes: Buffer.byteLength(text),
          inspectBytes: Buffer.byteLength(JSON.stringify(inspected)),
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
  } finally {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}, 120_000);
