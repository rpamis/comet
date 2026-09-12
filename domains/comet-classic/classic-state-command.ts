import { spawnSync } from 'child_process';
import path from 'path';
import { Document, parseDocument } from 'yaml';
import type { CliOutputEnvelope } from '../workflow-contract/output-envelope.js';
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import {
  clearCurrentChange,
  resolveCurrentChange,
  selectCurrentChange,
} from './classic-current-change.js';
import {
  driftBlockedMessage,
  evaluateBranchBinding,
  healBoundBranch,
  isGitWorkTree,
  liveGitBranch,
  requiresBranchBinding,
  resolveBranchBinding,
  unboundDetachedMessage,
} from './classic-branch-binding.js';
import { collectClassicEvidence } from './classic-evidence.js';
import {
  collectClassicSpecFiles,
  ensureClassicActiveChangeDirectory,
  openSpecChangeNameError,
  resolveClassicChangeDirectory,
} from './classic-paths.js';
import { assertClassicLayoutWritable, assertClassicLayoutReadable } from './classic-layout.js';
import {
  classicCommandInvocationCwd,
  classicCommandProjectRoot,
  withProjectContext,
} from './classic-command-context.js';
import { resolveClassicStepId } from './classic-resolver.js';
import { reconcileClassicRuntimeRun, transitionClassicRuntimeRun } from './classic-runtime-run.js';
import { appendClassicStateEvent } from './classic-state-events.js';
import { parseClassicStateDocument, type ClassicState } from './classic-state.js';
import { FIELD_ENUMS, MACHINE_OWNED_FIELDS, SETTABLE_FIELDS } from './classic-state-options.js';
import { readClassicState, writeClassicState, withClassicStateLock } from './classic-store.js';
import {
  CLASSIC_TRANSITION_EVENTS,
  applyClassicTransition,
  type ClassicTransitionEvent,
} from './classic-transitions.js';
import { readRunState } from '../../domains/engine/state.js';
import { appendTrajectory, readTrajectory } from '../../domains/engine/run-store.js';
import {
  recordCommandCheck,
  recoverCommandChecks,
  type CommandCheckScope,
} from './classic-command-checks.js';
import { classicGuardCommand } from './classic-guard.js';
import { readClassicConfigValue } from './classic-project-config.js';
import {
  classicEntryCheckEnvelope,
  classicLocale,
  classicNextEnvelope,
  classicRecoveryEnvelope,
  classicScaleEnvelope,
  classicTransitionEnvelope,
} from './classic-output-language.js';
import {
  classicProjectFileNonempty,
  classicProjectTargetExists,
  inspectClassicProjectTarget,
  readClassicProjectFile,
  writeClassicProjectText,
} from './classic-protected-path.js';
import { resolveClassicWorkspace } from './classic-workspace.js';
import { classicRecoveryContext } from './classic-recovery.js';
import { classicConfigurationReadiness } from './classic-build-configuration.js';
import { classicHandoffCommand } from './classic-handoff.js';
import { classicIssue, type ClassicIssue } from './classic-issues.js';
import {
  readClassicCheckpoint,
  writeClassicCheckpoint,
  readClassicDelivery,
  writeClassicDelivery,
  invalidateClassicDelivery,
} from './classic-progress.js';
import { readClassicArtifactRequirements } from './classic-artifact-requirements.js';
import {
  assignClassicTaskIds,
  classicTaskRevision,
  completeClassicTask,
  parseClassicTasks,
  inspectClassicPlanTasks,
  synchronizeClassicPlanTasks,
} from './classic-tasks.js';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';
const PROFILES = ['full', 'hotfix', 'tweak'] as const;
const PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;
const ARTIFACT_LANGUAGES = ['en', 'zh-CN'] as const;
const EVENTS = CLASSIC_TRANSITION_EVENTS;
const PATH_FIELDS = new Set(['design_doc', 'plan', 'verification_report', 'handoff_context']);
const CLASSIC_FIELD_WIRE_NAMES: Partial<Record<keyof ClassicState, string>> = {
  archived: 'archived',
  branchStatus: 'branch_status',
  classicProfile: 'classic_profile',
  designDoc: 'design_doc',
  language: 'language',
  phase: 'phase',
  verificationReport: 'verification_report',
  verifiedAt: 'verified_at',
  archiveConfirmation: 'archive_confirmation',
  verifyResult: 'verify_result',
  verifyFailures: 'verify_failures',
  checkEpoch: 'check_epoch',
  workflow: 'workflow',
};

class CommandFailure extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
    readonly issue?: ClassicIssue,
  ) {
    super(message);
  }
}

class CommandOutput {
  stdout: string[] = [];
  stderr: string[] = [];
  envelope?: CliOutputEnvelope;
  data?: unknown;

  result(exitCode = 0): ClassicCommandResult {
    return {
      exitCode,
      ...(this.data === undefined ? {} : { data: this.data }),
      ...(this.stdout.length > 0 ? { stdout: this.stdout.join('\n') + '\n' } : {}),
      ...(this.stderr.length > 0 ? { stderr: this.stderr.join('\n') } : {}),
      ...(this.envelope === undefined ? {} : { envelope: this.envelope }),
    };
  }
}

function green(message: string): string {
  return `${GREEN}${message}${RESET}`;
}

function red(message: string): string {
  return `${RED}${message}${RESET}`;
}

function yellow(message: string): string {
  return `${YELLOW}${message}${RESET}`;
}

function fail(message: string): never {
  throw new CommandFailure(message);
}

function validateChangeName(name: string | undefined): asserts name is string {
  const error = openSpecChangeNameError(name);
  if (error) fail(`ERROR: ${error}`);
}

function validateEnum(value: string, values: readonly string[]): void {
  if (!values.includes(value)) {
    fail(`ERROR: Invalid value: '${value}'\nValid values: ${values.join(' ')}`);
  }
}

function validateLanguage(value: string, source: string): string {
  if (ARTIFACT_LANGUAGES.includes(value as (typeof ARTIFACT_LANGUAGES)[number])) {
    return value;
  }
  fail(`ERROR: Invalid language from ${source}: '${value}'\nValid values: en, zh-CN`);
}

function validateRelativePath(value: string, field: string): void {
  if (!value || value === 'null') return;
  if (/^(?:[A-Za-z]:|[\\/]|~)/u.test(value)) {
    throw new CommandFailure(
      `ERROR: ${field} must be a relative path within the repo: '${value}'`,
      1,
      {
        code: 'CLASSIC_ARTIFACT_REF_INVALID',
        field,
        actual: value,
        expected: 'repository-relative path',
        message: `${field} must use a repository-relative reference.`,
        remediation:
          'Use entry.artifactRefs for state registration; absolute paths are for file operations.',
      },
    );
  }
  if (value.split(/[\\/]/u).includes('..')) {
    throw new CommandFailure(
      `ERROR: ${field} cannot contain '..' (path traversal not allowed): '${value}'`,
      1,
      {
        code: 'CLASSIC_ARTIFACT_REF_INVALID',
        field,
        actual: value,
        expected: 'repository-relative path without traversal',
        message: `${field} cannot traverse outside its artifact root.`,
      },
    );
  }
}

async function exists(file: string): Promise<boolean> {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectTargetExists(projectRoot, file, {
    label: `Classic project path ${path.relative(projectRoot, path.resolve(projectRoot, file)).replaceAll('\\', '/')}`,
  });
}

async function nonempty(file: string): Promise<boolean> {
  const projectRoot = classicCommandProjectRoot();
  return classicProjectFileNonempty(
    projectRoot,
    file,
    `Classic project file ${path.relative(projectRoot, path.resolve(projectRoot, file)).replaceAll('\\', '/')}`,
  );
}

async function changeDirectory(name: string): Promise<{ label: string; directory: string }> {
  return resolveClassicChangeDirectory(name, classicCommandProjectRoot());
}

