import { serializeNativeVerificationMachineBlock } from '../../domains/comet-native/native-acceptance.js';
import { nativeChangeDir, readNativeChange } from '../../domains/comet-native/native-change.js';
import { buildNativeCheckReceipt } from '../../domains/comet-native/native-check-receipt-model.js';
import {
  readNativeCheckReceipt,
  writeNativeCheckReceipt,
} from '../../domains/comet-native/native-check-receipt-storage.js';
import { collectNativeContractFiles } from '../../domains/comet-native/native-contract-files.js';
import type { NativeProjectPaths } from '../../domains/comet-native/native-types.js';
import { readNativeImplementationScopeBundle } from '../../domains/comet-native/native-evidence-storage.js';
import {
  issueNativeManualEvidenceReceipt,
  persistNativeStaticInspectionReceipt,
} from '../../domains/comet-native/native-verification-receipt-runtime.js';

const TYPED_RECEIPT_REF_PATTERN = /^runtime\/evidence\/receipts\/[a-f0-9]{64}\.json$/u;

/** Build a structurally valid report for lifecycle tests that are not testing evidence content. */
export async function nativeVerificationFixtureReport(options: {
  paths: NativeProjectPaths;
  name: string;
  evidenceRefs?: readonly string[];
  conclusion?: 'Pass' | 'Fail';
}): Promise<string> {
  const state = await readNativeChange(options.paths, options.name);
  const collected = await collectNativeContractFiles({
    changeDir: nativeChangeDir(options.paths, options.name),
    briefRef: state.brief,
    specChanges: state.spec_changes,
  });
  const conclusion = options.conclusion ?? 'Pass';
  let evidenceRefs = [...(options.evidenceRefs ?? [])].filter((ref) =>
    TYPED_RECEIPT_REF_PATTERN.test(ref),
  );
  if (conclusion === 'Pass' && evidenceRefs.length === 0) {
    const issued = await issueNativeManualEvidenceReceipt({
      paths: options.paths,
      name: options.name,
      acceptanceIds: collected.contract.acceptance.map((criterion) => criterion.id),
      responsible: 'native-test-fixture',
      steps: ['Exercise every acceptance criterion in the lifecycle fixture.'],
      observations: ['Every acceptance criterion produced the expected fixture outcome.'],
      confirmed: true,
      now: new Date('2026-07-28T00:00:00.000Z'),
    });
    evidenceRefs = [issued.ref];
  }
  const machineBlock = serializeNativeVerificationMachineBlock(
    collected.contract.acceptance.map((criterion) => ({
      acceptance_id: criterion.id,
      ...(conclusion === 'Pass'
        ? { status: 'passed' as const, evidence_refs: evidenceRefs }
        : {
            status: 'failed' as const,
            evidence_refs: [],
            skipped_reason: 'Lifecycle fixture records the requested failed verification outcome.',
          }),
    })),
  );
  return `# Acceptance evidence
${machineBlock}
# Commands and results
Lifecycle fixture completed.
# Skipped checks
${evidenceRefs.length > 0 ? 'None.' : 'Acceptance checks are intentionally skipped by this lifecycle fixture.'}
# Spec consistency
Matches.
# Known limitations and risks
This report is test fixture evidence only.
# Conclusion
${conclusion}.
`;
}

/** Create a current, passed Runtime receipt for lifecycle tests that do not test check policy. */
export async function nativeVerificationFixtureReceipt(options: {
  paths: NativeProjectPaths;
  name: string;
  now?: Date;
}): Promise<string> {
  const state = await readNativeChange(options.paths, options.name);
  if (!state.implementation_scope)
    throw new Error('Fixture receipt requires an implementation scope');
  const [scope, collected] = await Promise.all([
    readNativeImplementationScopeBundle(options.paths, options.name, state.implementation_scope),
    collectNativeContractFiles({
      changeDir: nativeChangeDir(options.paths, options.name),
      briefRef: state.brief,
      specChanges: state.spec_changes,
    }),
  ]);
  const selected = scope.scope.changes.filter((change) => change.after !== null);
  const startedAt = (options.now ?? new Date('2026-07-28T00:00:00.000Z')).toISOString();
  const endedAt = new Date(new Date(startedAt).getTime() + 1).toISOString();
  const checkRef = await writeNativeCheckReceipt({
    paths: options.paths,
    name: options.name,
    receipt: buildNativeCheckReceipt({
      change: options.name,
      sourceRevision: state.revision,
      status: 'passed',
      startedAt,
      endedAt,
      contract: {
        expectedHash: collected.contract.contractHash,
        beforeHash: collected.contract.contractHash,
        afterHash: collected.contract.contractHash,
      },
      implementation: {
        scopeHash: scope.scope.scopeHash,
        expectedSnapshotHash: scope.scope.currentProjectionHash,
        beforeSnapshotHash: scope.scope.currentProjectionHash,
        afterSnapshotHash: scope.scope.currentProjectionHash,
      },
      counts: {
        filesSelected: selected.length,
        filesScanned: selected.length,
        binaryFilesSkipped: 0,
        bytesScanned: selected.reduce((total, change) => total + change.after!.size, 0),
        issueCount: 0,
        recordedIssueCount: 0,
      },
      issues: [],
      issuesTruncated: false,
      stale: false,
      staleReasons: [],
    }),
  });
  return (
    await persistNativeStaticInspectionReceipt({
      paths: options.paths,
      state,
      checkReceipt: await readNativeCheckReceipt(options.paths, options.name, checkRef),
      checkReceiptRef: checkRef,
    })
  ).ref;
}
