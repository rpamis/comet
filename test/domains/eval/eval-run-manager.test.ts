import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  startEvalRun,
  requestStopEvalRun,
  repairManagedEvalRun,
  reconcileEvalRun,
} from '../../../domains/eval/eval-run-manager.js';
const launch = vi.fn(async () => ({ pid: process.pid }));
vi.mock('../../../platform/process/eval-worker.js', () => ({
  launchEvalWorker: (...args: unknown[]) => launch(...args),
}));
vi.mock('../../../domains/eval/eval-run-preview.js', () => ({
  previewEvalRun: vi.fn(async (_project: string, config: unknown) => ({
    config,
    target: { id: 'skill', contentHash: 'content', type: 'skill' },
    confirmationHash: 'preview',
    taskSource: 'pending-generation',
    blockedReasons: [],
  })),
}));
describe('Eval run launch ownership', () => {
  let project: string;
  const request = {
    config: { target: 'skill', targetType: 'skill', agent: 'codex', model: 'model-a' },
    confirmationHash: 'preview',
    requestId: 'one-click',
  };
  beforeEach(async () => {
    launch.mockClear();
    project = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-manager-'));
  });
  afterEach(async () => {
    await fs.rm(project, { recursive: true, force: true });
  });
  it('diagnoses corrupt records and requires hash-bound explicit stopped confirmation before retaining evidence', async () => {
    const root = path.join(project, '.comet/eval/runs/old');
    await fs.mkdir(root, { recursive: true });
    const file = path.join(root, 'dashboard-run.json');
    const bytes = Buffer.from('{broken');
    await fs.writeFile(file, bytes);
    await expect(startEvalRun(project, request)).rejects.toThrow(
      /old.*dashboard-run.json.*sha256:/,
    );
    expect(launch).not.toHaveBeenCalled();
    expect((await reconcileEvalRun(project, 'old')).diagnostics.join(' ')).toContain(
      'repair-managed-record',
    );
    const hash = createHash('sha256').update(bytes).digest('hex');
    await expect(repairManagedEvalRun(project, 'old', hash, false)).rejects.toThrow('停止');
    await expect(repairManagedEvalRun(project, 'old', 'a'.repeat(64), true)).rejects.toThrow(
      '已变化',
    );
    expect(await fs.readFile(file)).toEqual(bytes);
    const repaired = await repairManagedEvalRun(project, 'old', hash, true);
    expect(await fs.readFile(path.join(root, repaired.retained))).toEqual(bytes);
    expect(await repairManagedEvalRun(project, 'old', hash, true)).toEqual(repaired);
    expect((await reconcileEvalRun(project, 'old')).diagnostics.join(' ')).toContain('隔离');
    await startEvalRun(project, request);
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it('resumes after retaining evidence but before removing the corrupt entry', async () => {
    const root = path.join(project, '.comet/eval/runs/crash');
    await fs.mkdir(root, { recursive: true });
    const file = path.join(root, 'dashboard-run.json');
    const bytes = Buffer.from('{broken');
    const hash = createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(file, bytes);
    const unlink = fs.unlink;
    const spy = vi.spyOn(fs, 'unlink').mockImplementation(async (name) => {
      if (String(name) === file) throw new Error('injected crash before isolation');
      return unlink(name);
    });
    try {
      await expect(repairManagedEvalRun(project, 'crash', hash, true)).rejects.toThrow(
        'injected crash',
      );
    } finally {
      spy.mockRestore();
    }
    expect(await fs.readFile(file)).toEqual(bytes);
    const result = await repairManagedEvalRun(project, 'crash', hash, true);
    expect(await fs.readFile(path.join(root, result.retained))).toEqual(bytes);
    expect((await reconcileEvalRun(project, 'crash')).executionStatus).toBe('unknown');
  });
  it('deduplicates concurrent launches with the same request identity', async () => {
    const [a, b] = await Promise.all([
      startEvalRun(project, request),
      startEvalRun(project, request),
    ]);
    expect(a.id).toBe(b.id);
    expect(launch).toHaveBeenCalledTimes(1);
  });
  it('rejects changed preview identity before launching a process', async () => {
    await expect(startEvalRun(project, { ...request, confirmationHash: 'stale' })).rejects.toThrow(
      /变化|重新/,
    );
    expect(launch).not.toHaveBeenCalled();
  });
  it('records a stop request instead of claiming the worker has already stopped', async () => {
    const run = await startEvalRun(project, request);
    const stopping = await requestStopEvalRun(project, run.id);
    expect(stopping.executionStatus).toBe('stopping');
    const marker = JSON.parse(
      await fs.readFile(
        path.join(project, '.comet/eval/runs', run.id, 'stop-request.json'),
        'utf8',
      ),
    );
    expect(marker.runId).toBe(run.id);
  });
});