async function readDocument(file: string): Promise<Document> {
  let source: string;
  const projectRoot = classicCommandProjectRoot();
  try {
    source = await readClassicProjectFile(projectRoot, file, {
      label: `Classic state ${path.relative(projectRoot, file).replaceAll('\\', '/')}`,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail(
        `ERROR: .comet.yaml not found at ${path.relative(projectRoot, file).replaceAll('\\', '/')}`,
      );
    }
    throw error;
  }
  const document = parseDocument(source, { uniqueKeys: false });
  if (document.errors.length > 0) fail(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  return document;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await writeClassicProjectText(classicCommandProjectRoot(), file, content, {
    label: 'Classic state write target',
  });
}

function scalar(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function wireField(field: keyof ClassicState): string {
  return CLASSIC_FIELD_WIRE_NAMES[field] ?? String(field);
}

function wireValue(value: unknown): string {
  return value === null ? 'null' : scalar(value);
}

function enumRecordValue<const T extends readonly string[]>(
  record: Record<string, unknown>,
  field: string,
  values: T,
  fallback: T[number] | null,
): T[number] | null {
  const value = record[field];
  return typeof value === 'string' && values.includes(value as T[number])
    ? (value as T[number])
    : fallback;
}

function nullableRecordString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value : String(value);
}

function nullableRecordBoolean(record: Record<string, unknown>, field: string): boolean | null {
  const value = record[field];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function nonNegativeRecordInteger(
  record: Record<string, unknown>,
  field: string,
  fallback = 0,
): number {
  const value = record[field];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function sparseClassicState(record: Record<string, unknown>): ClassicState {
  const workflow = enumRecordValue(record, 'workflow', PROFILES, 'full')!;
  return {
    workflow,
    language: enumRecordValue(record, 'language', ARTIFACT_LANGUAGES, null),
    phase: enumRecordValue(record, 'phase', PHASES, 'open')!,
    contextCompression: enumRecordValue(
      record,
      'context_compression',
      ['off', 'beta'] as const,
      null,
    ),
    buildMode: enumRecordValue(
      record,
      'build_mode',
      ['subagent-driven-development', 'executing-plans', 'autonomous', 'direct'] as const,
      null,
    ),
    buildPause: enumRecordValue(record, 'build_pause', ['plan-ready'] as const, null),
    subagentDispatch: enumRecordValue(record, 'subagent_dispatch', ['confirmed'] as const, null),
    tddMode: enumRecordValue(record, 'tdd_mode', ['tdd', 'direct'] as const, null),
    reviewMode: enumRecordValue(
      record,
      'review_mode',
      ['off', 'standard', 'thorough'] as const,
      null,
    ),
    isolation: enumRecordValue(
      record,
      'isolation',
      ['current', 'branch', 'worktree'] as const,
      null,
    ),
    boundBranch: nullableRecordString(record, 'bound_branch'),
    verifyMode: enumRecordValue(record, 'verify_mode', ['light', 'full'] as const, null),
    autoTransition: nullableRecordBoolean(record, 'auto_transition'),
    baseRef: nullableRecordString(record, 'base_ref'),
    designDoc: nullableRecordString(record, 'design_doc'),
    plan: nullableRecordString(record, 'plan'),
    verifyResult: enumRecordValue(
      record,
      'verify_result',
      ['pending', 'pass', 'fail'] as const,
      'pending',
    )!,
    verifyFailures: nonNegativeRecordInteger(record, 'verify_failures'),
    checkEpoch: nonNegativeRecordInteger(record, 'check_epoch'),
    verificationReport: nullableRecordString(record, 'verification_report'),
    branchStatus: enumRecordValue(record, 'branch_status', ['pending', 'handled'] as const, null),
    createdAt: nullableRecordString(record, 'created_at'),
    verifiedAt: nullableRecordString(record, 'verified_at'),
    archiveConfirmation: enumRecordValue(
      record,
      'archive_confirmation',
      ['pending', 'confirmed'] as const,
      null,
    ),
    archived: nullableRecordBoolean(record, 'archived') ?? false,
    directOverride: nullableRecordBoolean(record, 'direct_override'),
    handoffContext: nullableRecordString(record, 'handoff_context'),
    handoffHash: nullableRecordString(record, 'handoff_hash'),
    classicProfile: enumRecordValue(record, 'classic_profile', PROFILES, workflow),
    classicMigration:
      typeof record.classic_migration === 'number' ? record.classic_migration : null,
  };
}

async function projectConfigValue(
  field: 'context_compression' | 'auto_transition' | 'review_mode' | 'language',
): Promise<string | null> {
  return (await readClassicConfigValue(field, { cwd: classicCommandProjectRoot() }))?.value ?? null;
}

async function projectLanguageDefault(): Promise<string> {
  if (process.env.COMET_LANGUAGE)
    return validateLanguage(process.env.COMET_LANGUAGE, 'COMET_LANGUAGE');
  const configured = await readClassicConfigValue('language', {
    cwd: classicCommandProjectRoot(),
  });
  if (configured) return validateLanguage(configured.value, configured.source);
  return 'en';
}

async function contextCompression(): Promise<string> {
  const value =
    process.env.COMET_CONTEXT_COMPRESSION ??
    (await projectConfigValue('context_compression')) ??
    'off';
  if (!['off', 'beta'].includes(value)) {
    fail(`ERROR: Invalid context_compression: '${value}'\nValid values: off, beta`);
  }
  return value;
}

async function autoTransition(): Promise<string> {
  const value =
    process.env.COMET_AUTO_TRANSITION ?? (await projectConfigValue('auto_transition')) ?? 'true';
  if (!['true', 'false'].includes(value)) {
    fail(`ERROR: Invalid auto_transition: '${value}'\nValid values: true, false`);
  }
  return value;
}

async function reviewModeDefault(): Promise<string | null> {
  const value =
    process.env.COMET_REVIEW_MODE ?? (await projectConfigValue('review_mode')) ?? 'standard';
  if (!['null', 'off', 'standard', 'thorough'].includes(value)) {
    fail(`ERROR: Invalid review_mode: '${value}'\nValid values: off, standard, thorough`);
  }
  return value === 'null' ? null : value;
}

function gitOutput(args: string[]): string | null {
  const result = spawnSync('git', args, {
    cwd: classicCommandProjectRoot(),
    encoding: 'utf8',
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function stateFile(
  name: string,
): Promise<{ file: string; label: string; directory: string }> {
  const change = await changeDirectory(name);
  await inspectClassicProjectTarget(
    classicCommandProjectRoot(),
    path.join(change.directory, '.comet'),
    {
      label: `Classic runtime directory for ${name}`,
      expected: 'directory',
    },
  );
  return {
    ...change,
    file: path.join(change.directory, '.comet.yaml'),
  };
}

async function readField(name: string, field: string): Promise<string> {
  const { file } = await stateFile(name);
  const document = await readDocument(file);
  // Read via toJS so an explicit `field: null` round-trips as JS null (-> "null"),
  // matching the shell `yaml_field` grep contract. A bare Document#get returns
  // undefined for null-valued keys, erasing the distinction between "present but
  // null" and "absent" that the frozen 0.3.8 behavior preserves.
  const record = document.toJS() as Record<string, unknown>;
  return readRecordField(record, field);
}

async function readRecordField(record: Record<string, unknown>, field: string): Promise<string> {
  const value = record[field];
  if (field === 'language') {
    if (value === null || value === undefined || value === '') return projectLanguageDefault();
    return validateLanguage(scalar(value), '.comet.yaml');
  }
  if (field === 'auto_transition' && (value === null || value === undefined || value === '')) {
    return autoTransition();
  }
  return scalar(value);
}

function parsedValue(field: string, value: string): unknown {
  const document = parseDocument(`${field}: ${value}\n`);
  if (document.errors.length > 0) fail(`ERROR: Invalid value: '${value}'`);
  return document.get(field);
}

async function validateSetValue(field: string, value: string): Promise<void> {
  if (field === 'language') {
    validateLanguage(value, 'language');
    return;
  }
  const enumValues = FIELD_ENUMS[field];
  if (enumValues && !enumValues.includes(value))
    throw new CommandFailure(
      `ERROR: Invalid value: '${value}'\nValid values: ${enumValues.join(' ')}`,
      1,
      {
        code: 'CLASSIC_FIELD_VALUE_INVALID',
        field,
        actual: value,
        expected: enumValues,
        message: `Invalid value for ${field}.`,
      },
    );
  if (PATH_FIELDS.has(field)) {
    validateRelativePath(value, field);
    if (value && value !== 'null') {
      await inspectClassicProjectTarget(classicCommandProjectRoot(), value, {
        label: `${field} artifact pointer`,
        expected: 'file',
      });
    }
  }
  if ((field === 'skill_hash' || field === 'handoff_hash') && !/^[a-f0-9]{64}$/u.test(value)) {
    fail(`ERROR: ${field} must be a sha256 hex digest`);
  }
  if (field === 'iteration' && !/^[0-9]+$/u.test(value)) {
    fail('ERROR: iteration must be a non-negative integer');
  }
}

async function setFields(
  output: CommandOutput,
  name: string,
  updates: Array<[string, string]>,
  options: { internal?: boolean; machineOwned?: boolean } = {},
): Promise<void> {
  const { directory } = await stateFile(name);
  return withClassicStateLock(directory, () => setFieldsLocked(output, name, updates, options));
}

async function setFieldsLocked(
  output: CommandOutput,
  name: string,
  updates: Array<[string, string]>,
  options: { internal?: boolean; machineOwned?: boolean },
): Promise<void> {
  const seen = new Set<string>();
  for (const [field, value] of updates) {
    if (seen.has(field)) fail(`ERROR: Duplicate field: '${field}'`);
    seen.add(field);
    if (MACHINE_OWNED_FIELDS.has(field) && !options.machineOwned) {
      fail(`ERROR: '${field}' is a machine-owned field and cannot be set directly`);
    }
    if (!SETTABLE_FIELDS.has(field) && !MACHINE_OWNED_FIELDS.has(field)) {
      throw new CommandFailure(`ERROR: Unknown field: '${field}'`, 1, {
        code: 'CLASSIC_FIELD_UNKNOWN',
        field,
        actual: field,
        expected: [...SETTABLE_FIELDS],
        message: `Unknown Classic state field: ${field}.`,
      });
    }
    if (field === 'phase' && !options.internal && process.env.COMET_FORCE_PHASE !== '1') {
      fail(
        "ERROR: Setting 'phase' directly is not allowed; it bypasses state machine evidence checks.\n" +
          '  Use: comet state transition <change-name> <event>\n' +
          '  Repair-only escape hatch: COMET_FORCE_PHASE=1 comet state set <change-name> phase <value>',
      );
    }
    await validateSetValue(field, value);
  }
  const { file, directory } = await stateFile(name);
  const document = await readDocument(file);
  const previousRecord = (document.toJS() ?? {}) as Record<string, unknown>;
  for (const [field, value] of updates) {
    document.set(field, parsedValue(field, value));
    if (field === 'phase' && previousRecord.phase !== value) {
      const epoch = nonNegativeRecordInteger(previousRecord, 'check_epoch');
      if (!Number.isSafeInteger(epoch + 1)) fail('ERROR: Invalid Classic check epoch');
      document.set('check_epoch', epoch + 1);
    }
    if (field === 'isolation') {
      if (requiresBranchBinding(value)) {
        const previousIsolation =
          typeof previousRecord.isolation === 'string' ? previousRecord.isolation : null;
        const existing = previousRecord.bound_branch;
        const alreadyBound = typeof existing === 'string' && existing !== '';
        // Switching between workspace modes is an explicit new workspace
        // decision and re-points the binding; repeating the same mode keeps
        // the sticky binding that drift checks rely on.
        if (!alreadyBound || previousIsolation !== value) {
          const invocationCwd = classicCommandInvocationCwd();
          const currentBranch = liveGitBranch(invocationCwd);
          const verdict = evaluateBranchBinding({
            isolation: value,
            boundBranch: null,
            currentBranch,
            gitWorkTree: currentBranch === null ? isGitWorkTree(invocationCwd) : true,
          });
          if (verdict.status === 'needs-heal') {
            document.set('bound_branch', verdict.branch);
          } else if (verdict.status === 'unbound-detached') {
            fail(
              `ERROR: cannot bind isolation=${value} while HEAD is detached; checkout a branch first`,
            );
          } else {
            document.set('bound_branch', null);
          }
        }
      } else {
        document.set('bound_branch', null);
      }
    }
  }
  const run = await readRunState(directory);
  const projection = parseClassicStateDocument(document.toJS() as Record<string, unknown>, run);
  if (projection.run) {
    if (!projection.classic) fail('ERROR: migrated Run is missing its Classic projection');
    const evidence = await collectClassicEvidence(directory, projection);
    const currentStep = resolveClassicStepId(projection.classic, evidence);
    const stepChanged = currentStep !== projection.run.currentStep;
    const run = {
      ...projection.run,
      currentStep,
      iteration: projection.run.iteration + (stepChanged ? 1 : 0),
      status: currentStep === 'completed' ? ('completed' as const) : ('running' as const),
    };
    await writeClassicState(directory, {
      classic: projection.classic,
      run,
      unknownKeys: projection.unknownKeys,
    });
    if (stepChanged) {
      const trajectory = await readTrajectory(directory, run.trajectoryRef);
      await appendTrajectory(directory, run.trajectoryRef, {
        sequence: trajectory.length + 1,
        timestamp: new Date().toISOString(),
        type: 'state_transitioned',
        runId: run.runId,
        data: {
          kind: 'classic-config',
          ...(updates.length === 1
            ? { field: updates[0][0] }
            : { fields: updates.map(([field]) => field) }),
          fromStep: projection.run.currentStep,
          toStep: currentStep,
        },
      });
    }
  } else {
    await atomicWrite(file, document.toString());
  }
  if (seen.has('phase') && !options.internal) {
    output.stderr.push(
      yellow("WARNING: Setting 'phase' directly bypasses state machine constraints."),
      yellow('  Consider using: comet state transition <change-name> <event>'),
    );
  }
  output.data = {
    change: name,
    updated: Object.fromEntries(updates.map(([field]) => [field, document.get(field)])),
  };
  for (const [field, value] of updates) output.stderr.push(green(`[SET] ${field}=${value}`));
}

async function init(
  output: CommandOutput,
  name: string,
  workflow: string,
  isolation: string | null = null,
): Promise<void> {
  validateChangeName(name);
  validateEnum(workflow, PROFILES);
  if (isolation !== null) validateEnum(isolation, ['current', 'branch', 'worktree']);
  const boundBranch = isolation !== null ? liveGitBranch(classicCommandProjectRoot()) : null;
  if (isolation !== null && isolation !== 'current' && boundBranch === null) {
    fail(
      `ERROR: cannot bind isolation=${isolation} while HEAD is detached; checkout a branch first`,
    );
  }
  const change = await ensureClassicActiveChangeDirectory(name, classicCommandProjectRoot());
  const { label, directory } = change;
  const file = path.join(directory, '.comet.yaml');
  if (await exists(file)) fail(`ERROR: .comet.yaml already exists at ${label}/.comet.yaml`);

  const preset = workflow !== 'full';
  const reviewMode = preset ? 'off' : await reviewModeDefault();
  const document = new Document({
    workflow,
    language: await projectLanguageDefault(),
    phase: 'open',
    context_compression: await contextCompression(),
    build_mode: preset ? 'direct' : null,
    build_pause: null,
    subagent_dispatch: null,
    tdd_mode: preset ? 'direct' : null,
    review_mode: reviewMode,
    isolation,
    verify_mode: preset ? 'light' : null,
    auto_transition: (await autoTransition()) === 'true',
    base_ref: gitOutput(['rev-parse', '--verify', 'HEAD']),
    design_doc: null,
    plan: null,
    verify_result: 'pending',
    verify_failures: 0,
    verification_report: null,
    branch_status: 'pending',
    created_at: new Date().toISOString().slice(0, 10),
    verified_at: null,
    archive_confirmation: null,
    archived: false,
  });
  if (isolation !== null) document.set('bound_branch', boundBranch);
  await atomicWrite(file, document.toString());
  output.stdout.push(green(`Initialized: ${label}/.comet.yaml (workflow=${workflow})`));
}

async function requirePhase(name: string, expected: string): Promise<void> {
  const actual = await readField(name, 'phase');
  if (actual !== expected) {
    fail(`ERROR: Cannot transition '${name}': expected phase ${expected}, got ${actual}`);
  }
}

async function requireBuildDecisions(name: string): Promise<void> {
  const { file } = await stateFile(name);
  const record = (await readDocument(file)).toJS() as Record<string, unknown>;
  const state = sparseClassicState(record);
  const buildMode = state.buildMode;
  const isolation = state.isolation;
  const readiness = classicConfigurationReadiness(state);
  const allowedIsolation = ['current', 'branch', 'worktree'];
  if (!isolation || !allowedIsolation.includes(isolation)) {
    fail(
      `ERROR: Cannot transition '${name}': isolation must be current, branch, or worktree, got '${isolation || 'null'}'`,
    );
  }
  if (readiness.missingFields.includes('build_mode')) {
    fail(
      `ERROR: Cannot transition '${name}': build_mode must be selected before leaving build, got '${buildMode || 'null'}'`,
    );
  }
  if (readiness.invalidFields.some(({ field }) => field === 'direct_override')) {
    fail(
      `ERROR: Cannot transition '${name}': build_mode=direct is only allowed for hotfix/tweak unless direct_override=true`,
    );
  }
  if (readiness.missingFields.includes('subagent_dispatch')) {
    fail(
      `ERROR: Cannot transition '${name}': subagent_dispatch must be confirmed before using build_mode=subagent-driven-development`,
    );
  }
  if (readiness.missingFields.includes('tdd_mode')) {
    fail(
      `ERROR: Cannot transition '${name}': tdd_mode must be selected before leaving build (full workflow)`,
    );
  }
  if (readiness.missingFields.includes('review_mode')) {
    fail(
      `ERROR: Cannot transition '${name}': review_mode must be selected before leaving build (full workflow); review_mode must be off, standard, or thorough, got 'null'`,
    );
  }
  if (readiness.invalidFields.some(({ field }) => field === 'review_mode')) {
    fail(
      `ERROR: Cannot transition '${name}': review_mode must be standard or thorough for autonomous full build`,
    );
  }
}

async function requireOpenArtifacts(name: string): Promise<void> {
  const { directory } = await stateFile(name);
  const workflow = await readField(name, 'workflow');
  const requirements = await readClassicArtifactRequirements(
    classicCommandProjectRoot(),
    directory,
  );
  if (requirements.problems.length) fail(`ERROR: ${requirements.problems.join('\n')}`);
  for (const artifact of ['proposal.md', 'tasks.md']) {
    if (!(await nonempty(path.join(directory, artifact)))) {
      fail(
        `ERROR: Cannot transition '${name}': ${artifact} must exist and be non-empty before leaving open`,
      );
    }
  }
  if (
    workflow === 'full' &&
    requirements.designRequired &&
    !(await nonempty(path.join(directory, 'design.md')))
  ) {
    fail(
      `ERROR: Cannot transition '${name}': design.md must exist and be non-empty before leaving open`,
    );
  }
}

async function requireDesignEvidence(name: string): Promise<void> {
  const designDoc = await readField(name, 'design_doc');
  if (!designDoc || designDoc === 'null' || !(await nonempty(designDoc))) {
    fail(
      `ERROR: Cannot transition '${name}': design_doc must point to an existing Design Doc before leaving design`,
    );
  }
}

async function writeSparseTransitionEffects(
  directory: string,
  effects: Array<{ field: keyof ClassicState; to: unknown }>,
): Promise<void> {
  const file = path.join(directory, '.comet.yaml');
  const document = await readDocument(file);
  for (const effect of effects) {
    const field = wireField(effect.field);
    document.set(field, parsedValue(field, wireValue(effect.to)));
  }
  await atomicWrite(file, document.toString());
}

async function applyTransitionEvent(
  output: CommandOutput,
  name: string,
  event: ClassicTransitionEvent,
): Promise<{ fromPhase: string; toPhase: string }> {
  const { directory } = await stateFile(name);
  const projection = await readClassicState(directory);
  let classic = projection.classic;
  let sparse = false;
  if (!classic) {
    if (projection.run) fail('ERROR: Classic state projection is missing');
    const document = await readDocument(path.join(directory, '.comet.yaml'));
    classic = sparseClassicState(document.toJS() as Record<string, unknown>);
    sparse = true;
  }

  const result = applyClassicTransition(classic, event);
  if (event === 'archive-reopen')
    await invalidateClassicDelivery(classicCommandProjectRoot(), directory);
  if (projection.run) {
    await transitionClassicRuntimeRun(directory, result.classic, projection.run, {
      event,
      source: 'comet-state',
    });
  } else if (sparse) {
    await writeSparseTransitionEffects(directory, result.effects);
  } else {
    await writeClassicState(directory, {
      classic: result.classic,
      run: null,
      unknownKeys: projection.unknownKeys,
    });
  }
  await appendClassicStateEvent(directory, {
    change: name,
    event,
    source: 'comet-state',
    from: classic,
    to: result.classic,
    effects: result.effects,
  });

  for (const effect of result.effects) {
    output.stderr.push(green(`[SET] ${wireField(effect.field)}=${wireValue(effect.to)}`));
  }
  output.stderr.push(green(`[TRANSITION] ${event}`));
  return { fromPhase: classic.phase, toPhase: result.classic.phase };
}

async function transition(output: CommandOutput, name: string, event: string): Promise<void> {
  validateChangeName(name);
  const { directory } = await stateFile(name);
  return withClassicStateLock(directory, () => transitionLocked(output, name, event));
}

async function transitionLocked(output: CommandOutput, name: string, event: string): Promise<void> {
  validateChangeName(name);
  validateEnum(event, EVENTS);
  if (event === 'open-complete') {
    await requirePhase(name, 'open');
    await requireOpenArtifacts(name);
  } else if (event === 'design-complete') {
    await requirePhase(name, 'design');
    await requireDesignEvidence(name);
  } else if (event === 'build-complete') {
    await requirePhase(name, 'build');
    await requireBuildDecisions(name);
    const guarded = await classicGuardCommand([name, 'build', '--apply'], { json: false });
    if (guarded.exitCode !== 0) fail(guarded.stderr ?? `ERROR: Cannot complete build '${name}'`);
    if (guarded.stderr) output.stderr.push(guarded.stderr);
    return;
  } else if (event === 'verify-pass') {
    await requirePhase(name, 'verify');
    const verification = await classicGuardCommand([name, 'verify', '--apply'], { json: false });
    if (verification.exitCode !== 0) fail(verification.stderr ?? `ERROR: Cannot verify '${name}'`);
    if (verification.stderr) output.stderr.push(verification.stderr);
    return;
  } else if (event === 'verify-fail') {
    await requirePhase(name, 'verify');
  } else if (event === 'archive-confirm') {
    await requirePhase(name, 'archive');
    if ((await readField(name, 'verify_result')) !== 'pass') {
      fail(`ERROR: Cannot transition '${name}': verify_result must be pass before archiving`);
    }
    if ((await readField(name, 'archived')) === 'true') {
      fail(`ERROR: Cannot transition '${name}': already archived`);
    }
  } else if (event === 'preset-escalate') {
    // preset (hotfix/tweak) → full: rewind phase to design so the agent can
    // supplement a Design Doc before continuing. Unlike verify-fail /
    // archive-reopen, this event also lifts workflow to full. classic_profile
    // MUST be synced alongside workflow, otherwise classic-resolver.ts throws
    // on the (phase=design, profile!=full) invariant — profileFor() reads
    // classicProfile first, which stays at the old preset value otherwise.
    await requirePhase(name, 'build');
    const workflow = await readField(name, 'workflow');
    if (!['hotfix', 'tweak'].includes(workflow)) {
      fail(
        `ERROR: Cannot transition '${name}': preset-escalate only applies to hotfix/tweak, got workflow='${workflow}'`,
      );
    }
  } else if (event === 'archive-reopen') {
    await requirePhase(name, 'archive');
    if ((await readField(name, 'archived')) === 'true') {
      fail(`ERROR: Cannot transition '${name}': already archived`);
    }
  } else {
    await requirePhase(name, 'archive');
    if ((await readField(name, 'verify_result')) !== 'pass') {
      fail(`ERROR: Cannot transition '${name}': verify_result must be pass before archiving`);
    }
    if ((await readField(name, 'archive_confirmation')) !== 'confirmed') {
      fail(
        `ERROR: Cannot transition '${name}': archive_confirmation must be confirmed before archiving`,
      );
    }
  }
  const { fromPhase, toPhase } = await applyTransitionEvent(
    output,
    name,
    event as ClassicTransitionEvent,
  );
  const locale = classicLocale(await readField(name, 'language'));
  output.envelope = classicTransitionEnvelope({ name, fromPhase, toPhase, locale });
  output.stdout.push(output.envelope.summary);
}

async function next(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { file, label, directory } = await stateFile(name);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const record = (await readDocument(file)).toJS() as Record<string, unknown>;
  const phase = scalar(record.phase);
  const workflow = scalar(record.workflow);
  const automatic = await readRecordField(record, 'auto_transition');
  const locale = classicLocale(await readRecordField(record, 'language'));
  output.data = {
    ...(await classicRecoveryContext(
      classicCommandProjectRoot(),
      directory,
      sparseClassicState(record),
    )),
    change: name,
    phase,
    configuration: sparseClassicState(record),
  };
  if (scalar(record.archived) === 'true') {
    const delivery = await readClassicDelivery(classicCommandProjectRoot(), directory);
    const complete = ['complete', 'local-verified'].includes(delivery.verification.status);
    output.data = {
      change: name,
      phase,
      configuration: sparseClassicState(record),
      delivery,
      nextAction: { kind: complete ? 'done' : 'delivery' },
    };
    const envelope = classicNextEnvelope({
      name,
      phase: complete ? 'done' : 'archive',
      skill: complete ? '' : 'comet-archive',
      automatic: true,
      locale,
    });
    output.envelope = envelope;
    output.stdout.push(envelope.summary);
    output.stdout.push(
      complete
        ? 'NEXT: done'
        : 'NEXT: delivery\nSKILL: comet-archive\nInspect authorized delivery and actual results; do not archive again.',
    );
    return;
  }
  const skill =
    phase === 'open'
      ? 'comet-open'
      : phase === 'design'
        ? 'comet-design'
        : phase === 'verify'
          ? 'comet-verify'
          : phase === 'archive'
            ? 'comet-archive'
            : phase === 'build'
              ? workflow === 'hotfix'
                ? 'comet-hotfix'
                : workflow === 'tweak'
                  ? 'comet-tweak'
                  : 'comet-build'
              : null;
  if (!skill) {
    fail(`ERROR: Cannot resolve next step for '${name}': unknown phase '${phase || 'null'}'`);
  }
  output.envelope = classicNextEnvelope({
    name,
    phase,
    skill,
    automatic: automatic !== 'false',
    locale,
  });
  output.stdout.push(output.envelope.summary);
  output.stdout.push(`NEXT: ${automatic === 'false' ? 'manual' : 'auto'}`, `SKILL: ${skill}`);
  if (automatic === 'false') {
    output.stdout.push(`HINT: phase is '${phase}'; run /${skill} manually to continue`);
  }
}

async function taskCheckoff(
  output: CommandOutput,
  taskFile: string,
  taskText: string,
): Promise<void> {
  validateRelativePath(taskFile, 'task file');
  if (!taskText) fail('ERROR: Task text cannot be empty');
  const file = path.resolve(classicCommandProjectRoot(), taskFile);
  if (!(await exists(file))) fail(`ERROR: Task file not found: ${taskFile}`);
  const lines = (
    await readClassicProjectFile(classicCommandProjectRoot(), file, {
      label: 'Classic task-checkoff file',
    })
  ).split(/\r?\n/u);
  const matches = lines.filter((line) =>
    [`- [ ] ${taskText}`, `- [x] ${taskText}`, `- [X] ${taskText}`].includes(line),
  );
  const checked = matches.filter((line) => /^- \[[xX]\] /u.test(line));
  if (matches.length !== 1) {
    fail(
      `ERROR: task text must appear exactly once in ${taskFile} (found ${matches.length}): ${taskText}`,
    );
  }
  if (checked.length !== 1) fail(`ERROR: task is not checked in ${taskFile}: ${taskText}`);
  output.stdout.push('TASK_CHECKOFF: PASS', `FILE: ${taskFile}`, `TASK: ${taskText}`);
}

async function taskState(
  output: CommandOutput,
  name: string,
  action:
    { kind: 'list' | 'assign' | 'sync-plan' } | { kind: 'complete'; id: string; revision: string },
): Promise<void> {
  validateChangeName(name);
  const { directory } = await stateFile(name);
  const operation = async () => {
    const projection = await readClassicState(directory, { migrate: false });
    if (!projection.classic) fail('ERROR: Classic state is missing');
    if (projection.unknownKeys.length)
      fail(`ERROR: Unknown Classic state fields: ${projection.unknownKeys.join(', ')}`);
    const state = projection.classic;
    if (action.kind !== 'list') {
      const binding = await resolveBranchBinding(directory, {
        heal: false,
        cwd: classicCommandInvocationCwd(),
      });
      if (binding.status === 'drift')
        fail(driftBlockedMessage(name, binding.boundBranch, binding.currentBranch));
      if (binding.status === 'unbound-detached') fail(unboundDetachedMessage(name));
    }
    if (
      action.kind !== 'list' &&
      (state.archived || !['open', 'design', 'build'].includes(state.phase))
    ) {
      fail('ERROR: task updates require an active Open, Design or Build phase');
    }
    if (action.kind === 'complete' && state.phase !== 'build')
      fail('ERROR: task completion requires Build phase');
    const tasksFile = path.join(directory, 'tasks.md');
    const source = await readClassicProjectFile(classicCommandProjectRoot(), tasksFile, {
      label: 'Classic task authority',
    });
    const updated =
      action.kind === 'assign'
        ? assignClassicTaskIds(source)
        : action.kind === 'complete'
          ? completeClassicTask(source, action.id, action.revision)
          : source;
    const tasks = parseClassicTasks(updated);
    if (!tasks.length) fail('ERROR: tasks.md has no implementation tasks');
    const planPath = state.plan;
    let planSync: 'none' | 'synced' | 'mapping-required' = 'none';
    let planUpdate: { file: string; source: string; updated: string } | null = null;
    if (
      planPath &&
      planPath !== 'null' &&
      (await exists(path.resolve(classicCommandProjectRoot(), planPath)))
    ) {
      const planFile = path.resolve(classicCommandProjectRoot(), planPath);
      const planSource = await readClassicProjectFile(classicCommandProjectRoot(), planFile, {
        label: 'Classic plan task mapping',
      });
      const mapping = inspectClassicPlanTasks(planSource, tasks);
      if (mapping.unmapped.length) {
        planSync = 'mapping-required';
        if (action.kind === 'sync-plan')
          fail(
            'ERROR: reconcile legacy plan tasks and assign explicit matching IDs before syncing',
          );
      } else if (mapping.total && ['complete', 'sync-plan'].includes(action.kind)) {
        planUpdate = {
          file: planFile,
          source: planSource,
          updated: synchronizeClassicPlanTasks(planSource, tasks),
        };
        planSync = 'synced';
      }
    }
    if (updated !== source)
      await writeClassicProjectText(classicCommandProjectRoot(), tasksFile, updated, {
        label: 'Classic task authority',
      });
    // Authority is committed first; retrying completion repairs an interrupted plan projection.
    if (planUpdate && planUpdate.source !== planUpdate.updated)
      await writeClassicProjectText(
        classicCommandProjectRoot(),
        planUpdate.file,
        planUpdate.updated,
        { label: 'Classic plan task projection' },
      );
    output.data = {
      change: name,
      authority: path.relative(classicCommandProjectRoot(), tasksFile).replaceAll('\\', '/'),
      revision: classicTaskRevision(updated),
      needsIds: tasks.some((task) => !task.id),
      planSync,
      tasks,
      progress: { total: tasks.length, completed: tasks.filter((task) => task.completed).length },
    };
    output.stdout.push(
      `Tasks: ${tasks.filter((task) => task.completed).length}/${tasks.length} complete. Use --json for task IDs and revision.`,
    );
  };
  if (action.kind === 'list') await operation();
  else await withClassicStateLock(directory, operation);
}

async function progressCommand(
  output: CommandOutput,
  kind: 'checkpoint' | 'delivery',
  args: string[],
) {
  if (
    args.length !== 1 &&
    !(args.length === 3 && args[1] === '--file') &&
    !(kind === 'delivery' && args.length === 2 && args[1] === '--verify')
  )
    fail(
      `Usage: comet state ${kind} <change-name> [--file <json>${kind === 'delivery' ? ' | --verify' : ''}]`,
    );
  validateChangeName(args[0]);
  const { directory, file } = await stateFile(args[0]);
  const root = classicCommandProjectRoot();
  const write = args[1] === '--file';
  const operation = async () => {
    const state = sparseClassicState((await readDocument(file)).toJS() as Record<string, unknown>);
    const input = write
      ? JSON.parse(
          await readClassicProjectFile(root, args[2], {
            label: 'Classic progress input',
            maxBytes: 64 * 1024,
          }),
        )
      : null;
    if (kind === 'checkpoint') {
      if (write && (state.phase !== 'build' || state.archived))
        fail('ERROR: checkpoint updates require active Build phase');
      const source = await readClassicProjectFile(root, path.join(directory, 'tasks.md'), {
        label: 'Classic checkpoint task authority',
      });
      output.data = write
        ? await writeClassicCheckpoint(root, directory, input, source)
        : await readClassicCheckpoint(root, directory, source);
    } else {
      output.data = write
        ? await writeClassicDelivery(root, directory, input, state)
        : await readClassicDelivery(root, directory, { verifyRemote: args[1] === '--verify' });
    }
    output.stdout.push(
      `${kind}: ${write ? 'recorded' : 'inspected'}. Use --json for exact state and verification.`,
    );
  };
  if (write) {
    await assertStateCommandWritable('set');
    const binding = await resolveBranchBinding(directory, {
      heal: false,
      cwd: classicCommandInvocationCwd(),
    });
    if (binding.status === 'drift' || binding.status === 'unbound-detached')
      fail(
        'ERROR: progress update requires the bound branch; inspect the workspace before retrying',
      );
    await withClassicStateLock(directory, operation);
  } else await operation();
}

async function check(
  output: CommandOutput,
  name: string,
  phase: string,
  details = false,
): Promise<void> {
  validateChangeName(name);
  validateEnum(phase, PHASES);
  const { file, directory, label } = await stateFile(name);
  output.stdout.push(`=== Entry Check: comet-${phase} ===`);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const record = (await readDocument(file)).toJS() as Record<string, unknown>;
  let blocked = false;
  let passed = 0;
  let total = 0;
  const issues: ClassicIssue[] = [];
  const pass = (message: string) => {
    output.stdout.push(`  ${green('[PASS]')} ${message}`);
    passed += 1;
    total += 1;
  };
  const reject = (message: string, issue?: Partial<ClassicIssue>) => {
    output.stdout.push(`  ${red('[FAIL]')} ${message}`);
    blocked = true;
    total += 1;
    issues.push(
      classicIssue(message, {
        code: 'CLASSIC_ENTRY_CHECK_FAILED',
        path: file,
        remediation: 'Repair the reported prerequisite, then retry this entry check.',
        ...issue,
      }),
    );
  };
  const expectField = async (field: string, expected: string) => {
    const actual = await readRecordField(record, field);
    if (actual === expected) pass(`${field}=${actual} (expected: ${expected})`);
    else reject(`${field}=${actual} (expected: ${expected})`, { field, actual, expected });
  };
  pass('.comet.yaml exists');
  await expectField('phase', phase);
  if (phase === 'design') {
    await expectField('workflow', 'full');
    const designDoc = scalar(record.design_doc);
    pass(
      designDoc && designDoc !== 'null'
        ? `design_doc=${designDoc}; preserve registered Design work`
        : 'design_doc is empty/null',
    );
    const requirements = await readClassicArtifactRequirements(
      classicCommandProjectRoot(),
      directory,
    );
    for (const problem of requirements.problems) reject(problem);
    for (const artifact of requirements.files) {
      const present = await nonempty(artifact);
      (present ? pass : reject)(`${artifact} ${present ? 'non-empty' : 'missing or empty'}`);
    }
  } else if (phase === 'build') {
    const workflow = scalar(record.workflow);
    const designDoc = scalar(record.design_doc);
    if (workflow === 'full') {
      (designDoc && designDoc !== 'null' && (await exists(designDoc)) ? pass : reject)(
        `design_doc=${designDoc} (expected: non-null and file exists)`,
      );
    } else {
      pass(`workflow=${workflow} (design_doc not required)`);
    }
    for (const artifact of ['proposal.md', 'tasks.md']) {
      const present = await nonempty(path.join(directory, artifact));
      (present ? pass : reject)(`${artifact} ${present ? 'non-empty' : 'missing or empty'}`);
    }
  } else if (phase === 'verify') {
    const value = scalar(record.verify_result);
    (['', 'null', 'pending'].includes(value) ? pass : reject)(
      `verify_result=${value} (expected: pending or null)`,
    );
  } else if (phase === 'archive') {
    await expectField('verify_result', 'pass');
    const archived = scalar(record.archived);
    pass(
      archived === 'true'
        ? 'archived=true; resume delivery only, do not archive again'
        : `archived=${archived} (ready for archive confirmation)`,
    );
  }
  const binding = await resolveBranchBinding(directory, {
    heal: true,
    cwd: classicCommandInvocationCwd(),
  });
  if (binding.bindingRequired) {
    switch (binding.status) {
      case 'drift':
        reject(driftBlockedMessage(name, binding.boundBranch, binding.currentBranch));
        break;
      case 'unbound-detached':
        reject(unboundDetachedMessage(name));
        break;
      case 'healed':
        record.bound_branch = binding.branch;
        pass(`bound_branch lazily set to ${binding.branch}`);
        break;
      case 'needs-heal':
      case 'ok':
      case 'not-applicable':
        pass('bound_branch matches current branch');
        break;
      default: {
        const exhaustive: never = binding;
        throw new Error(`unhandled branch binding status: ${JSON.stringify(exhaustive)}`);
      }
    }
  }
  output.stdout.push('');
  const locale = classicLocale(await readRecordField(record, 'language'));
  const recovery = await classicRecoveryContext(
    classicCommandProjectRoot(),
    directory,
    sparseClassicState(record),
    details,
  );
  for (const issue of recovery.issues ?? []) reject(issue.message, issue);
  output.data = {
    ...recovery,
    change: name,
    phase: record.phase,
    requestedPhase: phase,
    configuration: sparseClassicState(record),
    checks: { passed, total, blocked },
    issues,
  };
  output.envelope = classicEntryCheckEnvelope({ name, phase, passed, total, locale });
  output.stdout.push(output.envelope.summary);
  if (blocked) {
    output.stderr.push(red('BLOCKED — fix failing checks before proceeding'));
    throw new CommandFailure('', 1);
  }
  output.stderr.push(green('ALL CHECKS PASSED — ready to proceed'));
}

/** Coordinate only the already-authorized Design writes; each existing operation retains its lock and validation. */
async function completeDesign(
  output: CommandOutput,
  name: string,
  designRef: string,
  options: Parameters<ClassicCommandHandler>[1],
): Promise<void> {
  validateChangeName(name);
  validateRelativePath(designRef, 'design_doc');
  const phase = await readField(name, 'phase');
  const recorded = await readField(name, 'design_doc');
  if (!['design', 'build'].includes(phase) || (await readField(name, 'workflow')) !== 'full')
    fail(
      'ERROR: complete-design requires the full workflow in design or its completed build phase',
    );
  if (recorded && recorded !== 'null' && recorded !== designRef)
    fail(
      'ERROR: complete-design must preserve the registered Design Doc; explicitly correct design_doc before retrying',
    );
  if (phase === 'build') {
    if (recorded !== designRef) fail('ERROR: completed Design reference does not match');
    await check(output, name, 'build');
    return;
  }
  await check(output, name, 'design');
  if (recorded !== designRef) await setFields(output, name, [['design_doc', designRef]]);
  const handoff = await classicHandoffCommand([name, 'design', '--write'], options);
  if (handoff.stderr) output.stderr.push(handoff.stderr);
  if (handoff.exitCode !== 0) {
    output.data = {
      ...(output.data as Record<string, unknown>),
      issues: [
        classicIssue(handoff.stderr ?? 'Design handoff failed', {
          code: 'CLASSIC_DESIGN_HANDOFF_FAILED',
          field: 'handoff_context',
          remediation:
            'Preserve the registered design, repair the handoff cause, then retry complete-design.',
        }),
      ],
    };
    throw new CommandFailure('', handoff.exitCode);
  }
  const guard = await classicGuardCommand([name, 'design', '--apply'], options);
  if (guard.stderr) output.stderr.push(guard.stderr);
  output.data = guard.data;
  output.envelope = guard.envelope;
  if (guard.exitCode !== 0) throw new CommandFailure('', guard.exitCode);
}

async function fieldStatus(field: string, value: string, file?: string): Promise<string> {
  if (!value || value === 'null') return `  - ${field}: PENDING`;
  if (file && !(await exists(path.resolve(classicCommandProjectRoot(), file)))) {
    return `  - ${field}: BROKEN (path ${value} does not exist)`;
  }
  return `  - ${field}: DONE (${value})`;
}

async function recoveryArtifacts(output: CommandOutput, directory: string) {
  const requirements = await readClassicArtifactRequirements(
    classicCommandProjectRoot(),
    directory,
  );
  output.stdout.push('  Artifacts:');
  let complete = 0;
  for (const file of requirements.files) {
    const done = await nonempty(file);
    if (done) complete += 1;
    output.stdout.push(`  - ${path.relative(directory, file)}: ${done ? 'DONE' : 'PENDING'}`);
  }
  for (const skipped of requirements.skipped) output.stdout.push(`  - ${skipped}: SKIPPED`);
  for (const problem of requirements.problems) output.stdout.push(`  - ${problem}`);
  return {
    complete,
    ready: complete === requirements.files.length && !requirements.problems.length,
  };
}

async function recoverOpen(output: CommandOutput, directory: string): Promise<void> {
  const { complete, ready } = await recoveryArtifacts(output, directory);
  output.stdout.push(
    '',
    ready
      ? 'Recovery action: All artifacts complete. Run /comet-open user confirmation, then guard to transition.'
      : complete === 0
        ? 'Recovery action: No artifacts created yet. Start from /comet-open Step 1 (explore and clarify).'
        : 'Recovery action: Some artifacts incomplete. Resume /comet-open from the first missing artifact.',
  );
}

async function recoverDesign(
  output: CommandOutput,
  name: string,
  directory: string,
): Promise<void> {
  const { ready } = await recoveryArtifacts(output, directory);
  if (!ready) {
    output.stdout.push(
      'Recovery action: Required artifacts are incomplete. Repair the reported dependency or file before continuing design.',
    );
    return;
  }
  const handoff = await readField(name, 'handoff_context');
  const hash = await readField(name, 'handoff_hash');
  const design = await readField(name, 'design_doc');
  output.stdout.push(
    '',
    '  Design progress:',
    await fieldStatus('handoff_context', handoff, handoff),
    await fieldStatus('handoff_hash', hash),
    await fieldStatus('design_doc', design, design),
    '',
  );
  if (
    design &&
    design !== 'null' &&
    (await exists(path.resolve(classicCommandProjectRoot(), design)))
  ) {
    output.stdout.push(
      'Recovery action: Design Doc already created and linked. Run guard to transition to build.',
    );
  } else if (
    handoff &&
    handoff !== 'null' &&
    (await exists(path.resolve(classicCommandProjectRoot(), handoff)))
  ) {
    output.stdout.push(
      'Recovery action: Handoff generated but Design Doc not yet created. Resume from brainstorming confirmation (Step 1c).',
    );
  } else {
    output.stdout.push(
      'Recovery action: No handoff generated yet. Start from Step 1a (generate handoff package).',
    );
  }
}

async function recoverBuild(
  output: CommandOutput,
  state: ClassicState,
  context: Awaited<ReturnType<typeof classicRecoveryContext>>,
): Promise<void> {
  const value = (input: string | null) => input ?? 'null';
  output.stdout.push(
    '  Build decisions:',
    await fieldStatus('isolation', value(state.isolation)),
    await fieldStatus('build_mode', value(state.buildMode)),
    await fieldStatus('build_pause', value(state.buildPause)),
    await fieldStatus('tdd_mode', value(state.tddMode)),
    await fieldStatus('review_mode', value(state.reviewMode)),
    await fieldStatus('subagent_dispatch', value(state.subagentDispatch)),
    '',
    '  Plan:',
    await fieldStatus('plan', value(state.plan), state.plan ?? undefined),
    '',
    context.taskState.exists
      ? `  Tasks: ${context.taskState.completed}/${context.taskState.total} done, ${context.taskState.total - context.taskState.completed} pending`
      : '  Tasks: tasks.md MISSING',
    `  Plan task mapping: ${context.planMapping.status}`,
    '',
    `Recovery action: ${context.nextAction.reason}`,
  );
}

async function recoverVerify(output: CommandOutput, name: string): Promise<void> {
  const result = await readField(name, 'verify_result');
  const failures = await readField(name, 'verify_failures');
  const mode = await readField(name, 'verify_mode');
  const report = await readField(name, 'verification_report');
  const branch = await readField(name, 'branch_status');
  output.stdout.push(
    '  Verification:',
    await fieldStatus('verify_result', result),
    `  - verify_failures: ${failures || '0'}`,
    await fieldStatus('verify_mode', mode),
    await fieldStatus('verification_report', report, report),
    branch === 'handled'
      ? '  - branch_status: LEGACY (handled before archive; archive still owns final closure)'
      : '  - branch_status: DEFERRED (handled after the archive commit)',
    '',
    result === 'pass'
      ? 'Recovery action: Verification complete. Continue to archive; branch handling happens after archive changes are committed.'
      : result === 'fail'
        ? 'Recovery action: Verification failed and rolled back to build. Resume from /comet-build.'
        : 'Recovery action: Verification not yet started or in progress. Run scale assessment then verify.',
  );
}

async function recoverArchive(output: CommandOutput, name: string): Promise<void> {
  const archiveConfirmation = await readField(name, 'archive_confirmation');
  output.stdout.push(
    '  Archive:',
    await fieldStatus('verify_result', await readField(name, 'verify_result')),
    await fieldStatus('archive_confirmation', archiveConfirmation),
    await fieldStatus('archived', await readField(name, 'archived')),
    '',
    archiveConfirmation === 'confirmed'
      ? 'Recovery action: Archive is confirmed. Run /comet-archive to complete archiving.'
      : 'Recovery action: Ask for final archive confirmation in /comet-archive before running the archive command.',
  );
}

async function recover(
  output: CommandOutput,
  name: string,
  details = false,
  json = false,
): Promise<void> {
  validateChangeName(name);
  const { file, directory, label } = await stateFile(name);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const projection = await readClassicState(directory, { migrate: false });
  const classic =
    projection.classic ??
    sparseClassicState((await readDocument(file)).toJS() as Record<string, unknown>);
  const phase = classic.phase;
  if (phase === 'design') await check(output, name, phase, details);
  const workflow = classic.workflow;
  const locale = classicLocale(classic.language);
  const evidenceScopes = projection.run
    ? await recoverCommandChecks(classicCommandProjectRoot(), directory, projection.run)
    : { build: 'rerun-required', verify: 'rerun-required' };
  const checkpoint = path.join(directory, '.comet', 'subagent-progress.md');
  const context = await classicRecoveryContext(
    classicCommandProjectRoot(),
    directory,
    classic,
    details,
  );
  output.data = {
    ...context,
    change: name,
    phase,
    workflow,
    projectRoot: classicCommandProjectRoot(),
    changeDir: directory,
    currentStep: projection.run?.currentStep ?? null,
    configuration: classic,
    checkpoint: (await exists(checkpoint))
      ? {
          path: checkpoint,
          ...(details
            ? {
                content: await readClassicProjectFile(classicCommandProjectRoot(), checkpoint, {
                  label: 'Recovery checkpoint',
                }),
              }
            : {}),
        }
      : null,
    evidence: {
      status: evidenceScopes[phase === 'build' ? 'build' : 'verify'],
      reason: 'cold-recovery',
      scopes: evidenceScopes,
    },
    requiredFiles: [file, ...context.requiredFiles],
  };
  output.envelope = classicRecoveryEnvelope({ name, phase, locale });
  if (json) return;
  output.stdout.push(
    output.envelope.summary,
    `=== Recovery Context: ${name} ===`,
    `Phase: ${phase}`,
    `Workflow: ${workflow}`,
    '',
    'State fields:',
  );
  if (phase === 'open') {
    await recoverOpen(output, directory);
  } else if (phase === 'design') {
    await recoverDesign(output, name, directory);
  } else if (phase === 'build') {
    await recoverBuild(output, classic, context);
  } else if (phase === 'verify') {
    await recoverVerify(output, name);
  } else if (phase === 'archive') {
    await recoverArchive(output, name);
  } else {
    fail(`ERROR: Unknown phase: ${phase}`);
  }
  output.stdout.push('', '=== End Recovery Context ===');
  output.stdout.push(`Next action: ${context.nextAction.kind}. ${context.nextAction.reason}`);
}

async function scale(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { file, directory, label } = await stateFile(name);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const tasksFile = path.join(directory, 'tasks.md');
  const taskCount = (await exists(tasksFile))
    ? parseClassicTasks(
        await readClassicProjectFile(classicCommandProjectRoot(), tasksFile, {
          label: 'Classic scale task file',
        }),
      ).length
    : 0;
  const specs = path.join(directory, 'specs');
  const deltaSpecs = (await collectClassicSpecFiles(classicCommandProjectRoot(), specs)).length;
  const plan = await readField(name, 'plan');
  let baseRef = '';
  if (plan && plan !== 'null' && (await exists(plan))) {
    const match = (
      await readClassicProjectFile(classicCommandProjectRoot(), plan, {
        label: 'Classic scale plan',
      })
    ).match(/^base-ref:\s*(.+)$/mu);
    baseRef = match?.[1].trim() ?? '';
  }
  if (!baseRef) baseRef = await readField(name, 'base_ref');
  const changed = gitOutput([
    'diff',
    '--name-only',
    ...(baseRef && baseRef !== 'null' ? [`${baseRef}...HEAD`] : ['HEAD']),
  ]);
  const changedFiles = changed ? changed.split(/\r?\n/u).filter(Boolean).length : 0;
  const result = taskCount > 3 || deltaSpecs > 1 || changedFiles > 8 ? 'full' : 'light';
  const selected = await readField(name, 'verify_mode');
  output.data = {
    change: name,
    recommendation: result,
    selected: selected === 'light' || selected === 'full' ? selected : null,
    metrics: { tasks: taskCount, deltaSpecs, changedFiles },
  };
  const locale = classicLocale(await readField(name, 'language'));
  output.envelope = classicScaleEnvelope({ name, result, locale });
  output.stderr.push(
    output.envelope.summary,
    `=== Scale Assessment: ${name} ===`,
    `  Tasks: ${taskCount} (threshold: 3)`,
    `  Delta specs: ${deltaSpecs} capabilities (threshold: 1)`,
    `  Changed files: ${changedFiles} (threshold: 8)`,
    `  → Result: ${result}`,
    green(`[SCALE] recommendation=${result}; selected=${selected || 'null'} (unchanged)`),
  );
}

function parseRecordCheckOptions(args: string[]): {
  command: string;
  exitCode: number;
  cwd?: string;
} {
  let command: string | undefined;
  let exitCodeText: string | undefined;
  let cwd: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    if (!['--command', '--exit-code', '--cwd'].includes(option)) {
      fail(`ERROR: Unknown option: ${option}`);
    }
    const value = args[index + 1];
    if (value === undefined) fail(`ERROR: Missing value for option: ${option}`);
    if (option === '--command') command = value;
    else if (option === '--exit-code') exitCodeText = value;
    else cwd = value;
  }
  if (command === undefined) fail('ERROR: Missing option: --command');
  if (exitCodeText === undefined) fail('ERROR: Missing option: --exit-code');
  if (!/^-?\d+$/u.test(exitCodeText)) fail('ERROR: --exit-code must be an integer');
  return { command, exitCode: Number(exitCodeText), ...(cwd === undefined ? {} : { cwd }) };
}

async function recordCheck(
  output: CommandOutput,
  name: string,
  scopeText: string,
  args: string[],
): Promise<void> {
  validateChangeName(name);
  if (scopeText !== 'build' && scopeText !== 'verify') {
    fail(`ERROR: Invalid command check scope: '${scopeText}'`);
  }
  const options = parseRecordCheckOptions(args);
  const { directory, file } = await stateFile(name);
  const projectRoot = classicCommandProjectRoot();
  const activeChangesDir = (await assertClassicLayoutReadable(projectRoot)).changesDir;
  if (path.dirname(directory) !== activeChangesDir || !(await exists(file))) {
    fail(`ERROR: command checks require an active change: ${name}`);
  }
  try {
    const projection = await readClassicState(directory, { migrate: false });
    if (!projection.classic || !projection.run) {
      throw new Error('command checks require an existing synchronized Classic Run');
    }
    const reconciliation = await reconcileClassicRuntimeRun(directory, projection);
    if (reconciliation.reconciled && reconciliation.fromStep !== null) {
      output.stderr.push(
        green(
          `[RECONCILED] currentStep ${reconciliation.fromStep} -> ${reconciliation.context.run.currentStep}`,
        ),
      );
    }
    const recorded = await recordCommandCheck(projectRoot, directory, reconciliation.context.run, {
      scope: scopeText as CommandCheckScope,
      ...options,
      cwd:
        options.cwd ??
        (path.relative(projectRoot, classicCommandInvocationCwd()).replaceAll('\\', '/') || '.'),
    });
    output.stderr.push(
      green(
        `[RECORDED] ${recorded.scope} exit=${recorded.exitCode} cwd=${recorded.cwd} command=${recorded.command}`,
      ),
    );
  } catch (error) {
    fail(`ERROR: ${(error as Error).message}`);
  }
}

function required(args: string[], count: number, usage: string): void {
  if (args.length < count) fail(usage);
}

function requiredExact(args: string[], count: number, usage: string): void {
  if (args.length !== count) fail(usage);
}

const MUTATING_STATE_COMMANDS = new Set([
  'init',
  'set',
  'task-complete',
  'sync-plan',
  'transition',
  'check',
  'scale',
  'record-check',
  'rebind',
  'select',
  'clear-selection',
  'complete-design',
]);

async function assertStateCommandWritable(subcommand: string | undefined): Promise<void> {
  if (!subcommand || !MUTATING_STATE_COMMANDS.has(subcommand)) return;
  try {
    await assertClassicLayoutWritable(classicCommandProjectRoot());
  } catch (error) {
    fail(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function selectChange(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  try {
    const requestedRoot = classicCommandProjectRoot();
    const workspace = await resolveClassicWorkspace({ projectRoot: requestedRoot, name });
    const selection = await selectCurrentChange(workspace.projectRoot, name);
    const change = await resolveClassicChangeDirectory(name, workspace.projectRoot);
    const state = await readClassicState(change.directory, { migrate: false });
    const bound = state.classic?.boundBranch ?? null;
    output.stderr.push(
      green(
        `[SELECTED] current change: ${selection.change}${bound ? ` (branch: ${bound})` : ''}${workspace.routed ? ` (workspace: ${workspace.projectRoot})` : ''}`,
      ),
    );
  } catch (error) {
    fail(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function rebind(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { directory } = await stateFile(name);
  const boundBranch = await readField(name, 'bound_branch');
  if (!boundBranch || boundBranch === 'null') {
    fail(
      `ERROR: '${name}' is not yet bound; use 'comet state set ${name} isolation <current|branch|worktree>' to establish the first binding`,
    );
  }
  const branch = liveGitBranch(classicCommandInvocationCwd());
  if (branch === null) {
    fail('ERROR: cannot rebind while HEAD is detached; checkout a branch first');
  }
  const before = await readClassicState(directory);
  if (!before.classic) fail('ERROR: Classic state projection is missing');
  await healBoundBranch(directory, branch);
  const after: ClassicState = { ...before.classic, boundBranch: branch };
  await appendClassicStateEvent(directory, {
    change: name,
    event: 'rebind',
    source: 'comet-state',
    from: before.classic,
    to: after,
    effects: [{ field: 'boundBranch', from: boundBranch, to: branch }],
  });
  output.stderr.push(green(`[REBIND] bound_branch: ${boundBranch} → ${branch}`));
}

async function currentChange(output: CommandOutput): Promise<void> {
  const resolution = await resolveCurrentChange(classicCommandProjectRoot());
  if (resolution.status === 'selected') {
    output.stdout.push(resolution.selection.change);
    return;
  }
  if (resolution.status === 'missing') {
    fail('ERROR: no current change selected\nUse: comet state select <change-name>');
  }
  fail(
    `ERROR: current change selection is stale: ${resolution.reason}\nUse: comet state select <change-name>`,
  );
}

async function clearSelection(output: CommandOutput): Promise<void> {
  await clearCurrentChange(classicCommandProjectRoot());
  output.stderr.push(green('[CLEARED] current change selection'));
}

export const classicStateCommand: ClassicCommandHandler = withProjectContext(
  async (args, options) => {
    const output = new CommandOutput();
    try {
      const [subcommand, ...rest] = args;
      const arity: Record<string, number> = {
        get: 2,
        transition: 2,
        scale: 1,
        'task-checkoff': 2,
        rebind: 1,
        select: 1,
        current: 0,
        'clear-selection': 0,
        next: 1,
        artifacts: 1,
      };
      if (subcommand && Object.hasOwn(arity, subcommand)) {
        requiredExact(
          rest,
          arity[subcommand],
          `Invalid arguments for comet state ${subcommand}; run comet state --help`,
        );
      }
      if (
        subcommand === 'check' &&
        (rest.length < 2 ||
          rest.length > 4 ||
          rest.slice(2).some((option) => !['--recover', '--details'].includes(option)) ||
          new Set(rest.slice(2)).size !== rest.length - 2)
      ) {
        fail('Usage: comet state check <change-name> <phase> [--recover] [--details]');
      }
      await assertStateCommandWritable(subcommand);
      if (subcommand === 'tasks' && rest.includes('--assign-ids'))
        await assertStateCommandWritable('set');
      if (subcommand === 'init') {
        required(rest, 2, 'Usage: comet state init <change-name> <workflow>');
        const initOptions = rest.slice(2);
        let isolation: string | null = null;
        if (initOptions.length > 0) {
          if (initOptions.length !== 2 || initOptions[0] !== '--isolation') {
            fail('Usage: comet state init <change-name> <workflow> [--isolation <mode>]');
          }
          isolation = initOptions[1];
        }
        await init(output, rest[0], rest[1], isolation);
      } else if (subcommand === 'get') {
        required(rest, 2, 'Usage: comet state get <change-name> <field>');
        validateChangeName(rest[0]);
        output.stdout.push(await readField(rest[0], rest[1]));
      } else if (subcommand === 'set') {
        if (rest.length < 3 || rest.length % 2 !== 1) {
          fail('Usage: comet state set <change-name> <field> <value> [<field> <value> ...]');
        }
        validateChangeName(rest[0]);
        const updates: Array<[string, string]> = [];
        for (let index = 1; index < rest.length; index += 2)
          updates.push([rest[index], rest[index + 1]]);
        await setFields(output, rest[0], updates);
      } else if (subcommand === 'complete-design') {
        if (rest.length !== 3 || rest[1] !== '--design-doc')
          fail('Usage: comet state complete-design <change-name> --design-doc <repo-relative-ref>');
        await completeDesign(output, rest[0], rest[2], options);
      } else if (subcommand === 'transition') {
        required(rest, 2, 'Usage: comet state transition <change-name> <event>');
        await transition(output, rest[0], rest[1]);
      } else if (subcommand === 'check') {
        required(rest, 2, 'Usage: comet state check <change-name> <phase> [--recover]');
        validateEnum(rest[1], PHASES);
        if (rest.includes('--recover'))
          await recover(output, rest[0], rest.includes('--details'), options.json);
        else await check(output, rest[0], rest[1], rest.includes('--details'));
      } else if (subcommand === 'scale') {
        required(rest, 1, 'Usage: comet state scale <change-name>');
        await scale(output, rest[0]);
      } else if (subcommand === 'artifacts') {
        validateChangeName(rest[0]);
        const { directory } = await stateFile(rest[0]);
        const requirements = await readClassicArtifactRequirements(
          classicCommandProjectRoot(),
          directory,
        );
        if (requirements.source === 'legacy') {
          const full = (await readField(rest[0], 'workflow')) === 'full';
          requirements.designRequired = full;
          if (!full) {
            requirements.required = requirements.required.filter((id) => id !== 'design');
            requirements.files = requirements.files.filter(
              (file) => path.basename(file) !== 'design.md',
            );
          }
          for (const file of requirements.files)
            if (!(await nonempty(file)))
              requirements.problems.push(`Required Classic artifact is missing or empty: ${file}`);
        }
        output.data = requirements;
        output.stdout.push(
          requirements.problems.length
            ? requirements.problems.join('\n')
            : 'Required artifact dependency closure is ready',
        );
        if (requirements.problems.length) throw new CommandFailure('', 1);
      } else if (subcommand === 'record-check') {
        required(
          rest,
          2,
          'Usage: comet state record-check <change> <build|verify> --command <text> --exit-code <int> [--cwd <path>]',
        );
        await recordCheck(output, rest[0], rest[1], rest.slice(2));
      } else if (subcommand === 'task-checkoff') {
        required(rest, 2, 'Usage: comet state task-checkoff <file> <task-text>');
        await taskCheckoff(output, rest[0], rest[1]);
      } else if (subcommand === 'tasks') {
        if (rest.length !== 1 && !(rest.length === 2 && rest[1] === '--assign-ids')) {
          fail('Usage: comet state tasks <change-name> [--assign-ids]');
        }
        await taskState(output, rest[0], { kind: rest.length === 2 ? 'assign' : 'list' });
      } else if (subcommand === 'sync-plan') {
        requiredExact(rest, 1, 'Usage: comet state sync-plan <change-name>');
        await taskState(output, rest[0], { kind: 'sync-plan' });
      } else if (subcommand === 'checkpoint' || subcommand === 'delivery') {
        await progressCommand(output, subcommand, rest);
      } else if (subcommand === 'task-complete') {
        if (rest.length !== 4 || rest[2] !== '--expect')
          fail('Usage: comet state task-complete <change-name> <task-id> --expect <revision>');
        await taskState(output, rest[0], { kind: 'complete', id: rest[1], revision: rest[3] });
      } else if (subcommand === 'rebind') {
        requiredExact(rest, 1, 'Usage: comet state rebind <change-name>');
        await rebind(output, rest[0]);
      } else if (subcommand === 'select') {
        requiredExact(rest, 1, 'Usage: comet state select <change-name>');
        await selectChange(output, rest[0]);
      } else if (subcommand === 'current') {
        requiredExact(rest, 0, 'Usage: comet state current');
        await currentChange(output);
      } else if (subcommand === 'clear-selection') {
        requiredExact(rest, 0, 'Usage: comet state clear-selection');
        await clearSelection(output);
      } else if (subcommand === 'next') {
        required(rest, 1, 'Usage: comet state next <change-name>');
        await next(output, rest[0]);
      } else {
        fail(`Unknown subcommand: ${subcommand ?? ''}`);
      }
      if (options.json && ['init', 'set', 'transition', 'select'].includes(subcommand)) {
        const { directory } = await stateFile(rest[0]);
        const state = (await readClassicState(directory, { migrate: false })).classic;
        if (state)
          output.data = {
            ...(output.data && typeof output.data === 'object' ? output.data : {}),
            ...(await classicRecoveryContext(classicCommandProjectRoot(), directory, state)),
            change: rest[0],
            phase: state.phase,
            configuration: state,
          };
      }
      if (options.json && ['check', 'complete-design'].includes(subcommand)) output.stdout = [];
      return output.result();
    } catch (error) {
      const issue = error instanceof CommandFailure ? error.issue : undefined;
      const previous =
        output.data && typeof output.data === 'object'
          ? (output.data as Record<string, unknown>)
          : {};
      if (!Array.isArray(previous.issues) || previous.issues.length === 0)
        output.data = { ...previous, issues: [issue ?? classicIssue(error)] };
      // The frozen 0.3.8 shell calls red() once per line and never embeds newlines
      // inside a single color call. Mirror that contract by wrapping each line of
      // the message in its own span so multi-line errors (e.g. validateEnum) render
      // as separate colored lines rather than one span across a newline.
      const message = error instanceof Error ? error.message : String(error);
      if (message) {
        for (const line of message.split('\n')) output.stderr.push(red(line));
      }
      return output.result(error instanceof CommandFailure ? error.exitCode : 70);
    }
  },
);
