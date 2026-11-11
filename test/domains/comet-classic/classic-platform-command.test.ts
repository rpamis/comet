import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('routes a legacy check invocation to platform work without executing it or claiming a pass', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'classic-platform-command-'));
  roots.push(root);
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'classic-platform-userdata-'));
  roots.push(dataRoot);
  vi.stubEnv('COMET_DATA_DIR', dataRoot);
  const change = path.join(root, 'docs/openspec/changes/sample');
  await mkdir(change, { recursive: true });
  await mkdir(path.join(root, '.comet'));
  await writeFile(
    path.join(root, '.comet/config.yaml'),
    'schema: comet.project.v1\ndefault_workflow: classic\nnative:\n  artifact_root: docs\nclassic:\n  artifact_layout: docs\n',
  );
  const marker = path.join(root, 'must-not-exist');
  await writeFile(
    path.join(change, '.comet.yaml'),
    'workflow: tweak\nphase: build\narchived: false\n',
  );
  const result = await runClassicCli(
    [
      'check',
      'run',
      'sample',
      'build',
      '--json',
      '--',
      process.execPath,
      '-e',
      `require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed')`,
    ],
    undefined,
    { projectRoot: root, invocationCwd: root },
  );
  expect(result.exitCode, result.stderr ?? result.stdout).toBe(0);
  const output = JSON.parse(result.stdout!);
  const data = output.data;
  expect(data.status).toBe('platform-execution-required');
  expect(data.checksExecuted).toBe(false);
  expect(data).not.toHaveProperty('passed');
  expect(data).not.toHaveProperty('receiptRef');
  await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await readFile(path.join(change, '.comet.yaml'), 'utf8')).toContain('phase: build');
});
