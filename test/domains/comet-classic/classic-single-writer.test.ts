import { afterEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { inspectClassicSdkRun } from '../../../domains/comet-classic/classic-sdk-status.js';
import { resolveWorkspaceRuntimeRootSync } from '../../../domains/workflow-contract/workspace-runtime.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
it('creates and reads the authoritative Classic Run without ordinary workflow locks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-single-writer-'));
  roots.push(root);
  await prepareClassicLegacyProject(root);
  const result = await runClassicCli(
    ['state', 'init', 'serial', 'full', '--runtime', 'sdk', '--json'],
    undefined,
    { projectRoot: root, invocationCwd: root },
  );
  expect(result.exitCode, result.stdout).toBe(0);
  const original = await inspectClassicSdkRun(root, 'serial', { readOnly: true });
  expect(original?.run.runId).toBe('serial');
  const runtime = resolveWorkspaceRuntimeRootSync(root);
  const files = await fs.readdir(runtime, { recursive: true });
  expect(
    files.filter((file) => /\.lock(?:\.sqlite(?:-(?:journal|wal|shm))?)?$/u.test(file)),
  ).toEqual([]);
  expect(files.some((file) => String(file).includes('state-projections'))).toBe(false);
  const document = path.join(root, 'openspec/changes/serial/comet-state.yaml');
  const before = await fs.readFile(document, 'utf8');
  expect((await inspectClassicSdkRun(root, 'serial', { readOnly: true }))?.run).toEqual(
    original?.run,
  );
  expect(await fs.readFile(document, 'utf8')).toBe(before);
});
