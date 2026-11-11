import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import * as gitWorktree from '../../../platform/paths/git-worktree.js';
import { defineNativeWorkflowApplication } from '../../../domains/comet-native/native-sdk-application.js';
import { nativeSdkSupervisorIntegrateExecutor } from '../../../domains/comet-native/native-sdk-supervisor-integrate.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';

it('keeps the parent Builder unavailable until the original dependent Child graph is integrated', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-current-parent-frontier-'));
  roots.push(root);
  execFileSync('git', ['init', '-b', 'main'], { cwd: root, stdio: 'ignore' });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'seed',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  const name = 'frontier';
  const cli = async (...args: string[]) => {
    const r = await runNativeCli([...args, '--project-root', root, '--json']);
    expect(r.exitCode, r.stdout).toBe(0);
    return JSON.parse(r.stdout!).data;
  };
  await cli('new', name);
  const change = path.join(root, 'docs/comet/changes', name);
  await fs.writeFile(path.join(change, 'brief.md'), 'Deliver the complete API and UI result.\n');
  await fs.writeFile(
    path.join(change, 'children.yaml'),
    'schema: comet.native.children.v2\nchildren:\n  - name: api\n    depends_on: []\n    covers: [A1]\n  - name: ui\n    depends_on: [api]\n    covers: [A2]\n',
  );
  const shape = await cli('next', name, '--session', 'shape-fixture-agent');
  const result = path.join(root, 'shape-result.json');
  await fs.writeFile(
    result,
    JSON.stringify({
      status: 'succeeded',
      output: {
        acceptance: [
          { source: 'brief.md', text: 'API works.' },
          { source: 'brief.md', text: 'UI works.' },
        ],
      },
    }),
  );
  await cli(
    'next',
    name,
    '--session',
    'shape-fixture-agent',
    '--action',
    shape.task.actionId,
    '--result',
    result,
  );
  const proposed = await inspectNativeSdkRun(root, name);
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'fixture scope',
    ],
    { cwd: root, stdio: 'ignore' },
  );
  await cli(
    'next',
    name,
    '--confirmed',
    '--coordination-mode',
    'multi-session',
    '--summary',
    'Fixture user approved the full child scope',
    '--expected-state-version',
    String(proposed.state.state_version),
    '--expected-action',
    'confirm-shape',
  );
  const task = await cli('next', name, '--session', 'actual-api-fixture-session');
  expect(task.task).toMatchObject({
    role: 'build',
    child: 'api',
    session: 'actual-api-fixture-session',
  });
  const run = (await inspectNativeSdkRun(root, name)).run;
  expect(
    run.actions.some(
      (action) =>
        action.stepId === 'supervisor.parent.builder' &&
        ['pending', 'running'].includes(action.status),
    ),
  ).toBe(false);
  expect(
    run.actions.some(
      (action) =>
        action.stepId === 'supervisor.child.builder' &&
        (action.input as { activation?: { child?: string } }).activation?.child === 'ui' &&
        ['pending', 'running'].includes(action.status),
    ),
  ).toBe(false);
  expect(run.waits.find((wait) => wait.stepId === 'supervisor.shape.confirm')).toMatchObject({
    status: 'resolved',
    decision: { choice: 'multi-session' },
  });
});

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) =>
      fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      }),
    ),
  );
});

