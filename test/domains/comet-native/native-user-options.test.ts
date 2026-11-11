import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { fixtureAcceptanceReview } from '../../helpers/native-builder-acceptance-review.js';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { archiveNativePortableChange } from '../../../domains/comet-native/native-portable-archive.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { nativeWorkspaceIsClean } from '../../../domains/comet-native/native-workspace-config.js';
import { ensureCometProjectGitignore } from '../../../domains/workflow-contract/project-gitignore.js';

const roots: string[] = [];
const git = (root: string, args: string[]) => {
  if (!root || !path.isAbsolute(root))
    throw new Error('Test Git commands require an explicit absolute fixture directory');
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
};
async function cliEnvelope(root: string, args: string[]) {
  const argv = [...args, '--project-root', root, '--json'];
  const result =
    process.env.COMET_TEST_NATIVE_RUNTIME === '1'
      ? {
          stdout: execFileSync(
            process.execPath,
            [path.resolve('assets/skills/comet-native/scripts/comet-native-runtime.mjs'), ...argv],
            { cwd: root, encoding: 'utf8', windowsHide: true },
          ),
        }
      : await runNativeCli(argv);
  const payload = JSON.parse(result.stdout!);
  expect(payload.exitCode, JSON.stringify(payload)).toBe(0);
  return payload;
}
async function cli(root: string, args: string[]) {
  return (await cliEnvelope(root, args)).data;
}
async function follow(root: string, args: string[]) {
  return cli(
    root,
    args.slice(2).map((arg) => (arg === '<summary>' ? 'User confirmed fixture' : arg)),
  );
}
async function input(root: string, name: string, value: unknown) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'native-options-input-'));
  roots.push(temp);
  const file = path.join(temp, 'input.json');
  await fs.writeFile(file, JSON.stringify(value));
  return cli(root, ['next', name, '--runner-input', file]);
}

function supervisorBrief(acceptance: string | string[]): string {
  const examples = Array.isArray(acceptance) ? acceptance : [acceptance];
  return `# Outcome
Exercise one integrated Supervisor result.

# Scope
Coordinate the child changes and the parent verification boundary.

## Directory structure
### Created
None.
### Modified
None.
### Deleted
None.
### Not created
None.

# Non-goals
Do not introduce behavior outside the coordinated change.

# Acceptance examples
${examples.map((example) => `- ${example}`).join('\n')}

# Constraints and invariants
Child evidence remains traceable to the parent result.

# Decisions
No product behavior change: this fixture validates Supervisor state transitions only.

# Open questions
None.

# Verification expectations
Run the focused Supervisor checks.
`;
}

