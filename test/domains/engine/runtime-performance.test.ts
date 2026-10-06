import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import {
  createFileRuntimeStore,
  createMemoryRuntimeStore,
} from '../../../domains/engine/runtime-store.js';
import type { DefineWorkflowOptions } from '../../../domains/engine/workflow-definition.js';
import { parseWorkflowRun } from '../../../domains/engine/workflow-run-validation.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

const workflow: DefineWorkflowOptions = {
  id: 'history-budget',
  version: '1',
  entry: 'work',
  steps: { work: { type: 'call_tool', ref: 'work' } },
  commands: { replace: 'work' },
};

describe('Runtime work budgets', () => {
  it('reads a childless no-op next once without committing a new revision', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const runtime = createRuntime({ store, workflows: [workflow] });
    const started = await runtime.start({ runId: 'read-budget', workflow, input: null });
    const read = vi.spyOn(store, 'read');
    const write = vi.spyOn(store, 'compareAndSwap');
    expect(await runtime.next({ runId: started.runId })).toEqual(started);
    expect(read).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it('returns the validated next snapshot when a concurrent caller commits after its read', async () => {
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const other = createRuntime({ store, workflows: [workflow] });
    const started = await other.start({ runId: 'read-race', workflow, input: null });
    const runtime = createRuntime({
      workflows: [workflow],
      store: {
        async read(runId) {
          const snapshot = await store.read(runId);
          await other.cancel({ runId, reason: 'Concurrent cancellation' });
          return snapshot;
        },
        compareAndSwap: store.compareAndSwap,
      },
    });
    const returned = await runtime.next({ runId: started.runId });
    expect(returned).toEqual(started);
    expect(parseWorkflowRun(returned)).toEqual(returned);
    expect((await other.inspect(started.runId)).status).toBe('cancelled');
  });

  it('scans a legitimate long history once without sorting or rereading old snapshots', async () => {
    const root = await fs.realpath(
      await fs.mkdtemp(path.join(os.tmpdir(), 'comet-history-budget-')),
    );
    try {
      const store = createFileRuntimeStore<WorkflowRun>({ rootDir: root });
      const runtime = createRuntime({ store, workflows: [workflow] });
      let run = await runtime.start({ runId: 'long-run', workflow, input: null });
      for (let index = 0; index < 64; index += 1) {
        run = await runtime.dispatchCommand({
          runId: run.runId,
          expectedRevision: run.revision,
          commandId: `replace-${index}`,
          name: 'replace',
          input: { index },
        });
      }
      const runDir = path.join(root, (await fs.readdir(root))[0]);
      await fs.writeFile(path.join(runDir, '.abandoned.tmp'), 'partial');
      const originalReaddir = fs.readdir.bind(fs);
      const readdir = vi.spyOn(fs, 'readdir').mockImplementationOnce(async (...args) => {
        const entries = await originalReaddir(...args);
        return entries.reverse();
      });
      const open = vi.spyOn(fs, 'open');
      const compare = vi.spyOn(String.prototype, 'localeCompare');
      try {
        expect(await runtime.inspect(run.runId)).toEqual(run);
        expect(readdir).toHaveBeenCalledTimes(1);
        expect(compare).not.toHaveBeenCalled();
        const records = open.mock.calls.filter(([file]) => String(file).endsWith('.json'));
        expect(records).toHaveLength(1);
        expect(String(records[0][0])).toBe(path.join(runDir, '0000000000000065.json'));
      } finally {
        readdir.mockRestore();
        open.mockRestore();
        compare.mockRestore();
      }

      const find = Array.prototype.find;
      const some = Array.prototype.some;
      let actionVisits = 0;
      function count(value: unknown): void {
        if (value && typeof value === 'object' && 'runId' in value && value.runId === run.runId) {
          actionVisits += 1;
        }
      }
      const findSpy = vi
        .spyOn(Array.prototype, 'find')
        .mockImplementation(function (predicate, thisArg) {
          return find.call(this, (value, index, array) => {
            count(value);
            return predicate.call(thisArg, value, index, array);
          });
        });
      const someSpy = vi
        .spyOn(Array.prototype, 'some')
        .mockImplementation(function (predicate, thisArg) {
          return some.call(this, (value, index, array) => {
            count(value);
            return predicate.call(thisArg, value, index, array);
          });
        });
      try {
        await runtime.inspect(run.runId);
      } finally {
        findSpy.mockRestore();
        someSpy.mockRestore();
      }
      expect(actionVisits).toBeLessThanOrEqual(run.actions.length * 2);

      const invalid = structuredClone(run);
      invalid.actions[1] = structuredClone(invalid.actions[0]);
      expect(() => parseWorkflowRun(invalid)).toThrow(/INVALID_RUN/u);
      invalid.actions = run.actions;
      invalid.commands![0].actionId = 'missing-action';
      expect(() => parseWorkflowRun(invalid)).toThrow(/INVALID_RUN/u);
      await fs.unlink(path.join(runDir, '0000000000000032.json'));
      await expect(store.read(run.runId)).rejects.toThrow(/STORE_MISSING_REVISION.*32/u);
      await expect(
        store.compareAndSwap(run.runId, run.revision, { ...run, revision: run.revision + 1 }),
      ).rejects.toThrow(/STORE_MISSING_REVISION.*32/u);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
