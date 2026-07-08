import type { RunState } from '../../domains/engine/types.js';
import { runStateFromDocument, type StateDocument } from '../../domains/engine/state.js';

export const CLASSIC_PROFILES = ['full', 'hotfix', 'tweak'] as const;
export const CLASSIC_MIGRATION_VERSION = 1;

const PHASES = ['open', 'design', 'build', 'verify', 'archive'] as const;
const ARTIFACT_LANGUAGES = ['en', 'zh-CN'] as const;
const CONTEXT_COMPRESSION = ['off', 'beta'] as const;
const BUILD_MODES = ['subagent-driven-development', 'executing-plans', 'direct'] as const;
const BUILD_PAUSES = ['plan-ready'] as const;
const SUBAGENT_DISPATCH = ['confirmed'] as const;
const TDD_MODES = ['tdd', 'direct'] as const;
const REVIEW_MODES = ['off', 'standard', 'thorough'] as const;
const ISOLATIONS = ['branch', 'worktree'] as const;
const VERIFY_MODES = ['light', 'full'] as const;
const VERIFY_RESULTS = ['pending', 'pass', 'fail'] as const;
const BRANCH_STATUSES = ['pending', 'handled'] as const;

export type ClassicProfile = (typeof CLASSIC_PROFILES)[number];
export type ClassicPhase = (typeof PHASES)[number];
export type ClassicArtifactLanguage = (typeof ARTIFACT_LANGUAGES)[number];

export interface ClassicState {
  workflow: ClassicProfile;
  language: ClassicArtifactLanguage | null;
  phase: ClassicPhase;
  contextCompression: (typeof CONTEXT_COMPRESSION)[number] | null;
  buildMode: (typeof BUILD_MODES)[number] | null;
  buildPause: (typeof BUILD_PAUSES)[number] | null;
  subagentDispatch: (typeof SUBAGENT_DISPATCH)[number] | null;
  tddMode: (typeof TDD_MODES)[number] | null;
  reviewMode: (typeof REVIEW_MODES)[number] | null;
  isolation: (typeof ISOLATIONS)[number] | null;
  verifyMode: (typeof VERIFY_MODES)[number] | null;
  autoTransition: boolean | null;
  baseRef: string | null;
  designDoc: string | null;
  plan: string | null;
  verifyResult: (typeof VERIFY_RESULTS)[number];
  verificationReport: string | null;
  branchStatus: (typeof BRANCH_STATUSES)[number] | null;
  createdAt: string | null;
  verifiedAt: string | null;
  archived: boolean;
  directOverride: boolean | null;
  handoffContext: string | null;
  handoffHash: string | null;
  classicProfile: ClassicProfile | null;
  classicMigration: number | null;
}

export interface ClassicStateProjection {
  classic: ClassicState | null;
  run: RunState | null;
  unknownKeys: string[];
}

export const CLASSIC_WIRE_KEYS = [
  'workflow',
  'language',
  'phase',
  'context_compression',
  'build_mode',
  'build_pause',
  'subagent_dispatch',
  'tdd_mode',
  'review_mode',
  'isolation',
  'verify_mode',
  'auto_transition',
  'base_ref',
  'design_doc',
  'plan',
  'verify_result',
  'verification_report',
  'branch_status',
  'created_at',
  'verified_at',
  'archived',
  'direct_override',
  'handoff_context',
  'handoff_hash',
  'classic_profile',
  'classic_migration',
] as const;

/** Fields that appear in .comet.yaml to link to the Run state. */
export const RUN_WIRE_KEYS = ['run_id'] as const;

const KNOWN_KEYS = new Set<string>([...CLASSIC_WIRE_KEYS, ...RUN_WIRE_KEYS]);
// NOTE: review_mode is intentionally omitted — pre-0.4.0 state files lack this field,
// and omitting it here allows legacy files to parse without migration. The transition
// guard in classic-state-command.ts enforces review_mode selection for full workflow
// at build→verify time, so runtime safety is not compromised.
const REQUIRED_CLASSIC_KEYS = [
  'workflow',
  'phase',
  'design_doc',
  'plan',
  'build_mode',
  'isolation',
  'verify_mode',
  'verify_result',
  'verified_at',
  'archived',
] as const;

function has(doc: StateDocument, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(doc, key);
}

function nullableString(doc: StateDocument, key: string): string | null {
  const value = doc[key];
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') {
    throw new Error(`Invalid Classic state: ${key} must be a string or null`);
  }
  return value;
}

function enumValue<const T extends readonly string[]>(
  doc: StateDocument,
  key: string,
  values: T,
  nullable = true,
): T[number] | null {
  const value = doc[key];
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new Error(`Invalid Classic state: ${key} is required`);
  }
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new Error(
      `Invalid Classic state: ${key} must be one of ${values.join(', ')}${nullable ? ' or null' : ''}`,
    );
  }
  return value as T[number];
}

