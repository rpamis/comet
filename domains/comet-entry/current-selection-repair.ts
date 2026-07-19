import { clearCometCurrentSelection, migrateLegacyClassicSelection } from './current-selection.js';
import { resolveHookWorkflowOwner } from './hook-router.js';

export interface RepairCometCurrentSelectionOptions {
  migrateLegacyClassic: boolean;
}

export interface RepairCometCurrentSelectionResult {
  migratedLegacyClassic: boolean;
  clearedStaleSelection: boolean;
}

interface RepairCometCurrentSelectionDependencies {
  migrateLegacyClassic: typeof migrateLegacyClassicSelection;
  resolveOwner: typeof resolveHookWorkflowOwner;
  clearSelection: typeof clearCometCurrentSelection;
}

const DEFAULT_DEPENDENCIES: RepairCometCurrentSelectionDependencies = {
  migrateLegacyClassic: migrateLegacyClassicSelection,
  resolveOwner: resolveHookWorkflowOwner,
  clearSelection: clearCometCurrentSelection,
};

export async function repairCometCurrentSelection(
  projectRoot: string,
  options: RepairCometCurrentSelectionOptions,
  dependencies: RepairCometCurrentSelectionDependencies = DEFAULT_DEPENDENCIES,
): Promise<RepairCometCurrentSelectionResult> {
  const migratedLegacyClassic = options.migrateLegacyClassic
    ? await dependencies.migrateLegacyClassic(projectRoot)
    : false;

  const resolution = await dependencies.resolveOwner(projectRoot);
  if (resolution.status !== 'stale' || resolution.code !== 'target-missing') {
    return { migratedLegacyClassic, clearedStaleSelection: false };
  }

  await dependencies.clearSelection(projectRoot);
  return { migratedLegacyClassic, clearedStaleSelection: true };
}
