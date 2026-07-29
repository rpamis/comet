export const COMET_INTENT_SCHEMA_VERSION = 'comet.intent.v1' as const;
export const COMET_INTENT_CONFIDENCE_THRESHOLD = 0.7;

const INTENT_NAMES = [
  'start_change',
  'resume_change',
  'fix_bug',
  'make_tweak',
  'ask_question',
  'unknown',
] as const;
const ENTITY_TYPES = [
  'change_id',
  'workflow',
  'file_path',
  'command',
  'capability',
  'bug_signal',
  'risk_signal',
] as const;
const REQUESTED_ACTIONS = [
  'start',
  'resume',
  'continue',
  'fix',
  'modify',
  'create',
  'verify',
  'archive',
  'question',
  'unknown',
] as const;
const WORKFLOWS = ['full', 'hotfix', 'tweak'] as const;
const WORKFLOW_INTENSITIES = ['light', 'standard', 'thorough'] as const;
const SCOPES = ['small', 'medium', 'large', 'unknown'] as const;
const ROUTES = ['full', 'hotfix', 'tweak', 'resume', 'ask_user', 'out_of_scope'] as const;
const NEXT_SKILLS = [
  'comet-open',
  'comet-hotfix',
  'comet-tweak',
  'comet-design',
  'comet-build',
  'comet-verify',
  'comet-archive',
] as const;
const EVIDENCE_SOURCES = ['user', 'repo', 'state'] as const;

type ValueOf<T extends readonly string[]> = T[number];

export type CometIntentName = ValueOf<typeof INTENT_NAMES>;
export type CometIntentEntityType = ValueOf<typeof ENTITY_TYPES>;
export type CometIntentRequestedAction = ValueOf<typeof REQUESTED_ACTIONS>;
export type CometIntentWorkflow = ValueOf<typeof WORKFLOWS>;
export type CometIntentWorkflowIntensity = ValueOf<typeof WORKFLOW_INTENSITIES>;
export type CometIntentScope = ValueOf<typeof SCOPES>;
export type CometIntentRouteName = ValueOf<typeof ROUTES>;
export type CometIntentNextSkill = ValueOf<typeof NEXT_SKILLS>;
export type CometIntentEvidenceSource = ValueOf<typeof EVIDENCE_SOURCES>;

export interface CometIntentFrame {
  schema_version: typeof COMET_INTENT_SCHEMA_VERSION;
  utterance: string;
  locale: string;
  intent: { name: CometIntentName; confidence: number };
  entities: Array<{ type: CometIntentEntityType; value: string; text: string }>;
  slots: {
    requested_action: CometIntentRequestedAction;
    workflow_candidate: CometIntentWorkflow | null;
    user_explicit_workflow: CometIntentWorkflow | null;
    change_id: string | null;
    target_area: string | null;
    scope: CometIntentScope;
    existing_behavior: boolean | null;
    new_capability: boolean | null;
    public_api_change: boolean | null;
    schema_change: boolean | null;
    cross_module_change: boolean | null;
  };
  context: {
    active_changes_count: number;
    active_change_names: string[];
    dirty_worktree: boolean | null;
    workflow_intensity: CometIntentWorkflowIntensity;
  };
  evidence: Array<{ field: string; quote: string; source: CometIntentEvidenceSource }>;
  proposed_route: CometIntentRoute;
}

export interface CometIntentNormalizedFrame extends CometIntentFrame {
  route: CometIntentRoute;
}

export interface CometIntentRoute {
  name: CometIntentRouteName;
  next_skill: CometIntentNextSkill | null;
  confidence: number;
  requires_confirmation: boolean;
  fallback_reason: string | null;
  recommendation: CometIntentRecommendation | null;
}

export interface CometIntentRecommendation {
  workflow: Exclude<CometIntentWorkflow, 'full'>;
  next_skill: Extract<CometIntentNextSkill, 'comet-hotfix' | 'comet-tweak'>;
  intensity: CometIntentWorkflowIntensity;
  reasons: string[];
  options: CometIntentWorkflow[];
}

export interface CometIntentRouteResolution {
  route: CometIntentRoute;
  diagnostics: string[];
  normalizedFrame: CometIntentNormalizedFrame;
}

export class CometIntentValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid CometIntentFrame:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  issues: string[],
): ValueOf<T> | null {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    issues.push(`${field} must be one of: ${allowed.join(', ')}`);
    return null;
  }
  return value as ValueOf<T>;
}

function optionalEnumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  field: string,
  issues: string[],
): ValueOf<T> | null {
  if (value === null || value === undefined) return null;
  return enumValue(value, allowed, field, issues);
}

