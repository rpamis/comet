import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { createNativeChange, nativeChangeDir } from '../../../domains/comet-native/native-change.js';
import { inspectNativeGuard } from '../../../domains/comet-native/native-guards.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type { NativeChangeState, NativeProjectPaths } from '../../../domains/comet-native/native-types.js';

const completeBrief = `# Outcome
Ship the feature.
# Scope
One capability.
# Non-goals
No migration.
# Acceptance examples
- The feature works.
# Constraints and invariants
Keep compatibility.
# Decisions
Use existing APIs.
# Open questions

# Verification expectations
Run focused tests.
`;

describe('Native phase guards', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let state: NativeChangeState;
  let changeDir: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-guards-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    state = await createNativeChange({ paths, name: 'guarded-change', language: 'en' });
    changeDir = nativeChangeDir(paths, state.name);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('blocks incomplete Shape without mutating state', async () => {
    const result = await inspectNativeGuard({ paths, state, evidence: { summary: 'ready' } });
    expect(result.valid).toBe(false);
    expect(result.findings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'brief-section-empty' })]),
    );
  });

  it('requires confirmed approval only for an explicit decision point', async () => {
    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    state.confirmation_required = true;
    expect(
      (await inspectNativeGuard({ paths, state, evidence: { summary: 'ready' } })).findings,
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'shape-confirmation-required' })]),
    );
    state.approval = 'confirmed';
    expect(await inspectNativeGuard({ paths, state, evidence: { summary: 'ready' } })).toEqual({
      valid: true,
      findings: [],
    });
  });

  it('requires a real artifact or a no-code reason in Build', async () => {
    state.phase = 'build';
    expect(
      (await inspectNativeGuard({ paths, state, evidence: { summary: 'built' } })).findings[0],
    ).toMatchObject({ code: 'build-evidence-missing' });
    expect(
      await inspectNativeGuard({
        paths,
        state,
        evidence: { summary: 'docs only', noCodeReason: 'The change only updates documentation.' },
      }),
    ).toEqual({ valid: true, findings: [] });
  });
});
