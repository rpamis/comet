import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isolatedBenchmarkEnvironment,
  measureRuntimeSample,
  validateRuntimeProcess,
  writeRuntimeBaseline,
  writeRuntimeReport,
} from '../../scripts/benchmark/runtime-coldstart-benchmark.mjs';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })),
  );
});

describe('Runtime cold-start benchmark evidence', () => {
  it('isolates user configuration, caches, and inherited task context', () => {
    const home = path.join(os.tmpdir(), 'isolated-comet-benchmark-home');
    const inherited = {
      HOME: '/user',
      LOCALAPPDATA: '/user/cache',
      COMET_TASK: 'private task',
      NODE_OPTIONS: '--inspect',
      PATH: 'unchanged',
    };
    const env = isolatedBenchmarkEnvironment(home, inherited);
    for (const key of [
      'HOME',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'XDG_CONFIG_HOME',
      'XDG_CACHE_HOME',
      'XDG_DATA_HOME',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_SYSTEM',
    ]) {
      expect(path.relative(home, env[key]).startsWith('..')).toBe(false);
    }
    expect(env).toMatchObject({ COMET_TASK: '', NODE_OPTIONS: '', PATH: 'unchanged' });
    expect(inherited.COMET_TASK).toBe('private task');
  });

  it.each([
    { status: 1, signal: null, error: undefined },
    { status: null, signal: 'SIGTERM', error: undefined },
    { status: null, signal: null, error: new Error('spawn ETIMEDOUT') },
  ])('rejects unsuccessful or timed-out processes before trusting their JSON: %j', (result) => {
    const validate = vi.fn();
    expect(() =>
      validateRuntimeProcess(
        { name: 'native-status', validate },
        { ...result, stdout: '{"data":{"phase":"shape"}}', stderr: '' },
      ),
    ).toThrow('unsuccessful process');
    expect(validate).not.toHaveBeenCalled();
  });

  it('checks Runtime semantics and persisted postconditions even after exit zero', async () => {
    const spawn = vi.fn(() => ({ status: 0, signal: null, stdout: '{}', stderr: '' }));
    const target = {
      name: 'native-next',
      args: [],
      cwd: os.tmpdir(),
      validate: () => {
        throw new Error('wrong continuation');
      },
    };
    await expect(measureRuntimeSample(target, {}, { spawn })).rejects.toThrow('wrong continuation');
    await expect(
      measureRuntimeSample(
        {
          ...target,
          validate: undefined,
          postcondition: () => {
            throw new Error('wrong state version');
          },
        },
        {},
        { spawn },
      ),
    ).rejects.toThrow('wrong state version');
    await expect(
      measureRuntimeSample(
        { ...target, validate: undefined },
        {},
        { spawn, profile: 'instrument.cjs' },
      ),
    ).rejects.toThrow('missing Git instrumentation');
  });

  it('restores before each process and validates afterward while recording bytes and Git separately', async () => {
    const events: string[] = [];
    const stdout = '{"name":"中文"}';
    const spawn = vi.fn(() => {
      events.push('process');
      return {
        status: 0,
        signal: null,
        stdout,
        stderr: 'COMET_BENCHMARK_PROFILE=[{"milliseconds":7}]\n',
      };
    });
    const result = await measureRuntimeSample(
      {
        name: 'native-next',
        cwd: os.tmpdir(),
        args: ['runtime.mjs'],
        prepare: async () => {
          events.push('restore');
        },
        validate: () => {
          events.push('json');
        },
        postcondition: async () => {
          events.push('state');
        },
      },
      { HOME: 'isolated' },
      { spawn, profile: 'instrument.cjs', timeout: 123 },
    );
    expect(events).toEqual(['restore', 'process', 'json', 'state']);
    expect(result).toMatchObject({
      exitCode: 0,
      stdoutBytes: Buffer.byteLength(stdout),
      git: [{ milliseconds: 7 }],
    });
    expect(result.milliseconds).toBeGreaterThanOrEqual(0);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ['--require', 'instrument.cjs', 'runtime.mjs'],
      expect.objectContaining({ cwd: os.tmpdir(), env: { HOME: 'isolated' }, timeout: 123 }),
    );
  });

  it('never overwrites a baseline with failed, incomplete, or over-budget measurements', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-benchmark-evidence-'));
    temporary.push(root);
    const file = path.join(root, 'baseline.json');
    await fs.writeFile(file, 'original');
    const valid = {
      schema: 'comet.runtime-benchmark.v2',
      complete: true,
      gitBudgetsEnforced: true,
      results: { sample: { gitBudgetMet: true, samples: [{ exitCode: 0, milliseconds: 5 }] } },
    };
    for (const report of [
      { ...valid, complete: false },
      { ...valid, results: {} },
      {
        ...valid,
        results: { sample: { gitBudgetMet: true, samples: [{ exitCode: 1, milliseconds: 5 }] } },
      },
      {
        ...valid,
        results: {
          sample: { gitBudgetMet: true, samples: [{ exitCode: 0, milliseconds: Number.NaN }] },
        },
      },
      {
        ...valid,
        results: { sample: { gitBudgetMet: false, samples: [{ exitCode: 0, milliseconds: 5 }] } },
      },
    ]) {
      await expect(writeRuntimeBaseline(file, report)).rejects.toThrow('Refusing to record');
      expect(await fs.readFile(file, 'utf8')).toBe('original');
    }
    const before = { ...valid, gitBudgetsEnforced: false };
    await expect(writeRuntimeBaseline(file, before)).rejects.toThrow('without passing Git budgets');
    await writeRuntimeReport(file, before);
    expect(JSON.parse(await fs.readFile(file, 'utf8')).gitBudgetsEnforced).toBe(false);
    await writeRuntimeBaseline(file, valid);
    expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual(valid);
  });
});
