import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { afterAll, beforeAll, expect, test } from 'vitest';

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
  await fs.mkdir(project, { recursive: true });
  return { home, project };
}
async function run(home: string, project: string, options = {}) {
  return execFileAsync(
    process.execPath,
    [path.join(root, 'runner.mjs'), project, JSON.stringify(options)],
    {
      env: { ...process.env, USERPROFILE: home, HOME: home },
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

test('reports a real waiting lifecycle review and closes only the reviewed change after application', async () => {
  const { home, project } = await fixture('review-lifecycle');
  const env = { ...process.env, HOME: home, USERPROFILE: home };
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
      env: { ...process.env, HOME: home, USERPROFILE: home },
      timeout: 18_000,
      windowsHide: true,
    },
  );
  const receipt = JSON.parse(written.stdout);
  expect(receipt.entry).toMatchObject({ workflow: 'native', change: 'current' });
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
  const persisted = await fs.readFile(
    path.join(home, '.comet/plugins/storage/comet.agent-context-user-global.json'),
    'utf8',
  );
  expect(persisted).toContain(response.context[0].applications[0].applicationId);
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
  const restoredStore = JSON.parse(
    await fs.readFile(
      path.join(home, '.comet/plugins/storage/comet.agent-context-user-global.json'),
      'utf8',
    ),
  );
  expect(restoredStore.records).toHaveLength(3);
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
    const connections = await new Promise<number>((resolve, reject) =>
      server.getConnections((error, count) => (error ? reject(error) : resolve(count))),
    );
    expect(connections).toBe(0);
    await fs.unlink(path.join(home, '.comet/config.yaml'));
    const recovered = await run(home, project);
    expect(JSON.parse(recovered.stdout)).toEqual({ context: [] });
    expect(recovered.stderr).not.toMatch(/canceled|unavailable/i);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 25_000);
