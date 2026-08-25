export const AGENT_EXPERIENCE_SCHEMA = 'comet.agent-experience.v1' as const;

export type AgentExperienceEventType =
  | 'user.signal'
  | 'episode.completed'
  | 'verification.completed'
  | 'review.resolved'
  | 'failure.resolved'
  | 'change.archived'
  | 'repository.changed'
  | 'context.applied'
  | 'context.outcome';

export type AgentExperienceActor = 'user' | 'agent' | 'tool' | 'workflow' | 'repository';
export type AgentExperienceScope = 'user' | 'project';
export type AgentLearningState = 'trial' | 'proven' | 'enforced' | 'superseded';
export type AgentLearningOwner = 'personal-memory' | 'project-knowledge' | string;
export type AgentMemoryType =
  | 'core-profile'
  | 'collaboration-policy'
  | 'personal-episode'
  | 'project-model'
  | 'project-policy';

export interface AgentExperienceSource {
  readonly kind: 'user' | 'workflow' | 'tool' | 'repository' | 'system';
  readonly name: string;
  readonly workflow?: string;
  readonly changeId?: string;
  readonly command?: string;
}

export interface AgentExperienceContext {
  readonly task?: string;
  readonly workflow?: string;
  readonly changeId?: string;
  readonly phase?: string;
  readonly paths?: readonly string[];
  readonly operation?: string;
}

export interface AgentExperienceSignal {
  readonly kind: 'preference' | 'correction' | 'acceptance' | 'rejection' | 'remember' | 'forget';
  readonly explicit: boolean;
  readonly longTerm: boolean;
  readonly text: string;
  readonly category?: string;
  readonly targetId?: string;
  readonly selectors?: AgentContextSelectors;
}

export interface AgentExperienceEvidence {
  readonly id: string;
  readonly kind: 'user' | 'source' | 'verification' | 'review' | 'failure' | 'outcome';
  readonly summary: string;
  readonly source?: string;
  readonly anchor?: string;
  readonly digest?: string;
  readonly command?: string;
  readonly success?: boolean;
}

export type AgentContextOutcomeStatus =
  | 'used-successfully'
  | 'ignored'
  | 'overridden'
  | 'corrected'
  | 'contributed-to-failure';

export interface AgentExperienceOutcome {
  readonly status: AgentContextOutcomeStatus;
  readonly previousStatus?: AgentContextOutcomeStatus;
  readonly revision?: number;
  readonly summary?: string;
  readonly applicationId?: string;
  readonly unitIds?: readonly string[];
}

export interface AgentExperienceEvent {
  readonly schema: typeof AGENT_EXPERIENCE_SCHEMA;
  readonly eventId: string;
  readonly episodeId: string;
  readonly occurredAt: string;
  readonly type: AgentExperienceEventType;
  readonly actor: AgentExperienceActor;
  readonly scope: AgentExperienceScope;
  readonly projectId?: string;
  readonly source: AgentExperienceSource;
  readonly context: AgentExperienceContext;
  readonly signal?: AgentExperienceSignal;
  readonly evidence: readonly AgentExperienceEvidence[];
  readonly outcome?: AgentExperienceOutcome;
  readonly causedByEventId?: string;
  readonly supersedesEventId?: string;
}

export interface AgentContextSelectors {
  readonly projectId?: string;
  readonly paths?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
  readonly tasks?: readonly string[];
}

export interface AgentContextSourceRef {
  readonly type: 'user' | 'repository' | 'workflow' | 'review' | 'verification' | 'inference';
  readonly source?: string;
  readonly anchor?: string;
  readonly digest?: string;
}

export interface AgentContextVerification {
  readonly command: string;
  readonly expected?: string;
}

export interface AgentContextCandidate {
  readonly id: string;
  readonly owner: AgentLearningOwner;
  readonly scope: AgentExperienceScope;
  readonly memoryType: AgentMemoryType;
  readonly kind: string;
  readonly state: AgentLearningState;
  readonly authority: 'explicit' | 'inferred' | 'repository' | 'user';
  readonly title: string;
  readonly summary: string;
  readonly content?: string;
  readonly selectors: AgentContextSelectors;
  readonly sources: readonly AgentContextSourceRef[];
  readonly verification: readonly AgentContextVerification[];
  readonly priority?: number;
  readonly matchReasons?: readonly string[];
  readonly digest?: string;
  readonly application?: AgentContextApplicationStats;
}

export interface AgentContextApplicationStats {
  readonly applied: number;
  readonly successful: number;
  readonly ignored: number;
  readonly negative: number;
  readonly lastOutcome?: AgentContextOutcomeStatus;
  readonly lastAppliedAt?: string;
}

