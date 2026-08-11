import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import {
  appendNativePortableHistory,
  compareAndSwapNativePortableState,
  createNativePortableState,
  NativePortableStateVersionConflictError,
  parseNativePortableState,
  readNativePortableState,
  writeNativePortableState,
} from '../../../domains/comet-native/native-portable-state.js';
import { toNativePortableText } from '../../../domains/comet-native/native-portable-text.js';
import type {
  NativePortableHistoryEntry,
  NativePortableState,
} from '../../../domains/comet-native/native-portable-types.js';

describe('Native portable state', () => {
  let root: string;
  let file: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-portable-state-'));
    file = path.join(root, 'comet-state.yaml');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('round-trips the v4 portable schema and rejects unknown fields at every level', async () => {
    const state = createNativePortableState({
      name: 'portable-resume',
      language: 'zh-CN',
      createdAt: '2026-08-09T00:00:00.000Z',
      nextAction: '确认验收项',
    });
    await writeNativePortableState(file, state, { containedRoot: root });

    await expect(readNativePortableState(file)).resolves.toEqual(state);
    expect(await fs.readFile(file, 'utf8')).toContain('schema: comet.native.v4');

    expect(() => parseNativePortableState({ ...state, unexpected: true })).toThrow(
      /unknown field.*unexpected/iu,
    );
    expect(() =>
      parseNativePortableState({
        ...state,
        loop: { ...state.loop, hidden_hash: 'not-allowed' },
      }),
    ).toThrow(/unknown field.*hidden_hash/iu);

    await fs.writeFile(file, 'schema: comet.native.v4\nschema: comet.native.v4\n', 'utf8');
    await expect(readNativePortableState(file)).rejects.toThrow(
      /invalid YAML|Map keys must be unique/iu,
    );
  });

  it('uses state_version for an atomic compare-and-swap boundary', async () => {
    const state = createNativePortableState({
      name: 'portable-cas',
      language: 'en',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    await writeNativePortableState(file, state, { containedRoot: root });
    const next: NativePortableState = {
      ...state,
      state_version: 2,
      loop: { ...state.loop, next_action: 'Confirm acceptance' },
    };

    await expect(
      compareAndSwapNativePortableState({
        file,
        expectedStateVersion: 1,
        next,
        containedRoot: root,
      }),
    ).resolves.toEqual(next);
    await expect(readNativePortableState(file)).resolves.toEqual(next);

    const stale = { ...next, state_version: 2, loop: { ...next.loop, next_action: 'stale' } };
    await expect(
      compareAndSwapNativePortableState({
        file,
        expectedStateVersion: 1,
        next: stale,
        containedRoot: root,
      }),
    ).rejects.toBeInstanceOf(NativePortableStateVersionConflictError);
    await expect(readNativePortableState(file)).resolves.toEqual(next);
  });

  it('keeps the parent contract hash optional for existing portable changes', async () => {
    const ordinary = createNativePortableState({
      name: 'ordinary-change',
      language: 'en',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    await writeNativePortableState(file, ordinary, { containedRoot: root });
    await expect(readNativePortableState(file)).resolves.not.toHaveProperty(
      'children_contract_hash',
    );

    const parent = parseNativePortableState({
      ...ordinary,
      children_contract_hash: 'a'.repeat(64),
    });
    await writeNativePortableState(file, parent, { containedRoot: root });
    await expect(readNativePortableState(file)).resolves.toMatchObject({
      children_contract_hash: 'a'.repeat(64),
    });
    expect(() =>
      parseNativePortableState({ ...ordinary, children_contract_hash: 'not-a-hash' }),
    ).toThrow(/children contract hash/iu);
  });

  it('keeps only 50 history entries and folds older facts into a non-decision overflow', () => {
    let state = createNativePortableState({
      name: 'bounded-history',
      language: 'en',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    for (let index = 0; index < 55; index += 1) {
      const entry: NativePortableHistoryEntry = {
        goal_cycle: 1,
        iteration: index + 1,
        attempt: 1,
        outcome: index % 2 === 0 ? 'fail' : 'execution-error',
        unresolved_ids: [],
        summary: toNativePortableText(`iteration ${index + 1}`),
        completed_at: new Date(Date.UTC(2026, 7, 9, 0, index)).toISOString(),
      };
      state = appendNativePortableHistory(state, entry);
    }

    expect(state.history).toHaveLength(50);
    expect(state.history[0].iteration).toBe(6);
    expect(state.history_overflow).toEqual({
      dropped_entries: 5,
      first_dropped_at: '2026-08-09T00:00:00.000Z',
      last_dropped_at: '2026-08-09T00:04:00.000Z',
      outcome_counts: {
        pass: 0,
        fail: 3,
        blocked: 0,
        'execution-error': 2,
        recovery: 0,
      },
    });
    expect(() => parseNativePortableState(state)).not.toThrow();
  });

  it('truncates only diagnostic PortableText without truncating acceptance decision data', () => {
    const diagnostic = '🙂'.repeat(10);
    expect(toNativePortableText(diagnostic, 9)).toEqual({ text: '🙂🙂', truncated: true });

    const state = createNativePortableState({
      name: 'long-acceptance',
      language: 'en',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    const acceptanceText = 'observable requirement '.repeat(10_000);
    const parsed = parseNativePortableState({
      ...state,
      acceptance: [
        {
          id: 'A1',
          source: 'brief.md',
          text: acceptanceText,
          result: 'failed',
          reason: toNativePortableText('diagnostic '.repeat(10_000), 64),
        },
      ],
      loop: { ...state.loop, previous_unresolved_ids: ['A1'] },
    });

    expect(parsed.acceptance[0].id).toBe('A1');
    expect(parsed.acceptance[0].text).toBe(acceptanceText);
    expect(parsed.acceptance[0].reason).toMatchObject({ truncated: true });
    expect(Buffer.byteLength(parsed.acceptance[0].reason!.text, 'utf8')).toBeLessThanOrEqual(64);
  });

  it('parses a complete passing state while enforcing trusted role separation', () => {
    const initial = createNativePortableState({
      name: 'complete-state',
      language: 'en',
      createdAt: '2026-08-09T00:00:00.000Z',
    });
    const state = parseNativePortableState({
      ...initial,
      phase: 'archive',
      state_version: 8,
      spec_changes: [
        { capability: 'native-loop', operation: 'modify', source: 'specs/native-loop/spec.md' },
      ],
      workspace: {
        isolation: 'worktree',
        change_branch: 'beta17',
        target_branch: 'beta17',
        finish: 'push',
      },
      loop: {
        ...initial.loop,
        stage: 'archive-ready',
        iteration: 1,
        attempt: 1,
        next_action: 'Archive after confirmation',
      },
      acceptance: [
        {
          id: 'A1',
          source: 'brief.md',
          text: 'The independent verifier covers this item.',
          result: 'passed',
          reason: toNativePortableText('Observed in the implementation.'),
        },
      ],
      builder_handoff: {
        candidate_id: 'candidate-1',
        identity_provider: 'host-a',
        builder_execution_ref: 'builder-1',
        iteration: 1,
        summary: toNativePortableText('Implemented the change.'),
        addressed_acceptance_ids: ['A1'],
        checks: [],
        checks_truncated: false,
        known_limits: [],
        known_limits_truncated: false,
        submitted_at: '2026-08-09T00:01:00.000Z',
      },
      verification: {
        candidate_id: 'candidate-1',
        identity_provider: 'host-a',
        verifier_execution_ref: 'verifier-1',
        iteration: 1,
        attempt: 1,
        verdict: 'pass',
        checks: [
          {
            id: 'test',
            name: toNativePortableText('test'),
            argv_display: [toNativePortableText('pnpm'), toNativePortableText('test')],
            argv_truncated: false,
            cwd_ref: '.',
            status: 'passed',
            exit_code: 0,
            duration_ms: 123,
          },
        ],
        summary: toNativePortableText('All acceptance items passed.'),
        risks: [],
        risks_truncated: false,
        completed_at: '2026-08-09T00:02:00.000Z',
      },
      verification_result: 'pass',
      verification_report: 'verification.md',
    });

    expect(state.verification_result).toBe('pass');
    expect(() =>
      parseNativePortableState({
        ...state,
        verification: { ...state.verification!, verifier_execution_ref: 'builder-1' },
      }),
    ).toThrow(/execution refs must differ/iu);

    expect(stringify(state)).not.toContain('hash');
  });
});
