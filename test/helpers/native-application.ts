import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';
import { createNativePortableState } from '../../domains/comet-native/native-portable-state.js';
import { prepareNativeCandidateReviewExample } from '../../domains/comet-native/native-candidate-review-example.js';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import { runNativeCli } from '../../domains/comet-native/native-cli.js';
import type { RuntimeAction, RuntimeValue, WorkflowRun } from '../../domains/engine/runtime.js';
import { fixtureAcceptanceReview } from './native-builder-acceptance-review.js';

export async function prepareNativeApplication(root: string, supervisor = false) {
  const projectRoot = path.join(root, 'project');
  await fs.mkdir(projectRoot);
  await fs.mkdir(path.join(root, 'node_modules', '@rpamis'), { recursive: true });
  await fs.symlink(
    path.resolve('.'),
    path.join(root, 'node_modules', '@rpamis', 'comet'),
    'junction',
  );
  const file = await prepareNativeCandidateReviewExample(path.join(root, 'package'));
  await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
  const name = 'native-example';
  const change = path.join(projectRoot, 'docs/comet/changes', name);
  await fs.mkdir(path.join(change, 'specs', 'example'), { recursive: true });
  await fs.writeFile(
    path.join(change, 'brief.md'),
    '# Outcome\nShip the candidate.\n# Scope\nCandidate review.\n# Non-goals\nPublishing.\n' +
      '# Acceptance examples\n- The candidate meets its requirement.\n' +
      '# Directory structure\n## Created\n- candidate.txt\n## Modified\nNone.\n## Deleted\nNone.\n## Not created\nNo service.\n',
  );
  await fs.writeFile(
    path.join(change, 'specs/example/spec.md'),
    '# Example\nThe candidate meets its requirement.\n',
  );
  if (supervisor)
    await fs.writeFile(
      path.join(change, 'children.yaml'),
      'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: The candidate meets its requirement.\nchildren:\n  - name: left\n    depends_on: []\n    covers: [A1]\n  - name: right\n    depends_on: []\n    covers: [A1]\n',
    );
  await fs.writeFile(path.join(projectRoot, 'candidate.txt'), 'unreviewed\n');
  await fs.writeFile(
    path.join(projectRoot, '.gitignore'),
    '.comet/runtime/\n.comet/current-change.json\n.worktrees/\n**/comet-state.yaml\n**/verification.md\nnode_modules/\n',
  );
  const git = (cwd: string, argv: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Comet Test', '-c', 'user.email=comet-test@example.com', ...argv],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
  git(projectRoot, ['init', '-b', 'main']);
  git(projectRoot, ['add', '.']);
  git(projectRoot, ['commit', '-m', 'base']);
  let counter = 0;
  async function dispatch(request: Record<string, unknown>, applicationFile = false) {
    const requestFile = path.join(root, `request-${++counter}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    const result = await runtimeDispatchCommand({
      projectRoot,
      request: requestFile,
      ...(applicationFile ? { applicationFile: file } : { application: 'native-candidate-review' }),
    });
    if (result.response.status !== 'succeeded')
      throw new Error(JSON.stringify(result.response.error));
    return result.response.data;
  }
  async function native(argv: string[]) {
    const result = await runNativeCli([...argv, '--project-root', projectRoot, '--json']);
    const envelope = JSON.parse(result.stdout!);
    if (result.exitCode) {
      const observed = await dispatch({ operation: 'inspect', runId: name }).catch(() => null);
      throw new Error(
        JSON.stringify({
          ...envelope,
          actions: observed?.actions
            .filter((action) => ['running', 'unknown'].includes(action.status))
            .map(({ id, stepId, status, receipts }) => ({ id, stepId, status, receipts })),
        }),
      );
    }
    return envelope.data;
  }
  await dispatch(
    {
      operation: 'start',
      runId: name,
      workflow: { id: 'comet-native', version: '1' },
      input: { name, artifactRootRef: 'docs' },
      initialState: createNativePortableState({
        name,
        language: 'en',
        workspace: {
          isolation: 'current',
          change_branch: 'main',
          target_branch: 'main',
          finish: null,
        },
      }),
    },
    true,
  );
  await native(['next', name]);
  let run = await dispatch({ operation: 'inspect', runId: name });
  await native([
    'next',
    name,
    '--confirmed',
    '--summary',
    'Confirmed scope',
    '--expected-state-version',
    String((run.state as { state_version: number }).state_version),
    '--expected-action',
    'confirm-shape',
    ...(supervisor ? ['--coordination-mode', 'multi-session'] : []),
  ]);
  run = await dispatch({ operation: 'inspect', runId: name });
  async function claim(action: RuntimeAction, sessionId = 'builder') {
    return dispatch({
      operation: 'claim',
      runId: name,
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'native-host',
      sessionId,
      claimToken: `${action.id}-${sessionId}`,
    });
  }
  async function record(action: RuntimeAction, output: RuntimeValue, status = 'succeeded') {
    return dispatch({
      operation: 'record-outcome',
      runId: name,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim!.token,
        outcomeId: `${action.id}-result`,
        status,
        output,
      },
    });
  }
  const checks = [
    {
      id: 'candidate-process',
      name: 'candidate process',
      executable: process.execPath,
      argv: ['-e', 'process.exit(0)'],
      cwdRef: '.',
      timeoutMs: 10000,
      repeatable: true,
    },
  ];
  async function submitBuilder(action: RuntimeAction, content: string, sessionId = 'builder') {
    const activation = (
      action.input as { activation?: { worktree?: string; integrationWorktree?: string } }
    ).activation;
    const cwd = ['supervisor.parent.builder', 'supervisor.child.integration-repair'].includes(
      action.stepId,
    )
      ? activation!.integrationWorktree!
      : (activation?.worktree ?? projectRoot);
    await fs.writeFile(path.join(cwd, 'candidate.txt'), content);
    git(cwd, ['add', 'candidate.txt']);
    git(cwd, ['commit', '--allow-empty', '-m', `${action.id} candidate`]);
    const claimed = await claim(action, sessionId);
    const actual = claimed.actions.find(({ id }) => id === action.id)!;
    if (action.stepId === 'supervisor.child.integration-repair')
      return record(actual, {
        summary: 'Repaired integrated candidate',
        integrationCommit: git(cwd, ['rev-parse', 'HEAD']),
        integrationChecks: checks,
      });
    return record(actual, {
      summary: 'Implemented candidate',
      candidateCommit: git(cwd, ['rev-parse', 'HEAD']),
      addressedAcceptanceIds: ['A1'],
      acceptanceReview: fixtureAcceptanceReview(['A1']),
      checks: [{ name: 'candidate-process', result: 'passed', note: 'process exited 0' }],
      knownLimits: [],
      submittedAt: new Date().toISOString(),
      verificationChecks: checks,
    });
  }
  const pending = (value: WorkflowRun, step?: string) =>
    value.actions.find(
      (action) => action.status === 'pending' && (!step || action.stepId === step),
    )!;
  return {
    root,
    projectRoot,
    file,
    name,
    change,
    dispatch,
    native,
    run,
    claim,
    record,
    submitBuilder,
    checks,
    pending,
    git,
  };
}