function stringValue(value: unknown, field: string, issues: string[]): string {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${field} must be a non-empty string`);
    return '';
  }
  return value;
}

function optionalStringValue(value: unknown, field: string, issues: string[]): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${field} must be a non-empty string or null`);
    return null;
  }
  return value;
}

function optionalBooleanValue(value: unknown, field: string, issues: string[]): boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'boolean') {
    issues.push(`${field} must be boolean or null`);
    return null;
  }
  return value;
}

function confidenceValue(value: unknown, field: string, issues: string[]): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0 || value > 1) {
    issues.push(`${field} must be a number between 0 and 1`);
    return 0;
  }
  return value;
}

function nonNegativeIntegerValue(value: unknown, field: string, issues: string[]): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    issues.push(`${field} must be a non-negative integer`);
    return 0;
  }

  return value;
}

function validateFrame(input: unknown): CometIntentFrame {
  const issues: string[] = [];
  if (!isRecord(input)) throw new CometIntentValidationError(['frame must be an object']);

  const intent = isRecord(input.intent) ? input.intent : {};
  if (!isRecord(input.intent)) issues.push('intent must be an object');
  const slots = isRecord(input.slots) ? input.slots : {};
  if (!isRecord(input.slots)) issues.push('slots must be an object');
  const context = isRecord(input.context) ? input.context : {};
  if (!isRecord(input.context)) issues.push('context must be an object');
  const proposedRouteInput = isRecord(input.proposed_route) ? input.proposed_route : {};
  if (!isRecord(input.proposed_route)) issues.push('proposed_route must be an object');

  const entities =
    input.entities === undefined ? [] : Array.isArray(input.entities) ? input.entities : [];
  if (input.entities !== undefined && !Array.isArray(input.entities)) {
    issues.push('entities must be an array');
  }
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (!Array.isArray(input.evidence)) issues.push('evidence must be an array');

  const frame: CometIntentFrame = {
    schema_version: enumValue(
      input.schema_version,
      [COMET_INTENT_SCHEMA_VERSION] as const,
      'schema_version',
      issues,
    ) as typeof COMET_INTENT_SCHEMA_VERSION,
    utterance: stringValue(input.utterance, 'utterance', issues),
    locale: input.locale === undefined ? 'unknown' : stringValue(input.locale, 'locale', issues),
    intent: {
      name: enumValue(intent.name, INTENT_NAMES, 'intent.name', issues) ?? 'unknown',
      confidence: confidenceValue(intent.confidence, 'intent.confidence', issues),
    },
    entities: entities.map((entity, index) => {
      const record = isRecord(entity) ? entity : {};
      if (!isRecord(entity)) issues.push(`entities[${index}] must be an object`);
      return {
        type:
          enumValue(record.type, ENTITY_TYPES, `entities[${index}].type`, issues) ?? 'risk_signal',
        value: stringValue(record.value, `entities[${index}].value`, issues),
        text: stringValue(record.text, `entities[${index}].text`, issues),
      };
    }),
    slots: {
      requested_action:
        enumValue(slots.requested_action, REQUESTED_ACTIONS, 'slots.requested_action', issues) ??
        'unknown',
      workflow_candidate: optionalEnumValue(
        slots.workflow_candidate,
        WORKFLOWS,
        'slots.workflow_candidate',
        issues,
      ),
      user_explicit_workflow: optionalEnumValue(
        slots.user_explicit_workflow,
        WORKFLOWS,
        'slots.user_explicit_workflow',
        issues,
      ),
      change_id: optionalStringValue(slots.change_id, 'slots.change_id', issues),
      target_area: optionalStringValue(slots.target_area, 'slots.target_area', issues),
      scope:
        slots.scope === undefined
          ? 'unknown'
          : (enumValue(slots.scope, SCOPES, 'slots.scope', issues) ?? 'unknown'),
      existing_behavior: optionalBooleanValue(
        slots.existing_behavior,
        'slots.existing_behavior',
        issues,
      ),
      new_capability: optionalBooleanValue(slots.new_capability, 'slots.new_capability', issues),
      public_api_change: optionalBooleanValue(
        slots.public_api_change,
        'slots.public_api_change',
        issues,
      ),
      schema_change: optionalBooleanValue(slots.schema_change, 'slots.schema_change', issues),
      cross_module_change: optionalBooleanValue(
        slots.cross_module_change,
        'slots.cross_module_change',
        issues,
      ),
    },
    context: {
      active_changes_count: nonNegativeIntegerValue(
        context.active_changes_count,
        'context.active_changes_count',
        issues,
      ),
      active_change_names: isRecord(context)
        ? (() => {
            if (!Array.isArray(context.active_change_names)) {
              issues.push('context.active_change_names must be an array');
              return [];
            }

            if (!context.active_change_names.every((value) => typeof value === 'string')) {
              issues.push('context.active_change_names must only contain strings');
              return [];
            }

            return context.active_change_names;
          })()
        : [],
      dirty_worktree: optionalBooleanValue(
        context.dirty_worktree,
        'context.dirty_worktree',
        issues,
      ),
      workflow_intensity:
        context.workflow_intensity === undefined || context.workflow_intensity === null
          ? 'standard'
          : (enumValue(
              context.workflow_intensity,
              WORKFLOW_INTENSITIES,
              'context.workflow_intensity',
              issues,
            ) ?? 'standard'),
    },
    evidence: evidence.map((item, index) => {
      const record = isRecord(item) ? item : {};
      if (!isRecord(item)) issues.push(`evidence[${index}] must be an object`);
      return {
        field: stringValue(record.field, `evidence[${index}].field`, issues),
        quote: stringValue(record.quote, `evidence[${index}].quote`, issues),
        source:
          enumValue(record.source, EVIDENCE_SOURCES, `evidence[${index}].source`, issues) ?? 'user',
      };
    }),
    proposed_route: {
      name: enumValue(proposedRouteInput.name, ROUTES, 'proposed_route.name', issues) ?? 'ask_user',
      next_skill: optionalEnumValue(
        proposedRouteInput.next_skill,
        NEXT_SKILLS,
        'proposed_route.next_skill',
        issues,
      ),
      confidence: confidenceValue(
        proposedRouteInput.confidence,
        'proposed_route.confidence',
        issues,
      ),
      requires_confirmation:
        typeof proposedRouteInput.requires_confirmation === 'boolean'
          ? proposedRouteInput.requires_confirmation
          : true,
      fallback_reason: optionalStringValue(
        proposedRouteInput.fallback_reason,
        'proposed_route.fallback_reason',
        issues,
      ),
      recommendation: null,
    },
  };

  if (issues.length > 0) throw new CometIntentValidationError(issues);
  return frame;
}

