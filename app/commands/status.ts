import path from 'path';
import { promises as fs } from 'fs';
import { fileExists, readDir } from '../../platform/fs/file-system.js';
import { inspectClassicChangeReadOnly } from '../../domains/comet-classic/classic-diagnostics.js';
import { readClassicState } from '../../domains/comet-classic/classic-store.js';
import {
  latestCommandCheck,
  type RecordedCommandCheck,
} from '../../domains/comet-classic/classic-command-checks.js';
import { requiresBranchBinding } from '../../domains/comet-classic/classic-branch-binding.js';

export interface ChangeStatus {
  name: string;
  cometManaged: boolean;
  archiveReady: boolean;
  recommendedArchiveCommand: string;
  workflow: string | null;
  phase: string | null;
  buildMode: string | null;
  isolation: string | null;
  boundBranch: string | null;
  verifyMode: string | null;
  verifyResult: string | null;
  designDoc: string | null;
  plan: string | null;
  tasksCompleted: number;
  tasksTotal: number;
  nextCommand: string | null;
  currentStep: string | null;
  runtimeMode: string | null;
  runtimeEval: {
    stepId: string;
    passed: boolean;
    requiredEvidence: string[];
    missingEvidence: string[];
  } | null;
  commandChecks: {
    build: RecordedCommandCheck | null;
    verify: RecordedCommandCheck | null;
  } | null;
  error?: string;
}

async function countTasks(tasksPath: string): Promise<{ done: number; total: number }> {
  if (!(await fileExists(tasksPath))) return { done: 0, total: 0 };
  const content = await fs.readFile(tasksPath, 'utf-8');
  const lines = content.split('\n');
  const total = lines.filter((l) => /^\s*- \[[ x]\]/i.test(l)).length;
  const done = lines.filter((l) => /^\s*- \[x\]/i.test(l)).length;
  return { done, total };
}

