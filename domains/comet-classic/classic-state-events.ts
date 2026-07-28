import path from 'path';
import { appendEngineRunText } from '../engine/protected-run-file.js';
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
const CLASSIC_STATE_EVENT_MAX_BYTES = 8 * 1024 * 1024;

export async function appendClassicStateEvent(
  changeDir: string,
  input: ClassicStateEventInput,
): Promise<ClassicStateEventRecord> {
  const record: ClassicStateEventRecord = {
    schemaVersion: 1,
    timestamp: new Date().toISOString(),
    ...input,
  };
  await appendEngineRunText(
    changeDir,
    CLASSIC_STATE_EVENT_LOG,
    `${JSON.stringify(record)}\n`,
    CLASSIC_STATE_EVENT_MAX_BYTES,
    'Classic state event log',
  );
  return record;
}
