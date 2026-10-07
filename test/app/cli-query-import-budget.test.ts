import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const imports = vi.hoisted(() => ({ runtime: 0 }));
vi.mock('../../app/commands/runtime.js', async (original) => {
  imports.runtime += 1;
  return original();
});
vi.mock('../../domains/workflow-creation/index.js', () => {
  throw new Error('A static Creator guide must not load the Creator execution graph');
});
vi.mock('../../domains/workflow-application/index.js', () => {
  throw new Error('Portable Runtime requests must not load application delivery or Skill review');
});
vi.mock('../../domains/bundle/candidates.js', () => {
  throw new Error('Bundle state queries must not discover Skill candidates');
});
vi.mock('../../domains/bundle/compiler.js', () => {
  throw new Error('Bundle state queries must not load compilation');
});
vi.mock('../../domains/bundle/platform.js', () => {
  throw new Error('Bundle state queries must not load platform installation');
});
vi.mock('../../domains/bundle/review-summary.js', () => {
  throw new Error('Bundle state queries must not load review compilation');
});
vi.mock('../../domains/bundle/publish.js', () => {
  throw new Error('Bundle state queries must not load publishing');
});
vi.mock('../../domains/bundle/distribute.js', () => {
  throw new Error('Bundle state queries must not load distribution');
});

describe('CLI query import budgets', () => {
  let root: string;
  let exitCode: typeof process.exitCode;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-cli-query-budget-'));
    exitCode = process.exitCode;
    vi.stubEnv('HOME', root);
    vi.stubEnv('USERPROFILE', root);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  });
  afterEach(async () => {
    process.exitCode = exitCode;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reports invalid Runtime CLI arguments without loading the request executor', async () => {
    const before = imports.runtime;
    const { runRuntimeCli } = await import('../../app/cli/runtime-command.js');
    await runRuntimeCli(['runtime', 'dispatch']);
    expect(imports.runtime).toBe(before);
    expect(process.exitCode).toBe(64);
    expect(console.log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toMatchObject({
      protocolVersion: 1,
      status: 'failed',
      error: { code: 'INVALID_REQUEST' },
      usage: {
        command: 'comet runtime dispatch [options]',
        missingOptions: ['--request <file>'],
        helpCommand: 'comet runtime dispatch --help',
      },
    });
  });

  it('prints the Creator guide without loading execution or candidate discovery', async () => {
    const { creatorGuideCommand } = await import('../../app/commands/creator.js');
    await creatorGuideCommand({ project: root, json: true });
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toMatchObject({
      start: expect.stringContaining('--install-target'),
      inspect: 'comet creator status <name> --json',
      resume: 'comet creator next <name> --json',
      dispatch: 'comet creator dispatch <name> --request <json-file> --json',
    });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('lists Bundle state without loading candidate, compiler, publisher or installer graphs', async () => {
    const { bundleListCommand } = await import('../../app/commands/bundle.js');
    await bundleListCommand({ project: root, json: true });
    expect(JSON.parse(vi.mocked(console.log).mock.calls[0][0])).toEqual({ bundles: [] });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('keeps portable Runtime validation independent of workflow application delivery', async () => {
    const { runtimeDispatchCommand } = await import('../../app/commands/runtime.js');
    const request = path.join(root, 'request.json');
    await fs.writeFile(request, JSON.stringify({ operation: 'inspect', runId: 'missing' }));
    const result = await runtimeDispatchCommand({
      request,
      rootDir: path.join(root, 'runs'),
      projectRoot: root,
    });
    expect(result.response).toMatchObject({ status: 'failed', error: { code: 'RUN_NOT_FOUND' } });
  });
});
