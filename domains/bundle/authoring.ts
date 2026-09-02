import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { reconcileBundleAuthoringState, writeBundleAuthoringState } from './state.js';
import type { AuthoringReview, AuthoringReviewFinding, BundleAuthoringState } from './types.js';

export type AuthoringDepth = 'quick' | 'full';
export type AuthoringLaneId =
  'script' | 'reference' | 'pause-points' | 'workflow-entry' | 'skill-core' | 'skill-review';

export const AUTHORING_LANE_IDS: readonly AuthoringLaneId[] = [
  'script',
  'reference',
  'pause-points',
  'workflow-entry',
  'skill-core',
  'skill-review',
];

export const AUTHORING_DAG = {
  wave1: ['script', 'reference', 'pause-points'],
  wave2: ['workflow-entry', 'skill-core'],
  barrier: ['skill-review'],
} as const;

export const AUTHORING_LANE_CLAIMS: Record<AuthoringLaneId, string[]> = {
  script: [
    'script:workflow-state',
    'script:workflow-guard',
    'script:workflow-handoff',
    'script:comet-plan',
    'script:comet-check',
    'script:comet-hook-guard',
  ],
  reference: [
    'reference:workflow-protocol',
    'reference:resolved-skills',
    'reference:composition-report',
    'reference:authoring-lanes',
  ],
  'pause-points': ['pause:decision-points', 'pause:recovery'],
  'workflow-entry': ['workflow-entry'],
  'skill-core': [],
  'skill-review': ['review:skill-review'],
};

const CONTENT_LEAF_REFERENCE_PATHS = new Set([
  'SKILL.md',
  'reference/decision-points.md',
  'reference/recovery.md',
  'reference/skill-review.md',
]);

const LANE_STATUS_VALUES = new Set(['DONE', 'DONE_WITH_CONCERNS', 'NEEDS_CONTEXT', 'BLOCKED']);

const EVIDENCE_SOURCES = new Set(['deterministic-check-only', 'llm-single', 'llm-multivote']);
const SEVERITIES = new Set(['critical', 'important', 'minor']);

export function hashAuthoringProtocol(): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        schemaVersion: 1,
        dag: AUTHORING_DAG,
        lanes: AUTHORING_LANE_CLAIMS,
      }),
    )
    .digest('hex');
}

export interface AuthoringLaneArtifact {
  path: string;
  kind?: string;
  content?: string;
}

export interface AuthoringLaneFinding {
  severity: 'critical' | 'important' | 'minor';
  path?: string;
  claim?: string;
  problem: string;
  impact?: string;
  fix?: string;
}

export interface AuthoringLaneOutput {
  lane: string;
  status: string;
  dispatchMode?: string;
  model?: string;
  artifacts?: AuthoringLaneArtifact[];
  claims?: Array<{ id: string; kind?: string; paths?: string[]; summary?: string }>;
  findings?: AuthoringLaneFinding[];
  review?: {
    passed: boolean;
    evidenceSource: 'deterministic-check-only' | 'llm-single' | 'llm-multivote';
    voters?: number;
    lenses?: string[];
    rounds?: number;
    findings: Array<{
      severity: 'critical' | 'important' | 'minor';
      path?: string;
      problem: string;
      fix?: string;
    }>;
    reviewedAt: string;
  };
}

export interface AuthoringPlan {
  schemaVersion: 1;
  name: string;
  depth: AuthoringDepth;
  protocolHash: string;
  dag: typeof AUTHORING_DAG;
  lanes: Array<{
    id: AuthoringLaneId;
    claims: string[];
    producesContentLeaves: boolean;
  }>;
  verify: {
    voters: number;
    lenses: string[];
    maxRounds: number;
    dryThreshold: number;
  };
}

export async function buildAuthoringPlan(options: {
  projectRoot: string;
  name: string;
  depth?: AuthoringDepth;
}): Promise<AuthoringPlan> {
  const depth = options.depth ?? 'quick';
  await reconcileBundleAuthoringState(options.projectRoot, options.name);
  const voters = depth === 'full' ? 3 : 1;
  const maxRounds = depth === 'full' ? 4 : 1;
  return {
    schemaVersion: 1,
    name: options.name,
    depth,
    protocolHash: hashAuthoringProtocol(),
    dag: AUTHORING_DAG,
    lanes: AUTHORING_LANE_IDS.map((id) => ({
      id,
      claims: AUTHORING_LANE_CLAIMS[id],
      producesContentLeaves:
        id === 'workflow-entry' ||
        id === 'skill-core' ||
        id === 'pause-points' ||
        id === 'skill-review',
    })),
    verify: {
      voters,
      lenses: ['contract-fit', 'usability', 'evidence-trace', 'self-consistency'],
      maxRounds,
      dryThreshold: 2,
    },
  };
}

