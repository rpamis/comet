import { PassThrough } from 'stream';
import { describe, expect, it } from 'vitest';
import { classicIntentCommand } from '../../../domains/comet-classic/classic-intent-command.js';

const BOM = String.fromCharCode(0xfeff);

const FRAME = JSON.stringify({
  schema_version: 'comet.intent.v1',
  utterance: 'help me fix the login bug',
  locale: 'en',
  intent: { name: 'fix_bug', confidence: 0.9 },
  entities: [],
  slots: {
    requested_action: 'fix',
    workflow_candidate: 'hotfix',
    user_explicit_workflow: null,
    change_id: null,
    target_area: null,
    scope: 'small',
    existing_behavior: true,
    new_capability: false,
    public_api_change: false,
    schema_change: false,
    cross_module_change: false,
  },
  context: { active_changes_count: 0, active_change_names: [], dirty_worktree: false },
  evidence: [{ field: 'slots.workflow_candidate', quote: 'hotfix workflow', source: 'user' }],
  proposed_route: {
    name: 'hotfix',
    next_skill: 'comet-hotfix',
    confidence: 0.9,
    requires_confirmation: false,
    fallback_reason: null,
  },
});

async function runWithStdin<T>(payload: string, fn: () => Promise<T>): Promise<T> {
  const originalStdin = process.stdin;
  const input = new PassThrough();
  input.end(payload);
  Object.defineProperty(process, 'stdin', { value: input, configurable: true });

  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
  }
}

describe('classicIntentCommand', () => {
  it('routes a frame read from stdin', async () => {
    const result = await runWithStdin(FRAME, () =>
      classicIntentCommand(['route', '--stdin'], { json: false }),
    );
    const payload = JSON.parse(result.stdout ?? '');

    expect(result.exitCode).toBe(0);
    expect(payload.route.name).toBe('hotfix');
  });

  it('accepts a stdin frame carrying a leading UTF-8 BOM', async () => {
    const result = await runWithStdin(BOM + FRAME, () =>
      classicIntentCommand(['route', '--stdin'], { json: false }),
    );
    const payload = JSON.parse(result.stdout ?? '');

    expect(result.exitCode).toBe(0);
    expect(payload.route.name).toBe('hotfix');
  });
});
