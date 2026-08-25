import { randomUUID } from 'node:crypto';
import path from 'node:path';

export type ProjectKnowledgeRecordType =
  | 'topology'
  | 'fact'
  | 'dependency'
  | 'decision'
  | 'pattern'
  | 'procedure'
  | 'constraint'
  | 'failure-resolution';
export type ProjectKnowledgeRecordFamily = 'project-model' | 'project-policy';
export type ProjectKnowledgeRecordState = 'trial' | 'proven' | 'enforced' | 'superseded';
export type ProjectKnowledgeRecordAuthority = 'automatic' | 'user' | 'repository';
export type ProjectKnowledgeRecordRelationType =
  | 'contains'
  | 'depends-on'
  | 'consumes'
  | 'registers'
  | 'propagates-to'
  | 'generated-by'
  | 'validated-by'
  | 'supersedes';

export interface ProjectKnowledgeRecordSource {
  readonly source: string;
  readonly anchor?: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
  readonly evidence?: string;
}

export interface ProjectKnowledgeRecordSourceVersion {
  readonly source: string;
  readonly size: number;
  readonly modifiedAt: number;
}

export interface ProjectKnowledgeRecordConclusion {
  readonly text: string;
  readonly sources: readonly ProjectKnowledgeRecordSource[];
}

export interface ProjectKnowledgeRecordRelation {
  readonly type: ProjectKnowledgeRecordRelationType;
  readonly targetId: string;
  readonly sources: readonly ProjectKnowledgeRecordSource[];
}

export interface ProjectKnowledgeRecordVerification {
  readonly command: string;
  readonly expected?: string;
}

export interface ProjectKnowledgeRecord {
  readonly id: string;
  readonly projectId: string;
  readonly type: ProjectKnowledgeRecordType;
  readonly state: ProjectKnowledgeRecordState;
  readonly authority: ProjectKnowledgeRecordAuthority;
  readonly title: string;
  readonly summary: string;
  readonly applicablePaths: readonly string[];
  readonly operations: readonly string[];
  readonly phases?: readonly string[];
  readonly conclusions: readonly ProjectKnowledgeRecordConclusion[];
  readonly relations: readonly ProjectKnowledgeRecordRelation[];
  readonly verification: readonly ProjectKnowledgeRecordVerification[];
  readonly sourceVersions: readonly ProjectKnowledgeRecordSourceVersion[];
  readonly applicationCount: number;
  readonly successCount: number;
  readonly failureCount: number;
  readonly lastAppliedAt?: string;
  readonly updatedAt: string;
}

export interface ProjectKnowledgeUserRecordInput {
  readonly type: ProjectKnowledgeRecordType;
  readonly title: string;
  readonly summary: string;
  readonly applicablePaths?: readonly string[];
  readonly operations?: readonly string[];
  readonly phases?: readonly string[];
  readonly sources?: readonly ProjectKnowledgeRecordSource[];
  readonly verification?: readonly ProjectKnowledgeRecordVerification[];
}

const RECORD_ID = /^[a-z0-9][a-z0-9._-]{1,127}$/u;
const MAX_STRING = 2000;
const MAX_PATH_LENGTH = 1024;
const MAX_PATHS = 32;
const MAX_OPERATIONS = 32;
const MAX_CONCLUSIONS = 32;
const MAX_RELATIONS = 16;
const MAX_VERIFICATIONS = 16;
const MAX_SOURCES_PER_ENTRY = 32;
const MAX_TOTAL_REFERENCES = 128;
const MAX_SOURCE_VERSIONS = 32;

