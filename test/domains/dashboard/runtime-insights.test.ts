import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectRuntimeInsights } from '../../../domains/dashboard/runtime-insights.js';
import {
  createCometDaemonServer,
  resolveCometDaemonEndpoint,
  sendCometDaemonRequest,
} from '../../../platform/process/comet-daemon.js';
import { applicationObservationFixture } from '../../helpers/dashboard-application-fixture.js';

describe('Runtime health and SDK execution insights', () => {
  let directory: string;
  let project: string;
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-insights-'));
    project = path.join(directory, 'project');
    await fs.mkdir(project);
    vi.stubEnv('COMET_DATA_DIR', path.join(directory, 'data'));
    vi.stubEnv('COMET_DAEMON_BUILD_ID', 'insights-test');
    vi.spyOn(os, 'homedir').mockReturnValue(path.join(directory, 'home'));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(directory, { recursive: true, force: true });
  });
  it('keeps absent Runtime and empty SDK samples unknown without creating workspace data', async () => {
    const data = await collectRuntimeInsights(project);
    expect(data.health.state).toBe('idle');
    expect(data.quality).toMatchObject({
      sampledRuns: 0,
      firstPassRate: null,
      succeededActions: 0,
      unreadableRuns: 0,
    });
    expect(await fs.readdir(directory)).toEqual(['project']);
  });
  it('observes actual daemon memory and workload without adding requests or leaking its endpoint', async () => {
    const endpoint = resolveCometDaemonEndpoint(project, 'insights-test');
    const server = await createCometDaemonServer({
      endpoint,
      buildId: 'insights-test',
      projectRoot: project,
      handler: async () => ({ exitCode: 0 }),
    });
    try {
      await sendCometDaemonRequest({
        endpoint,
        buildId: 'insights-test',
        projectRoot: project,
        runtime: 'native',
        argv: ['status'],
      });
      const data = await collectRuntimeInsights(project);
      expect(data.health).toMatchObject({ state: 'running', requestCount: 1, activeRequests: 0 });
      expect(data.health.memoryRssBytes).toBeGreaterThan(0);
      expect(server.status().requestCount).toBe(1);
      expect(JSON.stringify(data.health)).not.toContain(endpoint.endpoint);
    } finally {
      await server.close();
    }
  });
  it('counts completed first attempts separately from waiting work without advancing or exposing SDK records', async () => {
    const fixture = await applicationObservationFixture(project, {
      parallel: true,
      claimParallel: false,
    });
    const before = await fixture.outer.read(fixture.run.runId);
    const data = await collectRuntimeInsights(project);
    expect(data.quality).toMatchObject({
      available: true,
      sampledRuns: 1,
      succeededActions: 1,
      terminalActions: 1,
      firstPassSucceeded: 1,
      firstPassRate: 1,
      retries: 0,
      activeActions: 2,
      waitingDecisions: 1,
    });
    expect(await fixture.outer.read(fixture.run.runId)).toEqual(before);
    expect(JSON.stringify(data)).not.toContain('private-fixture');
  });
  it('does not count a successful retry as a first-attempt success', async () => {
    const fixture = await applicationObservationFixture(project);
    let run = fixture.run;
    const action = run.actions[0];
    const claim = (current: typeof run) =>
      fixture.runtime.claim({
        runId: current.runId,
        expectedRevision: current.revision,
        actionId: action.id,
        attempt: current.actions[0].attempt,
        inputHash: action.inputHash,
        executorId: 'fixture-host',
        claimToken: 'retry-claim',
        capabilities: [],
      });
    run = await claim(run);
    run = await fixture.runtime.recordOutcome({
      runId: run.runId,
      expectedRevision: run.revision,
      outcome: {
        actionId: action.id,
        attempt: 1,
        inputHash: action.inputHash,
        claimToken: 'retry-claim',
        outcomeId: 'failure',
        status: 'failed',
        output: null,
      },
    });
    expect((await collectRuntimeInsights(project)).quality).toMatchObject({
      terminalActions: 1,
      firstPassRate: 0,
      succeededActions: 0,
    });
    run = await fixture.runtime.retry({
      runId: run.runId,
      expectedRevision: run.revision,
      actionId: action.id,
      attempt: 1,
      reconciliation: { resolution: 'not-executed', evidence: 'Host confirmed no side effect' },
    });
    run = await claim(run);
    await fixture.runtime.recordOutcome({
      runId: run.runId,
      expectedRevision: run.revision,
      outcome: {
        actionId: action.id,
        attempt: 2,
        inputHash: action.inputHash,
        claimToken: 'retry-claim',
        outcomeId: 'success',
        status: 'succeeded',
        output: { scope: 'retry' },
      },
    });
    expect((await collectRuntimeInsights(project)).quality).toMatchObject({
      terminalActions: 1,
      succeededActions: 1,
      firstPassRate: 0,
      retries: 1,
    });
  });
});
