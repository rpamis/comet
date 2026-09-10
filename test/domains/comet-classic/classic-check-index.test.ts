import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as store from '../../../domains/engine/run-store.js';
import { readCheckIndex } from '../../../domains/comet-classic/classic-check-index.js';

let root: string;
const ref = '.comet/trajectory.jsonl';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-index-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
});
const append = (sequence: number) =>
  store.appendTrajectory(root, ref, {
    sequence,
    timestamp: '',
    runId: 'run',
    type: 'command_check_started',
    data: { scope: 'verify' },
  });
it('reuses an unchanged protected trajectory and rebuilds after external writes', async () => {
  await append(1);
  const read = vi.spyOn(store, 'readTrajectory');
  expect((await readCheckIndex(root, ref)).maximumSequence).toBe(1);
  expect((await readCheckIndex(root, ref)).maximumSequence).toBe(1);
  expect(read).toHaveBeenCalledTimes(1);
  await append(2);
  expect((await readCheckIndex(root, ref)).maximumSequence).toBe(2);
  expect(read).toHaveBeenCalledTimes(2);
});
it('does not trust forged disk indexes, mutable returned values or damaged logs', async () => {
  await append(1);
  await fs.writeFile(path.join(root, '.comet/check-index.json'), '{"maximumSequence":999}');
  const index = await readCheckIndex(root, ref);
  index.maximumSequence = 999;
  index.events.length = 0;
  expect((await readCheckIndex(root, ref)).maximumSequence).toBe(1);
  await fs.writeFile(path.join(root, ref), 'corrupt\n');
  await expect(readCheckIndex(root, ref)).rejects.toThrow(/Trajectory/i);
});
it('rejects paths outside the change directory', async () => {
  await expect(readCheckIndex(root, '../trajectory.jsonl')).rejects.toThrow();
});

it('rejects a junction ancestor instead of reusing cached success', async () => {
  await append(1);
  await readCheckIndex(root, ref);
  const original = path.join(root, '.comet');
  const moved = path.join(root, 'moved');
  await fs.rename(original, moved);
  await fs.symlink(moved, original, 'junction');
  await expect(readCheckIndex(root, ref)).rejects.toThrow(/symbolic|junction/i);
});

it('rebuilds a replaced trajectory even when length and mtime are preserved', async () => {
  await append(1);
  await readCheckIndex(root, ref);
  const file = path.join(root, ref);
  const stat = await fs.stat(file);
  const raw = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, raw.replace('"sequence":1', '"sequence":2'));
  await fs.utimes(file, stat.atime, stat.mtime);
  expect((await readCheckIndex(root, ref)).maximumSequence).toBe(2);
});