function hasEvidence(frame: CometIntentFrame, field: string): boolean {
  return frame.evidence.some((item) => item.field === field && item.quote.trim() !== '');
}

function hasSmallScopeEvidence(frame: CometIntentFrame): boolean {
  if (frame.slots.scope === 'small') return true;

  return frame.evidence.some(
    (item) =>
      item.field === 'slots.scope' &&
      /\b(small|tiny|minor)\b|轻量|小型|较小|很小|微小|小改动|小修改/iu.test(item.quote),
  );
}

function hasRiskSignal(frame: CometIntentFrame): boolean {
  return (
    frame.slots.new_capability === true ||
    frame.slots.public_api_change === true ||
    frame.slots.schema_change === true ||
    frame.slots.cross_module_change === true
  );
}

function lowRiskEvidence(frame: CometIntentFrame): boolean {
  return (
    hasSmallScopeEvidence(frame) ||
    /docs?|prompt|wording|config|readme|small|tiny|minor/iu.test(frame.utterance)
  );
}

function recommendationFor(frame: CometIntentFrame): CometIntentRecommendation | null {
  if (hasRiskSignal(frame)) return null;
  const intensity = frame.context.workflow_intensity;
  const evidenceIsStrong = lowRiskEvidence(frame);
  if (intensity === 'thorough' && !evidenceIsStrong) return null;

  if (frame.intent.name === 'fix_bug' && frame.slots.existing_behavior === true) {
    return {
      workflow: 'hotfix',
      next_skill: 'comet-hotfix',
      intensity,
      reasons: ['existing behavior fix', `workflow_intensity=${intensity}`],
      options: ['hotfix', 'full'],
    };
  }

  if (
    (evidenceIsStrong || intensity === 'light') &&
    (frame.intent.name === 'start_change' ||
      frame.intent.name === 'make_tweak' ||
      frame.slots.requested_action === 'modify' ||
      frame.slots.requested_action === 'create')
  ) {
    return {
      workflow: 'tweak',
      next_skill: 'comet-tweak',
      intensity,
      reasons: [
        evidenceIsStrong ? 'small low-risk request' : 'low-risk request',
        `workflow_intensity=${intensity}`,
      ],
      options: ['tweak', 'full'],
    };
  }

  return null;
}

function route(
  name: CometIntentRouteName,
  confidence: number,
  fallback_reason: string | null = null,
  recommendation: CometIntentRecommendation | null = null,
): CometIntentRoute {
  const nextSkill: Record<CometIntentRouteName, CometIntentNextSkill | null> = {
    full: 'comet-open',
    hotfix: 'comet-hotfix',
    tweak: 'comet-tweak',
    resume: null,
    ask_user: null,
    out_of_scope: null,
  };
  return {
    name,
    next_skill: nextSkill[name],
    confidence,
    requires_confirmation:
      Boolean(recommendation) || name === 'ask_user' || name === 'out_of_scope',
    fallback_reason,
    recommendation,
  };
}

