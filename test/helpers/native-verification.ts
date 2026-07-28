import { serializeNativeVerificationMachineBlock } from '../../domains/comet-native/native-acceptance.js';
import { nativeChangeDir, readNativeChange } from '../../domains/comet-native/native-change.js';
import { buildNativeCheckReceipt } from '../../domains/comet-native/native-check-receipt-model.js';
import { writeNativeCheckReceipt } from '../../domains/comet-native/native-check-receipt-storage.js';
import { collectNativeContractFiles } from '../../domains/comet-native/native-contract-files.js';
import type { NativeProjectPaths } from '../../domains/comet-native/native-types.js';
import { readNativeImplementationScopeBundle } from '../../domains/comet-native/native-evidence-storage.js';

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
  const evidenceRefs = [...(options.evidenceRefs ?? [])];
  const machineBlock = serializeNativeVerificationMachineBlock(
    collected.contract.acceptance.map((criterion) => ({
      acceptance_id: criterion.id,
      ...(evidenceRefs.length > 0
        ? { evidence_refs: evidenceRefs }
        : { evidence_refs: [], skipped_reason: 'Lifecycle fixture does not execute this check.' }),
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
${options.conclusion ?? 'Pass'}.
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
  return writeNativeCheckReceipt({
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
}
