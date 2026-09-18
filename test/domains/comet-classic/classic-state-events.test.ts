import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  appendClassicStateEvent,
  CLASSIC_STATE_EVENT_LOG,
} from '../../../domains/comet-classic/classic-state-events.js';
import type { ClassicState } from '../../../domains/comet-classic/classic-state.js';

function state(phase: ClassicState['phase']): ClassicState {
  return {
    workflow: 'full',
    language: 'zh-CN',
    phase,
    contextCompression: 'beta',
    buildMode: 'executing-plans',
    buildPause: null,
    subagentDispatch: 'confirmed',
    tddMode: 'tdd',
    reviewMode: null,
    isolation: 'current',
    boundBranch: null,
    verifyMode: 'full',
    autoTransition: false,
    baseRef: null,
    designDoc: null,
    plan: null,
    verifyResult: null,
    verifyFailures: 0,
    verificationReport: null,
    branchStatus: null,
    createdAt: '2026-09-18',
    verifiedAt: null,
    archiveConfirmation: null,
    archived: false,
    archivedAt: null,
  };
}

describe('Classic state event log', () => {
  let changeDir: string;

  beforeEach(async () => {
    changeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-state-events-'));
  });

  afterEach(async () => {
    await fs.rm(changeDir, { recursive: true, force: true });
  });

  it('keeps appending when the log grows past the former 8 MiB byte cap', async () => {
    const logFile = path.join(changeDir, CLASSIC_STATE_EVENT_LOG);
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    await fs.writeFile(logFile, '\n'.repeat(8 * 1024 * 1024 + 1));

    const record = await appendClassicStateEvent(changeDir, {
      change: 'demo',
      event: 'build-complete',
      source: 'comet-state',
      from: state('build'),
      to: state('verify'),
      effects: [{ field: 'phase', from: 'build', to: 'verify' }],
    });

    expect(record.event).toBe('build-complete');
    const after = await fs.readFile(logFile, 'utf8');
    expect(after.endsWith(`${JSON.stringify(record)}\n`)).toBe(true);
  });
});