function askUser(reason: string): CometIntentRoute {
  return route('ask_user', 0.5, reason);
}

function workflowRoute(workflow: CometIntentWorkflow, confidence: number): CometIntentRoute {
  return route(workflow, confidence);
}

export function resolveCometIntentRoute(input: unknown): CometIntentRouteResolution {
  const frame = validateFrame(input);
  const diagnostics: string[] = [];
  const confidence = frame.intent.confidence;
  const recommendation = frame.slots.user_explicit_workflow ? null : recommendationFor(frame);

  let resolved: CometIntentRoute;
  if (frame.intent.confidence < COMET_INTENT_CONFIDENCE_THRESHOLD) {
    resolved = askUser(
      `intent confidence ${frame.intent.confidence} is below ${COMET_INTENT_CONFIDENCE_THRESHOLD}`,
    );
  } else if (
    (frame.intent.name === 'resume_change' ||
      frame.slots.requested_action === 'resume' ||
      frame.slots.requested_action === 'continue') &&
    !frame.slots.change_id &&
    frame.context.active_changes_count > 1
  ) {
    resolved = askUser('multiple active changes require an explicit change_id');
  } else if (
    (frame.intent.name === 'resume_change' ||
      frame.slots.requested_action === 'resume' ||
      frame.slots.requested_action === 'continue') &&
    frame.slots.change_id
  ) {
    resolved = frame.context.active_change_names.includes(frame.slots.change_id)
      ? route('resume', confidence)
      : askUser(`change_id '${frame.slots.change_id}' is not in active_change_names`);
  } else if (frame.intent.name === 'ask_question' || frame.slots.requested_action === 'question') {
    resolved = route(
      'out_of_scope',
      confidence,
      'user asked a question without requesting a Comet workflow',
    );
  } else if (
    frame.slots.user_explicit_workflow &&
    frame.slots.user_explicit_workflow !== 'full' &&
    hasRiskSignal(frame)
  ) {
    resolved = askUser(
      `explicit workflow '${frame.slots.user_explicit_workflow}' conflicts with risk signals`,
    );
  } else if (frame.slots.user_explicit_workflow) {
    resolved = workflowRoute(frame.slots.user_explicit_workflow, confidence);
  } else if (hasRiskSignal(frame)) {
    resolved = route('full', confidence);
  } else if (recommendation) {
    resolved = route('full', confidence, null, recommendation);
  } else if (
    frame.intent.name === 'fix_bug' &&
    frame.slots.existing_behavior === true &&
    hasEvidence(frame, 'slots.workflow_candidate')
  ) {
    resolved = route('hotfix', confidence);
  } else if (
    frame.intent.name === 'make_tweak' &&
    frame.slots.workflow_candidate === 'tweak' &&
    hasEvidence(frame, 'slots.workflow_candidate')
  ) {
    resolved = route('tweak', confidence);
  } else if (frame.slots.workflow_candidate && hasEvidence(frame, 'slots.workflow_candidate')) {
    resolved = workflowRoute(frame.slots.workflow_candidate, confidence);
  } else if (frame.slots.workflow_candidate === 'full') {
    resolved = route('full', confidence);
  } else {
    resolved = askUser('workflow_candidate evidence is missing or route is ambiguous');
  }

  if (resolved.name !== frame.proposed_route.name) {
    diagnostics.push(
      `agent proposed_route '${frame.proposed_route.name}' normalized to '${resolved.name}'`,
    );
  }
  if (resolved.next_skill !== frame.proposed_route.next_skill) {
    diagnostics.push(
      `agent proposed_route next_skill '${frame.proposed_route.next_skill}' normalized to '${resolved.next_skill}'`,
    );
  }
  if (resolved.requires_confirmation !== frame.proposed_route.requires_confirmation) {
    diagnostics.push(
      `agent proposed_route requires_confirmation '${frame.proposed_route.requires_confirmation}' normalized to '${resolved.requires_confirmation}'`,
    );
  }
  if (resolved.fallback_reason !== frame.proposed_route.fallback_reason) {
    diagnostics.push(
      `agent proposed_route fallback_reason '${frame.proposed_route.fallback_reason}' normalized to '${resolved.fallback_reason}'`,
    );
  }
  if (resolved.recommendation?.workflow !== frame.proposed_route.recommendation?.workflow) {
    diagnostics.push(
      `agent proposed_route recommendation '${frame.proposed_route.recommendation?.workflow ?? null}' normalized to '${resolved.recommendation?.workflow ?? null}'`,
    );
  }

  return {
    route: resolved,
    diagnostics,
    normalizedFrame: { ...frame, route: resolved },
  };
}
