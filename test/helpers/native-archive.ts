import { promises as fs } from 'node:fs';
import path from 'node:path';

import { serializeNativeVerificationMachineBlock } from '../../domains/comet-native/native-acceptance.js';
import { inspectNativeArchivePreflight } from '../../domains/comet-native/native-archive-inspection.js';
import { prepareNativeBuildEvidence } from '../../domains/comet-native/native-build-evidence.js';
import {
  compareAndSwapNativeChangeFile,
  createNativeChange,
  nativeChangeDir,
} from '../../domains/comet-native/native-change.js';
import { collectNativeContractFiles } from '../../domains/comet-native/native-contract-files.js';
import {
  NATIVE_RUNTIME_HASH,
  NATIVE_RUNTIME_PACKAGE,
} from '../../domains/comet-native/native-runtime-package.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
  NativeSpecChange,
} from '../../domains/comet-native/native-types.js';
import { prepareNativeVerificationEvidence } from '../../domains/comet-native/native-verification-runtime.js';
import { NATIVE_RUN_STORAGE } from '../../domains/engine/storage-layout.js';
import { startRunWithStorage, writeRunStateAt } from '../../domains/engine/storage-run.js';

const brief = `# Outcome
Ship the capability.
# Scope
One focused behavior.
# Non-goals
No Classic migration.
# Acceptance examples
- The capability works.
# Constraints and invariants
Keep Native self-contained.
# Decisions
Use canonical specs.
# Open questions
None.
# Verification expectations
Run focused tests.
`;

/** Build a real, content-bound Archive fixture without production test bypasses. */
export async function prepareNativeArchiveFixture(options: {
  paths: NativeProjectPaths;
  name: string;
  specChanges?: NativeSpecChange[];
  proposedSpecs?: Readonly<Record<string, string>>;
}): Promise<{ state: NativeChangeState; changeDir: string }> {
  const proofFile = path.join(options.paths.projectRoot, 'native-archive-proof.txt');
  try {
    await fs.access(proofFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await fs.writeFile(proofFile, 'Native Archive fixture evidence.\n');
  }
  const created = await createNativeChange({
    paths: options.paths,
    name: options.name,
    language: 'en',
  });
  const changeDir = nativeChangeDir(options.paths, options.name);
  await fs.writeFile(path.join(changeDir, 'brief.md'), brief);
  for (const [reference, content] of Object.entries(options.proposedSpecs ?? {})) {
    const target = path.join(changeDir, ...reference.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content);
  }
  const buildState: NativeChangeState = {
    ...created,
    phase: 'build',
    approval: 'implicit',
    spec_changes: options.specChanges ?? [],
    run_id: `run-${options.name}`,
  };
  const build = await prepareNativeBuildEvidence({
    paths: options.paths,
    state: buildState,
    artifactRefs: [],
    noCodeReason: 'The archive fixture changes only Native specifications.',
  });
  const stateFile = path.join(changeDir, 'comet-state.yaml');
  const verifyState = await compareAndSwapNativeChangeFile(
    stateFile,
    {
      ...buildState,
      phase: 'verify',
      implementation_scope: build.scopeRef as NativeChangeState['implementation_scope'],
    },
    created.revision,
  );
  const contract = await collectNativeContractFiles({
    changeDir,
    briefRef: verifyState.brief,
    specChanges: verifyState.spec_changes,
  });
  const machineBlock = serializeNativeVerificationMachineBlock(
    contract.contract.acceptance.map((criterion) => ({
      acceptance_id: criterion.id,
      evidence_refs: ['native-archive-proof.txt'],
    })),
  );
  await fs.writeFile(
    path.join(changeDir, 'verification.md'),
    `# Acceptance evidence
${machineBlock}
# Commands and results
Focused tests passed.
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
  const evidence = await prepareNativeVerificationEvidence({
    paths: options.paths,
    state: verifyState,
    result: 'pass',
    reportRef: 'verification.md',
  });
  if (!evidence.ready || !evidence.evidenceRef) {
    throw new Error(`Native Archive fixture evidence is not ready: ${evidence.findingCodes}`);
  }
  const archiveState = await compareAndSwapNativeChangeFile(
    stateFile,
    {
      ...verifyState,
      phase: 'archive',
      verification_result: 'pass',
      verification_report: 'verification.md',
      verification_evidence: evidence.evidenceRef as NativeChangeState['verification_evidence'],
    },
    verifyState.revision,
  );
  const run = startRunWithStorage(
    NATIVE_RUNTIME_PACKAGE,
    archiveState.run_id!,
    NATIVE_RUNTIME_HASH,
    NATIVE_RUN_STORAGE,
  );
  run.currentStep = 'archive';
  run.iteration = 3;
  await writeRunStateAt(changeDir, run, NATIVE_RUN_STORAGE);
  return { state: archiveState, changeDir };
}

export async function readyNativeArchivePreflight(options: {
  paths: NativeProjectPaths;
  name: string;
  now: Date;
}): Promise<string> {
  const preflight = await inspectNativeArchivePreflight(options);
  if (!preflight.ready) {
    throw new Error(`Native Archive fixture preflight is blocked: ${preflight.findingCodes}`);
  }
  return preflight.preflightHash;
}