function booleanValue(doc: StateDocument, key: string, nullable = true): boolean | null {
  const value = doc[key];
  if (value === null || value === undefined || value === '') {
    if (nullable) return null;
    throw new Error(`Invalid Classic state: ${key} is required`);
  }
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid Classic state: ${key} must be true or false`);
  }
  return value;
}

function relativePath(doc: StateDocument, key: string): string | null {
  const value = nullableString(doc, key);
  if (value === null) return null;
  if (/^(?:[A-Za-z]:|[\\/]|~)/u.test(value) || value.split(/[\\/]/u).includes('..')) {
    throw new Error(`Invalid Classic state: ${key} must be a relative repository path`);
  }
  return value;
}

function sha256(doc: StateDocument, key: string): string | null {
  const value = nullableString(doc, key);
  if (value !== null && !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`Invalid Classic state: ${key} must be a sha256 hex digest`);
  }
  return value;
}

function migrationVersion(doc: StateDocument): number | null {
  const value = doc.classic_migration;
  if (value === null || value === undefined || value === '') return null;
  if (value !== CLASSIC_MIGRATION_VERSION) {
    throw new Error(
      `Invalid Classic state: classic_migration must be ${CLASSIC_MIGRATION_VERSION}`,
    );
  }
  return value;
}

function classicStateFromDocument(doc: StateDocument): ClassicState | null {
  const hasClassicProjection = CLASSIC_WIRE_KEYS.some((key) => has(doc, key));
  if (!hasClassicProjection) return null;

  for (const key of REQUIRED_CLASSIC_KEYS) {
    if (!has(doc, key)) return null;
  }

  return {
    workflow: enumValue(doc, 'workflow', CLASSIC_PROFILES, false)!,
    language: enumValue(doc, 'language', ARTIFACT_LANGUAGES),
    phase: enumValue(doc, 'phase', PHASES, false)!,
    contextCompression: enumValue(doc, 'context_compression', CONTEXT_COMPRESSION),
    buildMode: enumValue(doc, 'build_mode', BUILD_MODES),
    buildPause: enumValue(doc, 'build_pause', BUILD_PAUSES),
    subagentDispatch: enumValue(doc, 'subagent_dispatch', SUBAGENT_DISPATCH),
    tddMode: enumValue(doc, 'tdd_mode', TDD_MODES),
    reviewMode: enumValue(doc, 'review_mode', REVIEW_MODES),
    isolation: enumValue(doc, 'isolation', ISOLATIONS),
    verifyMode: enumValue(doc, 'verify_mode', VERIFY_MODES),
    autoTransition: booleanValue(doc, 'auto_transition'),
    baseRef: nullableString(doc, 'base_ref'),
    designDoc: relativePath(doc, 'design_doc'),
    plan: relativePath(doc, 'plan'),
    verifyResult: enumValue(doc, 'verify_result', VERIFY_RESULTS, false)!,
    verificationReport: relativePath(doc, 'verification_report'),
    branchStatus: enumValue(doc, 'branch_status', BRANCH_STATUSES),
    createdAt: nullableString(doc, 'created_at'),
    verifiedAt: nullableString(doc, 'verified_at'),
    archived: booleanValue(doc, 'archived', false)!,
    directOverride: booleanValue(doc, 'direct_override'),
    handoffContext: relativePath(doc, 'handoff_context'),
    handoffHash: sha256(doc, 'handoff_hash'),
    classicProfile: enumValue(doc, 'classic_profile', CLASSIC_PROFILES),
    classicMigration: migrationVersion(doc),
  };
}

export function parseClassicStateDocument(
  doc: StateDocument,
  run?: RunState | null,
): ClassicStateProjection {
  // Run state is stored separately in .comet/run-state.json.
  // If not provided, check for a run_id link (but don't parse full Run state from yaml).
  let resolvedRun: RunState | null = run ?? null;
  if (resolvedRun === null && run === undefined) {
    // Backward compat: old yaml may still have full Run fields — extract them
    if (doc.run_id && doc.skill) {
      try {
        resolvedRun = runStateFromDocument(doc);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.replace(/^Invalid Run state:/u, 'Invalid Classic state:'), {
          cause: error,
        });
      }
    }
  }

  return {
    classic: classicStateFromDocument(doc),
    run: resolvedRun,
    unknownKeys: Object.keys(doc).filter((key) => !KNOWN_KEYS.has(key)),
  };
}

export interface LegacyStateSummary {
  workflow: ClassicProfile | null;
  phase: ClassicPhase | null;
  archived: boolean;
  designDoc: string | null;
  unknownKeys: string[];
}

export function readLegacyStateSummary(doc: StateDocument): LegacyStateSummary {
  const workflowRaw = doc['workflow'];
  const phaseRaw = doc['phase'];
  const archivedRaw = doc['archived'];
  const designDocRaw = doc['design_doc'];
  return {
    workflow:
      typeof workflowRaw === 'string' && CLASSIC_PROFILES.includes(workflowRaw as ClassicProfile)
        ? (workflowRaw as ClassicProfile)
        : null,
    phase:
      typeof phaseRaw === 'string' && PHASES.includes(phaseRaw as ClassicPhase)
        ? (phaseRaw as ClassicPhase)
        : null,
    archived: archivedRaw === true,
    designDoc: typeof designDocRaw === 'string' && designDocRaw !== '' ? designDocRaw : null,
    unknownKeys: Object.keys(doc).filter((key) => !KNOWN_KEYS.has(key)),
  };
}

export function classicStateToDocument(state: ClassicState): StateDocument {
  return {
    workflow: state.workflow,
    language: state.language,
    phase: state.phase,
    context_compression: state.contextCompression,
    build_mode: state.buildMode,
    build_pause: state.buildPause,
    subagent_dispatch: state.subagentDispatch,
    tdd_mode: state.tddMode,
    review_mode: state.reviewMode,
    isolation: state.isolation,
    verify_mode: state.verifyMode,
    auto_transition: state.autoTransition,
    base_ref: state.baseRef,
    design_doc: state.designDoc,
    plan: state.plan,
    verify_result: state.verifyResult,
    verification_report: state.verificationReport,
    branch_status: state.branchStatus,
    created_at: state.createdAt,
    verified_at: state.verifiedAt,
    archived: state.archived,
    direct_override: state.directOverride,
    handoff_context: state.handoffContext,
    handoff_hash: state.handoffHash,
    classic_profile: state.classicProfile,
    classic_migration: state.classicMigration,
  };
}