/** A normalized Reflection result before a domain Provider consolidates it. */
export interface AgentLearningDelta {
  readonly action: 'create' | 'update' | 'supersede' | 'forget' | 'noop';
  readonly owner: AgentLearningOwner;
  readonly targetId?: string;
  readonly memoryType: AgentMemoryType;
  readonly kind: string;
  readonly title?: string;
  readonly statement: string;
  readonly applicability: AgentContextSelectors;
  readonly evidence: readonly AgentExperienceEvidence[];
  readonly authority?: AgentContextCandidate['authority'];
  readonly verification?: readonly AgentContextVerification[];
  readonly feedback?: {
    readonly applicationId: string;
    readonly status: AgentContextOutcomeStatus;
    readonly previousStatus?: AgentContextOutcomeStatus;
    readonly revision: number;
  };
  /** Domain-normalized payload retained across the Provider seam. */
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly recommendedState: AgentLearningState;
}

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const EVENT_TYPES = new Set<AgentExperienceEventType>([
  'user.signal',
  'episode.completed',
  'verification.completed',
  'review.resolved',
  'failure.resolved',
  'change.archived',
  'repository.changed',
  'context.applied',
  'context.outcome',
]);
const ACTORS = new Set<AgentExperienceActor>(['user', 'agent', 'tool', 'workflow', 'repository']);
const STATES = new Set<AgentLearningState>(['trial', 'proven', 'enforced', 'superseded']);
const MEMORY_TYPES = new Set<AgentMemoryType>([
  'core-profile',
  'collaboration-policy',
  'personal-episode',
  'project-model',
  'project-policy',
]);

export function validateAgentExperienceEvent(value: unknown): AgentExperienceEvent {
  const event = objectValue(value, 'Agent Experience event');
  if (event.schema !== AGENT_EXPERIENCE_SCHEMA) {
    throw new Error(`Unsupported Agent Experience schema: ${String(event.schema)}`);
  }
  const eventId = identifier(event.eventId, 'eventId');
  const episodeId = identifier(event.episodeId, 'episodeId');
  const occurredAt = timestamp(event.occurredAt, 'occurredAt');
  if (!EVENT_TYPES.has(event.type as AgentExperienceEventType)) {
    throw new Error(`Unsupported Agent Experience event type: ${String(event.type)}`);
  }
  if (!ACTORS.has(event.actor as AgentExperienceActor)) {
    throw new Error(`Unsupported Agent Experience actor: ${String(event.actor)}`);
  }
  if (event.scope !== 'user' && event.scope !== 'project') {
    throw new Error('Agent Experience scope must be user or project');
  }
  const projectId = optionalIdentifier(event.projectId, 'projectId');
  if (event.scope === 'project' && projectId === undefined) {
    throw new Error('Project Agent Experience requires projectId');
  }
  const source = parseSource(event.source);
  const context = parseContext(event.context);
  const signal = event.signal === undefined ? undefined : parseSignal(event.signal);
  const evidence = arrayValue(event.evidence, 'evidence').map(parseEvidence);
  const outcome = event.outcome === undefined ? undefined : parseOutcome(event.outcome);
  return {
    schema: AGENT_EXPERIENCE_SCHEMA,
    eventId,
    episodeId,
    occurredAt,
    type: event.type as AgentExperienceEventType,
    actor: event.actor as AgentExperienceActor,
    scope: event.scope,
    ...(projectId === undefined ? {} : { projectId }),
    source,
    context,
    ...(signal === undefined ? {} : { signal }),
    evidence,
    ...(outcome === undefined ? {} : { outcome }),
    ...(event.causedByEventId === undefined
      ? {}
      : { causedByEventId: identifier(event.causedByEventId, 'causedByEventId') }),
    ...(event.supersedesEventId === undefined
      ? {}
      : { supersedesEventId: identifier(event.supersedesEventId, 'supersedesEventId') }),
  };
}

