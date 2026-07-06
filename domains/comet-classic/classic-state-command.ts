import { spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import path from 'path';
import { Document, parseDocument } from 'yaml';
import type { ClassicCommandHandler, ClassicCommandResult } from './classic-cli.js';
import { collectClassicEvidence } from './classic-evidence.js';
import { openSpecChangeNameError, resolveClassicChangeDirectory } from './classic-paths.js';
import { resolveClassicStepId } from './classic-resolver.js';
import { transitionClassicRuntimeRun } from './classic-runtime-run.js';
import { appendClassicStateEvent } from './classic-state-events.js';
import {
  CLASSIC_WIRE_KEYS,
  RUN_WIRE_KEYS,
  parseClassicStateDocument,
  type ClassicState,
} from './classic-state.js';
import { readClassicState, writeClassicState } from './classic-store.js';
import {
  CLASSIC_TRANSITION_EVENTS,
  applyClassicTransition,
  type ClassicTransitionEvent,
} from './classic-transitions.js';
import { readRunState } from '../../domains/engine/state.js';
import { appendTrajectory, readTrajectory } from '../../domains/engine/run-store.js';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';
const PROFILES = ['full', 'hotfix', 'tweak'] as const;
const PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;
const ARTIFACT_LANGUAGES = ['en', 'zh-CN'] as const;
const EVENTS = CLASSIC_TRANSITION_EVENTS;
const MACHINE_OWNED_FIELDS = new Set<string>([
  ...RUN_WIRE_KEYS,
  'classic_profile',
  'classic_migration',
]);
const SETTABLE_FIELDS = new Set<string>(
  CLASSIC_WIRE_KEYS.filter((field) => !MACHINE_OWNED_FIELDS.has(field)),
);

const FIELD_ENUMS: Record<string, readonly string[]> = {
  workflow: PROFILES,
  phase: PHASES,
  context_compression: ['off', 'beta'],
  build_mode: ['subagent-driven-development', 'executing-plans', 'direct'],
  build_pause: ['null', 'plan-ready'],
  subagent_dispatch: ['null', 'confirmed'],
  tdd_mode: ['tdd', 'direct'],
  review_mode: ['off', 'standard', 'thorough'],
  isolation: ['branch', 'worktree'],
  verify_mode: ['light', 'full'],
  auto_transition: ['true', 'false'],
  verify_result: ['pending', 'pass', 'fail'],
  branch_status: ['pending', 'handled'],
  archived: ['true', 'false'],
  direct_override: ['true', 'false'],
  classic_profile: PROFILES,
  classic_migration: ['1'],
};

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
  verifyResult: 'verify_result',
  workflow: 'workflow',
};

class CommandFailure extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}

class CommandOutput {
  stdout: string[] = [];
  stderr: string[] = [];

