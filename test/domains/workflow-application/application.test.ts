import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createRuntime,
  createMemoryRuntimeStore,
  defineWorkflow,
  type RuntimeOutcome,
  type RuntimeAction,
  type WorkflowRun,
} from '../../../domains/engine/runtime.js';
import {
  adaptApplicationSkill,
  loadWorkflowApplication,
  createApplicationSkillExecutor,
  reconcileApplicationSkill,
  inspectApplicationSkill,
} from '../../../domains/workflow-application/index.js';
import type { SkillExecutionHost } from '../../../domains/workflow-application/index.js';
import {
  createDiskApplication,
  createScopeCycleApplication,
} from '../../helpers/workflow-application.js';

describe('application adaptation and SDK authority', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-app-contract-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const input = { topic: 'Actual topic' };
  async function application(parallel = false) {
    const fixture = await createDiskApplication(root, { parallel });
    const loaded = await loadWorkflowApplication({ file: fixture.file, projectRoot: root });
    return {
      fixture,
      loaded,
      runtime: createRuntime({ ...loaded.implementation, store: loaded.store }),
    };
  }
  function outcome(action: RuntimeAction, overrides: Partial<RuntimeOutcome> = {}): RuntimeOutcome {
    return {
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      claimToken: action.claim!.token,
      outcomeId: `${action.id}-result`,
      status: 'succeeded',
      output: { title: 'Actual topic — reviewed' },
      ...overrides,
    };
  }
  async function claim(runtime: ReturnType<typeof createRuntime>, action: RuntimeAction) {
    return runtime.claim({
      runId: 'report',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'host',
      claimToken: `${action.id}-claim`,
      capabilities: ['skill-script'],
    });
  }
  it('accepts legal parallel completion in reverse order and schedules join only after both', async () => {
    const { runtime } = await application(true);
    let run = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    expect(run.actions.map((action) => action.stepId)).toEqual(['left', 'right']);
    run = await claim(runtime, run.actions[0]);
    run = await claim(runtime, run.actions[1]);
    const [left, right] = run.actions;
    await expect(
      runtime.recordOutcome({
        runId: 'report',
        outcome: { ...outcome(left), actionId: 'report:3' },
      }),
    ).rejects.toMatchObject({ code: 'ACTION_NOT_FOUND' });
    run = await runtime.recordOutcome({ runId: 'report', outcome: outcome(right) });
    expect(run.actions).toHaveLength(2);
    run = await runtime.recordOutcome({ runId: 'report', outcome: outcome(left) });
    expect(run.actions[2].stepId).toBe('join');
    expect(await runtime.recordOutcome({ runId: 'report', outcome: outcome(left) })).toEqual(run);
  });
  it('rejects old attempts, wrong claim ownership and stale approval proposals', async () => {
    const { runtime } = await application();
    let run = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    run = await claim(runtime, run.actions[0]);
    const action = run.actions[0];
    await expect(
      runtime.recordOutcome({ runId: 'report', outcome: outcome(action, { attempt: 2 }) }),
    ).rejects.toMatchObject({ code: 'STALE_ACTION' });
    await expect(
      runtime.recordOutcome({
        runId: 'report',
        outcome: outcome(action, { claimToken: 'wrong-owner' }),
      }),
    ).rejects.toThrow();
    run = await runtime.recordOutcome({ runId: 'report', outcome: outcome(action) });
    const wait = run.waits[0];
    run = await runtime.reviseWait({
      runId: 'report',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      proposal: { changed: true },
    });
    await expect(
      runtime.resolveWait({
        runId: 'report',
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: 'old',
        choice: 'approved',
      }),
    ).rejects.toMatchObject({ code: 'STALE_PROPOSAL' });
    expect((await runtime.inspect('report')).actions).toHaveLength(1);
  });
  async function parallelApprovalRuntime() {
    const fixture = await createDiskApplication(root);
    const skills = await Promise.all(
      ['left', 'right'].map((branch) =>
        adaptApplicationSkill(
          {
            ...fixture.manifest.skills[0],
            id: `writer-${branch}`,
            adapter: {
              ...fixture.manifest.skills[0].adapter,
              sideEffect: 'write',
              scope: [`${branch}.json`],
            },
          },
          fixture.packageRoot,
        ),
      ),
    );
    const invoked: string[] = [];
    const executor = createApplicationSkillExecutor(
      {
        manifest: {
          ...fixture.manifest,
          bindings: ['left', 'right'].map((branch) => ({
            ...fixture.manifest.bindings[0],
            stepId: `draft-${branch}`,
            skillId: `writer-${branch}`,
            authorizationFrom: 'approve',
          })),
        },
        skills: new Map(skills.map((skill) => [skill.id, skill])),
      },
      {
        id: 'host',
        capabilities: ['skill-script'],
        authorize: async () => true,
        invokeSkill: async ({ action, run, skill }) => {
          const approved = run.actionContexts[action.id].results.approve.value as {
            proposal: { activation: { branch: string } };
          };
          const output = JSON.parse(
            execFileSync(
              process.execPath,
              [path.join(skill.root, 'scripts/run.mjs'), JSON.stringify(action.input)],
              { encoding: 'utf8' },
            ),
          );
          await fs.writeFile(
            path.join(root, `${approved.proposal.activation.branch}.json`),
            JSON.stringify(output),
          );
          invoked.push(action.id);
          return { status: 'succeeded', output };
        },
      },
    );
    const workflow = defineWorkflow({
      id: 'editorial',
      version: '1',
      entry: 'fork',
      initialState: {},
      stateSchema: { type: 'object' },
      transitionHandler: { id: 'approval-fanout', version: '1' },
      steps: {
        fork: { type: 'call_tool', ref: 'fork' },
        approve: { type: 'ask_user', proposalFrom: 'fork' },
        'draft-left': {
          type: 'invoke_skill',
          ref: 'writer-left',
          outputSchema: skills[0].adapter.outputSchema,
          requiredCapabilities: ['skill-script'],
        },
        'draft-right': {
          type: 'invoke_skill',
          ref: 'writer-right',
          outputSchema: skills[1].adapter.outputSchema,
          requiredCapabilities: ['skill-script'],
        },
      },
      transitions: [
        { from: 'fork', to: 'approve' },
        { from: 'approve', to: 'draft-left', on: 'approved' },
        { from: 'approve', to: 'draft-right', on: 'approved' },
      ],
    });
    const runtime = createRuntime({
      store: createMemoryRuntimeStore(),
      workflows: [workflow],
      transitionHandlers: [
        {
          id: 'approval-fanout',
          version: '1',
          apply: ({ run, event }) => {
            if (event.stepId === 'fork')
              return {
                state: run.state!,
                next: ['left', 'right'].map((branch) => ({ stepId: 'approve', input: { branch } })),
              };
            if (event.kind === 'wait-resolved' && event.stepId === 'approve') {
              const wait = run.waits.find((wait) => wait.decision?.id === event.decisionId)!;
              const proposal = wait.proposal as { activation: { branch: string } };
              return { state: run.state!, next: [`draft-${proposal.activation.branch}`] };
            }
            return { state: run.state!, next: [] };
          },
        },
      ],
      executors: [
        executor,
        {
          id: 'fork-host',
          capabilities: [],
          supports: (action) => action.ref === 'fork',
          execute: async () => ({ status: 'succeeded', output: { source: 'fork' } }),
        },
      ],
    });
    let run = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    run = await runtime.execute({
      runId: 'report',
      actionId: run.actions[0].id,
      executorId: 'fork-host',
    });
    return { runtime, executor, invoked, run };
  }
  it.each([
    { decisions: [0, 1], actions: [0, 1] },
    { decisions: [0, 1], actions: [1, 0] },
    { decisions: [1, 0], actions: [0, 1] },
    { decisions: [1, 0], actions: [1, 0] },
  ])('executes both approved activations in order $decisions / $actions', async (order) => {
    const { runtime, invoked, run: forked } = await parallelApprovalRuntime();
    let run = forked;
    expect(run.waits.map((wait) => wait.sequence)).toEqual([2, 3]);
    for (const index of order.decisions) {
      const wait = forked.waits[index];
      run = await runtime.resolveWait({
        runId: 'report',
        waitId: wait.id,
        proposalHash: wait.proposalHash,
        decisionId: `${wait.id}-approved`,
        choice: 'approved',
      });
    }
    const drafts = run.actions.filter((action) => action.stepId.startsWith('draft-'));
    for (const index of order.actions)
      run = await runtime.execute({
        runId: 'report',
        actionId: drafts[index].id,
        executorId: 'host',
      });
    expect(run.status).toBe('completed');
    expect(invoked).toHaveLength(2);
    for (const branch of ['left', 'right'])
      expect(JSON.parse(await fs.readFile(path.join(root, `${branch}.json`), 'utf8'))).toEqual({
        title: 'Actual topic — reviewed',
      });
  });
  it.each(['sequence', 'value', 'proposal', 'step-owner'])(
    'rejects mismatched inherited approval %s without invoking the Skill',
    async (mismatch) => {
      const { runtime, executor, invoked, run: forked } = await parallelApprovalRuntime();
      let run = forked;
      for (const wait of forked.waits)
        run = await runtime.resolveWait({
          runId: 'report',
          waitId: wait.id,
          proposalHash: wait.proposalHash,
          decisionId: `${wait.id}-approved`,
          choice: 'approved',
        });
      const action = run.actions.find((action) => action.stepId.startsWith('draft-'))!;
      const current = structuredClone(run);
      const inherited = current.actionContexts[action.id].results.approve;
      const wait = current.waits.find((wait) => wait.sequence === inherited.sequence)!;
      if (mismatch === 'sequence') inherited.sequence = 999;
      if (mismatch === 'value')
        inherited.value = { choice: 'approved', proposal: 'another branch' };
      if (mismatch === 'proposal') wait.proposalHash = 'changed-after-approval';
      if (mismatch === 'step-owner') wait.stepId = 'another-approval';
      await expect(executor.preflight!(action, undefined, current)).rejects.toMatchObject({
        code: 'STALE_PROPOSAL',
      });
      expect(invoked).toHaveLength(0);
      expect(
        (await runtime.inspect('report')).actions.find(({ id }) => id === action.id)?.status,
      ).toBe('pending');
    },
  );
  it('blocks same-iteration writes despite mutual reachability through a repair cycle', async () => {
    const fixture = await createScopeCycleApplication(root, false);
    const loaded = await loadWorkflowApplication({ file: fixture.file, projectRoot: root });
    const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
    let run = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    run = await runtime.execute({
      runId: 'report',
      actionId: run.actions[0].id,
      executorId: 'tool-host',
    });
    const wait = run.waits[0];
    run = await runtime.resolveWait({
      runId: 'report',
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: 'approved-cycle',
      choice: 'approved',
    });
    run = await runtime.execute({
      runId: 'report',
      actionId: run.actions.find((action) => action.stepId === 'fork')!.id,
      executorId: 'tool-host',
    });
    const writers = run.actions.filter((action) => ['left', 'right'].includes(action.stepId));
    expect(writers).toHaveLength(2);
    const executions = await Promise.allSettled(
      writers.map((action) =>
        runtime.execute({ runId: 'report', actionId: action.id, executorId: 'local-skill' }),
      ),
    );
    for (const execution of executions)
      expect(execution).toMatchObject({ status: 'rejected', reason: { code: 'COMMAND_REJECTED' } });
    for (const action of writers)
      await expect(claim(runtime, action)).rejects.toMatchObject({ code: 'COMMAND_REJECTED' });
    await expect(fs.stat(path.join(root, 'shared.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      (await runtime.inspect('report')).actions
        .filter((action) => ['left', 'right'].includes(action.stepId))
        .map((action) => action.status),
    ).toEqual(['pending', 'pending']);
  });
  it('preserves legal serial writes through a bounded repair cycle', async () => {
    const fixture = await createScopeCycleApplication(root, true);
    const loaded = await loadWorkflowApplication({ file: fixture.file, projectRoot: root });
    const runtime = createRuntime({ ...loaded.implementation, store: loaded.store });
    let run = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    for (let index = 0; index < 15 && run.status !== 'completed'; index++) {
      const wait = run.waits.find((wait) => wait.status === 'pending');
      if (wait)
        run = await runtime.resolveWait({
          runId: 'report',
          waitId: wait.id,
          proposalHash: wait.proposalHash,
          decisionId: `${wait.id}-approved`,
          choice: 'approved',
        });
      else {
        const action = run.actions.find((action) => action.status === 'pending')!;
        run = await runtime.execute({
          runId: 'report',
          actionId: action.id,
          executorId: action.type === 'invoke_skill' ? 'local-skill' : 'tool-host',
        });
      }
    }
    expect(run.status).toBe('completed');
    expect(run.state).toEqual({ round: 2 });
    expect((await fs.readFile(path.join(root, 'shared.txt'), 'utf8')).trim().split('\n')).toEqual([
      'left',
      'right',
      'left',
      'right',
    ]);
  });
  it.each(['requires-review', 'false-evidence', 'guidance-side-effect', 'missing-resource'])(
    'rejects unverified Skill adaptation: %s without changing originals',
    async (scenario) => {
      const fixture = await createDiskApplication(root);
      const dependency = structuredClone(fixture.manifest.skills[0]);
      const before = await fs.readFile(path.join(fixture.skillRoot, 'SKILL.md'));
      if (scenario === 'requires-review') dependency.adapter.review.status = 'requires-review';
      if (scenario === 'false-evidence')
        dependency.adapter.review.capabilities[0].excerpt = 'Not present in the actual Skill';
      if (scenario === 'guidance-side-effect') {
        dependency.adapter.kind = 'guidance';
        dependency.adapter.sideEffect = 'external';
      }
      if (scenario === 'missing-resource')
        await fs.rm(path.join(fixture.skillRoot, 'reference/suffix.txt'));
      await expect(adaptApplicationSkill(dependency, fixture.packageRoot)).rejects.toThrow();
      expect(await fs.readFile(path.join(fixture.skillRoot, 'SKILL.md'))).toEqual(before);
    },
  );
  it.each(['unsupported-capability', 'schema-mismatch', 'approval-takeover', 'missing-validator'])(
    'blocks invalid complete bindings before starting: %s',
    async (scenario) => {
      const fixture = await createDiskApplication(root);
      if (scenario === 'unsupported-capability')
        fixture.manifest.bindings[0].capability = 'publish';
      if (scenario === 'schema-mismatch')
        fixture.manifest.skills[0].adapter.outputSchema = { type: 'string' };
      if (scenario === 'approval-takeover')
        fixture.manifest.skills[0].adapter.controlsApproval = true;
      if (scenario === 'missing-validator') {
        const module = path.join(fixture.packageRoot, 'application.mjs');
        await fs.writeFile(
          module,
          (await fs.readFile(module, 'utf8')).replace(
            "validators: [{ id: 'actual-title'",
            "validators: [{ id: 'different-validator'",
          ),
        );
      }
      await fs.writeFile(fixture.file, JSON.stringify(fixture.manifest));
      await expect(
        loadWorkflowApplication({ file: fixture.file, projectRoot: root }),
      ).rejects.toThrow();
    },
  );
  it('keeps loaded, self-reported, machine-checked and independent-review evidence distinct', async () => {
    const { loaded, runtime } = await application();
    expect(loaded.skills.get('writer')!.files['SKILL.md']).toContain('generate a title');
    let run = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    run = await claim(runtime, run.actions[0]);
    const action = run.actions[0];
    await expect(
      runtime.recordOutcome({
        runId: 'report',
        outcome: outcome(action, { output: { loaded: true, completedChecks: ['actual-title'] } }),
      }),
    ).rejects.toMatchObject({ code: 'OUTPUT_INVALID' });
    await expect(
      runtime.recordOutcome({
        runId: 'report',
        outcome: outcome(action, {
          outcomeId: 'plausible-string',
          output: { title: 'claimed completed' },
        }),
      }),
    ).rejects.toMatchObject({ code: 'OUTCOME_REJECTED' });
    run = await runtime.inspect('report');
    expect(run.waits).toHaveLength(0);
    expect(run.actions[0].rejectedOutcomes).toHaveLength(2);
    expect(loaded.skills.get('writer')!.adapter.completion).toBe('machine-check');
    expect(run.actions[0].status).toBe('running');
  });
  it('retains returned invalid outputs and artifacts in SDK rejectedOutcomes', async () => {
    const { loaded } = await application();
    const host: SkillExecutionHost = {
      id: 'host',
      capabilities: ['skill-script'],
      authorize: async () => true,
      invokeSkill: async () => ({
        status: 'succeeded',
        output: { invalid: true },
        artifacts: [{ uri: 'report.json', sha256: 'a'.repeat(64) }],
      }),
    };
    const runtime = createRuntime({
      ...loaded.implementation,
      executors: [createApplicationSkillExecutor(loaded, host)],
      store: loaded.store,
    });
    const run = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    await expect(
      runtime.execute({ runId: 'report', actionId: run.actions[0].id, executorId: 'host' }),
    ).rejects.toMatchObject({ code: 'OUTPUT_INVALID' });
    const action = (await runtime.inspect('report')).actions[0];
    expect(action.status).toBe('running');
    expect(action.rejectedOutcomes?.[0].outcome.output).toEqual({ invalid: true });
    expect(action.rejectedOutcomes?.[0].outcome.artifacts).toEqual([
      { uri: 'report.json', sha256: 'a'.repeat(64) },
    ]);
  });
  it('refuses dependency drift in a continuing host process before dispatch and resumes the original pending Action', async () => {
    const { fixture, loaded, runtime } = await application();
    const initial = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    const resource = path.join(fixture.skillRoot, 'reference/suffix.txt');
    const original = await fs.readFile(resource, 'utf8');
    await fs.writeFile(resource, ' — drifted');
    await expect(
      runtime.execute({
        runId: 'report',
        actionId: initial.actions[0].id,
        executorId: 'local-skill',
      }),
    ).rejects.toThrow('漂移');
    await fs.writeFile(resource, original);
    expect((await runtime.inspect('report')).actions[0]).toEqual(initial.actions[0]);
    const resumed = await runtime.execute({
      runId: 'report',
      actionId: initial.actions[0].id,
      executorId: 'local-skill',
    });
    expect(resumed.actions[0].outcome?.output).toEqual({ title: 'Actual topic — reviewed' });
    expect(loaded.identity.contentHash).toBeTruthy();
  });
  it('leaves a refused dispatch pending with no host invocation', async () => {
    const { loaded } = await application();
    let calls = 0;
    const host: SkillExecutionHost = {
      id: 'host',
      capabilities: ['skill-script'],
      authorize: async () => false,
      invokeSkill: async () => {
        calls++;
        return { status: 'succeeded', output: {} };
      },
    };
    const runtime = createRuntime({
      ...loaded.implementation,
      executors: [createApplicationSkillExecutor(loaded, host)],
      store: loaded.store,
    });
    const run = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    await expect(
      runtime.execute({ runId: 'report', actionId: run.actions[0].id, executorId: 'host' }),
    ).rejects.toMatchObject({ code: 'COMMAND_REJECTED' });
    expect(calls).toBe(0);
    expect((await runtime.inspect('report')).actions[0].status).toBe('pending');
  });
  it('preserves the original unknown action, reconciles an executed operation, and never replays it', async () => {
    const { loaded } = await application();
    let calls = 0;
    const host: SkillExecutionHost = {
      id: 'host',
      capabilities: ['skill-script'],
      authorize: async () => true,
      invokeSkill: async () => {
        calls++;
        await fs.writeFile(
          path.join(root, 'external-operation.json'),
          JSON.stringify({ title: 'Actual topic — reviewed' }),
        );
        throw new Error('Connection lost after execution');
      },
      reconcile: async ({ action }) => ({
        resolution: 'executed',
        outcome: {
          ...outcome(action),
          output: JSON.parse(await fs.readFile(path.join(root, 'external-operation.json'), 'utf8')),
        },
      }),
    };
    const runtime = createRuntime({
      ...loaded.implementation,
      executors: [createApplicationSkillExecutor(loaded, host)],
      store: loaded.store,
    });
    const initial = await runtime.start({
      runId: 'report',
      workflow: { id: 'editorial', version: '1' },
      input,
    });
    await expect(
      runtime.execute({ runId: 'report', actionId: initial.actions[0].id, executorId: 'host' }),
    ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
    const unknown = await runtime.inspect('report');
    await expect(
      runtime.execute({ runId: 'report', actionId: unknown.actions[0].id, executorId: 'host' }),
    ).rejects.toMatchObject({ code: 'ACTION_ALREADY_CLAIMED' });
    const restored = await loadWorkflowApplication({
      file: path.join(loaded.identity.packageRoot, 'application.json'),
      projectRoot: root,
      runId: 'report',
    });
    expect(
      (await createRuntime({ ...restored.implementation, store: restored.store }).inspect('report'))
        .actions[0],
    ).toEqual(unknown.actions[0]);
    const result = await reconcileApplicationSkill(restored, host, unknown, unknown.actions[0].id);
    if (result.resolution !== 'executed') throw new Error('Expected actual execution receipt');
    expect(
      (await runtime.recordOutcome({ runId: 'report', outcome: result.outcome })).actions[0].status,
    ).toBe('succeeded');
    expect(calls).toBe(1);
  });
  it('fixed Skill discovery includes a real resource closure and never invents missing capability evidence', async () => {
    const fixture = await createDiskApplication(root);
    const inspected = await inspectApplicationSkill(fixture.skillRoot);
    expect(Object.keys(inspected.files).sort()).toEqual([
      'SKILL.md',
      'reference/suffix.txt',
      'scripts/run.mjs',
    ]);
    await fs.writeFile(
      path.join(fixture.skillRoot, 'SKILL.md'),
      '# Skill\nRead [required data](reference/missing.json).',
    );
    await expect(inspectApplicationSkill(fixture.skillRoot)).rejects.toThrow('资源缺失');
  });
  it('uses existing multi-session authorization, blocks missing reconciliation, and reconciles a real isolated HTTP operation once', async () => {
    const fixture = await createDiskApplication(root, { external: true });
    const loaded = await loadWorkflowApplication({ file: fixture.file, projectRoot: root });
    let operations = 0;
    let stored: unknown = null;
    const server = createServer(async (request, response) => {
      if (request.method === 'POST') {
        for await (const _chunk of request) {
          /* 读取请求以完成一次实际派发。 */
        }
        operations++;
        stored = { title: 'Actual topic — reviewed' };
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(stored));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP endpoint');
    const endpoint = `http://127.0.0.1:${address.port}`;
    try {
      const host: SkillExecutionHost = {
        id: 'http-host',
        capabilities: ['skill-script'],
        authorize: async ({ run, binding, skill }) =>
          run.waits[0].decision?.choice === 'multi-session' &&
          binding.authorizationFrom === 'approve' &&
          skill.adapter.scope.includes('report'),
        invokeSkill: async ({ action }) => {
          await fetch(endpoint, { method: 'POST', body: JSON.stringify(action.input) });
          throw new Error('Outcome delivery interrupted after actual HTTP operation');
        },
      };
      let runtime = createRuntime({
        ...loaded.implementation,
        executors: [createApplicationSkillExecutor(loaded, host)],
        store: loaded.store,
      });
      let run = await runtime.start({
        runId: 'report',
        workflow: { id: 'editorial', version: '1' },
        input,
      });
      run = await claim(runtime, run.actions[0]);
      run = await runtime.recordOutcome({
        runId: 'report',
        outcome: outcome(run.actions[0], { output: { scope: 'report' } }),
      });
      run = await runtime.resolveWait({
        runId: 'report',
        waitId: run.waits[0].id,
        proposalHash: run.waits[0].proposalHash,
        choice: 'multi-session',
        decisionId: 'user-shape-approval',
      });
      const actionId = run.actions[1].id;
      await expect(
        runtime.execute({ runId: 'report', actionId, executorId: 'http-host' }),
      ).rejects.toMatchObject({ code: 'RECONCILIATION_REQUIRED' });
      expect((await runtime.inspect('report')).actions[1].status).toBe('pending');
      expect(operations).toBe(0);
      host.reconcile = async ({ action }) => ({
        resolution: 'executed',
        outcome: outcome(action, { output: await (await fetch(endpoint)).json() }),
      });
      runtime = createRuntime({
        ...loaded.implementation,
        executors: [createApplicationSkillExecutor(loaded, host)],
        store: loaded.store,
      });
      await expect(
        runtime.execute({ runId: 'report', actionId, executorId: 'http-host' }),
      ).rejects.toMatchObject({ code: 'EXECUTION_UNKNOWN' });
      const unknown = await runtime.inspect('report');
      await expect(
        runtime.execute({ runId: 'report', actionId, executorId: 'http-host' }),
      ).rejects.toMatchObject({ code: 'ACTION_ALREADY_CLAIMED' });
      const result = await reconcileApplicationSkill(loaded, host, unknown, actionId);
      if (result.resolution !== 'executed') throw new Error('Expected authoritative HTTP receipt');
      expect(
        (await runtime.recordOutcome({ runId: 'report', outcome: result.outcome })).status,
      ).toBe('completed');
      expect(operations).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