export function validateAgentContextCandidate(value: unknown): AgentContextCandidate {
  const candidate = objectValue(value, 'Context Candidate');
  const state = candidate.state as AgentLearningState;
  const memoryType = candidate.memoryType as AgentMemoryType;
  if (!STATES.has(state)) throw new Error('Context Candidate state is unsupported');
  if (!MEMORY_TYPES.has(memoryType)) throw new Error('Context Candidate memoryType is unsupported');
  const authority = candidate.authority;
  const scope = candidate.scope;
  if (scope !== 'user' && scope !== 'project') {
    throw new Error('Context Candidate scope must be user or project');
  }
  if (
    authority !== 'explicit' &&
    authority !== 'inferred' &&
    authority !== 'repository' &&
    authority !== 'user'
  ) {
    throw new Error('Context Candidate authority is unsupported');
  }
  return {
    id: identifier(candidate.id, 'candidate.id'),
    owner: text(candidate.owner, 'candidate.owner', 256),
    scope,
    memoryType,
    kind: text(candidate.kind, 'candidate.kind', 128),
    state,
    authority,
    title: text(candidate.title, 'candidate.title', 512),
    summary: text(candidate.summary, 'candidate.summary', 4000),
    ...(candidate.content === undefined
      ? {}
      : { content: text(candidate.content, 'candidate.content', Number.MAX_SAFE_INTEGER) }),
    selectors: parseSelectors(candidate.selectors),
    sources: arrayValue(candidate.sources, 'candidate.sources').map((entry, index) => {
      const source = objectValue(entry, `candidate.sources[${index}]`);
      const type = source.type;
      if (
        !['user', 'repository', 'workflow', 'review', 'verification', 'inference'].includes(
          String(type),
        )
      ) {
        throw new Error(`candidate.sources[${index}].type is unsupported`);
      }
      return {
        type: type as AgentContextSourceRef['type'],
        ...(source.source === undefined ? {} : { source: text(source.source, 'source', 2048) }),
        ...(source.anchor === undefined ? {} : { anchor: text(source.anchor, 'anchor', 512) }),
        ...(source.digest === undefined ? {} : { digest: text(source.digest, 'digest', 256) }),
      };
    }),
    verification: arrayValue(candidate.verification, 'candidate.verification').map(
      (entry, index) => {
        const verification = objectValue(entry, `candidate.verification[${index}]`);
        return {
          command: text(verification.command, 'verification.command', 4000),
          ...(verification.expected === undefined
            ? {}
            : { expected: text(verification.expected, 'verification.expected', 2000) }),
        };
      },
    ),
    ...(typeof candidate.priority === 'number' && Number.isFinite(candidate.priority)
      ? { priority: candidate.priority }
      : {}),
    ...(candidate.matchReasons === undefined
      ? {}
      : { matchReasons: stringArray(candidate.matchReasons, 'candidate.matchReasons') }),
    ...(candidate.digest === undefined ? {} : { digest: text(candidate.digest, 'digest', 256) }),
    ...(candidate.application === undefined
      ? {}
      : { application: parseApplicationStats(candidate.application) }),
  };
}

function parseSource(value: unknown): AgentExperienceSource {
  const source = objectValue(value, 'source');
  if (!['user', 'workflow', 'tool', 'repository', 'system'].includes(String(source.kind))) {
    throw new Error('Agent Experience source kind is unsupported');
  }
  return {
    kind: source.kind as AgentExperienceSource['kind'],
    name: text(source.name, 'source.name', 256),
    ...(source.workflow === undefined ? {} : { workflow: text(source.workflow, 'workflow', 128) }),
    ...(source.changeId === undefined ? {} : { changeId: text(source.changeId, 'changeId', 256) }),
    ...(source.command === undefined ? {} : { command: text(source.command, 'command', 2000) }),
  };
}

function parseContext(value: unknown): AgentExperienceContext {
  const context = objectValue(value ?? {}, 'context');
  return {
    ...(context.task === undefined ? {} : { task: text(context.task, 'context.task', 8000) }),
    ...(context.workflow === undefined
      ? {}
      : { workflow: text(context.workflow, 'context.workflow', 128) }),
    ...(context.changeId === undefined
      ? {}
      : { changeId: text(context.changeId, 'context.changeId', 256) }),
    ...(context.phase === undefined ? {} : { phase: text(context.phase, 'context.phase', 128) }),
    ...(context.paths === undefined ? {} : { paths: stringArray(context.paths, 'context.paths') }),
    ...(context.operation === undefined
      ? {}
      : { operation: text(context.operation, 'context.operation', 256) }),
  };
}

function parseSignal(value: unknown): AgentExperienceSignal {
  const signal = objectValue(value, 'signal');
  const kind = signal.kind;
  if (
    !['preference', 'correction', 'acceptance', 'rejection', 'remember', 'forget'].includes(
      String(kind),
    )
  ) {
    throw new Error('Agent Experience signal kind is unsupported');
  }
  if (typeof signal.explicit !== 'boolean' || typeof signal.longTerm !== 'boolean') {
    throw new Error('Agent Experience signal explicit and longTerm must be booleans');
  }
  return {
    kind: kind as AgentExperienceSignal['kind'],
    explicit: signal.explicit,
    longTerm: signal.longTerm,
    text: text(signal.text, 'signal.text', Number.MAX_SAFE_INTEGER),
    ...(signal.category === undefined ? {} : { category: text(signal.category, 'category', 512) }),
    ...(signal.targetId === undefined
      ? {}
      : { targetId: identifier(signal.targetId, 'signal.targetId') }),
    ...(signal.selectors === undefined ? {} : { selectors: parseSelectors(signal.selectors) }),
  };
}

