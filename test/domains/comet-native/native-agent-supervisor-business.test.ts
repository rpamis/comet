import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })),
  );
});

it.each(['source', 'generated'] as const)(
  'completes Agent-selected Supervisor work through the Native business entry via %s',
  async (entry) => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'native-supervisor-business-'));
    roots.push(base);
    const root = path.join(base, 'project'),
      home = path.join(base, 'home');
    await fs.mkdir(root);
    await fs.mkdir(home);
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    git(root, 'init', '-b', 'main');
    git(root, 'config', 'core.autocrlf', 'false');
    git(root, 'config', 'user.name', 'Fixture');
    git(root, 'config', 'user.email', 'fixture@example.invalid');
    await fs.writeFile(path.join(root, 'README.md'), 'Supervisor business fixture\n');
    git(root, 'add', 'README.md');
    git(root, 'commit', '-m', 'baseline');
    const invoke = async (...args: string[]) => {
      const input = [...args, '--project-root', root, '--json'];
      if (entry === 'source') return runNativeCli(input);
      const r = spawnSync(
        process.execPath,
        [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...input],
        { cwd: root, encoding: 'utf8', windowsHide: true },
      );
      return { exitCode: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
    };
    const cli = async (...args: string[]) => {
      const r = await invoke(...args);
      expect(r.exitCode, r.stdout ?? r.stderr).toBe(0);
      return JSON.parse(r.stdout!).data;
    };
    const name = 'agent-supervisor',
      resultFile = path.join(base, 'result.json');
    await cli('new', name, '--runtime', 'sdk', '--isolation', 'current');
    const change = path.join(root, 'docs/comet/changes', name);
    await fs.writeFile(
      path.join(change, 'brief.md'),
      'Implement API and UI output and verify the complete result.\n',
    );
    await fs.writeFile(
      path.join(change, 'children.yaml'),
      'schema: comet.native.children.v2\nchildren:\n  - name: api\n    depends_on: []\n    covers: [A1]\n  - name: ui\n    depends_on: ' +
        (entry === 'source' ? '[api]' : '[]') +
        '\n    covers: [A2]\n',
    );
    let task = await cli('next', name, '--session', 'shape-agent');
    await fs.writeFile(
      resultFile,
      JSON.stringify({
        status: 'succeeded',
        output: {
          acceptance: [
            { source: 'brief.md', text: 'API output is available.' },
            { source: 'brief.md', text: 'UI output is available.' },
            { source: 'brief.md', text: 'The integrated result retains both outputs.' },
          ],
        },
      }),
    );
    await cli(
      'next',
      name,
      '--session',
      'shape-agent',
      '--action',
      task.task.actionId,
      '--result',
      resultFile,
    );
    const shaped = await inspectNativeSdkRun(root, name);
    const runId = shaped.run.runId;
    git(root, 'add', '-A');
    git(root, 'commit', '-m', 'confirmed Shape materials');
    // 本测试的批准仅属于隔离夹具，不代表真实用户批准。
    await cli(
      'next',
      name,
      '--confirmed',
      '--coordination-mode',
      'multi-session',
      '--summary',
      'Fixture user approved the complete scope and coordination.',
      '--expected-state-version',
      String(shaped.state.state_version),
      '--expected-action',
      'confirm-shape',
    );
    for (const child of ['api', 'ui']) {
      task = await cli('next', name, '--session', child + '-builder');
      if (task.task.session !== child + '-builder') {
        const selected = task.availableTasks.find(
          (item: { child?: string }) => item.child === child,
        );
        task = await cli(
          'next',
          name,
          '--session',
          child + '-builder',
          '--action',
          selected.actionId,
        );
      }
      expect(task.task).toMatchObject({ role: 'build', child, session: child + '-builder' });
      const worktree = task.workspace.projectRoot;
      await fs.writeFile(path.join(worktree, child + '.txt'), child + ' output\n');
      await fs.mkdir(path.join(worktree, child + '-checks'));
      await fs.writeFile(
        path.join(worktree, child + '-checks', 'README.md'),
        'Child-local check directory\n',
      );
      git(worktree, 'add', child + '.txt', child + '-checks');
      git(worktree, 'commit', '-m', child + ' implementation');
      await fs.writeFile(
        resultFile,
        JSON.stringify({
          status: 'succeeded',
          output: {
            candidateCommit: git(worktree, 'rev-parse', 'HEAD'),
            verificationChecks: [],
            requireIndependentReview: child === 'ui',
          },
        }),
      );
      task = await cli(
        'next',
        name,
        '--session',
        child + '-builder',
        '--action',
        task.task.actionId,
        '--result',
        resultFile,
      );
      const reviewSession = child === 'ui' ? 'actual-ui-reviewer' : child + '-builder';
      if (child === 'ui') {
        expect(task.task).toMatchObject({
          role: 'verify',
          child,
          readOnly: true,
          session: null,
          requireIndependentReview: true,
        });
        const before = await inspectNativeSdkRun(root, name);
        expect(
          (
            await invoke(
              'next',
              name,
              '--session',
              child + '-builder',
              '--action',
              task.task.actionId,
            )
          ).exitCode,
        ).not.toBe(0);
        expect((await inspectNativeSdkRun(root, name)).run).toEqual(before.run);
        task = await cli('next', name, '--session', reviewSession, '--action', task.task.actionId);
      }
      expect(task.task).toMatchObject({
        role: 'verify',
        child,
        readOnly: true,
        session: reviewSession,
      });
      expect(task.task.acceptance).toHaveLength(1);
      const repairExpected = child === (entry === 'source' ? 'api' : 'ui');
      const integrationChecks = repairExpected
        ? [
            {
              id: 'integration-ready',
              name: 'Integration readiness',
              executable: process.execPath,
              argv: [
                '-e',
                "process.exit(require('node:fs').existsSync('../integration-ready.txt')?0:1)",
              ],
              cwdRef: child + '-checks',
              timeoutMs: 10000,
              repeatable: true,
            },
          ]
        : [];
      await fs.writeFile(
        resultFile,
        JSON.stringify({
          status: 'succeeded',
          output: {
            candidateCommit: task.resultTemplate.output.candidateCommit,
            verdict: 'pass',
            evidence: {
              summary: 'Observed the requested child output.',
              checks: [],
              acceptance: task.task.acceptance.map((item: { id: string }) => ({
                id: item.id,
                result: 'passed',
                reason: 'Observed ' + child + '.txt.',
              })),
            },
            integrationChecks,
          },
        }),
      );
      let completed = await cli(
        'next',
        name,
        '--session',
        reviewSession,
        '--action',
        task.task.actionId,
        '--result',
        resultFile,
      );
      if (repairExpected) {
        expect(completed.task).toMatchObject({
          role: 'integration-repair',
          child,
          readOnly: false,
        });
        const pending = await inspectNativeSdkRun(root, name);
        const repair = pending.run.actions.find((action) => action.id === completed.task.actionId)!;
        const original = (
          repair.input as { activation: { worktree: string; integrationWorktree: string } }
        ).activation;
        expect(completed.workspace.projectRoot).toBe(original.integrationWorktree);
        expect(completed.workspace.projectRoot).not.toBe(worktree);
        if (child === 'ui') expect(completed.task.session).toBeNull();
        if (!completed.task.session)
          completed = await cli(
            'next',
            name,
            '--session',
            child + '-builder',
            '--action',
            completed.task.actionId,
          );
        await fs.writeFile(
          path.join(completed.workspace.projectRoot, 'integration-ready.txt'),
          'Integration repaired\n',
        );
        git(completed.workspace.projectRoot, 'add', 'integration-ready.txt');
        git(completed.workspace.projectRoot, 'commit', '-m', 'repair integration readiness');
        await fs.writeFile(
          resultFile,
          JSON.stringify({
            status: 'succeeded',
            output: {
              summary: 'Repaired the actual failed integration check.',
              integrationCommit: git(completed.workspace.projectRoot, 'rev-parse', 'HEAD'),
              integrationChecks,
            },
          }),
        );
        await cli(
          'next',
          name,
          '--session',
          child + '-builder',
          '--action',
          completed.task.actionId,
          '--result',
          resultFile,
        );
      }
    }
    task = await cli('next', name, '--session', 'parent-agent');
    expect(task.task).toMatchObject({ role: 'build', scope: 'parent' });
    expect(task.task.acceptance).toHaveLength(3);
    const worktree = task.workspace.projectRoot;
    for (const child of ['api', 'ui'])
      expect(await fs.readFile(path.join(worktree, child + '.txt'), 'utf8')).toBe(
        child + ' output\n',
      );
    await fs.writeFile(
      resultFile,
      JSON.stringify({
        status: 'succeeded',
        output: {
          summary: 'The complete integrated result satisfies all three criteria.',
          addressedAcceptanceIds: task.task.acceptance.map((item: { id: string }) => item.id),
          checks: [],
          knownLimits: [],
          verificationChecks: [],
          requireIndependentReview: false,
          candidateCommit: git(worktree, 'rev-parse', 'HEAD'),
        },
      }),
    );
    task = await cli(
      'next',
      name,
      '--session',
      'parent-agent',
      '--action',
      task.task.actionId,
      '--result',
      resultFile,
    );
    expect(task.task).toMatchObject({ role: 'verify', readOnly: true, session: 'parent-agent' });
    expect(task.task.acceptance).toHaveLength(3);
    await fs.writeFile(
      resultFile,
      JSON.stringify({
        status: 'succeeded',
        output: {
          candidateId: task.task.candidateId,
          verifierExecutionRef: 'parent-agent',
          response: {
            kind: 'final-result',
            result: {
              iteration: task.resultTemplate.output.response.result.iteration,
              attempt: task.resultTemplate.output.response.result.attempt,
              verdict: 'pass',
              acceptance: task.task.acceptance.map((item: { id: string }) => ({
                id: item.id,
                result: 'passed',
                reason: 'Observed both integrated outputs.',
              })),
              risks: [],
              summary: 'All parent criteria passed.',
            },
          },
        },
      }),
    );
    const completeResult = JSON.parse(await fs.readFile(resultFile, 'utf8'));
    const incompleteResult = structuredClone(completeResult);
    incompleteResult.output.response.result.acceptance.pop();
    await fs.writeFile(resultFile, JSON.stringify(incompleteResult));
    const before = await inspectNativeSdkRun(root, name);
    expect(
      (
        await invoke(
          'next',
          name,
          '--session',
          'parent-agent',
          '--action',
          task.task.actionId,
          '--result',
          resultFile,
        )
      ).exitCode,
    ).not.toBe(0);
    const rejected = await inspectNativeSdkRun(root, name);
    expect(rejected.state).toEqual(before.state);
    const originalAction = before.run.actions.find((action) => action.id === task.task.actionId)!;
    const currentAction = rejected.run.actions.find((action) => action.id === task.task.actionId)!;
    expect(currentAction).toMatchObject({ status: 'running', claim: originalAction.claim });
    expect(currentAction.outcome).toEqual(originalAction.outcome);
    expect(currentAction.rejectedOutcomes).toHaveLength(1);
    await fs.writeFile(resultFile, JSON.stringify(completeResult));
    const accepted = await cli(
      'next',
      name,
      '--session',
      'parent-agent',
      '--action',
      task.task.actionId,
      '--result',
      resultFile,
      '--accept-on-pass',
      'Fixture user delegated acceptance and Archive after all criteria pass.',
    );
    expect(accepted.status, JSON.stringify(accepted)).toBe('completed');
    const final = await inspectNativeSdkRun(root, name);
    expect(final.run.runId).toBe(runId);
    expect(final.run.status).toBe('completed');
    expect(final.state.acceptance.every((item) => item.result === 'passed')).toBe(true);
    expect(
      final.run.actions.filter(
        (action) => action.stepId === 'supervisor.child.archive' && action.status === 'succeeded',
      ),
    ).toHaveLength(2);
  },
  240000,
);
