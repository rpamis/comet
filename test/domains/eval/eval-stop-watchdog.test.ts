import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {
  readManagedEvalRun,
  requestStopEvalRun,
  reconcileEvalRun,
} from '../../../domains/eval/eval-run-manager.js';
import {
  registerEvalContainerOwnership,
  writeEvalExecutionState,
} from '../../../domains/eval/eval-run-cleanup.js';
import { evalRunPath, writeEvalJson, readEvalJson } from '../../../domains/eval/eval-run-store.js';
import {
  inspectProcessTreeLiveness,
  readProcessIdentity,
} from '../../../platform/process/process-identity.js';

const docker = vi.fn(async () => '');
vi.mock('../../../platform/process/external-command.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../platform/process/external-command.js')>();
  return {
    ...actual,
    runExternalCommandAsync: (command: string, args: readonly string[], options: never) =>
      command === 'docker' ? docker() : actual.runExternalCommandAsync(command, args, options),
  };
});

const projects: string[] = [];
const children: ChildProcess[] = [];
afterEach(async () => {
  docker.mockReset().mockResolvedValue('');
  for (const child of children.splice(0)) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    try {
      process.kill(-child.pid!, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
    await closed;
  }
  for (const project of projects.splice(0)) await fs.rm(project, { recursive: true, force: true });
});

async function processFixture() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  children.push(child);
  await new Promise<void>((resolve) => child.once('spawn', () => resolve()));
  const identity = await readProcessIdentity(child.pid!);
  expect(identity).toBeTruthy();
  return { pid: child.pid!, identity: identity! };
}
async function fixture(
  options: { unknownIdentity?: boolean; expired?: boolean; withChild?: boolean } = {},
) {
  const project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-stop-watchdog-'));
  projects.push(project);
  const owner = await processFixture();
  const child = options.withChild
    ? { ...(await processFixture()), instanceId: 'fixture-child', ownerPid: owner.pid }
    : undefined;
  const registeredOwner = options.unknownIdentity ? { pid: owner.pid } : owner;
  const at = new Date(Date.now() - (options.expired ? 60_000 : 0)).toISOString();
  await writeEvalJson(await evalRunPath(project, 'run', 'dashboard-run.json'), {
    schema: 'comet.eval.managed-run.v1',
    id: 'run',
    origin: 'dashboard',
    status: 'running',
    launchPhase: 'dispatched',
    createdAt: at,
    updatedAt: at,
    config: { targetType: 'skill', target: 'fixture', timeoutSeconds: 30 },
    targetId: 'fixture',
    contentHash: '',
    previewHash: 'fixture',
    owner: registeredOwner,
    child,
  });
  await registerEvalContainerOwnership(project, 'run');
  await writeEvalExecutionState(project, 'run', { status: 'running' });
  return { project, owner, child };
}
async function oldStop(project: string) {
  await writeEvalJson(await evalRunPath(project, 'run', 'stop-request.json'), {
    runId: 'run',
    requestedAt: new Date(Date.now() - 60_000).toISOString(),
  });
}

