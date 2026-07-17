import { serializeNativeVerificationMachineBlock } from '../../domains/comet-native/native-acceptance.js';
import { nativeChangeDir, readNativeChange } from '../../domains/comet-native/native-change.js';
import { collectNativeContractFiles } from '../../domains/comet-native/native-contract-files.js';
import type { NativeProjectPaths } from '../../domains/comet-native/native-types.js';

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
