import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectRuntimePerformance } from '../../../domains/dashboard/runtime-performance.js';
import {
  recordRuntimePerformance,
  readRuntimePerformanceRecords,
} from '../../../platform/process/runtime-performance.js';
import { runNativeCliDetailed } from '../../../domains/comet-native/native-cli.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { createClassicCommandRunner } from '../../../domains/comet-classic/classic-script-entry.js';
import { startDashboardServer } from '../../../domains/dashboard/server.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

describe('Dashboard Runtime performance', () => {
  let directory: string;
  let project: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-runtime-view-'));
    project = path.join(directory, 'project');
    await fs.mkdir(project);
    vi.stubEnv('COMET_DATA_DIR', path.join(directory, 'data'));
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(directory, 'home'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });
  it('computes real quantiles, keeps checks separate, and filters workflows', async () => {
    expect((await collectRuntimePerformance(project)).commands.p95Ms).toBeNull();
    for (const [index, durationMs] of [10, 20, 30, 100].entries())
      await recordRuntimePerformance(project, {
        workflow: index === 3 ? 'classic' : 'native',
        kind: 'command',
        command: 'status',
        durationMs,
        exitCode: index === 3 ? 1 : 0,
        gitCommands: 1,
        gitDurationMs: 5,
        occurredAt: new Date().toISOString(),
      });
    await recordRuntimePerformance(project, {
      workflow: 'native',
      kind: 'check',
      command: 'check',
      durationMs: 2000,
      exitCode: 1,
      gitCommands: 0,
      gitDurationMs: 0,
      occurredAt: new Date().toISOString(),
    });
    const overview = await collectRuntimePerformance(project);
    expect(overview.commands).toMatchObject({
      count: 4,
      p50Ms: 20,
      p95Ms: 100,
      failureRate: 0.25,
      gitCommands: 4,
      gitDurationMs: 20,
    });
    expect(overview.checks).toMatchObject({ count: 1, p95Ms: 2000, failureRate: 1 });
    const native = await collectRuntimePerformance(project, 'native');
    expect(native.commands).toMatchObject({ count: 3, p95Ms: 30, failureRate: 0 });
    expect(native.recent.every((row) => row.workflow === 'native')).toBe(true);
  });
  it('records Native, Classic and standalone bundles at their common execution boundaries', async () => {
    await writeProjectConfig(project, defaultProjectConfig());
    await runNativeCliDetailed(['root', 'show', '--project-root', project], {
      invocationCwd: project,
    });
    const options = { projectRoot: project, invocationCwd: project };
    await runClassicCli(['root'], { root: async () => ({ exitCode: 0 }) }, options);
    await createClassicCommandRunner('state', async () => ({ exitCode: 70 }))(
      ['state', 'current'],
      options,
    );
    const rows = (await readRuntimePerformanceRecords(project)).records;
    expect(rows.map((row) => [row.workflow, row.command, row.exitCode])).toEqual(
      expect.arrayContaining([
        ['native', 'root', 0],
        ['classic', 'root', 0],
        ['classic', 'state', 70],
      ]),
    );
    await runClassicCli(['state', '--help'], {}, options);
    expect((await readRuntimePerformanceRecords(project)).records).toHaveLength(3);
  });
  it('counts fast successes without treating fast failures or missing samples as efficiency', async () => {
    const empty = await collectRuntimePerformance(project);
    expect(empty.commands).toMatchObject({ successRate: null, fastSuccessRate: null });
    for (const [workflow, command, durationMs, exitCode] of [
      ['native', 'status', 50, 0],
      ['native', 'status', 1000, 0],
      ['classic', 'show', 20, 70],
      ['classic', 'show', 1500, 0],
    ] as const)
      await recordRuntimePerformance(project, {
        workflow,
        kind: 'command',
        command,
        durationMs,
        exitCode,
        gitCommands: 1,
        gitDurationMs: 5,
        occurredAt: new Date().toISOString(),
      });
    const result = await collectRuntimePerformance(project);
    expect(result.commands).toMatchObject({
      successes: 3,
      successRate: 0.75,
      fastSuccesses: 2,
      fastSuccessRate: 0.5,
    });
    expect(result.hotspots).toEqual([
      expect.objectContaining({
        workflow: 'classic',
        command: 'show',
        count: 2,
        totalDurationMs: 1520,
        successes: 1,
        p95Ms: 1500,
      }),
      expect.objectContaining({
        workflow: 'native',
        command: 'status',
        count: 2,
        totalDurationMs: 1050,
        successes: 2,
        p95Ms: 1000,
      }),
    ]);
    expect(result.outcomes).toEqual([
      { workflow: 'classic', command: 'show', exitCode: 0, count: 1 },
      { workflow: 'classic', command: 'show', exitCode: 70, count: 1 },
      { workflow: 'native', command: 'status', exitCode: 0, count: 2 },
    ]);
    const native = await collectRuntimePerformance(project, 'native');
    expect(native.hotspots).toHaveLength(1);
    expect(native.commands.fastSuccessRate).toBe(1);
  });
  it('serves project-scoped read-only data and rejects invalid filters', async () => {
    const server = await startDashboardServer({ projectPath: project, port: 0 });
    try {
      const base = `http://127.0.0.1:${server.port}`;
      const projects = await (await fetch(base + '/api/dashboard/projects')).json();
      const url =
        base + '/api/dashboard/projects/' + projects.currentProjectId + '/runtime-performance';
      expect((await (await fetch(url)).json()).commands.count).toBe(0);
      const insightsUrl = url.replace('/runtime-performance', '/runtime-insights');
      expect((await (await fetch(insightsUrl)).json()).quality.sampledRuns).toBe(0);
      expect((await fetch(url + '?workflow=unknown')).status).toBe(400);
      expect((await fetch(url + '?from=bad&to=2026-10-17T12:00:00Z')).status).toBe(400);
      expect(
        (
          await fetch(url, {
            method: 'POST',
            headers: { Origin: base, 'Content-Type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(405);
      expect(await fs.readdir(directory)).not.toContain('data');
    } finally {
      await server.close();
    }
  });
  it('filters before calculating command, check, workflow and hotspot summaries', async () => {
    const now = Date.now();
    for (const [workflow, age, exitCode] of [
      ['native', 1000, 0],
      ['classic', 7200000, 1],
    ] as const)
      await recordRuntimePerformance(project, {
        workflow,
        kind: 'command',
        command: 'status',
        durationMs: 20,
        exitCode,
        occurredAt: new Date(now - age).toISOString(),
        gitCommands: 0,
        gitDurationMs: 0,
      });
    const result = await collectRuntimePerformance(project, 'all', {
      from: new Date(now - 3600000).toISOString(),
      to: new Date(now).toISOString(),
    });
    expect(result.commands).toMatchObject({ count: 1, successRate: 1 });
    expect(result.workflows.map((row) => row.count)).toEqual([1, 0]);
    expect(result.hotspots).toHaveLength(1);
    expect(result.slowest).toHaveLength(1);
  });
});