describe.skipIf(process.platform !== 'linux')('independent Eval stop watchdog', () => {
  it('stops a paused owner and independent child after grace without another read or Stop', async () => {
    const { project, owner, child } = await fixture({ withChild: true });
    process.kill(owner.pid, 'SIGSTOP');
    process.kill(child!.pid, 'SIGSTOP');
    expect((await requestStopEvalRun(project, 'run')).executionStatus).toBe('stopping');
    const marker = await readEvalJson(await evalRunPath(project, 'run', 'stop-request.json'));
    await requestStopEvalRun(project, 'run');
    expect(await readEvalJson(await evalRunPath(project, 'run', 'stop-request.json'))).toEqual(
      marker,
    );
    // Only read the persisted record here: no reconcile/polling drives the supervisor.
    await expect
      .poll(async () => (await readManagedEvalRun(project, 'run'))?.status, { timeout: 12_000 })
      .toBe('stopped');
    expect(await inspectProcessTreeLiveness(owner.pid, owner.identity)).toBe('dead');
    expect(await inspectProcessTreeLiveness(child!.pid, child!.identity)).toBe('dead');
    expect(docker).toHaveBeenCalled();
    expect(
      await readEvalJson(await evalRunPath(project, 'run', 'owner-cleanup.json')),
    ).toMatchObject({ owner, confirmed: true });
    expect(
      await readEvalJson(await evalRunPath(project, 'run', 'process-cleanup.json')),
    ).toMatchObject({ child, confirmed: true });
  });

  it('continues a persisted expired stop on a cold manager import', async () => {
    const { project, owner } = await fixture();
    process.kill(owner.pid, 'SIGSTOP');
    await oldStop(project);
    vi.resetModules();
    const cold = await import('../../../domains/eval/eval-run-manager.js');
    expect((await cold.reconcileEvalRun(project, 'run')).executionStatus).toBe('stopped');
    expect(await inspectProcessTreeLiveness(owner.pid, owner.identity)).toBe('dead');
  });

  it('enforces elapsed execution budget even when the owner never polls', async () => {
    const { project, owner } = await fixture({ expired: true });
    process.kill(owner.pid, 'SIGSTOP');
    expect((await reconcileEvalRun(project, 'run')).executionStatus).toBe('stopping');
    await expect
      .poll(async () => (await readManagedEvalRun(project, 'run'))?.status, { timeout: 12_000 })
      .toBe('interrupted');
    expect(await inspectProcessTreeLiveness(owner.pid, owner.identity)).toBe('dead');
  });

  it('keeps stopping and retries when container cleanup fails after process stop', async () => {
    const { project, owner } = await fixture();
    await oldStop(project);
    docker.mockRejectedValue(new Error('docker unavailable'));
    expect((await reconcileEvalRun(project, 'run')).executionStatus).toBe('stopping');
    expect((await readManagedEvalRun(project, 'run'))?.error).toContain('docker unavailable');
    expect(await inspectProcessTreeLiveness(owner.pid, owner.identity)).toBe('dead');
    docker.mockResolvedValue('');
    // An explicit retry is not delayed by the automatic failure backoff.
    expect((await requestStopEvalRun(project, 'run')).executionStatus).toBe('stopped');
  });

  it('does not terminate an owner with unknown creation identity or pretend it stopped', async () => {
    const { project, owner } = await fixture({ unknownIdentity: true });
    await oldStop(project);
    expect((await reconcileEvalRun(project, 'run')).executionStatus).toBe('stopping');
    expect(await inspectProcessTreeLiveness(owner.pid, owner.identity)).toBe('alive');
    expect(docker).toHaveBeenCalled();
    expect((await readManagedEvalRun(project, 'run'))?.error).toContain('身份');
  });
  it('does not consume a new queued run budget or a fresh worker budget while waiting in queue', async () => {
    const { project, owner } = await fixture({ expired: true });
    const file = await evalRunPath(project, 'run', 'dashboard-run.json');
    const original = await readEvalJson(file);
    await writeEvalJson(file, { ...original, status: 'queued' });
    expect((await reconcileEvalRun(project, 'run')).executionStatus).toBe('queued');
    expect(await readEvalJson(await evalRunPath(project, 'run', 'stop-request.json'))).toBeNull();
    await writeEvalJson(file, { ...original, startedAt: new Date().toISOString() });
    expect((await reconcileEvalRun(project, 'run')).executionStatus).toBe('running');
    expect(await inspectProcessTreeLiveness(owner.pid, owner.identity)).toBe('alive');
    expect(await readEvalJson(await evalRunPath(project, 'run', 'stop-request.json'))).toBeNull();
  });

  it('coalesces concurrent Stop calls and does not retry failed cleanup on every refresh', async () => {
    const { project } = await fixture();
    await oldStop(project);
    docker.mockRejectedValue(new Error('docker unavailable'));
    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => requestStopEvalRun(project, 'run')),
    );
    expect(attempts.every((value) => value.status === 'rejected')).toBe(true);
    expect(docker).toHaveBeenCalledTimes(1);
    for (let index = 0; index < 5; index++)
      expect((await reconcileEvalRun(project, 'run')).executionStatus).toBe('stopping');
    expect(docker).toHaveBeenCalledTimes(1);
    docker.mockResolvedValue('');
    expect((await requestStopEvalRun(project, 'run')).executionStatus).toBe('stopped');
  });
});
