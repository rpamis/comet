import { promises as fs } from 'node:fs';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import { inspectCometHook } from '../../domains/comet-entry/hook-router.js';
import { writeCometCurrentSelection } from '../../domains/workflow-contract/current-selection.js';
import { createDiskApplication } from '../helpers/workflow-application.js';
import { inspectApplicationSkill } from '../../domains/workflow-application/index.js';
import type { WorkflowRun } from '../../domains/engine/runtime.js';

describe('complete disk application public entry', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof createDiskApplication>>;
  let count: number;
  let service: ReturnType<typeof createServer> | undefined;
  let operations: number;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-application-'));
    app = await createDiskApplication(root);
    count = 0;
    operations = 0;
  });
  afterEach(async () => {
    if (service) await new Promise<void>((resolve) => service!.close(() => resolve()));
    service = undefined;
    await fs.rm(root, { recursive: true, force: true });
  });
  const start = {
    operation: 'start',
    runId: 'report',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'A real report' },
  };
  async function dispatch(
    request: unknown,
    projectRoot = root,
    cold = false,
    environment?: NodeJS.ProcessEnv,
  ) {
    const requestFile = path.join(root, `request-${++count}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    if (cold) {
      const result = spawnSync(
        process.execPath,
        [
          'bin/comet.js',
          'runtime',
          'dispatch',
          '--details',
          '--application-file',
          app.file,
          '--project-root',
          projectRoot,
          '--request',
          requestFile,
        ],
        { cwd: path.resolve('.'), encoding: 'utf8', timeout: 30000, env: environment },
      );
      expect(result.error).toBeUndefined();
      return { exitCode: result.status, response: JSON.parse(result.stdout) };
    }
    return runtimeDispatchCommand({ request: requestFile, projectRoot, applicationFile: app.file });
  }
  function run(result: Awaited<ReturnType<typeof dispatch>>): WorkflowRun {
    expect(result.response.status, JSON.stringify(result.response)).toBe('succeeded');
    return (result.response as { data: WorkflowRun }).data;
  }
  async function externalApplication(rejectedRoute = false, reconcile = true) {
    const project = path.join(root, 'external-project');
    await fs.mkdir(project);
    app = await createDiskApplication(project, { external: true });
    service = createServer(async (request, response) => {
      if (request.method === 'POST') {
        for await (const _chunk of request) {
          /* 读取真实请求体。 */
        }
        operations += 1;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ operations }));
    });
    await new Promise<void>((resolve) => service!.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${(service.address() as { port: number }).port}`;
    await fs.writeFile(
      path.join(app.skillRoot, 'scripts/run.mjs'),
      `import {readFileSync} from 'node:fs';\nawait fetch(${JSON.stringify(endpoint)}, {method:'POST',body:process.argv[2]});\nconsole.log(JSON.stringify({title:JSON.parse(process.argv[2]).input.topic+readFileSync(new URL('../reference/suffix.txt',import.meta.url),'utf8')}));\n`,
    );
    const inspected = await inspectApplicationSkill(app.skillRoot);
    app.manifest.skills[0].contentHash = inspected.contentHash;
    app.manifest.skills[0].adapter.review.contentHash = inspected.contentHash;
    await fs.writeFile(app.file, JSON.stringify(app.manifest));
    const moduleFile = path.join(app.packageRoot, 'application.mjs');
    let source = await fs.readFile(moduleFile, 'utf8');
    if (rejectedRoute) source = source.replace('"on":"single-session"', '"on":"rejected"');
    source = source.replace(
      'authorize: async () => true,',
      `authorize: async ({context}) => context?.environment?.COMET_TEST_DECLINED_AUTH !== '1', ${reconcile ? `reconcile: async () => {const result=await (await fetch(${JSON.stringify(endpoint)})).json(); return {resolution:'not-executed',evidence:'Isolated service operations='+result.operations};},` : ''}`,
    );
    await fs.writeFile(moduleFile, source);
    return project;
  }
  async function reachExternalAction(project: string, choice: string) {
    let current = run(await dispatch(start, project, true));
    const prepare = current.actions[0];
    current = run(
      await dispatch(
        {
          operation: 'claim',
          runId: 'report',
          actionId: prepare.id,
          attempt: prepare.attempt,
          inputHash: prepare.inputHash,
          executorId: 'manual-tool',
          claimToken: 'prepare-claim',
          capabilities: [],
        },
        project,
        true,
      ),
    );
    current = run(
      await dispatch(
        {
          operation: 'record-outcome',
          runId: 'report',
          outcome: {
            actionId: prepare.id,
            attempt: prepare.attempt,
            inputHash: prepare.inputHash,
            claimToken: 'prepare-claim',
            outcomeId: 'prepared',
            status: 'succeeded',
            output: { scope: 'report' },
          },
        },
        project,
        true,
      ),
    );
    const wait = current.waits[0];
    return run(
      await dispatch(
        {
          operation: 'resolve-wait',
          runId: 'report',
          waitId: wait.id,
          proposalHash: wait.proposalHash,
          decisionId: 'user-decision',
          choice,
        },
        project,
        true,
      ),
    );
  }
  it.each(['native', 'classic-full', 'classic-hotfix', 'classic-tweak'])(
    'rejects built-in application identity %s before starting an unrecoverable Run',
    async (id) => {
      app.manifest.id = id;
      await fs.writeFile(app.file, JSON.stringify(app.manifest));
      const result = await dispatch(start, root, true);
      expect(result.response).toMatchObject({
        status: 'failed',
        error: { code: 'INVALID_WORKFLOW' },
      });
      expect(result.response.error.message).toContain('内置应用');
      await expect(
        fs.stat(path.join(root, '.comet/runtime/applications', id)),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );
  it('rejects denied parent approval at execute and manual claim before any real HTTP operation', async () => {
    const project = await externalApplication(true);
    const initial = await reachExternalAction(project, 'rejected');
    const action = initial.actions.find((action) => action.stepId === 'draft')!;
    const execute = await dispatch(
      { operation: 'execute', runId: 'report', actionId: action.id, executorId: 'local-skill' },
      project,
      true,
    );
    expect(execute.response).toMatchObject({ status: 'failed', error: { code: 'STALE_PROPOSAL' } });
    const claim = await dispatch(
      {
        operation: 'claim',
        runId: 'report',
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'local-skill',
        claimToken: 'denied-claim',
        capabilities: ['skill-script'],
      },
      project,
      true,
    );
    expect(claim.response).toMatchObject({ status: 'failed', error: { code: 'STALE_PROPOSAL' } });
    const outcome = await dispatch(
      {
        operation: 'record-outcome',
        runId: 'report',
        outcome: {
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          claimToken: 'denied-claim',
          outcomeId: 'denied-result',
          status: 'succeeded',
          output: { title: 'A real report — reviewed' },
        },
      },
      project,
      true,
    );
    expect(outcome.response.status).toBe('failed');
    expect(run(await dispatch({ operation: 'inspect', runId: 'report' }, project, true))).toEqual(
      initial,
    );
    expect(operations).toBe(0);
  });
  it.each(['missing-host', 'host-capabilities', 'host-authorization', 'input-schema'])(
    'keeps manual Skill claims pending when %s does not satisfy the configured contract',
    async (scenario) => {
      const moduleFile = path.join(app.packageRoot, 'application.mjs');
      let source = await fs.readFile(moduleFile, 'utf8');
      if (scenario === 'host-capabilities')
        source = source.replace("capabilities: ['skill-script']", 'capabilities: []');
      if (scenario === 'host-authorization')
        source = source.replace('authorize: async () => true', 'authorize: async () => false');
      await fs.writeFile(moduleFile, source);
      const initial = run(
        await dispatch(
          scenario === 'input-schema' ? { ...start, input: { topic: 4 } } : start,
          root,
          true,
        ),
      );
      const action = initial.actions[0];
      const result = await dispatch(
        {
          operation: 'claim',
          runId: 'report',
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: scenario === 'missing-host' ? 'undeclared-worker' : 'local-skill',
          claimToken: 'claim',
          capabilities: ['skill-script'],
        },
        root,
        true,
      );
      expect(result.response.status).toBe('failed');
      expect(run(await dispatch({ operation: 'inspect', runId: 'report' }, root, true))).toEqual(
        initial,
      );
    },
  );
  it('refuses manual external work without a configured reconciliation adapter', async () => {
    const project = await externalApplication(false, false);
    const initial = await reachExternalAction(project, 'multi-session');
    const action = initial.actions.find((action) => action.stepId === 'draft')!;
    const result = await dispatch(
      {
        operation: 'claim',
        runId: 'report',
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'local-skill',
        claimToken: 'no-reconcile',
        capabilities: ['skill-script'],
      },
      project,
      true,
    );
    expect(result.response).toMatchObject({
      status: 'failed',
      error: { code: 'RECONCILIATION_REQUIRED' },
    });
    expect(run(await dispatch({ operation: 'inspect', runId: 'report' }, project, true))).toEqual(
      initial,
    );
    expect(operations).toBe(0);
  });
  it('preserves authorized manual HTTP execution, claim replay and unknown Outcome recovery', async () => {
    const project = await externalApplication();
    const initial = await reachExternalAction(project, 'multi-session');
    const action = initial.actions.find((action) => action.stepId === 'draft')!;
    const claimRequest = {
      operation: 'claim',
      runId: 'report',
      actionId: action.id,
      attempt: action.attempt,
      inputHash: action.inputHash,
      executorId: 'local-skill',
      sessionId: 'manual-session',
      claimToken: 'manual-claim',
      capabilities: ['skill-script'],
    };
    const claimed = run(await dispatch(claimRequest, project, true));
    expect(operations).toBe(0);
    const revokedEnvironment = { ...process.env, COMET_TEST_DECLINED_AUTH: '1' };
    expect(
      run(await dispatch({ ...claimRequest, capabilities: [] }, project, true, revokedEnvironment)),
    ).toEqual(claimed);
    const result = await promisify(execFile)(process.execPath, [
      path.join(app.skillRoot, 'scripts/run.mjs'),
      JSON.stringify(action.input),
    ]);
    expect(operations).toBe(1);
    const unknown = run(
      await dispatch(
        {
          operation: 'mark-unknown',
          runId: 'report',
          actionId: action.id,
          attempt: action.attempt,
          reason: 'Manual host lost the return channel',
        },
        project,
        true,
      ),
    );
    expect(unknown.actions.find(({ id }) => id === action.id)?.claim).toEqual(
      claimed.actions.find(({ id }) => id === action.id)?.claim,
    );
    const request = {
      operation: 'record-outcome',
      runId: 'report',
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: 'manual-claim',
        outcomeId: 'reconciled-result',
        status: 'succeeded',
        output: JSON.parse(result.stdout),
      },
    };
    const completed = run(await dispatch(request, project, true, revokedEnvironment));
    expect(completed.status).toBe('completed');
    expect(run(await dispatch(request, project, true, revokedEnvironment))).toEqual(completed);
    expect(operations).toBe(1);
  });
  it('executes an actual script Skill and restores the same Run across public CLI processes', async () => {
    const initial = run(await dispatch(start, root, true));
    const executed = run(
      await dispatch(
        {
          operation: 'execute',
          runId: 'report',
          actionId: initial.actions[0].id,
          executorId: 'local-skill',
        },
        root,
        true,
      ),
    );
    expect(executed.actions[0].outcome?.output).toEqual({ title: 'A real report — reviewed' });
    expect(executed.waits[0].status).toBe('pending');
    expect(run(await dispatch({ operation: 'inspect', runId: 'report' }, root, true))).toEqual(
      executed,
    );
    expect(JSON.parse(await fs.readFile(path.join(root, 'projection.json'), 'utf8'))).toEqual({
      phase: 'waiting',
    });
  });
  it('uses recorded application identity when resuming by id and ignores editable projections', async () => {
    const initial = run(await dispatch(start));
    await fs.writeFile(path.join(root, 'projection.json'), '{"phase":"completed"}');
    const request = path.join(root, 'resume.json');
    await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: 'report' }));
    const result = await runtimeDispatchCommand({
      application: 'editorial',
      projectRoot: root,
      request,
    });
    expect((result.response as { data: WorkflowRun }).data).toEqual(initial);
    expect(
      (
        await dispatch({
          operation: 'record-outcome',
          runId: 'report',
          outcome: {
            actionId: 'report:999',
            attempt: 1,
            inputHash: 'fake',
            claimToken: 'fake',
            outcomeId: 'fake',
            status: 'succeeded',
            output: 'completed',
          },
        })
      ).response.status,
    ).toBe('failed');
  });
  it.each(['application.mjs', 'application.json', 'SKILL.md', 'reference/suffix.txt'])(
    'rejects same-version definition or dependency drift in %s and resumes after restoration',
    async (ref) => {
      const initial = run(await dispatch(start, root, true));
      const target = path.join(
        ref === 'SKILL.md' || ref.startsWith('reference/') ? app.skillRoot : app.packageRoot,
        ref,
      );
      const original = await fs.readFile(target, 'utf8');
      await fs.writeFile(
        target,
        ref.endsWith('.json') ? original.replace('standalone', 'native') : original + '\nchanged\n',
      );
      expect(
        (await dispatch({ operation: 'inspect', runId: 'report' }, root, true)).response.status,
      ).toBe('failed');
      await fs.writeFile(target, original);
      expect(run(await dispatch({ operation: 'inspect', runId: 'report' }, root, true))).toEqual(
        initial,
      );
    },
  );
  it('isolates identical application and Run names in separate projects and linked worktrees', async () => {
    const project = path.join(root, 'project');
    const linked = path.join(root, 'linked');
    await fs.mkdir(project);
    execFileSync('git', ['init', '-b', 'main', project]);
    execFileSync('git', [
      '-C',
      project,
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.test',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    ]);
    execFileSync('git', ['-C', project, 'worktree', 'add', '-b', 'linked', linked]);
    run(await dispatch(start, project, true));
    const isolated = run(
      await dispatch({ ...start, input: { topic: 'Linked report' } }, linked, true),
    );
    run(
      await dispatch(
        {
          operation: 'execute',
          runId: 'report',
          actionId: isolated.actions[0].id,
          executorId: 'local-skill',
        },
        linked,
        true,
      ),
    );
    expect(
      run(await dispatch({ operation: 'inspect', runId: 'report' }, project, true)).actions[0]
        .status,
    ).toBe('pending');
    expect(
      run(await dispatch({ operation: 'inspect', runId: 'report' }, linked, true)).actions[0]
        .status,
    ).toBe('succeeded');
  });
  it('routes only the current Guard when switching custom and built-in selections', async () => {
    run(await dispatch(start));
    const request = { intent: 'write' as const, targets: [path.join(root, 'report.md')] };
    expect((await inspectCometHook(root, request)).applicationId).toBe('editorial');
    for (const workflow of ['native', 'classic'] as const) {
      await writeCometCurrentSelection(root, {
        schema: 'comet.selection.v2',
        workflow,
        change: 'builtin',
        branch: null,
      });
      expect((await inspectCometHook(root, request)).applicationId).toBeUndefined();
      run(await dispatch(start));
      expect((await inspectCometHook(root, request)).applicationId).toBe('editorial');
    }
  });
  it.each(['js', 'cjs'])(
    'rejects an unchecked %s implementation dependency before running its outside validator',
    async (extension) => {
      const outside = path.join(root, 'outside-validator.mjs');
      await fs.writeFile(outside, 'export const validate = () => true;');
      await fs.writeFile(
        path.join(app.packageRoot, `adapter.${extension}`),
        `import { validate } from '${outside.replaceAll('\\', '/')}'; export { validate };`,
      );
      const moduleFile = path.join(app.packageRoot, 'application.mjs');
      await fs.writeFile(
        moduleFile,
        `import './adapter.${extension}';\n${await fs.readFile(moduleFile, 'utf8')}`,
      );
      const result = await dispatch(start, root, true);
      expect(result.response.status).toBe('failed');
      expect(result.response.error.message).toContain('请先 bundle');
      await fs.writeFile(outside, 'export const validate = () => false;');
      expect((await dispatch(start, root, true)).response.status).toBe('failed');
    },
  );
  it('the generated public Hook restores the same custom application without built-in project configuration', async () => {
    const initial = run(await dispatch(start));
    const invokeHook = (target: string) =>
      spawnSync(
        process.execPath,
        [
          'assets/skills/comet/scripts/comet-hook-router.mjs',
          '--platform',
          'claude',
          '--project-root',
          root,
        ],
        {
          cwd: path.resolve('.'),
          input: JSON.stringify({
            tool_name: 'Write',
            cwd: root,
            tool_input: { file_path: target },
          }),
          encoding: 'utf8',
          timeout: 30000,
        },
      );
    const blocked = invokeHook(path.join(root, 'report.md'));
    expect(blocked.error).toBeUndefined();
    expect(blocked.status).toBe(2);
    expect(blocked.stderr + blocked.stdout).toContain('当前 SDK Action 没有此写入权限');
    const action = initial.actions[0];
    run(
      await dispatch({
        operation: 'claim',
        runId: initial.runId,
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        executorId: 'local-skill',
        claimToken: 'hook-probe',
        capabilities: ['skill-script'],
      }),
    );
    const result = invokeHook(path.join(root, '.comet/evidence/editorial/probe.json'));
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr + result.stdout).toContain('Editorial guard report running');
  });
});
