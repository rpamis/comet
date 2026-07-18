import { promises as fs } from 'fs';
import path from 'path';
import type { ClassicState } from './classic-state.js';
import type { ClassicTransitionEffect, ClassicTransitionEvent } from './classic-transitions.js';

export type ClassicStateEventSource = 'comet-state' | 'comet-guard' | 'comet-archive';

export interface ClassicStateEventInput {
  change: string;
  event: ClassicTransitionEvent | 'rebind';
  source: ClassicStateEventSource;
  from: ClassicState;
  to: ClassicState;
  effects: ClassicTransitionEffect[];
}

export interface ClassicStateEventRecord extends ClassicStateEventInput {
  schemaVersion: 1;
  timestamp: string;
}

export const CLASSIC_STATE_EVENT_LOG = path.join('.comet', 'state-events.jsonl');

export async function appendClassicStateEvent(
  changeDir: string,
  input: ClassicStateEventInput,
): Promise<ClassicStateEventRecord> {
  const record: ClassicStateEventRecord = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ...input,
  };
  const file = path.join(changeDir, CLASSIC_STATE_EVENT_LOG);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}