async function repository() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-user-options-'));
  roots.push(root);
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'Native Test']);
  git(root, ['config', 'user.email', 'native@example.test']);
  await ensureCometProjectGitignore(root);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'seed']);
  return root;
}
const checks = (name: string, files: string[]) => [
  {
    id: name,
    name,
    executable: process.execPath,
    argv: [
      '-e',
      files
        .map(
          (file) =>
            `require('node:assert').equal(require('node:fs').readFileSync('${file}.txt','utf8'),'${file}')`,
        )
        .join(';'),
    ],
    cwdRef: '.',
    timeoutMs: 30000,
    repeatable: true,
  },
];
function platformChecks(root: string, plans: unknown[]) {
  return plans.map((entry) => {
    const plan = entry as { name: string; executable: string; argv: string[]; cwdRef: string };
    execFileSync(plan.executable, plan.argv, {
      cwd: path.resolve(root, plan.cwdRef),
      windowsHide: true,
      stdio: 'ignore',
    });
    return { name: plan.name, result: 'passed', note: `Actual Node check in ${root}` };
  });
}
async function acceptCandidate(
  root: string,
  name: string,
  ids: string[],
  plans: unknown[],
  finish?: 'keep' | false,
) {
  const built = await input(root, name, {
    kind: 'builder-handoff',
    summary: 'Protocol regression fixture',
    addressed_acceptance_ids: ids,
    acceptance_review: fixtureAcceptanceReview(ids),
    checks: platformChecks(root, plans),
    known_limits: ['Fixture semantic verdict'],
    review: {
      status: 'passed',
      summary: 'Fixture review',
      reviewer_execution_ref: 'fixture-review',
    },
  });
  expect(built.state.phase).toBe('verify');
  // SIMULATED platform acceptance of this independent Verifier task; no model is run.
  const dispatched = await input(root, name, {
    kind: 'dispatch-verifier',
    verifierExecutionRef: 'fixture-verifier-' + name,
  });
  expect(dispatched.verifierDispatch).toMatchObject({
    candidateId: expect.any(String),
    verifierExecutionRef: expect.any(String),
  });
  await input(root, name, {
    kind: 'verifier-started',
    candidateId: dispatched.verifierDispatch.candidateId,
    verifierExecutionRef: dispatched.verifierDispatch.verifierExecutionRef,
  });
  const result = await input(root, name, {
    kind: 'verifier-response',
    candidateId: dispatched.verifierDispatch.candidateId,
    verifierExecutionRef: dispatched.verifierDispatch.verifierExecutionRef,
    response: {
      kind: 'final-result',
      result: {
        iteration: dispatched.state.loop.iteration,
        attempt: dispatched.state.loop.attempt,
        verdict: 'pass',
        acceptance: ids.map((id) => ({ id, result: 'passed', reason: 'Fixture result' })),
        risks: [],
        summary: 'Fixture result',
      },
    },
  });
  if (finish === false) return result;
  return follow(
    root,
    result.continuation.commandAlternatives.find(
      (item: { name: string }) =>
        item.name === (finish ? `accept-result-${finish}` : 'accept-result'),
    ).commandArgs,
  );
}
afterEach(async () => {
  for (const root of roots.splice(0).reverse()) {
    expect(path.relative(os.tmpdir(), root)).not.toMatch(/^\.\./u);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe('Native public user-option paths', () => {
  it.each(['branch', 'worktree'] as const)(
    'accepts the result and keeps its %s workspace in one guarded decision',
    async (isolation) => {
      const primary = await repository();
      const created = await cli(primary, [
        'new',
        'combined',
        '--runtime',
        'compat',
        '--isolation',
        isolation,
      ]);
      const root = created.preparation.projectRoot;
      await fs.writeFile(
        path.join(root, 'docs/comet/changes/combined/brief.md'),
        supervisorBrief('The fixture works.'),
      );
      const prepared = await cli(root, ['next', 'combined', '--summary', 'Ready']);
      await follow(root, prepared.continuation.commandAlternatives[0].commandArgs);
      const accepted = await acceptCandidate(root, 'combined', ['A1'], [], 'keep');
      expect(accepted.state).toMatchObject({ phase: 'archive', workspace: { finish: 'keep' } });
      expect(accepted.continuation.requiresUserDecision).toBe(false);
      expect(accepted.continuation.requiredInputs).not.toContain('workspace-finish');
      const preview = await cli(root, ['archive', 'combined', '--dry-run']);
      expect(preview.ready).toBe(true);
      expect(
        (await follow(root, preview.continuation.commandArgs)).workspaceFinishResult.status,
      ).toBe('kept');
    },
  );

  it('rejects an expired one-step Archive choice without recording finish', async () => {
    const primary = await repository();
    const root = (
      await cli(primary, ['new', 'stale-finish', '--runtime', 'compat', '--isolation', 'branch'])
    ).preparation.projectRoot;
    await fs.writeFile(
      path.join(root, 'docs/comet/changes/stale-finish/brief.md'),
      supervisorBrief('The fixture works.'),
    );
    const prepared = await cli(root, ['next', 'stale-finish', '--summary', 'Ready']);
    await follow(root, prepared.continuation.commandAlternatives[0].commandArgs);
    const ready = await acceptCandidate(root, 'stale-finish', ['A1'], []);
    const args = [
      ...ready.continuation.commandAlternatives.find(
        (item: { name: string }) => item.name === 'keep-workspace',
      ).commandArgs,
    ];
    args[args.indexOf('--expected-state-version') + 1] = String(ready.state.state_version - 1);
    const rejected = await runNativeCli([...args.slice(2), '--project-root', root, '--json']);
    expect(rejected.exitCode).not.toBe(0);
    expect(JSON.parse(rejected.stdout!).error.message).toMatch(/stale/iu);
    expect((await cli(root, ['status', 'stale-finish'])).workspace.finish).toBeNull();
    expect(
      (
        await follow(
          root,
          ready.continuation.commandAlternatives.find(
            (item: { name: string }) => item.name === 'keep-workspace',
          ).commandArgs,
        )
      ).workspaceFinishResult.status,
    ).toBe('kept');
  });
  it.each(['branch', 'worktree'] as const)(
    'delivers Supervisor to its %s change and preserves keep',
    async (isolation) => {
      const primary = await repository();
      const original = git(primary, ['rev-parse', 'main']);
      // Exercise Runtime-created configuration, not a precommitted fixture config.
      const created = await cli(primary, [
        'new',
        'parent',
        '--runtime',
        'compat',
        '--isolation',
        isolation,
      ]);
      const root = created.preparation.projectRoot;
      const dir = path.join(root, 'docs/comet/changes/parent');
      await fs.mkdir(path.join(dir, 'specs/options'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'specs/options/spec.md'),
        '# Requirement\nBoth outputs MUST be available.\n',
      );
      await fs.writeFile(
        path.join(dir, 'brief.md'),
        supervisorBrief(['Alpha works.', 'Beta works.']),
      );
      await fs.writeFile(
        path.join(dir, 'children.yaml'),
        'schema: comet.native.children.v2\nacceptance_index:\n  A1:\n    source: brief.md\n    text: Alpha works.\n  A2:\n    source: brief.md\n    text: Beta works.\nchildren:\n  - name: alpha\n    depends_on: []\n    covers: [A1]\n  - name: beta\n    depends_on: []\n    covers: [A2]\n',
      );
      const prepared = await cli(root, [
        'next',
        'parent',
        '--summary',
        'Ready',
        '--coordination-mode',
        'single-session',
      ]);
      let state = await follow(root, prepared.continuation.commandAlternatives[0].commandArgs);
      // The current worktree and the original child task identities own this Run.
      const supervisorFile = path.join(
        resolveWorkspaceRuntimeRootSync(root),
        'native/changes/parent/supervisor/state.json',
      );
      const legacySupervisor = JSON.parse(await fs.readFile(supervisorFile, 'utf8'));
      expect((await cli(root, ['status', 'parent'])).supervisor.integration.targetBranch).toBe(
        'comet/parent',
      );
      const completed: string[] = [];
      for (const name of ['alpha', 'beta']) {
        expect(state.continuation.commandArgs).not.toBeNull();
        const recovered = await cliEnvelope(root, ['status', 'parent']);
        expect(recovered.data.workspace.projectRoot).toBe('.');
        expect(recovered.agent.workspace.cwd).toBe(root);
        expect(recovered.agent.continuation.cwd).toBe(root);
        const dispatched = state.supervisorTasks?.length
          ? state
          : await follow(recovered.agent.workspace.cwd, recovered.agent.continuation.commandArgs);
        expect(dispatched.supervisorTasks).toHaveLength(1);
        let task = dispatched.supervisorTasks[0];
        expect(dispatched.readyChildren).toContain(name);
        expect(task.child).toBe(name);
        expect(nativeWorkspaceIsClean(task.projectRoot)).toBe(true);
        const status = await cli(root, ['status', 'parent']);
        const resumed = await follow(root, status.continuation.commandArgs);
        expect(resumed.supervisorTasks).toEqual(dispatched.supervisorTasks);
        expect(resumed.readyChildren).toEqual([]);
        const cancelled = await input(root, 'parent', {
          kind: 'supervisor-cancel',
          child: name,
          runId: task.runId,
          reason: 'Previous host session was lost',
        });
        const restarted = await follow(root, cancelled.continuation.commandArgs);
        expect(restarted.supervisorTasks).toHaveLength(1);
        expect(restarted.supervisorTasks[0].runId).not.toBe(task.runId);
        task = restarted.supervisorTasks[0];
        await fs.writeFile(path.join(task.projectRoot, `${name}.txt`), name);
        git(task.projectRoot, ['add', `${name}.txt`]);
        git(task.projectRoot, ['commit', '-m', `feat: ${name}`]);
        const candidateCommit = git(task.projectRoot, ['rev-parse', 'HEAD']);
        const verifier = (
          await input(root, 'parent', {
            ...task.returnAction.inputOptions.find(
              (option: { name: string }) => option.name === 'supervisor-builder-result',
            ).template,
            candidateCommit,
          })
        ).supervisorTask;
        const checkReports = platformChecks(verifier.projectRoot, checks(name, [name]));
        expect(verifier.returnAction.cwd).toBe(root);
        const resultTemplate = verifier.returnAction.inputOptions.find(
          (option: { name: string }) => option.name === 'supervisor-verifier-result',
        ).template;
        const verified = await input(root, 'parent', {
          ...resultTemplate,
          verdict: 'pass',
          evidence: {
            summary: 'File assertion passed',
            checks: checkReports.map((check) => `${check.name}: ${check.result}; ${check.note}`),
            acceptance: verifier.acceptance.map((item: { id: string }) => ({
              id: item.id,
              result: 'passed',
              reason: 'File assertion passed',
            })),
          },
        });
        completed.push(name);
        expect(verified.continuation.inputOptions[0].template).toMatchObject({
          kind: 'supervisor-integrate',
          child: name,
        });
        const { integrationCommit: placeholder, ...integrationInput } =
          verified.continuation.inputOptions[0].template;
        expect(placeholder).toBe('<actual-integration-commit>');
        const platformWork = (await input(root, 'parent', integrationInput)).platformWork;
        const integrationRoot = platformWork.workspace;
        expect(platformWork.candidateCommit).toBe(candidateCommit);
        git(integrationRoot, ['merge', '--no-edit', candidateCommit]);
        const integrationReports = platformChecks(
          integrationRoot,
          checks(`integrate-${name}`, completed),
        );
        state = await input(root, 'parent', {
          ...verified.continuation.inputOptions[0].template,
          integrationCommit: git(integrationRoot, ['rev-parse', 'HEAD']),
          checks: integrationReports.map((check) => ({
            name: check.name,
            status: check.result,
            reason: check.note,
          })),
        });
      }
      const integration = (await cli(root, ['status', 'parent'])).supervisor.integration;
      git(root, ['merge', '--ff-only', integration.branch]);
      await acceptCandidate(root, 'parent', ['A1', 'A2'], checks('parent', completed));
      const preview = await cli(root, ['archive', 'parent', '--dry-run', '--finish', 'keep']);
      expect(preview.ready).toBe(true);
      let appliedSpecAfterPartialCleanup: string | undefined;
      if (isolation === 'worktree') {
        const paths = await nativeProjectPaths(root, 'docs');
        const transactionFile = path.join(paths.transactionsDir, 'portable-archive-parent.json');
        const stateBefore = await fs.readFile(path.join(dir, 'comet-state.yaml'), 'utf8');
        const supervisorBefore = await fs.readFile(supervisorFile, 'utf8');
        const rename = fs.rename.bind(fs);
        let preparedTransaction: Record<string, unknown> | undefined;
        let interruptedTransaction: Record<string, unknown> | undefined;
        const interruption = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
          await rename(source, target);
          if (String(target) !== transactionFile) return;
          const transaction = JSON.parse(await fs.readFile(transactionFile, 'utf8'));
          if (transaction.status === 'prepared') preparedTransaction ??= transaction;
          if (transaction.status !== 'specs-applied' || interruptedTransaction) return;
          interruptedTransaction = transaction;
          expect((await fs.stat(legacySupervisor.integration.worktree)).isDirectory()).toBe(true);
          throw new Error('simulated-archive-interruption');
        });
        try {
          await expect(archiveNativePortableChange({ paths, name: 'parent' })).rejects.toThrow(
            'simulated-archive-interruption',
          );
        } finally {
          interruption.mockRestore();
        }
        expect(interruptedTransaction).toMatchObject({
          id: preparedTransaction!.id,
          archive_ref: preparedTransaction!.archive_ref,
          start_state_version: preparedTransaction!.start_state_version,
          status: 'specs-applied',
        });
        expect(JSON.parse(await fs.readFile(transactionFile, 'utf8'))).toEqual(
          interruptedTransaction,
        );
        expect(await fs.readFile(path.join(dir, 'comet-state.yaml'), 'utf8')).toBe(stateBefore);
        expect(await fs.readFile(supervisorFile, 'utf8')).toBe(supervisorBefore);
        const supervisor = JSON.parse(supervisorBefore);
        const betaRoot = supervisor.children.find(
          (child: { name: string }) => child.name === 'beta',
        ).projectRoot;
        const unlink = fs.unlink.bind(fs);
        let cleanupInterrupted = false;
        const cleanupFailure = vi.spyOn(fs, 'unlink').mockImplementation(async (target) => {
          await unlink(target);
          if (cleanupInterrupted || String(target) !== path.join(betaRoot, '.comet/config.yaml'))
            return;
          cleanupInterrupted = true;
          throw new Error('simulated-partial-cleanup-interruption');
        });
        try {
          const interrupted = await runNativeCli([
            ...preview.continuation.commandArgs.slice(2),
            '--project-root',
            root,
            '--json',
          ]);
          expect(interrupted.exitCode).not.toBe(0);
          expect(interrupted.stdout).toContain('simulated-partial-cleanup-interruption');
        } finally {
          cleanupFailure.mockRestore();
        }
        expect(cleanupInterrupted).toBe(true);
        const remaining = git(root, ['worktree', 'list', '--porcelain']);
        expect(remaining).not.toContain('/parent-alpha');
        expect(remaining).toContain('/parent-beta');
        expect(await fs.readFile(supervisorFile, 'utf8')).toBe(supervisorBefore);
        appliedSpecAfterPartialCleanup = await fs.readFile(
          path.join(root, 'docs/comet/specs/options/spec.md'),
          'utf8',
        );
      }
      const archived =
        isolation === 'worktree'
          ? await cli(root, ['archive', 'parent', '--confirmed'])
          : await follow(root, preview.continuation.commandArgs);
      expect(archived.workspaceFinishResult.status).toBe('kept');
      if (appliedSpecAfterPartialCleanup !== undefined) {
        expect(await fs.readFile(path.join(root, 'docs/comet/specs/options/spec.md'), 'utf8')).toBe(
          appliedSpecAfterPartialCleanup,
        );
        const repeated = await cli(root, ['archive', 'parent', '--confirmed']);
        expect(repeated.workspaceFinishResult.status).toBe('kept');
        expect(await fs.readFile(path.join(root, 'docs/comet/specs/options/spec.md'), 'utf8')).toBe(
          appliedSpecAfterPartialCleanup,
        );
      }
      expect(git(root, ['rev-parse', 'main'])).toBe(original);
      expect(await fs.readFile(path.join(root, 'alpha.txt'), 'utf8')).toBe('alpha');
      expect(await fs.readFile(path.join(root, 'beta.txt'), 'utf8')).toBe('beta');
      expect(git(root, ['worktree', 'list', '--porcelain'])).not.toContain('/parent-alpha');
      expect(git(root, ['branch', '--list', 'comet/supervisor/*'])).toBe('');
      await expect(fs.stat(legacySupervisor.integration.worktree)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(git(root, ['ls-files', '.comet/config.yaml'])).toBe('');
    },
    300_000,
  );

  it('provides an executable serial Archive choice for two real worktrees', async () => {
    const primary = await repository();
    const worktrees: string[] = [];
    for (const name of ['first', 'second']) {
      const root = (
        await cli(primary, ['new', name, '--runtime', 'compat', '--isolation', 'worktree'])
      ).preparation.projectRoot;
      worktrees.push(root);
      const dir = path.join(root, 'docs/comet/changes', name);
      await fs.writeFile(path.join(dir, 'brief.md'), supervisorBrief('Shared behavior works.'));
      await fs.mkdir(path.join(dir, 'specs/shared'), { recursive: true });
      await fs.writeFile(
        path.join(dir, 'specs/shared/spec.md'),
        '# Requirement\nShared behavior MUST work.\n',
      );
      const prepared = await cli(root, ['next', name, '--summary', 'Ready']);
      await follow(root, prepared.continuation.commandAlternatives[0].commandArgs);
      await acceptCandidate(root, name, ['A1'], []);
    }
    const preview = await cli(worktrees[0], ['archive', 'first', '--dry-run', '--finish', 'keep']);
    expect(preview.ready).toBe(true);
    const ordered = await cli(worktrees[0], [
      'archive',
      'first',
      '--dry-run',
      '--finish',
      'keep',
      '--serial-first',
      'first',
    ]);
    expect(ordered.ready).toBe(true);
    expect(ordered.continuation.commandArgs).toContain('--serial-first');
    const archived = await follow(worktrees[0], ordered.continuation.commandArgs);
    expect(archived.state.status).toBe('done');
    expect((await cli(worktrees[1], ['status', 'second'])).phase).toBe('archive');
  }, 180_000);
});
