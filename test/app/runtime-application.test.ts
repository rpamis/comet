import { promises as fs } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import { inspectCometHook } from '../../domains/comet-entry/hook-router.js';
import { writeCometCurrentSelection } from '../../domains/workflow-contract/current-selection.js';
import { createDiskApplication } from '../helpers/workflow-application.js';
import type { WorkflowRun } from '../../domains/engine/runtime.js';

describe('complete disk application public entry', () => {
  let root: string;
  let app: Awaited<ReturnType<typeof createDiskApplication>>;
  let count: number;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-application-'));
    app = await createDiskApplication(root);
    count = 0;
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  const start = {
    operation: 'start',
    runId: 'report',
    workflow: { id: 'editorial', version: '1' },
    input: { topic: 'A real report' },
  };
  async function dispatch(request: unknown, projectRoot = root, cold = false) {
    const requestFile = path.join(root, `request-${++count}.json`);
    await fs.writeFile(requestFile, JSON.stringify(request));
    if (cold) {
      const result = spawnSync(
        process.execPath,
        [
          'bin/comet.js',
          'runtime',
          'dispatch',
          '--application-file',
          app.file,
          '--project-root',
          projectRoot,
          '--request',
          requestFile,
        ],
        { cwd: path.resolve('.'), encoding: 'utf8', timeout: 30000 },
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
    run(await dispatch(start));
    const result = spawnSync(
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
          tool_input: { file_path: path.join(root, 'report.md') },
        }),
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.stderr + result.stdout).toContain('Editorial guard report running');
  });
});