const RECORD_TYPES = new Set<ProjectKnowledgeRecordType>([
  'topology',
  'fact',
  'dependency',
  'decision',
  'pattern',
  'procedure',
  'constraint',
  'failure-resolution',
]);
const RECORD_STATES = new Set<ProjectKnowledgeRecordState>([
  'trial',
  'proven',
  'enforced',
  'superseded',
]);
const RECORD_AUTHORITIES = new Set<ProjectKnowledgeRecordAuthority>([
  'automatic',
  'user',
  'repository',
]);
const RELATION_TYPES = new Set<ProjectKnowledgeRecordRelationType>([
  'contains',
  'depends-on',
  'consumes',
  'registers',
  'propagates-to',
  'generated-by',
  'validated-by',
  'supersedes',
]);

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, label: string, max = MAX_STRING): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function stableId(value: unknown, label: string): string {
  const id = boundedString(value, label, 128);
  if (!RECORD_ID.test(id)) {
    throw new Error(`${label} must use a stable record id`);
  }
  return id;
}

function boundedList<T>(
  value: unknown,
  label: string,
  max: number,
  parse: (entry: unknown, index: number) => T,
): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) {
    throw new Error(`${label} must be a bounded list`);
  }
  return value.map((entry, index) => parse(entry, index));
}

function requiredBoundedList<T>(
  value: unknown,
  label: string,
  max: number,
  parse: (entry: unknown, index: number) => T,
): T[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max) {
    throw new Error(`${label} must be a non-empty bounded list`);
  }
  return value.map((entry, index) => parse(entry, index));
}

function safeProjectPath(value: unknown, label: string): string {
  const source = boundedString(value, label, MAX_PATH_LENGTH).replaceAll('\\', '/');
  if (
    path.posix.isAbsolute(source) ||
    path.win32.isAbsolute(source) ||
    source.includes('\0') ||
    source.split('/').some((segment) => segment === '..')
  ) {
    throw new Error(`${label} must be a project-relative path`);
  }
  return source;
}

function pathList(value: unknown, label: string, max = MAX_PATHS): string[] {
  return boundedList(value, label, max, (entry, index) =>
    safeProjectPath(entry, `${label}[${index}]`),
  );
}

function stringList(value: unknown, label: string, max = MAX_OPERATIONS): string[] {
  return boundedList(value, label, max, (entry, index) =>
    boundedString(entry, `${label}[${index}]`, 512),
  );
}

function optionalBoundedString(
  value: unknown,
  label: string,
  max = MAX_STRING,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedString(value, label, max);
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return Number(value);
}