  result(exitCode = 0): ClassicCommandResult {
    return {
      exitCode,
      ...(this.stdout.length > 0 ? { stdout: this.stdout.join('\n') + '\n' } : {}),
      ...(this.stderr.length > 0 ? { stderr: this.stderr.join('\n') } : {}),
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
    fail(`ERROR: ${field} must be a relative path within the repo: '${value}'`);
  }
  if (value.split(/[\\/]/u).includes('..')) {
    fail(`ERROR: ${field} cannot contain '..' (path traversal not allowed): '${value}'`);
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function nonempty(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).size > 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function changeDirectory(name: string): Promise<{ label: string; directory: string }> {
  return resolveClassicChangeDirectory(name);
}

async function readDocument(file: string): Promise<Document> {
  let source: string;
  try {
    source = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      fail(
        `ERROR: .comet.yaml not found at ${path.relative(process.cwd(), file).replaceAll('\\', '/')}`,
      );
    }
    throw error;
  }
  const document = parseDocument(source, { uniqueKeys: false });
  if (document.errors.length > 0) fail(`ERROR: Invalid .comet.yaml: ${document.errors[0].message}`);
  return document;
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, content, 'utf8');
    await fs.rename(temporary, file);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
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
      ['subagent-driven-development', 'executing-plans', 'direct'] as const,
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
    isolation: enumRecordValue(record, 'isolation', ['branch', 'worktree'] as const, null),
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
    verificationReport: nullableRecordString(record, 'verification_report'),
    branchStatus: enumRecordValue(record, 'branch_status', ['pending', 'handled'] as const, null),
    createdAt: nullableRecordString(record, 'created_at'),
    verifiedAt: nullableRecordString(record, 'verified_at'),
    archived: nullableRecordBoolean(record, 'archived') ?? false,
    directOverride: nullableRecordBoolean(record, 'direct_override'),
    buildCommand: nullableRecordString(record, 'build_command'),
    verifyCommand: nullableRecordString(record, 'verify_command'),
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
  const file = path.resolve('.comet', 'config.yaml');
  if (!(await exists(file))) return null;
  const document = await readDocument(file);
  const value = document.get(field);
  return value === null || value === undefined ? null : scalar(value);
}

async function projectLanguageDefault(): Promise<string> {
  if (process.env.COMET_LANGUAGE)
    return validateLanguage(process.env.COMET_LANGUAGE, 'COMET_LANGUAGE');
  const value = await projectConfigValue('language');
  if (value) return validateLanguage(value, '.comet/config.yaml');
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
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function stateFile(
  name: string,
): Promise<{ file: string; label: string; directory: string }> {
  const change = await changeDirectory(name);
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

function validateSetValue(field: string, value: string): void {
  if (field === 'language') {
    validateLanguage(value, 'language');
    return;
  }
  const enumValues = FIELD_ENUMS[field];
  if (enumValues) validateEnum(value, enumValues);
  if (PATH_FIELDS.has(field)) validateRelativePath(value, field);
  if ((field === 'skill_hash' || field === 'handoff_hash') && !/^[a-f0-9]{64}$/u.test(value)) {
    fail(`ERROR: ${field} must be a sha256 hex digest`);
  }
  if (field === 'iteration' && !/^[0-9]+$/u.test(value)) {
    fail('ERROR: iteration must be a non-negative integer');
  }
}

async function setField(
  output: CommandOutput,
  name: string,
  field: string,
  value: string,
  options: { internal?: boolean; machineOwned?: boolean } = {},
): Promise<void> {
  if (MACHINE_OWNED_FIELDS.has(field) && !options.machineOwned) {
    fail(`ERROR: '${field}' is a machine-owned Run field and cannot be set directly`);
  }
  if (!SETTABLE_FIELDS.has(field) && !MACHINE_OWNED_FIELDS.has(field)) {
    fail(`ERROR: Unknown field: '${field}'`);
  }
  if (field === 'phase' && !options.internal && process.env.COMET_FORCE_PHASE !== '1') {
    fail(
      "ERROR: Setting 'phase' directly is not allowed; it bypasses state machine evidence checks.\n" +
        '  Use: comet-state.mjs transition <change-name> <event>\n' +
        '  Repair-only escape hatch: COMET_FORCE_PHASE=1 comet-state.mjs set <change-name> phase <value>',
    );
  }
  validateSetValue(field, value);
  const { file, directory } = await stateFile(name);
  const document = await readDocument(file);
  document.set(field, parsedValue(field, value));
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
          field,
          fromStep: projection.run.currentStep,
          toStep: currentStep,
        },
      });
    }
  } else {
    await atomicWrite(file, document.toString());
  }
  if (field === 'phase' && !options.internal) {
    output.stderr.push(
      yellow("WARNING: Setting 'phase' directly bypasses state machine constraints."),
      yellow('  Consider using: comet-state.mjs transition <change-name> <event>'),
    );
  }
  output.stderr.push(green(`[SET] ${field}=${value}`));
}

async function init(output: CommandOutput, name: string, workflow: string): Promise<void> {
  validateChangeName(name);
  validateEnum(workflow, PROFILES);
  const { file, label, directory } = await stateFile(name);
  if (await exists(file)) fail(`ERROR: .comet.yaml already exists at ${label}/.comet.yaml`);
  await fs.mkdir(directory, { recursive: true });

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
    isolation: preset ? 'branch' : null,
    verify_mode: preset ? 'light' : null,
    auto_transition: (await autoTransition()) === 'true',
    base_ref: gitOutput(['rev-parse', '--verify', 'HEAD']),
    design_doc: null,
    plan: null,
    verify_result: 'pending',
    verification_report: null,
    branch_status: 'pending',
    created_at: new Date().toISOString().slice(0, 10),
    verified_at: null,
    archived: false,
  });
  await atomicWrite(file, document.toString());
  output.stderr.push(green(`Initialized: ${label}/.comet.yaml (workflow=${workflow})`));
}

