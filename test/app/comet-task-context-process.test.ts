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
  await fs.writeFile(
    path.join(root, 'runner.mjs'),
    `
    import { cometTaskCommand } from './command.mjs';
    await cometTaskCommand(process.argv[2], { task: '开启全新的报表功能 change', json: true });
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
async function run(home: string, project: string) {
  return execFileAsync(process.execPath, [path.join(root, 'runner.mjs'), project], {
    env: { ...process.env, USERPROFILE: home, HOME: home },
    timeout: 18_000,
    killSignal: 'SIGKILL',
    windowsHide: true,
  });
}

test('a new project with no memory returns an empty successful response', async () => {
  const { home, project } = await fixture('empty');
  const result = await run(home, project);
  expect(JSON.parse(result.stdout)).toEqual({ context: [] });
  expect(result.stderr).not.toMatch(/timed out|exceeded/i);
});

test('a new change still recalls user preferences and persists their application for later feedback', async () => {
  const { home, project } = await fixture('preferences');
  await fs.mkdir(path.join(home, '.comet/memory'), { recursive: true });
  await fs.writeFile(
    path.join(home, '.comet/memory/profile.md'),
    '# 个人画像\n\n## 沟通偏好\n\n- 使用中文回复\n',
  );
  const result = await run(home, project);
  const response = JSON.parse(result.stdout);
  expect(response.context).toHaveLength(1);
  expect(response.context[0].text).toContain('使用中文回复');
  expect(response.context[0].applications).not.toHaveLength(0);
  const persisted = await fs.readFile(
    path.join(home, '.comet/plugins/storage/comet.agent-context-user-global.json'),
    'utf8',
  );
  expect(persisted).toContain(response.context[0].applications[0].applicationId);
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
