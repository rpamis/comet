import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { SqliteAgentContextApplicationStore } from '../../domains/agent-learning/index.js';
import { readRuntimeTraceSpans } from '../../platform/process/runtime-trace.js';

const execFileAsync = promisify(execFile);
let root: string;
beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-task-process-'));
  await build({
    entryPoints: ['app/commands/comet-task.ts'],
    outfile: path.join(root, 'command.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { __COMET_VERSION__: '"0.5.0"' },
    banner: {
      js: "import { createRequire as taskTestRequire } from 'node:module'; const require = taskTestRequire(import.meta.url);",
    },
  });
  await build({
    entryPoints: ['app/commands/comet-task-context-worker.ts'],
    outfile: path.join(root, 'comet-task-context-worker.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { __COMET_VERSION__: '"0.5.0"' },
    banner: {
      js: "import { createRequire as taskTestRequire } from 'node:module'; const require = taskTestRequire(import.meta.url);",
    },
  });
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await build({
    entryPoints: ['app/commands/task-facade.ts'],
    outfile: path.join(root, 'facade.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { __COMET_VERSION__: '"0.5.1"' },
    banner: {
      js: "import { createRequire as taskTestRequire } from 'node:module'; const require = taskTestRequire(import.meta.url);",
    },
  });
  await fs.writeFile(
    path.join(root, 'facade-runner.mjs'),
    "import { runTaskFacade } from './facade.mjs'; await runTaskFacade(process.argv.slice(2));\n",
  );
  await build({
    entryPoints: ['app/commands/project-knowledge.ts'],
    outfile: path.join(root, 'knowledge.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { __COMET_VERSION__: '"0.5.0"' },
    banner: {
      js: "import { createRequire as taskTestRequire } from 'node:module'; const require = taskTestRequire(import.meta.url);",
    },
  });
  await build({
    entryPoints: ['domains/comet-entry/plugin-context.ts'],
    outfile: path.join(root, 'bridge.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { __COMET_VERSION__: '"0.5.0"' },
    banner: {
      js: "import { createRequire as taskTestRequire } from 'node:module'; const require = taskTestRequire(import.meta.url);",
    },
  });
  await fs.writeFile(
    path.join(root, 'runner.mjs'),
    `
    import { cometTaskCommand } from './command.mjs';
    await cometTaskCommand(process.argv[2], { task: '开启全新的报表功能 change', json: true, ...JSON.parse(process.argv[3] ?? '{}') });
  `,
  );
});
afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function fixture(name: string) {
  const home = path.join(root, name, 'home');
  const project = path.join(root, name, 'project');
  await fs.mkdir(path.join(home, '.comet'), { recursive: true });
  await fs.mkdir(path.join(home, '.cache'), { recursive: true });
  await fs.mkdir(project, { recursive: true });
  return { home, project };
}
function fixtureEnvironment(home: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CACHE_HOME: path.join(home, '.cache'),
    LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
  };
}
async function run(home: string, project: string, options = {}) {
  return execFileAsync(
    process.execPath,
    [path.join(root, 'runner.mjs'), project, JSON.stringify(options)],
    {
      env: fixtureEnvironment(home),
      timeout: 18_000,
      killSignal: 'SIGKILL',
      windowsHide: true,
    },
  );
}

test('a new project with no memory returns an empty successful response', async () => {
  const { home, project } = await fixture('empty');
  const result = await run(home, project);
  expect(JSON.parse(result.stdout)).toEqual({ context: [] });
  expect(result.stderr).not.toMatch(/timed out|exceeded/i);
});

test('an unavailable project memory expansion returns a CLI diagnostic without a Node stack', async () => {
  const { home, project } = await fixture('missing-expansion');
  const error = await execFileAsync(
    process.execPath,
    [
      path.join(root, 'facade-runner.mjs'),
      project,
      '--task',
      'Read the recorded resolution',
      '--expand-context',
      'project-memory:missing-lesson',
      '--json',
    ],
    { env: fixtureEnvironment(home), timeout: 18000, windowsHide: true },
  ).catch((error) => error);
  expect(error.code).toBe(1);
  expect(error.stderr).not.toMatch(/\n\s+at |Node\.js v|file:\/\//u);
  expect(JSON.parse(error.stdout)).toMatchObject({
    error: {
      code: 'TASK_FAILED',
      message: expect.stringContaining('project-memory:missing-lesson'),
    },
  });
});
test('associates real task-context retrieval with its explicitly selected Change', async () => {
  const { home, project } = await fixture('trace-retrieval');
  const result = await run(home, project, {
    workflow: 'native',
    change: 'trace-example',
    phase: 'build',
  });
  expect(JSON.parse(result.stdout)).toEqual({ context: [] });
  const { spans } = await readRuntimeTraceSpans(project);
  const rootSpan = spans.find((span) => span.parentSpanId === null);
  expect(rootSpan).toMatchObject({
    change: 'trace-example',
    runId: 'trace-example',
    kind: 'retrieval',
    status: 'succeeded',
  });
  expect(rootSpan!.startedAt).not.toBeNull();
  expect(rootSpan!.endedAt).not.toBeNull();
  expect(JSON.stringify(spans)).not.toContain('开启全新的报表功能');
});

test('completes a task with one learning file and reuses durable receipts after process restart', async () => {
  const { home, project } = await fixture('learning-file');
  await fs.writeFile(path.join(project, 'migration.md'), '# Migration\n\nValidated migration.\n');
  const learningFile = path.join(root, 'learning.json');
  await fs.writeFile(
    learningFile,
    JSON.stringify({
      schema: 'comet.task-learning.v1',
      personal: { check: 'no-observation' },
      project: {
        check: 'submitted',
        memories: [
          {
            title: 'Validated migration',
            text: 'Run the validated migration.',
            evidence: ['migration.md'],
          },
        ],
      },
    }),
  );
  const options = { complete: true, workflow: 'classic', change: 'learning-file', learningFile };
  const first = JSON.parse((await run(home, project, options)).stdout);
  expect(first.learningSubmission, JSON.stringify(first.learningSubmission)).toMatchObject({
    status: 'applied',
    errors: [],
  });
  expect(first.projectLearning).toMatchObject({
    submissionVerified: true,
    pendingReflectionCount: 0,
    pendingHostReviewCount: 0,
  });
  const second = JSON.parse((await run(home, project, options)).stdout);
  expect(second.learningSubmission).toMatchObject({
    status: 'applied',
    memorySlugs: first.learningSubmission.memorySlugs,
  });
  const invalid = await run(home, project, { learningFile }).then(
    () => null,
    (error) => error,
  );
  expect(invalid?.stderr).toContain('--learning-file requires --complete');
});

test('reports a real waiting lifecycle review and closes only the reviewed change after application', async () => {
  const { home, project } = await fixture('review-lifecycle');
  const env = fixtureEnvironment(home);
  await fs.writeFile(path.join(project, 'retry.ts'), 'retry(1);');
  await execFileAsync(process.execPath, ['--check', path.join(project, 'retry.ts')], {
    env,
    windowsHide: true,
  });
  await fs.writeFile(
    path.join(root, 'checkpoint.mjs'),
    `
    import { recordCometWorkflowResult } from './bridge.mjs';
    await recordCometWorkflowResult({ projectRoot: process.argv[2], workflow: 'native', changeId: process.argv[3], command: 'archive', success: true, changedPaths: ['retry.ts'], verificationResults: [{ command: 'node --check retry.ts', success: true }] });
  `,
  );
  for (const change of ['current', 'other'])
    await execFileAsync(process.execPath, [path.join(root, 'checkpoint.mjs'), project, change], {
      env,
      timeout: 20_000,
      windowsHide: true,
    });
  const options = {
    complete: true,
    workflow: 'native',
    change: 'current',
    projectLearningCheck: 'no-observation',
  };
  const waiting = JSON.parse((await run(home, project, options)).stdout);
  expect(waiting.projectLearning).toMatchObject({
    submissionVerified: false,
    pendingHostReviewCount: 1,
    pendingReflectionCount: 1,
  });
  await fs.writeFile(
    path.join(root, 'review.mjs'),
    `
    import { projectKnowledgeReviewCommand } from './knowledge.mjs';
    await projectKnowledgeReviewCommand(process.argv[2], { workflow: 'native', change: 'current', json: true, ...(process.argv[3] ? { id: process.argv[3], file: process.argv[4] } : {}) });
  `,
  );
  const pending = JSON.parse(
    (
      await execFileAsync(process.execPath, [path.join(root, 'review.mjs'), project], {
        env,
        timeout: 20_000,
        windowsHide: true,
      })
    ).stdout,
  );
  expect(pending.pending).toHaveLength(1);
  const actions = path.join(project, 'actions.json');
  await fs.writeFile(actions, '[]');
  const reviewed = JSON.parse(
    (
      await execFileAsync(
        process.execPath,
        [path.join(root, 'review.mjs'), project, pending.pending[0].id, actions],
        { env, timeout: 20_000, windowsHide: true },
      )
    ).stdout,
  );
  expect(reviewed.submission.status).toBe('applied');
  const complete = JSON.parse((await run(home, project, options)).stdout);
  expect(complete.projectLearning).toMatchObject({
    submissionVerified: true,
    pendingHostReviewCount: 0,
    pendingReflectionCount: 0,
  });
  const unrelated = JSON.parse((await run(home, project, { ...options, change: 'other' })).stdout);
  expect(unrelated.projectLearning.pendingHostReviewCount).toBe(1);
}, 60_000);

test('keeps completion usable when a mismatched helper returns an invalid learning response', async () => {
  const { home, project } = await fixture('invalid-learning-helper');
  const worker = path.join(root, 'comet-task-context-worker.js');
  const original = await fs.readFile(worker);
  try {
    await fs.writeFile(
      worker,
      `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('[]'));`,
    );
    const result = JSON.parse(
      (
        await run(home, project, {
          complete: true,
          workflow: 'native',
          change: 'current',
          projectLearningCheck: 'no-observation',
        })
      ).stdout,
    );
    expect(result.projectLearning).toMatchObject({ unavailable: true, submissionVerified: false });
  } finally {
    await fs.writeFile(worker, original);
  }
});

test('checks completion receipts in the real helper process and refuses stale-source lessons', async () => {
  const { home, project } = await fixture('completion');
  await fs.writeFile(path.join(project, 'retry.ts'), 'retry(1);');
  await fs.writeFile(
    path.join(root, 'remember.mjs'),
    `
    import { projectKnowledgeRememberCommand } from './knowledge.mjs';
    await projectKnowledgeRememberCommand(process.argv[2], { title: 'Retry once', text: 'Retry once after a transient failure.', workflow: 'native', change: 'current', evidence: ['retry.ts'], json: true });
  `,
  );
  const written = await execFileAsync(
    process.execPath,
    [path.join(root, 'remember.mjs'), project],
    {
      env: fixtureEnvironment(home),
      timeout: 18_000,
      windowsHide: true,
    },
  );
  const receipt = JSON.parse(written.stdout);
  expect(receipt.entry).toMatchObject({ workflow: 'native', change: 'current' });
  const expanded = JSON.parse(
    (
      await run(home, project, {
        task: 'Retry once',
        expandContext: `project-memory:${receipt.slug}`,
      })
    ).stdout,
  );
  expect(expanded.expansion.content).toContain('Retry once after a transient failure.');
  const options = {
    complete: true,
    workflow: 'native',
    change: 'current',
    projectLearningCheck: 'submitted',
    memory: receipt.slug,
  };
  const completion = JSON.parse((await run(home, project, options)).stdout);
  expect(completion.projectLearning).toMatchObject({
    submissionVerified: true,
    pendingHostReviewCount: 0,
    pendingReflectionCount: 0,
  });
  await fs.writeFile(path.join(project, 'retry.ts'), 'retry(2);');
  const stale = JSON.parse((await run(home, project, options)).stdout);
  expect(stale.projectLearning.submissionVerified).toBe(false);
  expect(stale.projectLearning.memories).toEqual([
    { slug: receipt.slug, verified: false, reason: 'source-changed' },
  ]);
}, 45_000);

test('a new change still recalls user preferences and persists their application for later feedback', async () => {
  const { home, project } = await fixture('preferences');
  await fs.mkdir(path.join(home, '.comet/memory'), { recursive: true });
  await fs.writeFile(
    path.join(home, '.comet/memory/profile.md'),
    '# 个人画像\n\n## 沟通偏好\n\n- 使用中文回复\n',
  );
  const request = { session: 'builder', phase: 'build' };
  const result = await run(home, project, request);
  const response = JSON.parse(result.stdout);
  expect(response.context).toHaveLength(1);
  expect(response.context[0].text).toContain('使用中文回复');
  expect(response.context[0].applications).not.toHaveLength(0);
  const applicationStore = new SqliteAgentContextApplicationStore(
    path.join(home, '.comet/plugins/storage/context-applications.sqlite'),
  );
  expect((await applicationStore.list()).map((application) => application.applicationId)).toContain(
    response.context[0].applications[0].applicationId,
  );
  expect(JSON.parse((await run(home, project, request)).stdout).context).toEqual([]);
  const restored = JSON.parse(
    (await run(home, project, { ...request, contextMode: 'snapshot' })).stdout,
  );
  expect(restored.context[0].text).toContain('使用中文回复');
  expect(restored.context[0].applications[0].applicationId).toBe(
    response.context[0].applications[0].applicationId,
  );
  const verify = JSON.parse((await run(home, project, { ...request, phase: 'verify' })).stdout);
  expect(verify.context[0].text).toContain('使用中文回复');
  const independent = JSON.parse(
    (await run(home, project, { phase: 'verify', session: 'verifier', contextMode: 'snapshot' }))
      .stdout,
  );
  expect(independent.context[0].text).toContain('使用中文回复');
  expect(independent.context[0].applications[0].applicationId).not.toBe(
    verify.context[0].applications[0].applicationId,
  );
  expect(await applicationStore.list()).toHaveLength(3);
});

test('an unresponsive memory provider is canceled without blocking a new task or requiring retry', async () => {
  const { home, project } = await fixture('unavailable');
  let requests = 0;
  const server = createServer(() => {
    requests += 1;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await fs.writeFile(
    path.join(home, '.comet/config.yaml'),
    `personal_memory:\n  provider: remote\n  remote:\n    endpoint: http://127.0.0.1:${port}\n    timeout_ms: 120000\n`,
  );
  try {
    const result = await run(home, project);
    expect(requests).toBeGreaterThan(0);
    expect(JSON.parse(result.stdout)).toEqual({ context: [] });
    expect(result.stderr).toMatch(/canceled/i);
    expect(result.stderr).toMatch(/continue/i);
    await expect
      .poll(
        () =>
          new Promise<number>((resolve, reject) =>
            server.getConnections((error, count) => (error ? reject(error) : resolve(count))),
          ),
        { timeout: 2_000 },
      )
      .toBe(0);
    await fs.unlink(path.join(home, '.comet/config.yaml'));
    const recovered = await run(home, project);
    expect(JSON.parse(recovered.stdout)).toEqual({ context: [] });
    expect(recovered.stderr).not.toMatch(/canceled|unavailable/i);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  // Cancellation and recovery each launch a CLI with its own 18-second harness limit.
}, 45_000);

test('cancels checkpoint learning after one budget and preserves all queued events', async () => {
  const { home, project } = await fixture('checkpoint-unavailable');
  let requests = 0;
  const server = createServer(() => {
    requests++;
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await fs.writeFile(
    path.join(home, '.comet/config.yaml'),
    `personal_memory:\n  provider: remote\n  remote:\n    endpoint: http://127.0.0.1:${port}\n    timeout_ms: 120000\n`,
  );
  await build({
    entryPoints: ['app/commands/comet-task-context.ts'],
    outfile: path.join(root, 'checkpoint-helper.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
  });
  await fs.writeFile(
    path.join(root, 'checkpoint-runner.mjs'),
    `
    import { recordCometTaskWorkflowResults } from './checkpoint-helper.mjs';
    const started = performance.now();
    const results = await recordCometTaskWorkflowResults(['native', 'classic', 'native'].map((workflow, i) => ({
      projectRoot: process.argv[2], workflow, changeId: 'checkpoint-' + i, command: 'check', success: true, learningCheck: 'not-run'
    })));
    console.log(JSON.stringify({ results, elapsed: performance.now() - started }));
  `,
  );
  try {
    const result = await execFileAsync(
      process.execPath,
      [path.join(root, 'checkpoint-runner.mjs'), project],
      {
        env: fixtureEnvironment(home),
        timeout: 15_000,
        windowsHide: true,
      },
    );
    const response = JSON.parse(result.stdout);
    expect(response.results).toEqual([]);
    expect(response.elapsed).toBeLessThan(9_000);
    expect(result.stderr).toContain('exceeded 5 seconds');
    expect(requests).toBeGreaterThan(0);
    const files = await fs.readdir(path.join(home, '.comet/plugins/storage'));
    const journalFile = files.find(
      (file) => file.startsWith('comet.agent-learning-project-') && file.endsWith('.json'),
    )!;
    const journal = JSON.parse(
      await fs.readFile(path.join(home, '.comet/plugins/storage', journalFile), 'utf8'),
    );
    expect(journal.events).toHaveLength(3);
    expect(
      journal.events.map((event: { context: { changeId: string } }) => event.context.changeId),
    ).toEqual(['checkpoint-0', 'checkpoint-1', 'checkpoint-2']);
    expect(
      Object.values(journal.reflections).every(
        (entry) => (entry as { status: string }).status === 'pending',
      ),
    ).toBe(true);
    await expect
      .poll(
        () =>
          new Promise<number>((resolve, reject) =>
            server.getConnections((error, count) => (error ? reject(error) : resolve(count))),
          ),
        { timeout: 2_000 },
      )
      .toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 20_000);

test('workflow learning resolves a canonical Git root once across both durable capture and full recording', async () => {
  const { home, project } = await fixture('learning-git-root');
  await execFileAsync('git', ['init', project]);
  const trace = path.join(home, 'git-trace.jsonl');
  const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'comet-task-context-worker.js')], {
      env: {
        ...fixtureEnvironment(home),
        GIT_TRACE2_EVENT: trace,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 18_000,
      killSignal: 'SIGKILL',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`worker exit ${code}: ${stderr}`)),
    );
    child.stdin.end(
      JSON.stringify({
        projectRoot: project,
        workflowResults: [
          {
            projectRoot: project,
            workflow: 'native',
            changeId: 'git-count',
            command: 'next',
            success: true,
          },
        ],
      }),
    );
  });
  expect(result.stderr).not.toContain('checkpoint is unavailable');
  expect(JSON.parse(result.stdout)).toHaveLength(1);
  const starts = (await fs.readFile(trace, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((event) => event.event === 'start');
  expect(starts.filter((event) => event.argv.includes('--show-toplevel'))).toHaveLength(1);
});