async function requirePhase(name: string, expected: string): Promise<void> {
  const actual = await readField(name, 'phase');
  if (actual !== expected) {
    fail(`ERROR: Cannot transition '${name}': expected phase ${expected}, got ${actual}`);
  }
}

async function requireBuildDecisions(name: string): Promise<void> {
  const workflow = await readField(name, 'workflow');
  const buildMode = await readField(name, 'build_mode');
  const isolation = await readField(name, 'isolation');
  const directOverride = await readField(name, 'direct_override');
  const subagentDispatch = await readField(name, 'subagent_dispatch');
  const tddMode = await readField(name, 'tdd_mode');
  const reviewMode = await readField(name, 'review_mode');
  if (!['branch', 'worktree'].includes(isolation)) {
    fail(
      `ERROR: Cannot transition '${name}': isolation must be branch or worktree, got '${isolation || 'null'}'`,
    );
  }
  if (!['subagent-driven-development', 'executing-plans', 'direct'].includes(buildMode)) {
    fail(
      `ERROR: Cannot transition '${name}': build_mode must be selected before leaving build, got '${buildMode || 'null'}'`,
    );
  }
  if (
    buildMode === 'direct' &&
    !['hotfix', 'tweak'].includes(workflow) &&
    directOverride !== 'true'
  ) {
    fail(
      `ERROR: Cannot transition '${name}': build_mode=direct is only allowed for hotfix/tweak unless direct_override=true`,
    );
  }
  if (buildMode === 'subagent-driven-development' && subagentDispatch !== 'confirmed') {
    fail(
      `ERROR: Cannot transition '${name}': subagent_dispatch must be confirmed before using build_mode=subagent-driven-development`,
    );
  }
  if (workflow === 'full' && (!tddMode || tddMode === 'null')) {
    fail(
      `ERROR: Cannot transition '${name}': tdd_mode must be selected before leaving build (full workflow)`,
    );
  }
  if (workflow === 'full' && !['off', 'standard', 'thorough'].includes(reviewMode)) {
    fail(
      `ERROR: Cannot transition '${name}': review_mode must be selected before leaving build (full workflow); review_mode must be off, standard, or thorough, got '${reviewMode || 'null'}'`,
    );
  }
}

async function requireOpenArtifacts(name: string): Promise<void> {
  const { directory } = await stateFile(name);
  const workflow = await readField(name, 'workflow');
  for (const artifact of ['proposal.md', 'tasks.md']) {
    if (!(await nonempty(path.join(directory, artifact)))) {
      fail(
        `ERROR: Cannot transition '${name}': ${artifact} must exist and be non-empty before leaving open`,
      );
    }
  }
  if (workflow === 'full' && !(await nonempty(path.join(directory, 'design.md')))) {
    fail(
      `ERROR: Cannot transition '${name}': design.md must exist and be non-empty before leaving open`,
    );
  }
}

async function requireDesignEvidence(name: string): Promise<void> {
  const designDoc = await readField(name, 'design_doc');
  if (!designDoc || designDoc === 'null' || !(await nonempty(path.resolve(designDoc)))) {
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
): Promise<void> {
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
}

async function transition(output: CommandOutput, name: string, event: string): Promise<void> {
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
  } else if (event === 'verify-pass') {
    await requirePhase(name, 'verify');
    const report = await readField(name, 'verification_report');
    if (!report || !(await exists(path.resolve(report)))) {
      fail(
        `ERROR: Cannot transition '${name}': verification_report must point to an existing report file`,
      );
    }
    if ((await readField(name, 'branch_status')) !== 'handled') {
      fail(`ERROR: Cannot transition '${name}': branch_status must be handled`);
    }
  } else if (event === 'verify-fail') {
    await requirePhase(name, 'verify');
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
  }
  await applyTransitionEvent(output, name, event as ClassicTransitionEvent);
}

