import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import {
  readClassicState,
  writeClassicState,
} from '../../../domains/comet-classic/classic-store.js';
import type { ClassicState } from '../../../domains/comet-classic/classic-state.js';
import type { RunState } from '../../../domains/engine/types.js';

function classicState(): ClassicState {
  return {
    workflow: 'full',
    language: 'zh-CN',
    phase: 'build',
    contextCompression: 'beta',
    buildMode: 'executing-plans',
    buildPause: 'plan-ready',
    subagentDispatch: 'confirmed',
    tddMode: 'tdd',
    reviewMode: null,
    isolation: 'worktree',
    verifyMode: 'full',
    autoTransition: false,
    baseRef: 'abc123',
    designDoc: 'docs/superpowers/specs/design.md',
    plan: 'docs/superpowers/plans/plan.md',
    verifyResult: 'fail',
    verificationReport: 'docs/verification.md',
    branchStatus: 'handled',
    createdAt: '2026-06-01',
    verifiedAt: '2026-06-02',
    archived: false,
    directOverride: true,
    buildCommand: 'pnpm build',
    verifyCommand: 'pnpm test',
    handoffContext: '.comet/handoff/context.json',
    handoffHash: 'b'.repeat(64),
    classicProfile: 'full',
    classicMigration: 1,
  };
}

function runState(): RunState {
  return {
    runId: 'run-classic-1',
    skill: 'comet-classic',
    skillVersion: '1',
    skillHash: 'a'.repeat(64),
    orchestration: 'deterministic',
    currentStep: 'full.build.execute',
    iteration: 3,
    pending: null,
    pendingRef: '.comet/pending-action.json',
    trajectoryRef: '.comet/trajectory.jsonl',
    contextRef: '.comet/context.md',
    artifactsRef: '.comet/artifacts.json',
    checkpointRef: '.comet/checkpoint.json',
    status: 'running',
    retries: { action: 1 },
  };
}

describe('Classic state projection', () => {
  let changeDir: string;
  let stateFile: string;

  beforeEach(async () => {
    changeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-state-'));
    stateFile = path.join(changeDir, '.comet.yaml');
  });

  afterEach(async () => {
    await fs.rm(changeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it('round-trips every Classic field and Run projection', async () => {
    await writeClassicState(changeDir, {
      classic: classicState(),
      run: runState(),
    });

    expect(await readClassicState(changeDir)).toEqual({
      classic: classicState(),
      run: runState(),
      unknownKeys: [],
    });
  });

  it('reads a legacy-only state without inventing a Run', async () => {
    await writeClassicState(changeDir, { classic: classicState(), run: null });

    const projection = await readClassicState(changeDir);

    expect(projection.classic).toEqual(classicState());
    expect(projection.run).toBeNull();
  });

  it('reads a Run-only state without inventing Classic fields', async () => {
    await writeClassicState(changeDir, { classic: null, run: runState() });

    const projection = await readClassicState(changeDir);

    expect(projection.classic).toBeNull();
    expect(projection.run).toEqual(runState());
  });

  it('preserves comments and unknown top-level fields across atomic writes', async () => {
    await fs.writeFile(
      stateFile,
      [
        '# user heading',
        'workflow: full # selected workflow',
        'phase: build',
        'design_doc: null',
        'plan: null',
        'build_mode: direct',
        'isolation: branch',
        'verify_mode: light',
        'verify_result: pending',
        'verified_at: null',
        'archived: false',
        'custom_user_field: keep-me',
        '',
      ].join('\n'),
    );

    const projection = await readClassicState(changeDir);
    expect(projection.unknownKeys).toEqual(['custom_user_field']);
    projection.classic!.phase = 'verify';
    await writeClassicState(changeDir, projection);

    const raw = await fs.readFile(stateFile, 'utf8');
    expect(raw).toContain('# user heading');
    expect(raw).toContain('workflow: full # selected workflow');
    expect(raw).toContain('custom_user_field: keep-me');
    expect(raw).toContain('phase: verify');
  });

  it.each([
    ['workflow', 'ancient'],
    ['phase', 'planning'],
    ['context_compression', 'on'],
    ['build_mode', 'agent'],
    ['build_pause', 'paused'],
    ['subagent_dispatch', 'yes'],
    ['tdd_mode', 'sometimes'],
    ['isolation', 'folder'],
    ['verify_mode', 'medium'],
    ['verify_result', 'maybe'],
    ['branch_status', 'open'],
    ['classic_profile', 'other'],
  ])('rejects invalid %s values', async (field, value) => {
    await writeClassicState(changeDir, { classic: classicState(), run: runState() });
    const raw = await fs.readFile(stateFile, 'utf8');
    await fs.writeFile(
      stateFile,
      raw.replace(new RegExp(`^${field}:.*$`, 'm'), `${field}: ${value}`),
    );

    await expect(readClassicState(changeDir)).rejects.toThrow(`Invalid Classic state: ${field}`);
  });

  it('rejects malformed YAML without replacing the original file', async () => {
    const malformed = 'workflow: [full\nphase: build\n';
    await fs.writeFile(stateFile, malformed);

    await expect(readClassicState(changeDir)).rejects.toThrow('Invalid Classic state document');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(malformed);
  });

  // The engine-persist refactor reads state leniently: an incomplete legacy
  // projection degrades to a null Classic state (so callers can fall back to
  // the legacy summary and migrate) instead of throwing. Strict rejection is
  // enforced by the `validate` command, not the reader.
  it('degrades incomplete legacy projections to a null Classic state', async () => {
    await fs.writeFile(stateFile, 'workflow: full\nphase: build\n');

    const projection = await readClassicState(changeDir);
    expect(projection.classic).toBeNull();
    expect(projection.run).toBeNull();
  });

  it('validates a complete projection before replacing the existing file', async () => {
    await writeClassicState(changeDir, { classic: classicState(), run: runState() });
    const original = await fs.readFile(stateFile, 'utf8');
    const invalid = classicState();
    invalid.handoffHash = 'not-a-hash';

    await expect(
      writeClassicState(changeDir, { classic: invalid, run: runState() }),
    ).rejects.toThrow('Invalid Classic state: handoff_hash');
    expect(await fs.readFile(stateFile, 'utf8')).toBe(original);
  });
});