it.each(['complete', 'target-drift', 'dirty-child', 'wrong-child-branch'] as const)(
  'preserves real Supervisor delivery and all cleanup targets through the current public CLI: %s',
  async (variant) => {
    const entry = 'source' as const;
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
            {
              source: 'brief.md',
              text: 'The integrated result retains both outputs.',
            },
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
      expect(task.task).toMatchObject({
        role: 'build',
        child,
        session: child + '-builder',
      });
      const worktree = task.workspace.projectRoot;
      await fs.writeFile(path.join(worktree, child + '.txt'), child + ' output\n');
      await fs.mkdir(path.join(worktree, child + '-checks'));
      await fs.writeFile(
        path.join(worktree, child + '-checks', 'README.md'),
        'Child-local check directory\n',
      );
      git(worktree, 'add', child + '.txt', child + '-checks');
      git(worktree, 'commit', '-m', child + ' implementation');
      if (entry === 'source') {
        const { run } = await inspectNativeSdkRun(root, name);
        const action = run.actions.find((item) => item.id === task.task.actionId)!;
        const validator = defineNativeWorkflowApplication('4').validators.find(
          (item) => item.id === 'native-supervisor-builder-outcome',
        )!;
        const refs = vi.spyOn(gitWorktree, 'resolveGitRef');
        const validated = await validator.validate({
          run,
          action,
          outcome: {
            outcomeId: 'validation-budget',
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: action.claim!.token,
            status: 'succeeded',
            output: {
              candidateCommit: git(worktree, 'rev-parse', 'HEAD'),
              verificationChecks: [],
            },
          },
          context: { requestId: 'validation-budget', projectRoot: root },
        });
        expect(validated).toMatchObject({ accepted: true });
        expect(
          refs.mock.calls.filter(([cwd]) => path.resolve(cwd) === path.resolve(root)),
        ).toHaveLength(0);
        refs.mockRestore();
      }
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
      const checks: Array<{ name: string; result: 'passed' | 'failed' }> = [];
      const output = {
        candidateCommit: task.resultTemplate.output.candidateCommit,
        verdict: 'pass',
        evidence: {
          summary: 'Observed the requested child output.',
          checks,
          acceptance: task.task.acceptance.map((item: { id: string }) => ({
            id: item.id,
            result: 'passed',
            reason: 'Observed ' + child + '.txt.',
          })),
        },
      };
      if (repairExpected) {
        const marker = path.join(base, child + '-integration-ready');
        const checkArgs = [
          '-e',
          'process.exit(require("node:fs").existsSync(' + JSON.stringify(marker) + ')?0:7)',
        ];
        expect(spawnSync(process.execPath, checkArgs, { cwd: worktree }).status).toBe(7);
        checks.push({
          name: 'Actual platform integration readiness',
          result: 'failed',
        });
        await fs.writeFile(resultFile, JSON.stringify({ status: 'succeeded', output }));
        const before = (await inspectNativeSdkRun(root, name)).run;
        const rejected = await invoke(
          'next',
          name,
          '--session',
          reviewSession,
          '--action',
          task.task.actionId,
          '--result',
          resultFile,
        );
        expect(rejected.exitCode).not.toBe(0);
        const afterRejected = (await inspectNativeSdkRun(root, name)).run;
        expect(afterRejected.state).toEqual(before.state);
        expect(afterRejected.waits).toEqual(before.waits);
        expect(afterRejected.actions.map((action) => action.id)).toEqual(
          before.actions.map((action) => action.id),
        );
        const original = before.actions.find((action) => action.id === task.task.actionId)!;
        const retained = afterRejected.actions.find((action) => action.id === original.id)!;
        expect(retained).toMatchObject({
          id: original.id,
          attempt: original.attempt,
          inputHash: original.inputHash,
          status: 'running',
          claim: original.claim,
        });
        expect(retained.outcome).toBeUndefined();
        expect(retained.rejectedOutcomes?.at(-1)?.outcome).toMatchObject({
          actionId: original.id,
          attempt: original.attempt,
          inputHash: original.inputHash,
          output: { evidence: { checks: [{ result: 'failed' }] } },
        });
        await fs.writeFile(marker, 'Platform condition repaired\n');
        expect(spawnSync(process.execPath, checkArgs, { cwd: worktree }).status).toBe(0);
        checks[0].result = 'passed';
      }
      if (entry === 'source' && child === 'api') {
        const originalPreflight = nativeSdkSupervisorIntegrateExecutor.preflight!;
        vi.spyOn(nativeSdkSupervisorIntegrateExecutor, 'preflight').mockImplementationOnce(
          async function (action, context, run) {
            const integration = path.join(root, '.worktrees', name + '-integration');
            const head = git(integration, 'rev-parse', 'HEAD');
            const status = git(integration, 'status', '--porcelain');
            const target = git(root, 'rev-parse', 'main');
            await originalPreflight.call(this, action, context, run);
            try {
              git(root, 'update-ref', '-d', 'refs/heads/main');
              await expect(originalPreflight.call(this, action, context, run)).rejects.toThrow(
                'target branch has no commit',
              );
              expect(git(integration, 'rev-parse', 'HEAD')).toBe(head);
              expect(git(integration, 'status', '--porcelain')).toBe(status);
              git(root, 'update-ref', 'refs/heads/main', target);
              const divergent = git(
                root,
                'commit-tree',
                target + '^{tree}',
                '-m',
                'isolated divergent target',
              );
              git(root, 'update-ref', 'refs/heads/main', divergent);
              await expect(originalPreflight.call(this, action, context, run)).rejects.toThrow();
              expect(git(integration, 'rev-parse', 'HEAD')).toBe(head);
              expect(git(integration, 'status', '--porcelain')).toBe(status);
              expect((await inspectNativeSdkRun(root, name)).run.revision).toBe(run!.revision);
            } finally {
              git(root, 'update-ref', 'refs/heads/main', target);
            }
            await originalPreflight.call(this, action, context, run);
          },
        );
      }
      await fs.writeFile(resultFile, JSON.stringify({ status: 'succeeded', output }));
      await cli(
        'next',
        name,
        '--session',
        reviewSession,
        '--action',
        task.task.actionId,
        '--result',
        resultFile,
      );
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
    expect(task.task).toMatchObject({
      role: 'verify',
      readOnly: true,
      session: 'parent-agent',
    });
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
    expect(currentAction).toMatchObject({
      status: 'running',
      claim: originalAction.claim,
    });
    expect(currentAction.outcome).toEqual(originalAction.outcome);
    expect(currentAction.rejectedOutcomes).toHaveLength(1);
    await fs.writeFile(resultFile, JSON.stringify(completeResult));
    const expectedDelivery = git(worktree, 'rev-parse', 'HEAD');
    const childRoots = ['api', 'ui'].map((child) =>
      path.join(root, '.worktrees', name + '-' + child),
    );
    if (variant !== 'complete') {
      if (variant === 'target-drift') {
        await fs.writeFile(
          path.join(root, 'independent-target.txt'),
          'Independent target change\n',
        );
        git(root, 'add', 'independent-target.txt');
        git(root, 'commit', '-m', 'independent target change');
      } else if (variant === 'dirty-child')
        await fs.writeFile(
          path.join(childRoots[1], 'keep-user-work.txt'),
          'User work must survive\n',
        );
      else git(childRoots[1], 'switch', '-c', 'protected-wrong-child-branch');
      const targetBefore = git(root, 'rev-parse', 'main');
      const finalAttempt = await invoke(
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
      const after = await inspectNativeSdkRun(root, name);
      expect(after.run.status, finalAttempt.stdout).not.toBe('completed');
      expect(git(root, 'rev-parse', 'main')).toBe(targetBefore);
      for (const childRoot of childRoots) expect(await fs.stat(childRoot)).toBeDefined();
      expect(await fs.stat(worktree)).toBeDefined();
      expect(
        after.run.waits.filter(
          (w) => w.stepId === 'shape.confirm' || w.stepId === 'supervisor.shape.confirm',
        ),
      ).toEqual(
        before.run.waits.filter(
          (w) => w.stepId === 'shape.confirm' || w.stepId === 'supervisor.shape.confirm',
        ),
      );
      if (variant === 'dirty-child')
        expect(await fs.readFile(path.join(childRoots[1], 'keep-user-work.txt'), 'utf8')).toBe(
          'User work must survive\n',
        );
      if (variant === 'wrong-child-branch')
        expect(git(childRoots[1], 'branch', '--show-current')).toBe('protected-wrong-child-branch');
      const repeat = await invoke('archive', name);
      expect((await inspectNativeSdkRun(root, name)).run.status, repeat.stdout).not.toBe(
        'completed',
      );
      expect(git(root, 'rev-parse', 'main')).toBe(targetBefore);
      for (const childRoot of childRoots) expect(await fs.stat(childRoot)).toBeDefined();
      expect(await fs.stat(worktree)).toBeDefined();
      return;
    }
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
    expect(git(root, 'rev-parse', 'main')).toBe(expectedDelivery);
    for (const childRoot of childRoots)
      await expect(fs.stat(childRoot)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    await expect(fs.stat(worktree)).rejects.toMatchObject({ code: 'ENOENT' });
    for (const branch of ['integration', 'api', 'ui'])
      expect(git(root, 'branch', '--list', 'comet/supervisor/' + name + '/' + branch)).toBe('');
    const repeated = await invoke('archive', name);
    expect(repeated.exitCode, repeated.stdout).toBe(0);
    expect((await inspectNativeSdkRun(root, name)).run).toEqual(final.run);
    expect(git(root, 'rev-parse', 'main')).toBe(expectedDelivery);
  },
  240000,
);
