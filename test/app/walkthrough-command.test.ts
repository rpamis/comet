import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { walkthroughCommand } from '../../app/commands/walkthrough.js';

let root: string;
const originalArgv = process.argv;
const originalExitCode = process.exitCode;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-walkthrough-command-'));
  await fs.mkdir(path.join(root, '.comet'));
  await fs.writeFile(
    path.join(root, '.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nworkflows: [classic]\nclassic:\n  artifact_layout: docs\n',
  );
  await fs.mkdir(path.join(root, 'docs/openspec/changes/demo'), { recursive: true });
  process.exitCode = undefined;
});
afterEach(async () => {
  process.argv = originalArgv;
  process.exitCode = originalExitCode;
  vi.restoreAllMocks();
  vi.resetModules();
  await fs.rm(root, { recursive: true, force: true });
});

it('routes the public CLI to a real walkthrough and replaces only verification on request', async () => {
  const input = path.join(root, 'input.json');
  await fs.writeFile(
    input,
    JSON.stringify({
      summary: 'Preserve the ready API',
      scope: 'source.js',
      changes: [
        { title: 'Ready', before: 'False', after: 'True', reason: 'Correct the result', files: [] },
      ],
      verification: [{ label: 'Unit tests', status: 'passed', detail: 'Original result' }],
    }),
  );
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  process.argv = [
    process.execPath,
    path.resolve('bin/comet.js'),
    'walkthrough',
    'classic',
    'demo',
    '--file',
    input,
    '--project-root',
    root,
  ];
  await import('../../app/cli/index.js');
  expect(process.exitCode, stderr.mock.calls).toBeUndefined();
  const result = JSON.parse(stdout.mock.calls.map((call) => String(call[0])).join(''));
  expect(result).toEqual({
    enabled: true,
    path: path.join(root, 'docs/openspec/changes/demo/walkthrough.html'),
  });
  expect(await fs.readFile(result.path, 'utf8')).toContain('Preserve the ready API');
  await fs.writeFile(
    input,
    JSON.stringify({
      verification: [{ label: 'Follow-up', status: 'failed', detail: 'New result' }],
    }),
  );
  stdout.mockClear();
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  await walkthroughCommand('classic', 'demo', { file: input, verificationOnly: true });
  const html = await fs.readFile(result.path, 'utf8');
  expect(html).toContain('Preserve the ready API');
  expect(html).toContain('New result');
  expect(html).not.toContain('Original result');
  expect(JSON.parse(String(stdout.mock.calls[0][0]))).toEqual(result);
});

it('reports invalid workflows and content without overwriting the existing walkthrough', async () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  const page = path.join(root, 'docs/openspec/changes/demo/walkthrough.html');
  await fs.writeFile(page, 'Original page');
  await walkthroughCommand('unknown', 'demo', { projectRoot: root, file: 'missing.json' });
  expect(process.exitCode).toBe(1);
  expect(stderr.mock.calls[0][0]).toContain('workflow must be native or classic');
  process.exitCode = undefined;
  const input = path.join(root, 'invalid.json');
  await fs.writeFile(input, '{');
  await walkthroughCommand('classic', 'demo', { projectRoot: root, file: input });
  expect(process.exitCode).toBe(1);
  expect(stderr.mock.calls.at(-1)?.[0]).toContain('变更说明未生成');
  expect(stdout).not.toHaveBeenCalled();
  expect(await fs.readFile(page, 'utf8')).toBe('Original page');
});