function parseSource(value: unknown, label: string): ProjectKnowledgeRecordSource {
  const record = objectRecord(value, label);
  const lineStart = record.lineStart;
  const lineEnd = record.lineEnd;
  const parsedLineStart =
    lineStart === undefined ? undefined : positiveInteger(lineStart, `${label}.lineStart`);
  const parsedLineEnd =
    lineEnd === undefined ? undefined : positiveInteger(lineEnd, `${label}.lineEnd`);
  if (
    parsedLineStart !== undefined &&
    parsedLineEnd !== undefined &&
    parsedLineEnd < parsedLineStart
  ) {
    throw new Error(`${label}.lineEnd must be greater than or equal to lineStart`);
  }
  const anchor = optionalBoundedString(record.anchor, `${label}.anchor`, 256);
  const evidence = optionalBoundedString(record.evidence, `${label}.evidence`, 1024);
  return {
    source: safeProjectPath(record.source, `${label}.source`),
    ...(anchor === undefined ? {} : { anchor }),
    ...(parsedLineStart === undefined ? {} : { lineStart: parsedLineStart }),
    ...(parsedLineEnd === undefined ? {} : { lineEnd: parsedLineEnd }),
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function parseConclusion(value: unknown, index: number): ProjectKnowledgeRecordConclusion {
  const record = objectRecord(value, `conclusions[${index}]`);
  return {
    text: boundedString(record.text, `conclusions[${index}].text`),
    sources: requiredBoundedList(
      record.sources,
      `conclusions[${index}].sources`,
      MAX_SOURCES_PER_ENTRY,
      (entry, sourceIndex) => parseSource(entry, `conclusions[${index}].sources[${sourceIndex}]`),
    ),
  };
}

function parseRelation(value: unknown, index: number): ProjectKnowledgeRecordRelation {
  const record = objectRecord(value, `relations[${index}]`);
  const type = boundedString(
    record.type,
    `relations[${index}].type`,
    64,
  ) as ProjectKnowledgeRecordRelationType;
  if (!RELATION_TYPES.has(type)) {
    throw new Error(`relations[${index}].type is unsupported`);
  }
  return {
    type,
    targetId: stableId(record.targetId, `relations[${index}].targetId`),
    sources: requiredBoundedList(
      record.sources,
      `relations[${index}].sources`,
      MAX_SOURCES_PER_ENTRY,
      (entry, sourceIndex) => parseSource(entry, `relations[${index}].sources[${sourceIndex}]`),
    ),
  };
}

function parseVerification(value: unknown, index: number): ProjectKnowledgeRecordVerification {
  const record = objectRecord(value, `verification[${index}]`);
  const expected = optionalBoundedString(record.expected, `verification[${index}].expected`);
  return {
    command: boundedString(record.command, `verification[${index}].command`),
    ...(expected === undefined ? {} : { expected }),
  };
}

function parseSourceVersion(value: unknown, index: number): ProjectKnowledgeRecordSourceVersion {
  const record = objectRecord(value, `sourceVersions[${index}]`);
  return {
    source: safeProjectPath(record.source, `sourceVersions[${index}].source`),
    size: nonNegativeInteger(record.size, `sourceVersions[${index}].size`),
    modifiedAt: nonNegativeInteger(record.modifiedAt, `sourceVersions[${index}].modifiedAt`),
  };
}

function totalReferenceCount(
  conclusions: readonly ProjectKnowledgeRecordConclusion[],
  relations: readonly ProjectKnowledgeRecordRelation[],
): number {
  return (
    conclusions.reduce((total, entry) => total + entry.sources.length, 0) +
    relations.reduce((total, entry) => total + entry.sources.length, 0)
  );
}

function parseUpdatedAt(value: unknown): string {
  const updatedAt = boundedString(value, 'updatedAt', 64);
  if (Number.isNaN(Date.parse(updatedAt))) {
    throw new Error('updatedAt must be an ISO-8601 timestamp');
  }
  return updatedAt;
}

export function validateProjectKnowledgeRecordShape(value: unknown): ProjectKnowledgeRecord {
  const record = objectRecord(value, 'record');
  const type = boundedString(record.type, 'type', 64) as ProjectKnowledgeRecordType;
  if (!RECORD_TYPES.has(type)) {
    throw new Error('type is unsupported');
  }
  const state = boundedString(record.state, 'state', 32) as ProjectKnowledgeRecordState;
  if (!RECORD_STATES.has(state)) {
    throw new Error('state is unsupported');
  }
  const authority = boundedString(
    record.authority,
    'authority',
    32,
  ) as ProjectKnowledgeRecordAuthority;
  if (!RECORD_AUTHORITIES.has(authority)) {
    throw new Error('authority is unsupported');
  }
  const conclusions = boundedList(
    record.conclusions,
    'conclusions',
    MAX_CONCLUSIONS,
    parseConclusion,
  );
  const relations = boundedList(record.relations, 'relations', MAX_RELATIONS, parseRelation);
  if (totalReferenceCount(conclusions, relations) > MAX_TOTAL_REFERENCES) {
    throw new Error('conclusions/relations sources exceed the bounded total reference count');
  }
  const sourceVersions = boundedList(
    record.sourceVersions,
    'sourceVersions',
    MAX_SOURCE_VERSIONS,
    parseSourceVersion,
  );
  return {
    id: stableId(record.id, 'id'),
    projectId: stableId(record.projectId, 'projectId'),
    type,
    state,
    authority,
    title: boundedString(record.title, 'title'),
    summary: boundedString(record.summary, 'summary'),
    applicablePaths: pathList(record.applicablePaths, 'applicablePaths'),
    operations: stringList(record.operations, 'operations'),
    phases: stringList(record.phases, 'phases'),
    conclusions,
    relations,
    verification: boundedList(
      record.verification,
      'verification',
      MAX_VERIFICATIONS,
      parseVerification,
    ),
    sourceVersions,
    applicationCount: nonNegativeInteger(record.applicationCount, 'applicationCount'),
    successCount: nonNegativeInteger(record.successCount, 'successCount'),
    failureCount: nonNegativeInteger(record.failureCount, 'failureCount'),
    ...(record.lastAppliedAt === undefined
      ? {}
      : { lastAppliedAt: parseUpdatedAt(record.lastAppliedAt) }),
    updatedAt: parseUpdatedAt(record.updatedAt),
  };
}

export function parseProjectKnowledgeRecord(value: unknown): ProjectKnowledgeRecord {
  return validateProjectKnowledgeRecordShape(value);
}

export function createUserProjectKnowledgeRecord(
  input: ProjectKnowledgeUserRecordInput,
  projectId: string,
  updatedAt = new Date().toISOString(),
  id = `manual-${randomUUID()}`,
): ProjectKnowledgeRecord {
  const sources = input.sources ?? [];
  return validateProjectKnowledgeRecordShape({
    id,
    projectId,
    type: input.type,
    state: 'proven',
    authority: 'user',
    title: input.title,
    summary: input.summary,
    applicablePaths: input.applicablePaths ?? [],
    operations: input.operations ?? [],
    phases: input.phases ?? [],
    conclusions: sources.length > 0 ? [{ text: input.summary, sources }] : [],
    relations: [],
    verification: input.verification ?? [],
    sourceVersions: [],
    applicationCount: 0,
    successCount: 0,
    failureCount: 0,
    updatedAt,
  });
}

export function mergeProjectKnowledgeRecord(
  current: ProjectKnowledgeRecord,
  incoming: ProjectKnowledgeRecord,
): ProjectKnowledgeRecord {
  const validatedCurrent = validateProjectKnowledgeRecordShape(current);
  const validatedIncoming = validateProjectKnowledgeRecordShape(incoming);
  if (validatedCurrent.id !== validatedIncoming.id) {
    throw new Error('cannot merge records with different ids');
  }
  if (validatedCurrent.projectId !== validatedIncoming.projectId) {
    throw new Error('cannot merge records with different project ids');
  }
  if (validatedCurrent.type !== validatedIncoming.type) {
    throw new Error('cannot merge records with different types');
  }
  if (validatedCurrent.state === 'superseded' && validatedIncoming.authority !== 'user') {
    return validatedIncoming;
  }
  if (validatedCurrent.authority === 'user' && validatedIncoming.authority !== 'user') {
    return validateProjectKnowledgeRecordShape({
      ...validatedIncoming,
      authority: 'user',
      state: validatedCurrent.state,
      title: validatedCurrent.title,
      summary: validatedCurrent.summary,
      applicablePaths: validatedCurrent.applicablePaths,
      operations: validatedCurrent.operations,
      phases: validatedCurrent.phases ?? [],
      conclusions: validatedCurrent.conclusions,
      relations: validatedCurrent.relations,
      verification: validatedCurrent.verification,
      applicationCount: validatedCurrent.applicationCount,
      successCount: validatedCurrent.successCount,
      failureCount: validatedCurrent.failureCount,
      ...(validatedCurrent.lastAppliedAt === undefined
        ? {}
        : { lastAppliedAt: validatedCurrent.lastAppliedAt }),
    });
  }
  return validatedIncoming;
}

export function projectKnowledgeRecordFamily(
  type: ProjectKnowledgeRecordType,
): ProjectKnowledgeRecordFamily {
  return type === 'topology' || type === 'fact' || type === 'dependency'
    ? 'project-model'
    : 'project-policy';
}
