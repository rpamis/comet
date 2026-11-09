import path from 'path';
import { parseDocument } from 'yaml';
import type { CliOutputEnvelope } from '../workflow-contract/output-envelope.js';
import { readWorkflowProjectConfigDocument } from '../workflow-contract/project-config-reader.js';
import {
  classicArchivedRequirementsProblems,
  readClassicArtifactRequirements,
} from './classic-artifact-requirements.js';
import {
  driftBlockedMessage,
  resolveBranchBinding,
  unboundDetachedMessage,
  type BranchBindingOutcome,
} from './classic-branch-binding.js';
import { readCheckPolicy } from './classic-check-policy.js';
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import {
  evaluateCommandCheck,
  latestCommandCheck,
  latestInterruptedCommandCheck,
  rememberClassicAcceptedVerifyCheck,
  type CommandCheckEvaluation,
  type CommandCheckScope,
  type RecordedCommandCheck,
} from './classic-command-checks.js';
import {
  classicCommandInvocationCwd,
  classicCommandProjectRoot,
  withProjectContext,
} from './classic-command-context.js';
import { inspectClassicChange } from './classic-diagnostics.js';
import { validateClassicSdkDesignContext } from './classic-handoff.js';
import { classicIssue, type ClassicIssue } from './classic-issues.js';
import { assertClassicLayoutWritable } from './classic-layout.js';
import type { ClassicRunContext } from './classic-migrate.js';
import { classicGuardCheckEnvelope, classicLocale } from './classic-output-language.js';
import { openSpecChangeNameError, resolveClassicChangeDirectory } from './classic-paths.js';
import { inspectClassicAutonomousBuildProblems } from './classic-plan-readiness.js';
import {
  classicProjectFileNonempty,
  classicProjectTargetExists,
  inspectClassicProjectTarget,
  readClassicProjectFile,
} from './classic-protected-path.js';
import { classicRecoveryContext } from './classic-recovery.js';
import { resolveClassicChangeRuntimeOwner } from './classic-runtime-ownership.js';
import { ensureClassicRuntimeRun, transitionClassicRuntimeRun } from './classic-runtime-run.js';
import {
  classicSdkArchiveGuard,
  classicSdkBuildGuard,
  classicSdkDesignGuard,
  classicSdkOpenGuard,
  classicSdkVerifyGuard,
} from './classic-sdk-guard.js';
import { findClassicSdkWorkspace } from './classic-sdk-status.js';
import { appendClassicStateEvent } from './classic-state-events.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import type { ClassicPhase, ClassicState } from './classic-state.js';
import { readClassicState, withClassicStateLock } from './classic-store.js';
import {
  inspectClassicPlanTasks,
  parseClassicTasks,
  validateClassicTaskPlan,
} from './classic-tasks.js';
import { CLASSIC_GUARD_TRANSITION_EVENT, applyClassicTransition } from './classic-transitions.js';
import { classicValidateCommand } from './classic-validate-command.js';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';
const PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;
const PHASE_HEADER: Record<string, string> = {
  open: '=== Guard: open → next ===',
  design: '=== Guard: design → build ===',
  build: '=== Guard: build → verify ===',
  verify: '=== Guard: verify → archive ===',
  archive: '=== Guard: archive completeness ===',
};
const APPLY_MESSAGE: Record<string, string> = {
  open: '  [APPLY] .comet.yaml updated: phase=PLACEHOLDER',
  design: '  [APPLY] .comet.yaml updated: phase=build',
  build: '  [APPLY] .comet.yaml updated: phase=verify, verify_result=pending',
  verify: '  [APPLY] .comet.yaml updated: phase=archive, verify_result=pass',
};
const CLASSIC_FIELD_WIRE_NAMES: Partial<Record<keyof ClassicState, string>> = {
  branchStatus: 'branch_status',
  checkEpoch: 'check_epoch',
  phase: 'phase',
  verificationReport: 'verification_report',
  verifiedAt: 'verified_at',
  verifyResult: 'verify_result',
};

function green(message: string): string {
  return `${GREEN}${message}${RESET}`;
}

function red(message: string): string {
  return `${RED}${message}${RESET}`;
}

function yellow(message: string): string {
  return `${YELLOW}${message}${RESET}`;
}

function wireField(field: keyof ClassicState): string {
  return CLASSIC_FIELD_WIRE_NAMES[field] ?? String(field);
}

function wireValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

class GuardFailure extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

class GuardOutput {
  readonly stderr: string[] = [];
  diagnostics?: Record<string, unknown>;
  envelope?: CliOutputEnvelope;
  checksPassed = 0;
  checksFailed = 0;
  issues: ClassicIssue[] = [];
  data?: Record<string, unknown>;

  toResult(exitCode = 0): ClassicCommandResult {
    return {
      exitCode,
      data: {
        ...this.data,
        checks: {
          passed: this.checksPassed,
          total: this.checksPassed + this.checksFailed,
          blocked: exitCode !== 0,
        },
        issues: this.issues,
        ...(this.diagnostics ? { diagnostics: this.diagnostics } : {}),
      },
      ...(this.diagnostics
        ? { stdout: JSON.stringify({ diagnostics: this.diagnostics }) + '\n' }
        : {}),
      ...(this.stderr.length > 0 ? { stderr: this.stderr.join('\n') + '\n' } : {}),
      ...(this.envelope === undefined ? {} : { envelope: this.envelope }),
    };
  }
}

async function exists(file: string): Promise<boolean> {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectTargetExists(projectRoot, file, {
    label: `Classic guard path ${path.relative(projectRoot, path.resolve(projectRoot, file)).replaceAll('\\', '/')}`,
  });
}

async function nonempty(file: string): Promise<boolean> {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectFileNonempty(
    projectRoot,
    file,
    `Classic guard file ${path.relative(projectRoot, path.resolve(projectRoot, file)).replaceAll('\\', '/')}`,
  );
}

function validateChangeName(name: string): void {
  const error = openSpecChangeNameError(name);
  if (error) throw new GuardFailure(red(`ERROR: ${error}`));
}

