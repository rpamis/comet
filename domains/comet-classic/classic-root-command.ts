import type { ClassicCommandHandler } from './classic-cli.js';
import {
  applyClassicRootMove,
  planClassicRootMove,
  type ClassicRootMovePlan,
} from './classic-root-move.js';
import {
  assertClassicLayoutReadable,
  classicProjectRelative,
  discoverClassicProject,
} from './classic-layout.js';

function usage() {
  return {
    exitCode: 64,
    stderr:
      'Usage: comet classic root show | comet classic root move docs --dry-run | comet classic root move docs --apply --plan <id>',
  };
}

export function formatClassicRootMoveReport(
  plan: ClassicRootMovePlan,
  mode: 'dry-run' | 'complete',
): string {
  const list = (values: string[]) => (values.length > 0 ? values.join('; ') : 'none');
  return (
    [
      `Classic root move ${mode}`,
      `source: ${plan.source}`,
      `target: ${plan.target}`,
      `staging: ${plan.staging}`,
      `artifact layout: ${plan.artifactLayout}`,
      `source identity: ${JSON.stringify(plan.sourceIdentity)}`,
      `target initial identity: ${
        plan.targetInitialIdentity ? JSON.stringify(plan.targetInitialIdentity) : 'missing'
      }`,
      `files: ${plan.fileCount}`,
      `directories: ${plan.directoryCount}`,
      `bytes: ${plan.totalBytes}`,
      `manifest: ${plan.manifestHash}`,
      ...plan.fileSummary.map((file) => `file: ${file.path} ${file.size} ${file.hash}`),
      `config change: ${plan.configChange.from} -> ${plan.configChange.to}`,
      `config path: ${plan.configPath}`,
      `config: ${plan.configHash}`,
      `original config: ${plan.originalConfigHash}`,
      `expected config: ${plan.expectedConfigHash}`,
      `plan: ${plan.planId}`,
      `target initial state: ${plan.targetInitialState}`,
      `conflicts: ${list(plan.conflicts)}`,
      `blockers: ${list(plan.blockers)}`,
      `pending recovery: ${
        plan.pendingRecovery
          ? `${plan.pendingRecovery.id} at ${plan.pendingRecovery.stage}`
          : 'none'
      }`,
      `historical pointers preserved: ${plan.historicalPointersPreserved.join('; ')}`,
      `apply preconditions: ${plan.applyPreconditions.join('; ')}`,
      `allowed recovery strategies: ${list(plan.allowedRecoveryStrategies)}`,
      `ready to apply: ${plan.readyToApply ? 'yes' : 'no'}`,
    ].join('\n') + '\n'
  );
}

export const classicRootCommand: ClassicCommandHandler = async (args) => {
  const [action, target, mode, planFlag, planId, ...extra] = args;
  if (action === 'show' && target === undefined) {
    const projectRoot = await discoverClassicProject(process.cwd());
    const layout = await assertClassicLayoutReadable(projectRoot);
    return {
      exitCode: 0,
      stdout:
        JSON.stringify({
          schema: 'comet.classic-layout.v1',
          artifactLayout: layout.artifactLayout,
          openSpecRoot: classicProjectRelative(projectRoot, layout.openSpecRoot),
          changesRoot: classicProjectRelative(projectRoot, layout.changesDir),
          archiveRoot: classicProjectRelative(projectRoot, layout.archiveDir),
          specsRoot: classicProjectRelative(projectRoot, layout.specsDir),
          superpowersRoot: classicProjectRelative(projectRoot, layout.superpowersRoot),
        }) + '\n',
    };
  }
  if (action !== 'move' || target !== 'docs') return usage();
  if (mode === '--dry-run') {
    if (planFlag !== undefined) return usage();
    const plan = await planClassicRootMove(process.cwd());
    return {
      exitCode: 0,
      stdout: formatClassicRootMoveReport(plan, 'dry-run'),
    };
  }
  if (
    mode !== '--apply' ||
    planFlag !== '--plan' ||
    !planId ||
    !/^[a-f0-9]{64}$/u.test(planId) ||
    extra.length > 0
  ) {
    return usage();
  }
  const plan = await applyClassicRootMove(process.cwd(), { planId });
  return {
    exitCode: 0,
    stdout: formatClassicRootMoveReport(plan, 'complete'),
  };
};
