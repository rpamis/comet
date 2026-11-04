import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { prepareNativeApplication } from './native-application.js';
import type { RuntimeAction, WorkflowRun } from '../../domains/engine/runtime.js';
import { nativeVerifierContext } from '../../domains/comet-native/native-verifier-context.js';
import { fixtureAcceptanceReview } from './native-builder-acceptance-review.js';

/** 用真实 SDK、Git worktree 和检查执行生成父级候选；Agent/User 身份均为明确标注的模拟。 */
export async function prepareFrozenSupervisorCandidate(
  root: string,
  files: Record<string, string>,
  requirements: string,
  baselineFiles: Record<string, string> = files,
  verifyMode: 'standard' | 'bugfree' = 'bugfree',
) {
  const f = await prepareNativeApplication(
    root,
    true,
    'native',
    process.env.COMET_NATIVE_TEST_PACKAGE_ROOT ?? path.resolve('.'),
    verifyMode,
    {
      files: baselineFiles,
      requirements,
    },
  );
  f.git(f.projectRoot, ['config', '--local', 'user.name', 'Frozen fixture']);
  f.git(f.projectRoot, ['config', '--local', 'user.email', 'fixture@example.invalid']);
  const localCheck = `const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');const root=fs.mkdtempSync(path.join(os.tmpdir(),'comet-child-store-'));try{const system=require('./candidate.cjs')(root);const left=system.left(),right=system.right();assert.notEqual(left.id,right.id);assert.equal(system.read(left.id).id,left.id);assert.equal(system.read(right.id).id,right.id);}finally{fs.rmSync(root,{recursive:true,force:true});}`;
  f.checks[0].argv = ['-e', localCheck];
  let run: WorkflowRun = f.run;
  for (let turn = 0; turn < 40; turn++) {
    const verifier = f.pending(run, 'verify.verifier');
    if (verifier) {
      const context = await nativeVerifierContext(run, verifier, f.projectRoot);
      const parent = [...run.actions]
        .reverse()
        .find((action) => action.stepId === 'supervisor.parent.builder')!;
      const integrationRoot = (parent.input as { activation: { integrationWorktree: string } })
        .activation.integrationWorktree;
      for (const [ref, text] of Object.entries(files))
        if ((await fs.readFile(path.join(integrationRoot, ref), 'utf8')) !== text)
          throw new Error(`Frozen source changed: ${ref}`);
      return {
        run,
        context,
        integrationRoot,
        projectRoot: f.projectRoot,
        simulatedIdentities: true,
        task: (await f.native(['status', f.name])).pendingActions.find(
          (entry: { stepId: string }) => entry.stepId === 'verify.verifier',
        ),
      };
    }
    const action = f.pending(run) as RuntimeAction | undefined;
    if (!action)
      throw new Error('Frozen Supervisor has no runnable Action before final verification');
    if (
      action.stepId === 'supervisor.child.builder' ||
      action.stepId === 'supervisor.parent.builder'
    ) {
      const activation = (
        action.input as { activation: { worktree?: string; integrationWorktree?: string } }
      ).activation;
      const cwd = activation.worktree ?? activation.integrationWorktree!;
      if (action.stepId === 'supervisor.parent.builder') {
        for (const [ref, text] of Object.entries(files))
          await fs.writeFile(path.join(cwd, ref), text);
        f.git(cwd, ['add', ...Object.keys(files)]);
        f.git(cwd, ['commit', '--allow-empty', '-m', 'Freeze the final parent candidate']);
        run = await f.claim(action, `simulated-${action.id}-builder`);
        const claimed = run.actions.find((entry) => entry.id === action.id)!;
        run = await f.record(claimed, {
          summary:
            'Fixed parent candidate supplied for independent review; no parent command results are claimed.',
          candidateCommit: f.git(cwd, ['rev-parse', 'HEAD']),
          addressedAcceptanceIds: ['A1'],
          acceptanceReview: fixtureAcceptanceReview(['A1']),
          checks: [],
          knownLimits: [
            'Simulated fixture Builder; independent hidden truth is not given to the reviewer.',
          ],
          verificationChecks:
            verifyMode === 'bugfree'
              ? []
              : [
                  {
                    id: 'parent-syntax',
                    name: 'Parent module syntax',
                    executable: process.execPath,
                    argv: ['--check', 'candidate.cjs'],
                    cwdRef: '.',
                    timeoutMs: 10000,
                    repeatable: true,
                  },
                ],
          submittedAt: new Date().toISOString(),
        });
      } else {
        execFileSync(process.execPath, ['-e', localCheck], {
          cwd,
          windowsHide: true,
          stdio: 'pipe',
        });
        run = await f.submitBuilder(action, 'approved\n', `simulated-${action.id}-builder`);
      }
    } else if (action.stepId === 'supervisor.child.verifier') {
      run = await f.claim(action, `simulated-${action.id}-verifier`);
      const claimed = run.actions.find((entry) => entry.id === action.id)!;
      const activation = (claimed.input as { activation: { candidateCommit: string } }).activation;
      run = await f.record(claimed, {
        candidateCommit: activation.candidateCommit,
        verdict: 'pass',
        evidence: {
          summary:
            'Simulated fixture Verifier: real shared-store checks passed before the final parent change.',
          checks: ['candidate-process'],
          acceptance: [
            {
              id: 'A1',
              result: 'passed',
              reason:
                'Both routes have distinct persisted identifiers in this Child candidate; later parent changes need separate review.',
            },
          ],
        },
        integrationChecks: f.checks,
      });
    } else {
      const executor =
        action.stepId === 'supervisor.prepare'
          ? 'native-supervisor-prepare'
          : action.stepId === 'supervisor.child.prepare'
            ? 'native-supervisor-child-prepare'
            : action.stepId === 'supervisor.child.integrate'
              ? 'native-supervisor-integrate'
              : action.stepId === 'supervisor.child.archive'
                ? 'native-supervisor-child-archive'
                : 'comet-native-checks';
      run = await f.dispatch({
        operation: 'execute',
        runId: f.name,
        actionId: action.id,
        executorId: executor,
      });
    }
  }
  throw new Error('Frozen Supervisor did not reach final verification');
}