// Resolve an absolute change directory for filesystem and runtime consumers.
// Frozen relative provenance strings are derived separately from projectRoot.
async function resolveChangeDir(name: string): Promise<string> {
  return (await resolveClassicChangeDirectory(name, classicCommandProjectRoot())).directory;
}

async function readField(changeDir: string, field: string): Promise<string> {
  const file = await resolveClassicStateFile(changeDir);
  const document = parseDocument(
    await readClassicProjectFile(classicCommandProjectRoot(), file, {
      label: `Classic state ${changeDir}/.comet.yaml`,
    }),
    { uniqueKeys: false },
  );
  if (document.errors.length > 0) {
    throw new GuardFailure(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  }
  const record = document.toJS() as Record<string, unknown>;
  const value = record[field];
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function preflight(changeDir: string, name: string): Promise<void> {
  if (!(await exists(changeDir))) {
    throw new GuardFailure(red(`FATAL: change directory not found: ${changeDir}`));
  }
  if (!(await exists(await resolveClassicStateFile(changeDir)))) {
    throw new GuardFailure(red(`FATAL: .comet.yaml not found in ${changeDir}`));
  }
  await inspectClassicProjectTarget(classicCommandProjectRoot(), path.join(changeDir, '.comet'), {
    label: `Classic runtime directory for ${name}`,
    expected: 'directory',
  });
  const result = await classicValidateCommand([name], { json: false });
  if (result.exitCode !== 0) {
    if (result.stderr)
      process.stderr.write(result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`);
    throw new GuardFailure(red('FATAL: .comet.yaml schema validation failed'));
  }
  const projection = await readClassicState(changeDir);
  const unknownKeys = Array.from(new Set(projection.unknownKeys)).sort();
  if (unknownKeys.length > 0) {
    throw new GuardFailure(
      red(
        `FATAL: .comet.yaml has unknown field(s): ${unknownKeys.join(
          ', ',
        )}. Remove them (or realign them with this Comet version, e.g. after a version rollback), then rerun comet classic validate`,
      ),
    );
  }
}

interface CheckOutcome {
  description: string;
  passed: boolean;
  detail: string;
}

type CheckResult = { passed: true; detail?: string } | { passed: false; detail: string };

function pushCheck(output: GuardOutput, outcome: CheckOutcome): void {
  if (outcome.passed) {
    output.checksPassed += 1;
    output.stderr.push(green(`  [PASS] ${outcome.description}`));
    if (outcome.detail) {
      for (const line of outcome.detail.split('\n')) output.stderr.push(green(`    ${line}`));
    }
  } else {
    output.checksFailed += 1;
    output.issues.push(
      classicIssue(outcome.detail || outcome.description, {
        code: 'CLASSIC_GUARD_CHECK_FAILED',
        path: `checks.${outcome.description}`,
        expected: 'pass',
        actual: 'fail',
        remediation:
          'Repair this prerequisite using the reported detail, then retry the same guard. Preserve valid artifacts and evidence.',
      }),
    );
    output.stderr.push(red(`  [FAIL] ${outcome.description}`));
    if (outcome.detail) {
      for (const line of outcome.detail.split('\n')) output.stderr.push(red(`    ${line}`));
    }
  }
}

function check(description: string, run: () => Promise<CheckResult>): () => Promise<CheckOutcome> {
  return async () => {
    try {
      const result = await run();
      return {
        description,
        passed: result.passed,
        detail: ('detail' in result ? result.detail : '') ?? '',
      };
    } catch (error) {
      return {
        description,
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  };
}

function pass(detail?: string): CheckResult {
  return { passed: true, ...(detail ? { detail } : {}) };
}

function fail(detail: string): CheckResult {
  return { passed: false, detail };
}

async function runChecks(
  output: GuardOutput,
  builders: Array<() => Promise<CheckOutcome>>,
): Promise<boolean> {
  let blocked = false;
  for (const build of builders) {
    const outcome = await build();
    pushCheck(output, outcome);
    if (!outcome.passed) blocked = true;
  }
  return blocked;
}

interface CommandRun {
  status: number;
  output: string;
}

async function removedProjectCommandField(
  field: 'build_command' | 'verify_command',
  projectRoot = classicCommandProjectRoot(),
) {
  try {
    const document = await readWorkflowProjectConfigDocument(projectRoot, {
      allowPartialProject: true,
    });
    if (!document) return false;
    return Object.prototype.hasOwnProperty.call(document.value, field);
  } catch (error) {
    throw new Error(
      `.comet/config.yaml is invalid YAML (${error instanceof Error ? error.message : String(error)}); cannot check for removed "${field}" field. Fix the config and retry.`,
      { cause: error },
    );
  }
}

function removedProjectCommandRun(field: 'build_command' | 'verify_command'): CommandRun {
  return {
    status: 1,
    output: `${field} has been removed from .comet/config.yaml. Delete this field and run any required ${field === 'build_command' ? 'build' : 'verification'} command manually before retrying.`,
  };
}

function evidenceDetail(record: RecordedCommandCheck): string {
  return `Evidence: recorded command-check at ${record.timestamp}; command: ${record.command}; cwd: ${record.cwd}`;
}

function recoveryCommand(
  change: string,
  scope: CommandCheckScope,
  command: string | readonly string[],
): string {
  const display = typeof command !== 'string' || parseLegacyArgv(command) !== null ? null : command;
  if (display === null) return `comet check rerun ${change} ${scope}`;
  return `comet check run ${change} ${scope} --local -- ${display}`;
}

/**
 * Older command-check records stored argv as a JSON string in `command`.
 * Never render that serialized array as shell syntax in a recovery hint.
 */
function parseLegacyArgv(command: string): readonly string[] | null {
  const trimmed = command.trim();
  if (!trimmed.startsWith('[')) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function guardEvidenceCwd(root: string, record: RecordedCommandCheck): Promise<string> {
  // A v2 policy entry matching the recorded command declares where its
  // evidence belongs; every other command's evidence must come from the
  // guard's invocation directory.
  const policy = await readCheckPolicy(root, {
    argv: record.argv ?? [],
    cwd: record.cwd,
  });
  if (policy.declaredCwd) return path.resolve(root, policy.declaredCwd);
  return classicCommandInvocationCwd();
}

async function commandCheckPasses(
  changeDir: string,
  change: string,
  run: ClassicRunContext['run'],
  scope: CommandCheckScope,
): Promise<CommandRun> {
  const removedFields: Array<'build_command' | 'verify_command'> =
    scope === 'build' ? ['build_command'] : ['verify_command', 'build_command'];
  for (const removedField of removedFields) {
    if (await removedProjectCommandField(removedField)) {
      return removedProjectCommandRun(removedField);
    }
  }
  const root = classicCommandProjectRoot();
  const invocationDir = path.relative(root, classicCommandInvocationCwd()) || '.';
  const evaluation = await evaluateCommandCheck(root, changeDir, run, scope);
  let recorded = evaluation.record;
  let cwdMismatched: RecordedCommandCheck | null = null;
  if (recorded) {
    const requiredCwd = await guardEvidenceCwd(root, recorded);
    if (path.resolve(root, recorded.cwd) !== path.resolve(requiredCwd)) {
      cwdMismatched = recorded;
      recorded = null;
    }
  }
  // Never let heuristic command discovery replace a deliberate Runtime check,
  // including a failed, manual, stale or cwd-mismatched record. The existing
  // evidence must be surfaced with its recovery action first.
  const previous = !recorded ? await latestCommandCheck(root, changeDir, run, scope) : null;
  const interrupted =
    !recorded && !previous
      ? await latestInterruptedCommandCheck(root, changeDir, run, scope)
      : null;
  if (!recorded) {
    if (!previous && !interrupted && process.env.COMET_SKIP_BUILD === '1')
      return { status: 0, output: 'SKIPPED via explicit COMET_SKIP_BUILD=1' };
    if (interrupted)
      return {
        status: 1,
        output: [
          `The latest Runtime ${scope} check started at ${interrupted.timestamp} but did not complete.`,
          `Its original argv, cwd, timeout and evidence policy were preserved; automatic command discovery will not replace it.`,
          `Next: comet check rerun ${change} ${scope}`,
        ].join('\n'),
      };
    if (previous && previous.exitCode !== 0)
      return {
        status: previous.exitCode,
        output: `Latest recorded ${scope} check failed with exit code ${previous.exitCode}.\n${evidenceDetail(previous)}\nNext: ${recoveryCommand(change, scope, previous.argv ?? previous.command)}`,
      };
    if (previous && previous.provenance !== 'runtime')
      return {
        status: 1,
        output: [
          `Latest ${scope} record is a manual record-check declaration (recorded ${previous.timestamp}, command: ${previous.command}).`,
          'Manual declarations never satisfy the guard, and they shadow the earlier runtime evidence until a new runtime check runs.',
          `Next: ${recoveryCommand(change, scope, '<program> [args...]')}`,
        ].join('\n'),
      };
    if (cwdMismatched)
      return {
        status: 1,
        output: [
          `No current Runtime ${scope} evidence from this directory.`,
          evidenceDetail(cwdMismatched),
          `Why: the recorded check is valid but ran in '${cwdMismatched.cwd}'; check evidence is reused only when its cwd matches the guard's invocation directory '${invocationDir}' or a matching check-policy entry.`,
          `Rerun the command in a form that executes from '${invocationDir}' (for example npm --prefix <subdir> run build for a subdirectory build) and record it again, or declare this command with cwd '${cwdMismatched.cwd}' in .comet/check-policy.json (version 2) to bind subdirectory evidence.`,
          `Next: ${recoveryCommand(change, scope, '<program> [args...]')}`,
        ].join('\n'),
      };
    const invalidation = invalidationDetail(evaluation);
    return {
      status: 1,
      output:
        scope === 'build'
          ? `No current Runtime build result. The Agent must explicitly choose its command.${invalidation}\nNext: ${recoveryCommand(change, scope, '<program> [args...]')}`
          : `No current Runtime verify evidence. Manual attestations, stale inputs and recovered checks require a new execution.${invalidation}\nNext: ${recoveryCommand(change, scope, '<program> [args...]')}`,
    };
  }
  if (recorded.exitCode !== 0) {
    return {
      status: recorded.exitCode,
      output: `Latest recorded ${scope} check failed with exit code ${recorded.exitCode}.\n${evidenceDetail(recorded)}\nNext: rerun the command successfully, then record it with:\n${recoveryCommand(change, scope, recorded.argv ?? recorded.command)}`,
    };
  }
  const tierNote =
    recorded.tier === 'incremental'
      ? ' (incremental evidence: rerun the full command before --apply)'
      : '';
  const documentNote = documentChangesDetail(evaluation);
  return { status: 0, output: `${evidenceDetail(recorded)}${tierNote}${documentNote}` };
}

function documentChangesDetail(evaluation: CommandCheckEvaluation): string {
  const ignored = evaluation.documentChangesIgnored;
  if (!ignored?.length) return '';
  const shown = ignored.slice(0, 10);
  const remainder = ignored.length - shown.length;
  return `\nIgnored document-only changes (neutral by default; declare inputs in .comet/check-policy.json or set classic.document_evidence: strict if this command consumes them): ${shown.join(', ')}${remainder > 0 ? ` (+${remainder} more)` : ''}`;
}

function invalidationDetail(evaluation: CommandCheckEvaluation): string {
  if (!evaluation.reason) return '';
  const lines = [`\nWhy: ${evaluation.reason}.`];
  if (evaluation.changedPaths?.length) {
    const shown = evaluation.changedPaths.slice(0, 20);
    const remainder = evaluation.changedPaths.length - shown.length;
    lines.push(
      `Changed inputs: ${shown.join(', ')}${remainder > 0 ? ` (+${remainder} more)` : ''}`,
    );
    if (evaluation.relevance) lines.push(`Relevance scope: ${evaluation.relevance}.`);
  }
  return lines.join('\n');
}

async function tasksAllDone(changeDir: string): Promise<CheckResult> {
  const tasks = path.join(changeDir, 'tasks.md');
  if (!(await exists(tasks))) {
    return fail(
      `tasks.md is missing at ${tasks}\nNext: restore or create tasks.md for this change before leaving build.`,
    );
  }
  const source = await readClassicProjectFile(classicCommandProjectRoot(), tasks, {
    label: `Classic tasks ${tasks}`,
  });
  const entries = parseClassicTasks(source);
  if (!entries.some((task) => task.completed)) {
    return fail(
      "tasks.md has no completed tasks.\nNext: complete implementation tasks and mark them with '- [x]'.",
    );
  }
  const unfinished = entries.filter((task) => !task.completed);
  if (unfinished.length > 0) {
    return fail(
      `Unfinished tasks:\n${unfinished.map((entry) => `${entry.line}:${entry.text}`).join('\n')}\nNext: complete or explicitly remove unfinished tasks, then mark tasks.md with '- [x]'.`,
    );
  }
  return pass();
}

async function tasksHasAny(changeDir: string): Promise<boolean> {
  const tasks = path.join(changeDir, 'tasks.md');
  if (!(await exists(tasks))) return false;
  return (
    parseClassicTasks(
      await readClassicProjectFile(classicCommandProjectRoot(), tasks, {
        label: `Classic tasks ${tasks}`,
      }),
    ).length > 0
  );
}

async function planTaskMappingValid(changeDir: string): Promise<CheckResult> {
  const plan = await readField(changeDir, 'plan');
  if (!plan || plan === 'null') return pass();
  if (!(await exists(plan))) {
    return fail(
      `plan file is missing at ${plan}\nNext: restore the implementation plan or update .comet.yaml plan before leaving build.`,
    );
  }
  const source = await readClassicProjectFile(classicCommandProjectRoot(), plan, {
    label: `Classic plan ${plan}`,
  });
  const taskFile = path.join(changeDir, 'tasks.md');
  const tasks = parseClassicTasks(
    await readClassicProjectFile(classicCommandProjectRoot(), taskFile, {
      label: 'Classic plan task authority',
    }),
  );
  const authority = path.relative(classicCommandProjectRoot(), taskFile).replaceAll('\\', '/');
  if (validateClassicTaskPlan(source, authority, tasks) === 'canonical') return pass();
  const { unmapped } = inspectClassicPlanTasks(source, tasks);
  if (unmapped.length > 0) {
    return fail(
      `Unmapped implementation plan tasks:\n${unmapped.map((entry) => `${entry.line}:${entry.text}`).join('\n')}\nNext: reconcile these items against implementation and acceptance, map them to tasks.md IDs or add genuinely extra tasks. Checkbox state alone is not evidence of completion.`,
    );
  }
  return pass();
}

async function boundBranchMatches(changeDir: string, change: string): Promise<CheckResult> {
  let outcome: BranchBindingOutcome;
  try {
    outcome = await resolveBranchBinding(changeDir, {
      heal: true,
      cwd: classicCommandInvocationCwd(),
    });
  } catch (error) {
    throw new GuardFailure(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
  switch (outcome.status) {
    case 'drift':
      return fail(driftBlockedMessage(change, outcome.boundBranch, outcome.currentBranch));
    case 'unbound-detached':
      return fail(unboundDetachedMessage(change));
    case 'healed':
      return pass(`bound_branch lazily set to ${outcome.branch}`);
    case 'needs-heal':
    case 'ok':
    case 'not-applicable':
      return pass();
    default: {
      const exhaustive: never = outcome;
      throw new Error(`unhandled branch binding status: ${JSON.stringify(exhaustive)}`);
    }
  }
}

async function isolationSelected(changeDir: string, change: string): Promise<CheckResult> {
  const isolation = await readField(changeDir, 'isolation');
  if (isolation === 'current' || isolation === 'branch' || isolation === 'worktree') return pass();
  const allowedValues = '<current|branch|worktree>';
  return fail(
    `isolation must be current, branch, or worktree, got '${isolation || 'null'}'\nNext: choose a valid workspace mode, prepare it when needed, then run:\n  comet state set ${change} isolation ${allowedValues}`,
  );
}

async function buildModeSelected(changeDir: string, change: string): Promise<CheckResult> {
  const buildMode = await readField(changeDir, 'build_mode');
  if (
    ['subagent-driven-development', 'executing-plans', 'direct', 'autonomous'].includes(buildMode)
  )
    return pass();
  return fail(
    `build_mode must be selected before leaving build, got '${buildMode || 'null'}'\nNext: ask the user to choose an execution mode, then run:\n  comet state set ${change} build_mode <subagent-driven-development|executing-plans|autonomous>`,
  );
}

async function buildModeAllowedForWorkflow(changeDir: string): Promise<CheckResult> {
  const workflow = await readField(changeDir, 'workflow');
  const buildMode = await readField(changeDir, 'build_mode');
  const directOverride = await readField(changeDir, 'direct_override');
  if (buildMode !== 'direct') return pass();
  if (workflow === 'hotfix' || workflow === 'tweak') return pass();
  if (directOverride === 'true') return pass();
  return fail(
    'build_mode=direct is only allowed for hotfix/tweak unless direct_override: true is recorded\nNext: choose executing-plans or subagent-driven-development, or stop and ask the user for an explicit direct override.',
  );
}

async function subagentDispatchConfirmed(changeDir: string, change: string): Promise<CheckResult> {
  const buildMode = await readField(changeDir, 'build_mode');
  const subagentDispatch = await readField(changeDir, 'subagent_dispatch');
  if (buildMode !== 'subagent-driven-development') return pass();
  if (subagentDispatch === 'confirmed') return pass();
  return fail(
    `subagent_dispatch must be confirmed after the user selects subagent-driven-development\nNext: resume /comet-build and use the single joint decision to confirm the supported execution configuration for ${change}`,
  );
}

async function tddModeSelected(changeDir: string, change: string): Promise<CheckResult> {
  const workflow = await readField(changeDir, 'workflow');
  if (workflow === 'hotfix' || workflow === 'tweak') return pass();
  const tddMode = await readField(changeDir, 'tdd_mode');
  if (tddMode === 'tdd' || tddMode === 'direct') return pass();
  return fail(
    `tdd_mode must be tdd or direct for full workflow, got '${tddMode || 'null'}'\nNext: ask the user to choose TDD enforcement level, then run:\n  comet state set ${change} tdd_mode <tdd|direct>`,
  );
}

async function reviewModeSelected(changeDir: string, change: string): Promise<CheckResult> {
  const workflow = await readField(changeDir, 'workflow');
  if (workflow === 'hotfix' || workflow === 'tweak') return pass();
  const reviewMode = await readField(changeDir, 'review_mode');
  if (reviewMode === 'off' || reviewMode === 'standard' || reviewMode === 'thorough') {
    return pass();
  }
  return fail(
    `review_mode must be off, standard, or thorough before leaving build, got '${reviewMode || 'null'}'\nNext: ask the user to choose review strength, then run:\n  comet state set ${change} review_mode <off|standard|thorough>`,
  );
}

async function verificationReportExists(changeDir: string): Promise<boolean> {
  const report = await readField(changeDir, 'verification_report');
  return Boolean(report) && report !== 'null' && (await exists(report));
}

async function branchStatusHandled(changeDir: string): Promise<boolean> {
  return (await readField(changeDir, 'branch_status')) === 'handled';
}

async function archivedIsTrue(changeDir: string): Promise<boolean> {
  return (await readField(changeDir, 'archived')) === 'true';
}

async function designDocRecorded(changeDir: string, change: string): Promise<CheckResult> {
  const designDoc = await readField(changeDir, 'design_doc');
  if (designDoc && designDoc !== 'null' && (await exists(designDoc))) return pass();
  return fail(
    `design_doc must point to an existing Superpowers Design Doc for full workflow before leaving design.\nNext: create the Design Doc and run: comet state set ${change} design_doc <path>`,
  );
}
async function designHandoffContextValid(changeDir: string, change: string): Promise<CheckResult> {
  const context = await readField(changeDir, 'handoff_context');
  if (!context || context === 'null') return fail('Design proposal has no source reference');
  return (await validateClassicSdkDesignContext({
    projectRoot: classicCommandProjectRoot(),
    changeDir,
    change,
    contextCompression:
      (await readField(changeDir, 'context_compression')) === 'beta' ? 'beta' : 'off',
    handoffContext: context,
  }))
    ? pass()
    : fail('Design context must reference the selected change sources');
}

async function guardOpenChecks(output: GuardOutput, changeDir: string): Promise<boolean> {
  const workflow = await readField(changeDir, 'workflow');
  const requirements = await readClassicArtifactRequirements(
    classicCommandProjectRoot(),
    changeDir,
  );
  const checks: Array<() => Promise<CheckOutcome>> = [
    check('OpenSpec required dependency closure is ready', async () =>
      requirements.problems.length ? fail(requirements.problems.join('\n')) : pass(),
    ),
    check('proposal.md exists and non-empty', async () =>
      (await nonempty(path.join(changeDir, 'proposal.md'))) ? pass() : fail(''),
    ),
    check('tasks.md exists and non-empty', async () =>
      (await nonempty(path.join(changeDir, 'tasks.md'))) ? pass() : fail(''),
    ),
    check('tasks.md has at least one task', async () =>
      (await tasksHasAny(changeDir)) ? pass() : fail(''),
    ),
  ];
  if (
    workflow === 'full' &&
    (requirements.designRequired || (await exists(path.join(changeDir, 'design.md'))))
  ) {
    checks.splice(
      1,
      0,
      check('design.md exists and non-empty', async () =>
        (await nonempty(path.join(changeDir, 'design.md'))) ? pass() : fail(''),
      ),
    );
  }
  return runChecks(output, checks);
}

async function guardDesignChecks(
  output: GuardOutput,
  changeDir: string,
  change: string,
): Promise<boolean> {
  const designDoc = await readField(changeDir, 'design_doc');
  const workflow = await readField(changeDir, 'workflow');
  const requirements = await readClassicArtifactRequirements(
    classicCommandProjectRoot(),
    changeDir,
  );
  const checkDesign =
    requirements.designRequired || (await exists(path.join(changeDir, 'design.md')));
  const builders: Array<() => Promise<CheckOutcome>> = [
    check('OpenSpec required dependency closure is ready', async () =>
      requirements.problems.length ? fail(requirements.problems.join('\n')) : pass(),
    ),
    check('proposal.md exists', async () =>
      (await nonempty(path.join(changeDir, 'proposal.md'))) ? pass() : fail(''),
    ),
    check('design.md exists', async () =>
      !checkDesign || (await nonempty(path.join(changeDir, 'design.md'))) ? pass() : fail(''),
    ),
    check('tasks.md exists', async () =>
      (await nonempty(path.join(changeDir, 'tasks.md'))) ? pass() : fail(''),
    ),
    check('design handoff context exists', () => designHandoffContextValid(changeDir, change)),
  ];
  if (workflow === 'full') {
    builders.push(
      check('design_doc is recorded for full workflow', () => designDocRecorded(changeDir, change)),
    );
  }
  let blocked = await runChecks(output, builders);
  if (designDoc && designDoc !== 'null') {
    blocked =
      (await runChecks(output, [
        check(`Design Doc (${designDoc}) exists`, async () =>
          (await nonempty(designDoc)) ? pass() : fail(''),
        ),
      ])) || blocked;
  } else if (workflow !== 'full') {
    output.stderr.push(
      yellow('  [WARN] No design_doc recorded in .comet.yaml (optional for hotfix/tweak)'),
    );
  }
  return blocked;
}

async function guardBuildChecks(
  output: GuardOutput,
  changeDir: string,
  change: string,
  run: ClassicRunContext['run'],
): Promise<boolean> {
  const blocked = await runChecks(output, [
    check('bound branch matches workspace mode', () => boundBranchMatches(changeDir, change)),
    check('isolation selected', () => isolationSelected(changeDir, change)),
    check('build_mode selected', () => buildModeSelected(changeDir, change)),
    check('build_mode allowed for workflow', () => buildModeAllowedForWorkflow(changeDir)),
    check('autonomous full build prerequisites', async () => {
      const state = (await readClassicState(changeDir, { migrate: false })).classic;
      if (!state) return fail('Classic state is missing');
      const problems = await inspectClassicAutonomousBuildProblems(
        classicCommandProjectRoot(),
        change,
        state,
      );
      return problems.length ? fail(problems.join('\n')) : pass();
    }),
    check('subagent dispatch confirmed', () => subagentDispatchConfirmed(changeDir, change)),
    check('tdd_mode selected', () => tddModeSelected(changeDir, change)),
    check('review_mode selected', () => reviewModeSelected(changeDir, change)),
    check('tasks.md all tasks checked', () => tasksAllDone(changeDir)),
    check('plan task mapping is valid', () => planTaskMappingValid(changeDir)),
    check('proposal.md exists', async () =>
      (await nonempty(path.join(changeDir, 'proposal.md'))) ? pass() : fail(''),
    ),
  ]);
  if (blocked) return true;
  return runChecks(output, [
    check('Build passes', async () => {
      const buildResult = await commandCheckPasses(changeDir, change, run, 'build');
      return buildResult.status === 0 ? pass(buildResult.output) : fail(buildResult.output);
    }),
  ]);
}

async function guardVerifyChecks(
  output: GuardOutput,
  changeDir: string,
  change: string,
  run: ClassicRunContext['run'],
): Promise<boolean> {
  const blocked = await runChecks(output, [
    check('bound branch matches workspace mode', () => boundBranchMatches(changeDir, change)),
    check('tasks.md all tasks checked', () => tasksAllDone(changeDir)),
    check('verification_report exists', async () =>
      (await verificationReportExists(changeDir)) ? pass() : fail(''),
    ),
  ]);
  if (blocked) return true;
  return runChecks(output, [
    check('Verification passes', async () => {
      const result = await commandCheckPasses(changeDir, change, run, 'verify');
      return result.status === 0 ? pass(result.output) : fail(result.output);
    }),
  ]);
}

async function guardArchiveChecks(
  output: GuardOutput,
  changeDir: string,
  change: string,
): Promise<boolean> {
  return runChecks(output, [
    check('bound branch matches workspace mode', () => boundBranchMatches(changeDir, change)),
    check('archived is true', async () => ((await archivedIsTrue(changeDir)) ? pass() : fail(''))),
    check('proposal.md exists', async () =>
      (await nonempty(path.join(changeDir, 'proposal.md'))) ? pass() : fail(''),
    ),
    check('archived required artifacts exist', async () => {
      const problems = await classicArchivedRequirementsProblems(
        classicCommandProjectRoot(),
        changeDir,
      );
      return problems.length ? fail(problems.join('\n')) : pass();
    }),
    check('tasks.md all tasks checked', () => tasksAllDone(changeDir)),
    check('branch_status=handled', async () =>
      (await branchStatusHandled(changeDir)) ? pass() : fail(''),
    ),
  ]);
}

async function applyStateUpdate(
  output: GuardOutput,
  change: string,
  changeDir: string,
  phase: string,
): Promise<void> {
  return withClassicStateLock(changeDir, () =>
    applyStateUpdateLocked(output, change, changeDir, phase),
  );
}

async function applyStateUpdateLocked(
  output: GuardOutput,
  change: string,
  changeDir: string,
  phase: string,
): Promise<void> {
  const event = CLASSIC_GUARD_TRANSITION_EVENT[phase as ClassicPhase];
  if (!event) return;

  // Re-read instead of reusing the run context captured before the checks:
  // boundBranchMatches may have lazily healed bound_branch on disk, and a
  // stale projection would write the pre-heal null back over it.
  const context = await ensureClassicRuntimeRun(changeDir);

  if ((phase === 'build' || phase === 'verify') && process.env.COMET_SKIP_BUILD !== '1') {
    const evaluation = await evaluateCommandCheck(
      classicCommandProjectRoot(),
      changeDir,
      context.run,
      phase,
    );
    const record = evaluation.record;
    const cwdMismatched = Boolean(
      record &&
      path.resolve(classicCommandProjectRoot(), record.cwd) !==
        path.resolve(await guardEvidenceCwd(classicCommandProjectRoot(), record)),
    );
    if (!record || record.tier === 'incremental' || cwdMismatched) {
      const reason =
        record?.tier === 'incremental'
          ? 'Incremental check evidence cannot advance the phase; rerun the full command before --apply.'
          : cwdMismatched && record
            ? `Check evidence ran in '${record.cwd}', not the guard's invocation directory '${
                path.relative(classicCommandProjectRoot(), classicCommandInvocationCwd()) || '.'
              }'; rerun the check from the invocation directory, or declare its cwd in .comet/check-policy.json (version 2), before --apply.`
            : 'Check evidence changed before transition; rerun the check.';
      throw new GuardFailure(reason);
    }
  }
  const result = applyClassicTransition(context.classic, event);
  if (phase === 'verify' && process.env.COMET_SKIP_BUILD !== '1') {
    const check = await latestCommandCheck(
      classicCommandProjectRoot(),
      changeDir,
      context.run,
      'verify',
    );
    if (!check) throw new GuardFailure('Verify 检查已变化，不能记录接受证据');
    await rememberClassicAcceptedVerifyCheck(
      classicCommandProjectRoot(),
      changeDir,
      context.run,
      result.classic,
      check,
    );
  }
  await transitionClassicRuntimeRun(changeDir, result.classic, context.run, {
    event,
    phase,
    source: 'comet-guard',
  });
  await appendClassicStateEvent(changeDir, {
    change,
    event,
    source: 'comet-guard',
    from: context.classic,
    to: result.classic,
    effects: result.effects,
  });

  for (const effect of result.effects) {
    output.stderr.push(green(`[SET] ${wireField(effect.field)}=${wireValue(effect.to)}`));
  }
  output.stderr.push(green(`[TRANSITION] ${event}`));
  const template = APPLY_MESSAGE[phase];
  const message =
    phase === 'open' ? template.replace('PLACEHOLDER', result.classic.phase) : template;
  output.stderr.push(green(message));
}

export const classicGuardCommand: ClassicCommandHandler = withProjectContext(
  async (args, options) => {
    const output = new GuardOutput();
    const [change, phase, flag] = args;
    try {
      if (args.length < 2) {
        throw new GuardFailure(
          'Usage: comet guard <change-name> <open|design|build|verify|archive> [--apply]',
        );
      }
      validateChangeName(change);
      if (!phase || !PHASES.includes(phase as (typeof PHASES)[number])) {
        throw new GuardFailure(
          `${red(`Unknown phase: ${phase ?? ''}`)}\nValid phases: open, design, build, verify, archive`,
        );
      }
      const projectRoot = classicCommandProjectRoot();
      const localOwner = await resolveClassicChangeRuntimeOwner(projectRoot, change);
      const sdkWorkspace =
        localOwner?.format === 'compat' ? null : await findClassicSdkWorkspace(projectRoot, change);
      if (sdkWorkspace) {
        const sessionIndex = args.indexOf('--session');
        const sessionSeparator = args.indexOf('--');
        let sessionId: string | undefined;
        if (sessionIndex >= 0 && (sessionSeparator < 0 || sessionIndex < sessionSeparator)) {
          sessionId = args[sessionIndex + 1];
          if (phase !== 'build' || !sessionId?.trim() || sessionId.startsWith('--'))
            throw new GuardFailure('--session requires a Builder execution reference');
          args = args.filter((_, index) => index !== sessionIndex && index !== sessionIndex + 1);
        }
        const localIndex = args.indexOf('--local');
        const commandSeparator = args.indexOf('--');
        let reusable = localIndex >= 0 && (commandSeparator < 0 || localIndex < commandSeparator);
        if (reusable) {
          if (!['build', 'verify'].includes(phase) || !args.includes('--apply'))
            throw new GuardFailure('--local requires an applied Build or Verify check');
          args = args.filter((_, index) => index !== localIndex);
        }
        let requestedCheckCwd: string | undefined;
        let requestedCheckTimeoutMs: number | undefined;
        for (const option of ['--cwd', '--timeout-ms']) {
          const index = args.indexOf(option);
          const separator = args.indexOf('--');
          if (index < 0 || (separator >= 0 && index > separator)) continue;
          const value = args[index + 1];
          if (
            !['build', 'verify'].includes(phase) ||
            !args.includes('--apply') ||
            !value ||
            value.startsWith('--')
          )
            throw new GuardFailure(
              `${option} requires an applied Build or Verify check and a value`,
            );
          if (option === '--cwd') requestedCheckCwd = value;
          else {
            requestedCheckTimeoutMs = Number(value);
            if (!Number.isSafeInteger(requestedCheckTimeoutMs) || requestedCheckTimeoutMs <= 0)
              throw new GuardFailure('--timeout-ms requires a positive integer');
          }
          args = args.filter((_, current) => current !== index && current !== index + 1);
        }
        if (
          (requestedCheckCwd !== undefined || requestedCheckTimeoutMs !== undefined) &&
          !args.includes('--')
        )
          throw new GuardFailure(
            'Check cwd and timeout options require a literal program after --',
          );
        if (phase === 'open') {
          const apply = args.length === 5 && args[2] === '--apply' && args[3] === '--approval-hash';
          if (args.length !== 2 && !apply) {
            throw new GuardFailure(
              'Usage: comet guard <change-name> open [--apply --approval-hash <sha256>]',
            );
          }
          return classicSdkOpenGuard({
            inspected: sdkWorkspace,
            projectRoot: sdkWorkspace.projectRoot,
            change,
            apply,
            ...(apply ? { approvalHash: args[4] } : {}),
          });
        }
        if (phase === 'design') {
          const apply = args.length === 7 && args[4] === '--apply' && args[5] === '--approval-hash';
          if (args[2] !== '--design-doc' || !args[3] || (args.length !== 4 && !apply)) {
            throw new GuardFailure(
              'Usage: comet guard <change-name> design --design-doc <repo-relative-ref> [--apply --approval-hash <sha256>]',
            );
          }
          return classicSdkDesignGuard({
            inspected: sdkWorkspace,
            projectRoot: sdkWorkspace.projectRoot,
            change,
            designDoc: args[3],
            apply,
            ...(apply ? { approvalHash: args[6] } : {}),
          });
        }
        if (phase === 'build') {
          const apply = args[2] === '--apply';
          const separator = args.indexOf('--');
          if (
            args.length !== 2 &&
            !(apply && args.length === 3) &&
            !(apply && separator === 3 && args.length >= 5)
          ) {
            throw new GuardFailure(
              'Usage: comet guard <change-name> build [--apply [-- <program> [args...]]]',
            );
          }
          let argv = separator === 3 ? args.slice(separator + 1) : undefined;
          let checkCwd: string | undefined = requestedCheckCwd;
          let checkTimeoutMs: number | undefined = requestedCheckTimeoutMs;
          if (apply && !argv) {
            const pendingReceipt = sdkWorkspace.run.evidenceWaits?.some(
              (wait) =>
                wait.stepId === `${sdkWorkspace.state.workflow}.build.check.evidence` &&
                wait.status === 'pending',
            );
            const previous = sdkWorkspace.run.actions
              .slice()
              .reverse()
              .find((action) => action.stepId === `${sdkWorkspace.state.workflow}.build.check`);
            const recorded = previous?.outcome?.output as
              { argv?: unknown; cwd?: unknown; timeoutMs?: number; reusable?: boolean } | undefined;
            if (
              pendingReceipt &&
              Array.isArray(recorded?.argv) &&
              recorded.argv.every((arg) => typeof arg === 'string') &&
              typeof recorded.cwd === 'string'
            ) {
              argv = recorded.argv as string[];
              checkCwd = recorded.cwd;
              checkTimeoutMs = recorded.timeoutMs;
              reusable = recorded.reusable === true;
            } else if (previous) {
              throw new GuardFailure(
                `A previous Classic SDK Build check exists; run comet check run ${change} build -- <program> [args...] explicitly`,
              );
            } else {
              throw new GuardFailure(
                `Build command is not selected; run comet guard ${change} build --apply -- <program> [args...] explicitly`,
              );
            }
          }
          return classicSdkBuildGuard({
            inspected: sdkWorkspace,
            projectRoot: sdkWorkspace.projectRoot,
            invocationCwd: classicCommandInvocationCwd(),
            change,
            apply,
            reusable,
            sessionId,
            ...(argv ? { argv } : {}),
            ...(checkCwd ? { checkCwd } : {}),
            ...(checkTimeoutMs === undefined ? {} : { checkTimeoutMs }),
          });
        }
        if (phase === 'verify') {
          const apply = args[4] === '--apply';
          const separator = args.indexOf('--');
          if (
            args[2] !== '--report' ||
            !args[3] ||
            (args.length !== 4 &&
              !(apply && args.length === 5) &&
              !(apply && separator === 5 && args.length >= 7))
          ) {
            throw new GuardFailure(
              'Usage: comet guard <change-name> verify --report <repo-relative-ref> [--apply -- <program> [args...]]',
            );
          }
          let argv = separator === 5 ? args.slice(separator + 1) : undefined;
          let checkCwd: string | undefined = requestedCheckCwd;
          let checkTimeoutMs: number | undefined = requestedCheckTimeoutMs;
          if (apply && !argv) {
            const pendingReceipt = sdkWorkspace.run.evidenceWaits?.some(
              (wait) =>
                wait.stepId === `${sdkWorkspace.state.workflow}.verify.check.evidence` &&
                wait.status === 'pending',
            );
            const previous = sdkWorkspace.run.actions
              .slice()
              .reverse()
              .find((action) => action.stepId === `${sdkWorkspace.state.workflow}.verify.check`);
            const recorded = previous?.outcome?.output as
              { argv?: unknown; cwd?: unknown; timeoutMs?: number; reusable?: boolean } | undefined;
            if (
              pendingReceipt &&
              previous?.status === 'succeeded' &&
              Array.isArray(recorded?.argv) &&
              recorded.argv.every((arg) => typeof arg === 'string') &&
              typeof recorded.cwd === 'string'
            ) {
              argv = recorded.argv as string[];
              checkCwd = recorded.cwd;
              checkTimeoutMs = recorded.timeoutMs;
              reusable = recorded.reusable === true;
            } else {
              throw new GuardFailure(
                `A literal Verify check command is required; run comet guard ${change} verify --report ${args[3]} --apply -- <program> [args...]`,
              );
            }
          }
          return classicSdkVerifyGuard({
            inspected: sdkWorkspace,
            projectRoot: sdkWorkspace.projectRoot,
            invocationCwd: classicCommandInvocationCwd(),
            change,
            reportRef: args[3],
            apply,
            reusable,
            ...(argv ? { argv } : {}),
            ...(checkCwd ? { checkCwd } : {}),
            ...(checkTimeoutMs === undefined ? {} : { checkTimeoutMs }),
          });
        }
        if (phase === 'archive') {
          if (args.length !== 2 && !(args.length === 3 && args[2] === '--apply')) {
            throw new GuardFailure('Usage: comet guard <change-name> archive [--apply]');
          }
          return classicSdkArchiveGuard({
            inspected: sdkWorkspace,
            projectRoot: sdkWorkspace.projectRoot,
            change,
            apply: args.length === 3,
          });
        }
        throw new GuardFailure(`Classic SDK ${phase} Guard is not yet available`);
      }
      if (args.length > 3 || (flag !== undefined && flag !== '--apply')) {
        throw new GuardFailure(
          'Usage: comet guard <change-name> <open|design|build|verify|archive> [--apply]',
        );
      }
      await assertClassicLayoutWritable(classicCommandProjectRoot());
      const changeDir = await resolveChangeDir(change);
      await preflight(changeDir, change);
      const runContext = await ensureClassicRuntimeRun(changeDir);
      output.data = {
        change,
        phase: runContext.classic.phase,
        projectRoot: classicCommandProjectRoot(),
        changeDir,
      };
      const diagnostic = await inspectClassicChange(changeDir, change);
      if (options.json) {
        output.diagnostics = {
          change,
          phase,
          currentStep: diagnostic.currentStep,
          runtimeEval: diagnostic.runtimeEval,
        };
      }
      output.stderr.push(PHASE_HEADER[phase]);

      let blocked: boolean;
      if (phase === 'open') blocked = await guardOpenChecks(output, changeDir);
      else if (phase === 'design') blocked = await guardDesignChecks(output, changeDir, change);
      else if (phase === 'build')
        blocked = await guardBuildChecks(output, changeDir, change, runContext.run);
      else if (phase === 'verify')
        blocked = await guardVerifyChecks(output, changeDir, change, runContext.run);
      else blocked = await guardArchiveChecks(output, changeDir, change);

      const envelope = classicGuardCheckEnvelope({
        name: change,
        phase,
        failed: output.checksFailed,
        total: output.checksPassed + output.checksFailed,
        locale: classicLocale(runContext.classic.language),
      });
      output.envelope = envelope;

      if (blocked) {
        output.stderr.push('');
        output.stderr.push(envelope.summary);
        if (envelope.user_message) output.stderr.push(`RELAY TO USER: ${envelope.user_message}`);
        output.stderr.push('');
        output.stderr.push(red('BLOCKED — fix failing checks before proceeding to next phase'));
        return output.toResult(1);
      }
      output.stderr.push('');
      output.stderr.push(envelope.summary);
      if (phase === 'archive') {
        output.stderr.push(
          green('ALL CHECKS PASSED — archive completeness verified; no further phase transition.'),
        );
      } else if (flag === '--apply') {
        output.stderr.push(green('ALL CHECKS PASSED — ready for next phase'));
        // Capture the committed projection before releasing the lock so a later
        // writer cannot make this successful transition look like a read failure.
        const updated = await withClassicStateLock(changeDir, async () => {
          await applyStateUpdate(output, change, changeDir, phase);
          return readClassicState(changeDir, { migrate: false });
        });
        if (updated.classic)
          output.data = {
            ...(await classicRecoveryContext(
              classicCommandProjectRoot(),
              changeDir,
              updated.classic,
              false,
              updated.run ?? null,
            )),
            change,
            phase: updated.classic.phase,
            configuration: updated.classic,
          };
      } else {
        output.stderr.push(green('ALL CHECKS PASSED — ready for next phase'));
        output.stderr.push(
          `Check only: phase unchanged. To advance, run comet guard ${change} ${phase} --apply`,
        );
      }
      return output.toResult(0);
    } catch (error) {
      output.issues.push(classicIssue(error));
      if (error instanceof GuardFailure) {
        for (const line of error.message.split('\n')) output.stderr.push(line);
        return output.toResult(error.exitCode);
      }
      output.stderr.push(error instanceof Error ? error.message : String(error));
      return output.toResult(70);
    }
  },
);
