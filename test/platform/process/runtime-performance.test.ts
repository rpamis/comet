import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  observeRuntimeOperation,
  readRuntimePerformanceRecords,
  recordRuntimePerformance,
} from '../../../platform/process/runtime-performance.js';
import {
  recordCometGitCommand,
  withCometRuntimeMetrics,
} from '../../../platform/process/runtime-metrics.js';

describe('persistent Runtime performance', () => {
  let directory: string;
  let project: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-performance-'));
    project = path.join(directory, 'project');
    await fs.mkdir(project);
    vi.stubEnv('COMET_DATA_DIR', path.join(directory, 'data'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });
  it('keeps reads empty and read-only until an actual operation is recorded', async () => {
    expect((await readRuntimePerformanceRecords(project)).records).toEqual([]);
    expect(await fs.readdir(directory)).toEqual(['project']);
  });
  it('preserves outputs, records failures, and retains outer Git attribution', async () => {
    const output = { exitCode: 0, stdout: 'secret output' };
    const observed = await withCometRuntimeMetrics(() =>
      observeRuntimeOperation(
        {
          projectRoot: () => project,
          workflow: 'native',
          command: 'status',
        },
        async () => {
          recordCometGitCommand(12);
          return output;
        },
      ),
    );
    expect(observed.result).toBe(output);
    expect(observed.metrics).toEqual({ gitCommands: 1, gitDurationMs: 12 });
    const failure = new Error('secret exception');
    await expect(
      observeRuntimeOperation(
        { projectRoot: () => project, workflow: 'classic', command: 'check' },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    const { records } = await readRuntimePerformanceRecords(project);
    expect(records).toHaveLength(2);
    expect(records.find((row) => row.workflow === 'native')).toMatchObject({
      command: 'status',
      exitCode: 0,
      gitCommands: 1,
      gitDurationMs: 12,
    });
    expect(records.find((row) => row.workflow === 'classic')).toMatchObject({ exitCode: 1 });
    expect(JSON.stringify(records)).not.toContain('secret');
  });
  it('isolates projects, concurrent workflows and command/check records', async () => {
    const second = path.join(directory, 'second');
    await fs.mkdir(second);
    await Promise.all(
      ['native', 'classic'].map((workflow) =>
        observeRuntimeOperation(
          {
            projectRoot: () => project,
            workflow: workflow as 'native' | 'classic',
            command: 'check',
            kind: 'check',
          },
          async () => {
            recordCometGitCommand(workflow === 'native' ? 7 : 19);
            return { exitCode: 0 };
          },
        ),
      ),
    );
    const rows = (await readRuntimePerformanceRecords(project)).records;
    expect(rows.map((row) => row.gitDurationMs).sort((a, b) => a - b)).toEqual([7, 19]);
    expect(rows.every((row) => row.kind === 'check')).toBe(true);
    expect((await readRuntimePerformanceRecords(second)).records).toEqual([]);
  });
  it('excludes expired records and bounds the returned sample', async () => {
    for (const days of [9, 2, 1, 0])
      await recordRuntimePerformance(project, {
        workflow: 'native',
        kind: 'command',
        command: 'next',
        exitCode: 0,
        durationMs: 0,
        occurredAt: new Date(Date.now() - days * 86400000).toISOString(),
        gitCommands: 0,
        gitDurationMs: 0,
      });
    const sample = await readRuntimePerformanceRecords(project, 2);
    expect(sample.records).toHaveLength(2);
    expect(sample.truncated).toBe(true);
    expect(sample.records.every((row) => row.durationMs === 0)).toBe(true);
  });
  it('never changes an operation result when storage is unavailable', async () => {
    vi.stubEnv('COMET_DATA_DIR', project);
    expect(
      await observeRuntimeOperation(
        { projectRoot: () => project, workflow: 'classic', command: 'state' },
        async () => ({ exitCode: 70 }),
      ),
    ).toEqual({ exitCode: 70 });
    await expect(readRuntimePerformanceRecords(project)).rejects.toThrow();
  });
});