async function getActiveChanges(projectPath: string): Promise<ChangeStatus[]> {
  const changesDir = path.join(projectPath, 'openspec', 'changes');
  if (!(await fileExists(changesDir))) return [];

  const entries = (await readDir(changesDir)).sort();
  const changes: ChangeStatus[] = [];

  for (const entry of entries) {
    if (entry === 'archive') continue;
    const changeDir = path.join(changesDir, entry);
    const stat = await fs.stat(changeDir);
    if (!stat.isDirectory()) continue;

    const yamlPath = path.join(changeDir, '.comet.yaml');
    const { done, total } = await countTasks(path.join(changeDir, 'tasks.md'));
    if (!(await fileExists(yamlPath))) {
      changes.push({
        name: entry,
        cometManaged: false,
        archiveReady: total > 0 && done === total,
        recommendedArchiveCommand: `openspec archive ${entry} -y`,
        workflow: null,
        phase: null,
        buildMode: null,
        isolation: null,
        boundBranch: null,
        verifyMode: null,
        verifyResult: null,
        designDoc: null,
        plan: null,
        tasksCompleted: done,
        tasksTotal: total,
        nextCommand: null,
        currentStep: null,
        runtimeMode: null,
        runtimeEval: null,
        commandChecks: null,
      });
      continue;
    }
    try {
      const projection = await readClassicState(changeDir, { migrate: false });
      const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
      if (unknownKeys.length > 0) {
        changes.push({
          name: entry,
          cometManaged: true,
          archiveReady: false,
          recommendedArchiveCommand: `comet archive ${entry}`,
          workflow: 'unknown',
          phase: 'invalid',
          buildMode: projection.classic?.buildMode ?? null,
          isolation: projection.classic?.isolation ?? null,
          boundBranch: projection.classic?.boundBranch ?? null,
          verifyMode: projection.classic?.verifyMode ?? null,
          verifyResult: projection.classic?.verifyResult ?? 'pending',
          designDoc: projection.classic?.designDoc ?? null,
          plan: projection.classic?.plan ?? null,
          tasksCompleted: done,
          tasksTotal: total,
          nextCommand: null,
          currentStep: null,
          runtimeMode: 'invalid',
          runtimeEval: null,
          commandChecks: null,
          error: `Invalid Classic state: unknown field(s): ${unknownKeys.join(', ')}`,
        });
        continue;
      }

      const diagnostic = await inspectClassicChangeReadOnly(changeDir, entry);

      if (diagnostic.valid && projection.classic) {
        if (projection.classic.archived) continue;
        const run = projection.run;
        changes.push({
          name: entry,
          cometManaged: true,
          archiveReady:
            projection.classic.phase === 'archive' &&
            projection.classic.verifyResult === 'pass' &&
            !projection.classic.archived,
          recommendedArchiveCommand: `comet archive ${entry}`,
          workflow: diagnostic.workflow,
          phase: diagnostic.phase,
          buildMode: projection.classic.buildMode,
          isolation: projection.classic.isolation,
          boundBranch: projection.classic.boundBranch,
          verifyMode: projection.classic.verifyMode,
          verifyResult: projection.classic.verifyResult,
          designDoc: projection.classic.designDoc,
          plan: projection.classic.plan,
          tasksCompleted: done,
          tasksTotal: total,
          nextCommand: diagnostic.nextCommand,
          currentStep: diagnostic.currentStep,
          runtimeMode: diagnostic.runtimeMode,
          runtimeEval: diagnostic.runtimeEval,
          commandChecks: run
            ? {
                build: await latestCommandCheck(changeDir, run, 'build'),
                verify: await latestCommandCheck(changeDir, run, 'verify'),
              }
            : null,
        });
        continue;
      }

      changes.push({
        name: entry,
        cometManaged: true,
        archiveReady: false,
        recommendedArchiveCommand: `comet archive ${entry}`,
        workflow: diagnostic.workflow,
        phase: diagnostic.phase,
        buildMode: projection.classic?.buildMode ?? null,
        isolation: projection.classic?.isolation ?? null,
        boundBranch: projection.classic?.boundBranch ?? null,
        verifyMode: projection.classic?.verifyMode ?? null,
        verifyResult: projection.classic?.verifyResult ?? 'pending',
        designDoc: projection.classic?.designDoc ?? null,
        plan: projection.classic?.plan ?? null,
        tasksCompleted: done,
        tasksTotal: total,
        nextCommand: diagnostic.nextCommand,
        currentStep: diagnostic.currentStep,
        runtimeMode: diagnostic.runtimeMode,
        runtimeEval: diagnostic.runtimeEval,
        commandChecks: null,
        error: diagnostic.error,
      });
    } catch (error) {
      changes.push({
        name: entry,
        cometManaged: true,
        archiveReady: false,
        recommendedArchiveCommand: `comet archive ${entry}`,
        workflow: 'unknown',
        phase: 'invalid',
        buildMode: null,
        isolation: null,
        boundBranch: null,
        verifyMode: null,
        verifyResult: 'pending',
        designDoc: null,
        plan: null,
        tasksCompleted: done,
        tasksTotal: total,
        nextCommand: null,
        currentStep: null,
        runtimeMode: 'invalid',
        runtimeEval: null,
        commandChecks: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return changes;
}

function formatMissingEvidence(missingEvidence: readonly string[]): string {
  return missingEvidence.join(', ');
}

function formatRuntimeCheckRecovery(
  nextCommand: string | null,
  missingEvidence: readonly string[],
): string {
  const missing = formatMissingEvidence(missingEvidence);
  if (nextCommand) {
    return `run ${nextCommand} or restore missing evidence (${missing}), then rerun comet doctor`;
  }
  return `restore missing evidence (${missing}) and rerun comet doctor`;
}

function formatCommandCheck(check: RecordedCommandCheck): string {
  const result = check.exitCode === 0 ? 'pass' : `fail exit=${check.exitCode}`;
  return `${result} (${check.command}; cwd: ${check.cwd}; recorded: ${check.timestamp})`;
}

function displayStatus(changes: ChangeStatus[]): void {
  if (changes.length === 0) {
    console.log('No active changes.\n');
    return;
  }

  console.log('Active Changes:\n');

  for (let i = 0; i < changes.length; i++) {
    const c = changes[i];
    const taskStr = c.tasksTotal > 0 ? ` [${c.tasksCompleted}/${c.tasksTotal} tasks]` : '';
    const classification = c.cometManaged ? 'Comet' : 'OpenSpec';
    const phase = c.phase ? `phase: ${c.phase}` : 'plain change';
    console.log(`  ${i + 1}. ${c.name} [${classification}] [${phase}${taskStr}]`);
    if (c.error) {
      console.log(`     error: ${c.error}`);
      console.log('     next: inspect .comet.yaml and rerun comet doctor');
      console.log();
      continue;
    }
    if (!c.cometManaged) {
      if (c.archiveReady) console.log(`     recommended archive: ${c.recommendedArchiveCommand}`);
      console.log();
      continue;
    }
    console.log(`     workflow: ${c.workflow} | build_mode: ${c.buildMode}`);
    if (c.isolation) {
      const branchSuffix =
        requiresBranchBinding(c.isolation) && c.boundBranch ? ` (bound: ${c.boundBranch})` : '';
      console.log(`     isolation: ${c.isolation}${branchSuffix}`);
    }
    if (c.currentStep) console.log(`     run_step: ${c.currentStep}`);
    console.log(`     runtime_mode: ${c.runtimeMode}`);
    if (c.runtimeEval) {
      const suffix = c.runtimeEval.passed
        ? `(${c.runtimeEval.stepId})`
        : `(${c.runtimeEval.stepId}; missing: ${formatMissingEvidence(c.runtimeEval.missingEvidence)})`;
      console.log(`     runtime_check: ${c.runtimeEval.passed ? 'pass' : 'fail'} ${suffix}`);
    }
    if (c.commandChecks?.build) {
      console.log(`     build_check: ${formatCommandCheck(c.commandChecks.build)}`);
    }
    if (c.commandChecks?.verify) {
      console.log(`     verify_check: ${formatCommandCheck(c.commandChecks.verify)}`);
    }
    if (c.designDoc) console.log(`     design: ${c.designDoc}`);
    if (c.plan) console.log(`     plan:   ${c.plan}`);
    if (c.phase === 'verify') console.log(`     verify_result: ${c.verifyResult}`);
    if (c.runtimeEval && !c.runtimeEval.passed) {
      console.log(
        `     next: ${formatRuntimeCheckRecovery(c.nextCommand, c.runtimeEval.missingEvidence)}`,
      );
    } else if (c.nextCommand) {
      console.log(`     next: ${c.nextCommand}`);
    }
    if (c.archiveReady) console.log(`     recommended archive: ${c.recommendedArchiveCommand}`);
    console.log();
  }
}

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(
  targetPath: string,
  options: StatusOptions = {},
): Promise<void> {
  const projectPath = path.resolve(targetPath);
  const changes = await getActiveChanges(projectPath);

  if (options.json) {
    console.log(JSON.stringify({ changes }, null, 2));
    return;
  }

  displayStatus(changes);
}
