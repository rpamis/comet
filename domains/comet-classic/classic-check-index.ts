import { promises as fs } from 'node:fs';
import { readTrajectory } from '../engine/run-store.js';
import type { TrajectoryEvent } from '../engine/types.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';

interface CheckIndex {
  maximumSequence: number;
  events: TrajectoryEvent[];
}

// Never deserialize a disk index as evidence. Only this process's protected reads
// populate the cache; replacements, truncations and in-place edits rebuild it.
const indexes = new Map<string, { stamp: string; index: CheckIndex }>();
const MAX_INDEXES = 16;

async function identity(changeDir: string, ref: string) {
  const target = await inspectProtectedProjectPath(changeDir, ref, {
    label: 'Classic check trajectory',
    expected: 'file',
  });
  if (!target.exists) return { target: target.target, stamp: 'missing', cacheable: false };
  const stat = await fs.lstat(target.target, { bigint: true });
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Classic check trajectory changed');
  if (stat.size > 8n * 1024n * 1024n)
    throw new Error('Classic check trajectory exceeds size limit');
  return {
    target: target.target,
    cacheable: stat.ino !== 0n && stat.ctimeNs > 0n,
    stamp: [stat.dev, stat.ino, stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs, stat.size].join(':'),
  };
}

export async function readCheckIndex(changeDir: string, ref: string): Promise<CheckIndex> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await identity(changeDir, ref);
    const cached = indexes.get(before.target);
    let index: CheckIndex;
    if (before.cacheable && cached?.stamp === before.stamp) index = cached.index;
    else {
      const events = await readTrajectory(changeDir, ref);
      if (
        events.some(
          (event) =>
            !event ||
            typeof event.type !== 'string' ||
            !Number.isSafeInteger(event.sequence) ||
            event.sequence < 0,
        )
      )
        throw new Error('Invalid Trajectory event in Classic check index');
      index = {
        maximumSequence: events.reduce((maximum, event) => Math.max(maximum, event.sequence), 0),
        events: events.filter((event) => event.type.startsWith('command_check')),
      };
    }
    const after = await identity(changeDir, ref);
    if (before.stamp !== after.stamp) {
      indexes.delete(before.target);
      continue;
    }
    indexes.delete(before.target);
    if (indexes.size >= MAX_INDEXES) indexes.delete(indexes.keys().next().value!);
    indexes.set(before.target, { stamp: before.stamp, index });
    return structuredClone(index);
  }
  throw new Error('Classic check trajectory changed during index read');
}