async function next(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { file, label } = await stateFile(name);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const phase = await readField(name, 'phase');
  const workflow = await readField(name, 'workflow');
  const automatic = await readField(name, 'auto_transition');
  if ((await readField(name, 'archived')) === 'true') {
    output.stdout.push('NEXT: done');
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
  const file = path.resolve(taskFile);
  if (!(await exists(file))) fail(`ERROR: Task file not found: ${taskFile}`);
  const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/u);
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

async function check(output: CommandOutput, name: string, phase: string): Promise<void> {
  validateChangeName(name);
  validateEnum(phase, PHASES);
  const { file, directory, label } = await stateFile(name);
  output.stdout.push(`=== Entry Check: comet-${phase} ===`);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  let blocked = false;
  const pass = (message: string) => output.stdout.push(`  ${green('[PASS]')} ${message}`);
  const reject = (message: string) => {
    output.stdout.push(`  ${red('[FAIL]')} ${message}`);
    blocked = true;
  };
  const expectField = async (field: string, expected: string) => {
    const actual = await readField(name, field);
    (actual === expected ? pass : reject)(`${field}=${actual} (expected: ${expected})`);
  };
  pass('.comet.yaml exists');
  await expectField('phase', phase);
  if (phase === 'design') {
    await expectField('workflow', 'full');
    const designDoc = await readField(name, 'design_doc');
    (!designDoc || designDoc === 'null' ? pass : reject)(
      designDoc ? `design_doc=${designDoc} (expected: empty/null)` : 'design_doc is empty/null',
    );
    for (const artifact of ['proposal.md', 'design.md', 'tasks.md']) {
      ((await nonempty(path.join(directory, artifact))) ? pass : reject)(
        `${artifact} ${(await nonempty(path.join(directory, artifact))) ? 'non-empty' : 'missing or empty'}`,
      );
    }
  } else if (phase === 'build') {
    const workflow = await readField(name, 'workflow');
    const designDoc = await readField(name, 'design_doc');
    if (workflow === 'full') {
      (designDoc && designDoc !== 'null' && (await exists(path.resolve(designDoc)))
        ? pass
        : reject)(`design_doc=${designDoc} (expected: non-null and file exists)`);
    } else {
      pass(`workflow=${workflow} (design_doc not required)`);
    }
    for (const artifact of ['proposal.md', 'tasks.md']) {
      ((await nonempty(path.join(directory, artifact))) ? pass : reject)(
        `${artifact} ${(await nonempty(path.join(directory, artifact))) ? 'non-empty' : 'missing or empty'}`,
      );
    }
  } else if (phase === 'verify') {
    const value = await readField(name, 'verify_result');
    (['', 'null', 'pending'].includes(value) ? pass : reject)(
      `verify_result=${value} (expected: pending or null)`,
    );
  } else if (phase === 'archive') {
    await expectField('verify_result', 'pass');
    const archived = await readField(name, 'archived');
    (archived !== 'true' ? pass : reject)(`archived=${archived} (expected: not true)`);
  }
  output.stdout.push('');
  if (blocked) {
    output.stderr.push(red('BLOCKED — fix failing checks before proceeding'));
    throw new CommandFailure('', 1);
  }
  output.stderr.push(green('ALL CHECKS PASSED — ready to proceed'));
}

function fieldStatus(field: string, value: string, file?: string): string {
  if (!value || value === 'null') return `  - ${field}: PENDING`;
  if (file && !existsSync(path.resolve(file))) {
    return `  - ${field}: BROKEN (path ${value} does not exist)`;
  }
  return `  - ${field}: DONE (${value})`;
}

async function recoverOpen(output: CommandOutput, directory: string): Promise<void> {
  output.stdout.push('  Artifacts:');
  let complete = 0;
  for (const artifact of ['proposal.md', 'design.md', 'tasks.md']) {
    const done = await nonempty(path.join(directory, artifact));
    if (done) complete += 1;
    output.stdout.push(`  - ${artifact}: ${done ? 'DONE' : 'PENDING'}`);
  }
  output.stdout.push(
    '',
    complete === 3
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
  output.stdout.push('  Artifacts:');
  for (const artifact of ['proposal.md', 'design.md', 'tasks.md']) {
    output.stdout.push(
      `  - ${artifact}: ${(await nonempty(path.join(directory, artifact))) ? 'DONE' : 'MISSING (unexpected in design phase)'}`,
    );
  }
  const handoff = await readField(name, 'handoff_context');
  const hash = await readField(name, 'handoff_hash');
  const design = await readField(name, 'design_doc');
  output.stdout.push(
    '',
    '  Design progress:',
    fieldStatus('handoff_context', handoff, handoff),
    fieldStatus('handoff_hash', hash),
    fieldStatus('design_doc', design, design),
    '',
  );
  if (design && design !== 'null' && (await exists(path.resolve(design)))) {
    output.stdout.push(
      'Recovery action: Design Doc already created and linked. Run guard to transition to build.',
    );
  } else if (handoff && handoff !== 'null' && (await exists(path.resolve(handoff)))) {
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
  name: string,
  directory: string,
  workflow: string,
): Promise<void> {
  const isolation = await readField(name, 'isolation');
  const buildMode = await readField(name, 'build_mode');
  const pause = await readField(name, 'build_pause');
  const subagentDispatch = await readField(name, 'subagent_dispatch');
  const tdd = await readField(name, 'tdd_mode');
  const review = await readField(name, 'review_mode');
  const plan = await readField(name, 'plan');
  const decisions = [
    '  Build decisions:',
    fieldStatus('isolation', isolation),
    fieldStatus('build_mode', buildMode),
    fieldStatus('build_pause', pause),
    fieldStatus('tdd_mode', tdd),
    fieldStatus('review_mode', review),
  ];
  if (
    buildMode === 'subagent-driven-development' ||
    (subagentDispatch && subagentDispatch !== 'null')
  ) {
    decisions.push(fieldStatus('subagent_dispatch', subagentDispatch));
  }
  output.stdout.push(...decisions, '', '  Plan:', fieldStatus('plan', plan, plan), '');
  const tasks = path.join(directory, 'tasks.md');
  if (!(await exists(tasks))) {
    output.stdout.push(
      '  Tasks: tasks.md MISSING',
      '',
      'Recovery action: tasks.md missing. Verify change directory integrity.',
    );
    return;
  }
  const lines = (await fs.readFile(tasks, 'utf8')).split(/\r?\n/u);
  const total = lines.filter((line) => /^\s*- \[[ xX]\] /u.test(line)).length;
  const done = lines.filter((line) => /^\s*- \[[xX]\] /u.test(line)).length;
  const pending = total - done;
  let planTotal = 0;
  let planDone = 0;
  if (plan && plan !== 'null' && (await exists(path.resolve(plan)))) {
    const planLines = (await fs.readFile(path.resolve(plan), 'utf8')).split(/\r?\n/u);
    planTotal = planLines.filter((line) => /^\s*- \[[ xX]\] /u.test(line)).length;
    planDone = planLines.filter((line) => /^\s*- \[[xX]\] /u.test(line)).length;
  }
  const planPending = planTotal - planDone;
  output.stdout.push(`  Tasks: ${done}/${total} done, ${pending} pending`);
  if (planTotal > 0) {
    output.stdout.push(`  Plan tasks: ${planDone}/${planTotal} done, ${planPending} pending`);
  }
  output.stdout.push('');

  const action = resolveBuildRecoveryAction(
    workflow,
    isolation,
    buildMode,
    pause,
    subagentDispatch,
    tdd,
    review,
    plan,
    pending,
    planPending,
  );
  output.stdout.push(action);
}

function isMissingStateValue(value: string): boolean {
  return !value || value === 'null';
}

function resolveBuildRecoveryAction(
  workflow: string,
  isolation: string,
  buildMode: string,
  pause: string,
  subagentDispatch: string,
  tdd: string,
  review: string,
  plan: string,
  pending: number,
  planPending: number,
): string {
  const planExists = plan && plan !== 'null';
  const missingWorkflowChoices =
    workflow === 'full' && (isMissingStateValue(tdd) || isMissingStateValue(review));
  if (
    pause === 'plan-ready' &&
    planExists &&
    (isMissingStateValue(isolation) || isMissingStateValue(buildMode) || missingWorkflowChoices)
  ) {
    return workflow === 'full'
      ? 'Recovery action: Plan-ready pause detected. Ask the user whether to continue, then choose isolation, build mode, TDD mode, and review mode without regenerating the plan.'
      : 'Recovery action: Plan-ready pause detected. Ask the user whether to continue, then choose isolation and build mode without regenerating the plan.';
  }
  if (pause === 'plan-ready' && !planExists) {
    return 'Recovery action: Plan-ready pause is recorded, but the plan file is missing. Restore the plan file or rerun writing-plans before choosing execution.';
  }
  if (pause === 'plan-ready') {
    if (buildMode === 'subagent-driven-development' && (pending > 0 || planPending > 0)) {
      return subagentDispatch === 'confirmed'
        ? 'Recovery action: Plan-ready pause is stale because build decisions are already selected. Clear build_pause to null, then inspect the first unchecked task (OpenSpec or plan additions) against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window.'
        : 'Recovery action: Plan-ready pause is stale and subagent dispatch is not confirmed. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or set build_mode to executing-plans before continuing.';
    }
    if (pending > 0 || planPending > 0) {
      return 'Recovery action: Plan-ready pause is stale because build decisions are already selected. Clear build_pause to null, then continue from the first unchecked task.';
    }
    return 'Recovery action: Plan-ready pause is stale and all tasks are done. Clear build_pause to null, then run guard to transition to verify.';
  }
  if (isMissingStateValue(isolation)) {
    return "Recovery action: Isolation not selected. Use the current platform's user confirmation mechanism to ask user for branch/worktree choice.";
  }
  if (isMissingStateValue(buildMode)) {
    return "Recovery action: Build mode not selected. Use the current platform's user confirmation mechanism to ask user for execution method.";
  }
  if (workflow === 'full' && isMissingStateValue(tdd)) {
    return "Recovery action: TDD mode not selected. Use the current platform's user confirmation mechanism to ask user for tdd or direct.";
  }
  if (workflow === 'full' && isMissingStateValue(review)) {
    return "Recovery action: Review mode not selected. Use the current platform's user confirmation mechanism to ask user for off, standard, or thorough.";
  }
  if (pending > 0) {
    if (buildMode === 'subagent-driven-development') {
      return subagentDispatch === 'confirmed'
        ? 'Recovery action: Read tasks.md and the Superpowers plan (which may include additions beyond OpenSpec), then inspect the first unchecked task against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window.'
        : 'Recovery action: Subagent dispatch is not confirmed. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or set build_mode to executing-plans before continuing.';
    }
    return 'Recovery action: Read tasks.md and continue from first unchecked task.';
  }
  if (planPending > 0) {
    if (buildMode === 'subagent-driven-development') {
      return subagentDispatch === 'confirmed'
        ? 'Recovery action: Read the Superpowers plan, then inspect the first unchecked Superpowers plan task against recent git history/diff. If implemented, check it off; otherwise dispatch a real background subagent. Do not execute the pending task directly in the main window.'
        : 'Recovery action: Subagent dispatch is not confirmed. Confirm a real background subagent/Task/multi-agent dispatcher and set subagent_dispatch to confirmed, or set build_mode to executing-plans before continuing.';
    }
    return 'Recovery action: Read the Superpowers plan and continue from the first unchecked plan task.';
  }
  return 'Recovery action: All tasks done. Run guard to transition to verify.';
}

async function recoverVerify(output: CommandOutput, name: string): Promise<void> {
  const result = await readField(name, 'verify_result');
  const mode = await readField(name, 'verify_mode');
  const report = await readField(name, 'verification_report');
  const branch = await readField(name, 'branch_status');
  output.stdout.push(
    '  Verification:',
    fieldStatus('verify_result', result),
    fieldStatus('verify_mode', mode),
    fieldStatus('verification_report', report, report),
    fieldStatus('branch_status', branch),
    '',
    result === 'pass' && branch === 'handled'
      ? 'Recovery action: Verification complete. Run guard to transition to archive.'
      : result === 'fail'
        ? 'Recovery action: Verification failed and rolled back to build. Resume from /comet-build.'
        : 'Recovery action: Verification not yet started or in progress. Run scale assessment then verify.',
  );
}

async function recoverArchive(output: CommandOutput, name: string): Promise<void> {
  output.stdout.push(
    '  Archive:',
    fieldStatus('verify_result', await readField(name, 'verify_result')),
    fieldStatus('archived', await readField(name, 'archived')),
    '',
    'Recovery action: Run /comet-archive to complete archiving.',
  );
}

async function recover(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { file, directory, label } = await stateFile(name);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const phase = await readField(name, 'phase');
  const workflow = await readField(name, 'workflow');
  output.stdout.push(
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
    await recoverBuild(output, name, directory, workflow);
  } else if (phase === 'verify') {
    await recoverVerify(output, name);
  } else if (phase === 'archive') {
    await recoverArchive(output, name);
  } else {
    fail(`ERROR: Unknown phase: ${phase}`);
  }
  output.stdout.push('', '=== End Recovery Context ===');
}

async function scale(output: CommandOutput, name: string): Promise<void> {
  validateChangeName(name);
  const { file, directory, label } = await stateFile(name);
  if (!(await exists(file))) fail(`ERROR: .comet.yaml not found at ${label}/.comet.yaml`);
  const tasksFile = path.join(directory, 'tasks.md');
  const taskCount = (await exists(tasksFile))
    ? (await fs.readFile(tasksFile, 'utf8')).split(/\r?\n/u).filter((line) => /^- \[/u.test(line))
        .length
    : 0;
  const specs = path.join(directory, 'specs');
  let deltaSpecs = 0;
  if (await exists(specs)) {
    for (const entry of await fs.readdir(specs)) {
      if (await exists(path.join(specs, entry, 'spec.md'))) deltaSpecs += 1;
    }
  }
  const plan = await readField(name, 'plan');
  let baseRef = '';
  if (plan && plan !== 'null' && (await exists(path.resolve(plan)))) {
    const match = (await fs.readFile(path.resolve(plan), 'utf8')).match(/^base-ref:\s*(.+)$/mu);
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
  await setField(new CommandOutput(), name, 'verify_mode', result);
  output.stderr.push(
    `=== Scale Assessment: ${name} ===`,
    `  Tasks: ${taskCount} (threshold: 3)`,
    `  Delta specs: ${deltaSpecs} capabilities (threshold: 1)`,
    `  Changed files: ${changedFiles} (threshold: 8)`,
    `  → Result: ${result}`,
    green(`[SCALE] verify_mode=${result}`),
  );
}

function required(args: string[], count: number, usage: string): void {
  if (args.length < count) fail(usage);
}

export const classicStateCommand: ClassicCommandHandler = async (args) => {
  const output = new CommandOutput();
  try {
    const [subcommand, ...rest] = args;
    if (subcommand === 'init') {
      required(rest, 2, 'Usage: comet-state.mjs init <change-name> <workflow>');
      await init(output, rest[0], rest[1]);
    } else if (subcommand === 'get') {
      required(rest, 2, 'Usage: comet-state.mjs get <change-name> <field>');
      validateChangeName(rest[0]);
      output.stdout.push(await readField(rest[0], rest[1]));
    } else if (subcommand === 'set') {
      required(rest, 3, 'Usage: comet-state.mjs set <change-name> <field> <value>');
      validateChangeName(rest[0]);
      await setField(output, rest[0], rest[1], rest[2]);
    } else if (subcommand === 'transition') {
      required(rest, 2, 'Usage: comet-state.mjs transition <change-name> <event>');
      await transition(output, rest[0], rest[1]);
    } else if (subcommand === 'check') {
      required(rest, 2, 'Usage: comet-state.mjs check <change-name> <phase> [--recover]');
      if (rest[2] === '--recover') await recover(output, rest[0]);
      else await check(output, rest[0], rest[1]);
    } else if (subcommand === 'scale') {
      required(rest, 1, 'Usage: comet-state.mjs scale <change-name>');
      await scale(output, rest[0]);
    } else if (subcommand === 'task-checkoff') {
      required(rest, 2, 'Usage: comet-state.mjs task-checkoff <file> <task-text>');
      await taskCheckoff(output, rest[0], rest[1]);
    } else if (subcommand === 'next') {
      required(rest, 1, 'Usage: comet-state.mjs next <change-name>');
      await next(output, rest[0]);
    } else {
      fail(`Unknown subcommand: ${subcommand ?? ''}`);
    }
    return output.result();
  } catch (error) {
    if (!(error instanceof CommandFailure)) throw error;
    // The frozen 0.3.8 shell calls red() once per line and never embeds newlines
    // inside a single color call. Mirror that contract by wrapping each line of
    // the message in its own span so multi-line errors (e.g. validateEnum) render
    // as separate colored lines rather than one span across a newline.
    if (error.message) {
      for (const line of error.message.split('\n')) output.stderr.push(red(line));
    }
    return output.result(error.exitCode);
  }
};