function isContentLeafPath(relativePath: string): boolean {
  if (CONTENT_LEAF_REFERENCE_PATHS.has(relativePath)) return true;
  return relativePath.startsWith('../') && relativePath.endsWith('/SKILL.md');
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Authoring lane output field ${field} must be a non-empty string`);
  }
  return value;
}

function validateReview(review: unknown): AuthoringReview {
  if (!review || typeof review !== 'object') {
    throw new Error('skill-review lane output must include a review object');
  }
  const value = review as Record<string, unknown>;
  if (typeof value.passed !== 'boolean') {
    throw new Error('review.passed must be boolean');
  }
  if (!EVIDENCE_SOURCES.has(asString(value.evidenceSource, 'review.evidenceSource'))) {
    throw new Error('review.evidenceSource is invalid');
  }
  const findings = Array.isArray(value.findings) ? value.findings : null;
  if (!findings) {
    throw new Error('review.findings must be an array');
  }
  const normalizedFindings: AuthoringReviewFinding[] = findings.map((raw, index) => {
    const finding = raw as Record<string, unknown>;
    const severity = asString(finding.severity, `review.findings[${index}].severity`);
    if (!SEVERITIES.has(severity)) {
      throw new Error(`review.findings[${index}].severity is invalid`);
    }
    return {
      severity: severity as AuthoringReviewFinding['severity'],
      ...(typeof finding.path === 'string' ? { path: finding.path } : {}),
      problem: asString(finding.problem, `review.findings[${index}].problem`),
      ...(typeof finding.fix === 'string' ? { fix: finding.fix } : {}),
    };
  });
  return {
    passed: value.passed,
    evidenceSource: value.evidenceSource as AuthoringReview['evidenceSource'],
    ...(typeof value.voters === 'number' ? { voters: value.voters } : {}),
    ...(Array.isArray(value.lenses) ? { lenses: value.lenses as string[] } : {}),
    ...(typeof value.rounds === 'number' ? { rounds: value.rounds } : {}),
    findings: normalizedFindings,
    reviewedAt: asString(value.reviewedAt, 'review.reviewedAt'),
  };
}

export async function recordAuthoringLane(options: {
  projectRoot: string;
  name: string;
  lane: string;
  file: string;
}): Promise<BundleAuthoringState> {
  const lane = options.lane as AuthoringLaneId;
  if (!AUTHORING_LANE_IDS.includes(lane)) {
    throw new Error(`Unknown authoring lane: ${options.lane}`);
  }
  const raw = await fs.readFile(path.resolve(options.file), 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Authoring lane output is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Authoring lane output must be a JSON object');
  }
  const output = parsed as AuthoringLaneOutput;
  if (asString(output.lane, 'lane') !== options.lane) {
    throw new Error(`Authoring lane output lane mismatch: expected ${options.lane}`);
  }
  if (!LANE_STATUS_VALUES.has(asString(output.status, 'status'))) {
    throw new Error('Authoring lane output status is invalid');
  }
  if (output.status === 'BLOCKED' || output.status === 'NEEDS_CONTEXT') {
    throw new Error(
      `Authoring lane ${options.lane} returned ${output.status}; main session must add context, split, switch model, or ask the user before continuing`,
    );
  }

  const state = await reconcileBundleAuthoringState(options.projectRoot, options.name);
  if (!state.factory) {
    throw new Error(
      `Bundle ${options.name} has no Skill Creator metadata; run comet creator init first`,
    );
  }

  const factory = { ...state.factory };
  if (lane === 'skill-review') {
    factory.authoringReview = validateReview(output.review);
  } else {
    const artifacts = Array.isArray(output.artifacts) ? output.artifacts : [];
    const merged: Record<string, string> = { ...(factory.authoringContent ?? {}) };
    for (const artifact of artifacts) {
      const relativePath = artifact?.path;
      if (typeof relativePath !== 'string' || !isContentLeafPath(relativePath)) continue;
      if (typeof artifact.content === 'string' && artifact.content.length > 0) {
        merged[relativePath] = artifact.content;
      }
    }
    factory.authoringContent = merged;
  }

  const updated: BundleAuthoringState = { ...state, factory };
  await writeBundleAuthoringState(options.projectRoot, updated);
  return updated;
}
