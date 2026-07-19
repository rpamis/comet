import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { serializeNativeVerificationMachineBlock } from '../../../domains/comet-native/native-acceptance.js';
import { inspectNativeArchivePreflight } from '../../../domains/comet-native/native-archive-inspection.js';
import { prepareNativeBuildEvidence } from '../../../domains/comet-native/native-build-evidence.js';
import {
  compareAndSwapNativeChangeFile,
  createNativeChange,
  nativeChangeDir,
  writeNativeChange,
} from '../../../domains/comet-native/native-change.js';
import { collectNativeContractFiles } from '../../../domains/comet-native/native-contract-files.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import { nativeTransitionJournalFile } from '../../../domains/comet-native/native-transition-journal.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';
import { prepareNativeVerificationEvidence } from '../../../domains/comet-native/native-verification-runtime.js';

const brief = `# Outcome
Ship one focused behavior.
# Scope
Update the focused file.
# Non-goals
No unrelated changes.
# Acceptance examples
- The focused behavior works.
# Constraints and invariants
Keep callers stable.
# Decisions
Use the current module.
# Open questions
None.
# Verification expectations
Run the focused check.
`;

describe('Native Archive inspection', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let state: NativeChangeState;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-archive-inspection-'));
    await fs.mkdir(path.join(projectRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 1;\n');
    paths = await nativeProjectPaths(projectRoot, '.');
    const created = await createNativeChange({
      paths,
      name: 'archive-preview',
      language: 'en',
      now: new Date('2026-07-17T00:00:00.000Z'),
    });
    const changeDir = nativeChangeDir(paths, created.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
    const buildState: NativeChangeState = {
      ...created,
      phase: 'build',
      approval: 'implicit',
    };
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 2;\n');
    const build = await prepareNativeBuildEvidence({
      paths,
      state: buildState,
      artifactRefs: ['src/feature.ts'],
      now: new Date('2026-07-17T01:00:00.000Z'),
    });
    const verifyCandidate: NativeChangeState = {
      ...buildState,
      phase: 'verify',
      implementation_scope: build.scopeRef as NativeChangeState['implementation_scope'],
    };
    const stateFile = path.join(changeDir, 'comet-state.yaml');
    const verifyState = await compareAndSwapNativeChangeFile(stateFile, verifyCandidate, 1);
    const contract = await collectNativeContractFiles({
      changeDir,
      briefRef: verifyState.brief,
      specChanges: verifyState.spec_changes,
    });
    const block = serializeNativeVerificationMachineBlock(
      contract.contract.acceptance.map((criterion) => ({
        acceptance_id: criterion.id,
        evidence_refs: ['src/feature.ts'],
      })),
    );
    await fs.writeFile(
      path.join(changeDir, 'verification.md'),
      `# Acceptance evidence
${block}
# Commands and results
Focused check passed.
# Skipped checks
None.
# Spec consistency
Consistent.
# Known limitations and risks
None.
# Conclusion
Pass.
`,
    );
    const verification = await prepareNativeVerificationEvidence({
      paths,
      state: verifyState,
      result: 'pass',
      reportRef: 'verification.md',
      now: new Date('2026-07-17T02:00:00.000Z'),
    });
    const archiveCandidate: NativeChangeState = {
      ...verifyState,
      phase: 'archive',
      verification_result: 'pass',
      verification_report: 'verification.md',
      verification_evidence: verification.evidenceRef as NativeChangeState['verification_evidence'],
    };
    state = await compareAndSwapNativeChangeFile(stateFile, archiveCandidate, 2);
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('returns a stable ready preview without writing project state', async () => {
    const changeFile = path.join(nativeChangeDir(paths, state.name), 'comet-state.yaml');
    const before = await fs.readFile(changeFile, 'utf8');

    const first = await inspectNativeArchivePreflight({
      paths,
      name: state.name,
      now: new Date('2026-07-17T03:00:00.000Z'),
    });
    const second = await inspectNativeArchivePreflight({
      paths,
      name: state.name,
      now: new Date('2026-07-17T03:00:00.000Z'),
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ready: true,
      revision: 3,
      targetRef: 'archive/2026-07-17-archive-preview',
      evidenceFreshness: 'complete',
      findingCodes: [],
    });
    expect(await fs.readFile(changeFile, 'utf8')).toBe(before);
  });

  it('changes the preflight hash and blocks when implementation becomes stale', async () => {
    const before = await inspectNativeArchivePreflight({
      paths,
      name: state.name,
      now: new Date('2026-07-17T03:00:00.000Z'),
    });
    await fs.writeFile(path.join(projectRoot, 'src', 'feature.ts'), 'export const value = 3;\n');

    const after = await inspectNativeArchivePreflight({
      paths,
      name: state.name,
      now: new Date('2026-07-17T03:00:00.000Z'),
    });

    expect(after.ready).toBe(false);
    expect(after.findingCodes).toContain('verification-evidence-stale');
    expect(after.findingCodes).toContain('verification-implementation-stale');
    expect(after.preflightHash).not.toBe(before.preflightHash);
  });

  it('binds an existing archive target and pending journal into readiness', async () => {
    await fs.mkdir(path.join(paths.archiveDir, '2026-07-17-archive-preview'), {
      recursive: true,
    });
    await fs.writeFile(nativeTransitionJournalFile(paths, state.name), '{}\n');

    const preview = await inspectNativeArchivePreflight({
      paths,
      name: state.name,
      now: new Date('2026-07-17T03:00:00.000Z'),
    });

    expect(preview.ready).toBe(false);
    expect(preview.findingCodes).toEqual(
      expect.arrayContaining(['archive-target-exists', 'pending-journal']),
    );
  });

  it('blocks when another visible change claims the same implementation artifact', async () => {
    const competing = await createNativeChange({
      paths,
      name: 'competing-change',
      language: 'en',
    });
    const sourceEvidence = path.join(nativeChangeDir(paths, state.name), 'runtime', 'evidence');
    const targetEvidence = path.join(nativeChangeDir(paths, competing.name), 'runtime', 'evidence');
    await fs.cp(sourceEvidence, targetEvidence, { recursive: true });
    await writeNativeChange(paths, {
      ...competing,
      phase: 'build',
      approval: 'implicit',
      implementation_scope: state.implementation_scope,
    });

    const preview = await inspectNativeArchivePreflight({
      paths,
      name: state.name,
      now: new Date('2026-07-17T03:00:00.000Z'),
    });

    expect(preview.ready).toBe(false);
    expect(preview.findingCodes).toContain('native-change-conflict');
  });
});
