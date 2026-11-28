import {
  clearCometCurrentSelectionIf,
  migrateLegacyClassicSelection,
} from './current-selection.js';
import { hasPendingArchivedClassicDelivery } from '../comet-classic/classic-current-change.js';
import { resolveHookWorkflowOwner } from './hook-router.js';

export interface RepairCometCurrentSelectionOptions {
  migrateLegacyClassic: boolean;
  preserveLegacyClassic?: boolean;
}

export interface RepairCometCurrentSelectionResult {
  migratedLegacyClassic: boolean;
  clearedStaleSelection: boolean;
}

interface RepairCometCurrentSelectionDependencies {
  migrateLegacyClassic: typeof migrateLegacyClassicSelection;
  resolveOwner: typeof resolveHookWorkflowOwner;
  clearSelection: (
    projectRoot: string,
    workflow: 'native' | 'classic',
    change: string,
  ) => Promise<boolean | void>;
}

const DEFAULT_DEPENDENCIES: RepairCometCurrentSelectionDependencies = {
  migrateLegacyClassic: migrateLegacyClassicSelection,
  resolveOwner: resolveHookWorkflowOwner,
  clearSelection: clearCometCurrentSelectionIf,
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
  const stale = 'staleSelection' in resolution ? resolution.staleSelection : undefined;
  if (stale?.code !== 'target-missing' || (stale.legacy && options.preserveLegacyClassic)) {
    return { migratedLegacyClassic, clearedStaleSelection: false };
  }
  if (
    stale.workflow === 'classic' &&
    (await hasPendingArchivedClassicDelivery(projectRoot, stale.change))
  ) {
    return { migratedLegacyClassic, clearedStaleSelection: false };
  }
  const cleared = await dependencies.clearSelection(projectRoot, stale.workflow, stale.change);
  return { migratedLegacyClassic, clearedStaleSelection: cleared !== false };
}