function parseEvidence(value: unknown, index: number): AgentExperienceEvidence {
  const evidence = objectValue(value, `evidence[${index}]`);
  if (
    !['user', 'source', 'verification', 'review', 'failure', 'outcome'].includes(
      String(evidence.kind),
    )
  ) {
    throw new Error(`evidence[${index}].kind is unsupported`);
  }
  return {
    id: identifier(evidence.id, `evidence[${index}].id`),
    kind: evidence.kind as AgentExperienceEvidence['kind'],
    summary: text(evidence.summary, `evidence[${index}].summary`, Number.MAX_SAFE_INTEGER),
    ...(evidence.source === undefined
      ? {}
      : { source: text(evidence.source, `evidence[${index}].source`, 2048) }),
    ...(evidence.anchor === undefined
      ? {}
      : { anchor: text(evidence.anchor, `evidence[${index}].anchor`, 512) }),
    ...(evidence.digest === undefined
      ? {}
      : { digest: text(evidence.digest, `evidence[${index}].digest`, 256) }),
    ...(evidence.command === undefined
      ? {}
      : { command: text(evidence.command, `evidence[${index}].command`, 4000) }),
    ...(typeof evidence.success === 'boolean' ? { success: evidence.success } : {}),
  };
}

function parseOutcome(value: unknown): AgentExperienceOutcome {
  const outcome = objectValue(value, 'outcome');
  if (
    !['used-successfully', 'ignored', 'overridden', 'corrected', 'contributed-to-failure'].includes(
      String(outcome.status),
    )
  ) {
    throw new Error('Agent Experience outcome status is unsupported');
  }
  return {
    status: outcome.status as AgentContextOutcomeStatus,
    ...(outcome.previousStatus === undefined
      ? {}
      : {
          previousStatus: contextOutcomeStatus(outcome.previousStatus, 'outcome.previousStatus'),
        }),
    ...(outcome.revision === undefined
      ? {}
      : { revision: positiveInteger(outcome.revision, 'outcome.revision') }),
    ...(outcome.summary === undefined ? {} : { summary: text(outcome.summary, 'summary', 4000) }),
    ...(outcome.applicationId === undefined
      ? {}
      : { applicationId: identifier(outcome.applicationId, 'applicationId') }),
    ...(outcome.unitIds === undefined ? {} : { unitIds: stringArray(outcome.unitIds, 'unitIds') }),
  };
}

function contextOutcomeStatus(value: unknown, field: string): AgentContextOutcomeStatus {
  if (
    !['used-successfully', 'ignored', 'overridden', 'corrected', 'contributed-to-failure'].includes(
      String(value),
    )
  ) {
    throw new Error(`${field} is unsupported`);
  }
  return value as AgentContextOutcomeStatus;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return Number(value);
}

function parseSelectors(value: unknown): AgentContextSelectors {
  const selectors = objectValue(value ?? {}, 'selectors');
  return {
    ...(selectors.projectId === undefined
      ? {}
      : { projectId: identifier(selectors.projectId, 'selectors.projectId') }),
    ...(selectors.paths === undefined ? {} : { paths: stringArray(selectors.paths, 'paths') }),
    ...(selectors.operations === undefined
      ? {}
      : { operations: stringArray(selectors.operations, 'operations') }),
    ...(selectors.phases === undefined ? {} : { phases: stringArray(selectors.phases, 'phases') }),
    ...(selectors.tasks === undefined ? {} : { tasks: stringArray(selectors.tasks, 'tasks') }),
  };
}

function parseApplicationStats(value: unknown): AgentContextApplicationStats {
  const stats = objectValue(value, 'application');
  const result: AgentContextApplicationStats = {
    applied: nonNegativeInteger(stats.applied, 'application.applied'),
    successful: nonNegativeInteger(stats.successful, 'application.successful'),
    ignored: nonNegativeInteger(stats.ignored, 'application.ignored'),
    negative: nonNegativeInteger(stats.negative, 'application.negative'),
    ...(stats.lastAppliedAt === undefined
      ? {}
      : { lastAppliedAt: timestamp(stats.lastAppliedAt, 'application.lastAppliedAt') }),
  };
  return stats.lastOutcome === undefined
    ? result
    : { ...result, lastOutcome: parseOutcome({ status: stats.lastOutcome }).status };
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label, 256);
  if (!IDENTIFIER.test(result)) throw new Error(`${label} must be a stable identifier`);
  return result;
}

function optionalIdentifier(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : identifier(value, label);
}

function timestamp(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (Number.isNaN(Date.parse(result))) throw new Error(`${label} must be an ISO timestamp`);
  return result;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return [...new Set(value.map((entry, index) => text(entry, `${label}[${index}]`, 4000)))];
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(value);
}
