import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import type { AgentExperienceEvent, AgentLearningDelta } from '../agent-learning/index.js';
import type { MemoryLanguage } from '../comet-memory/types.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { extractDeterministicProjectRecords } from './deterministic-extractors.js';
import { validateProjectKnowledgeRecordShape, type ProjectKnowledgeRecord } from './records.js';
import { projectKnowledgeSourceReferenceMatchesText } from './source-validity.js';
import type { ProjectKnowledgeProvider } from './types.js';
import { resolveStableProjectId } from '../../platform/paths/project-identity.js';

const MAX_CHANGED_PATHS = 24;
const MAX_ARTIFACT_REFS = 16;
const MAX_VERIFICATION_COMMANDS = 16;
const MAX_VERIFICATION_RESULTS = 16;
const MAX_SOURCE_BYTES = 48 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 256 * 1024;
const MAX_HINT_STRING = 512;
const MAX_REVIEW_ACTIONS = 16;
const MAX_SOURCE_VALIDATION_BYTES = 1024 * 1024;

export interface ProjectKnowledgeChangedHint {
  readonly eventName: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly operation?: string;
  readonly phase?: string;
  readonly changedPaths: readonly string[];
  readonly artifactRefs: readonly string[];
  readonly verificationCommands: readonly string[];
  readonly verificationResults: readonly ProjectKnowledgeVerificationResult[];
}

export interface ProjectKnowledgeVerificationResult {
  readonly command: string;
  readonly success: boolean;
}

export interface ProjectKnowledgeReviewSource {
  readonly source: string;
  readonly text: string;
  readonly size: number;
  readonly modifiedAt: number;
}

export interface ProjectKnowledgeReviewPacket {
  readonly eventName: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly operation?: string;
  readonly phase?: string;
  readonly summary?: string;
  readonly occurredAt: string;
  readonly changedHint: ProjectKnowledgeChangedHint;
  readonly sources: readonly ProjectKnowledgeReviewSource[];
}

export type ProjectKnowledgeReviewAction =
  | { readonly action: 'create' | 'update'; readonly record: unknown }
  | { readonly action: 'supersede'; readonly recordId: string };

export interface ProjectKnowledgeSemanticReviewer {
  review(
    packet: ProjectKnowledgeReviewPacket,
  ): readonly ProjectKnowledgeReviewAction[] | Promise<readonly ProjectKnowledgeReviewAction[]>;
}

export interface ProjectKnowledgeLearningOptions {
  readonly projectRoot: string;
  readonly provider: ProjectKnowledgeProvider;
  readonly language?: MemoryLanguage;
  readonly reviewer?: ProjectKnowledgeSemanticReviewer;
  readonly reportDiagnostic?: (diagnostic: ProjectKnowledgeLearningDiagnostic) => void;
}

export interface ProjectKnowledgeLearningDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly source?: string;
}

export interface ProjectKnowledgeLearningResult {
  readonly skipped: boolean;
  readonly persisted: readonly string[];
  readonly proven: readonly string[];
  readonly superseded: readonly string[];
  readonly changedHint?: ProjectKnowledgeChangedHint;
  readonly diagnostics: readonly ProjectKnowledgeLearningDiagnostic[];
}

export interface ProjectKnowledgeReflectionResult {
  readonly skipped: boolean;
  readonly deferred: boolean;
  readonly deltas: readonly AgentLearningDelta[];
  readonly changedHint?: ProjectKnowledgeChangedHint;
  readonly diagnostics: readonly ProjectKnowledgeLearningDiagnostic[];
}

export interface ProjectKnowledgeReviewPacketOptions {
  readonly projectRoot: string;
  readonly maxSourceBytes?: number;
  readonly maxTotalSourceBytes?: number;
}

function boundedString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_HINT_STRING) : fallback;
}

function boundedStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
    .map((entry) => boundedString(entry))
    .filter(Boolean)
    .slice(0, max);
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replaceAll('\\', '/');
  if (
    !normalized ||
    normalized.includes('\0') ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    normalized.split('/').some((part) => part === '..')
  ) {
    return null;
  }
  return normalized;
}

function artifactPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const paths = value
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      return (
        (entry as { path?: unknown; source?: unknown }).path ??
        (entry as { path?: unknown; source?: unknown }).source
      );
    })
    .map(safeRelativePath)
    .filter((entry): entry is string => entry !== null);
  return [...new Set(paths)].slice(0, MAX_ARTIFACT_REFS);
}

function verificationResults(value: unknown): ProjectKnowledgeVerificationResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
      const command = boundedString((entry as { command?: unknown }).command);
      const success = (entry as { success?: unknown }).success;
      if (!command || typeof success !== 'boolean') return null;
      return { command, success };
    })
    .filter((entry): entry is ProjectKnowledgeVerificationResult => entry !== null)
    .slice(0, MAX_VERIFICATION_RESULTS);
}

export function createProjectKnowledgeChangedHint(
  event: AgentExperienceEvent,
): ProjectKnowledgeChangedHint | null {
  const changedPaths = boundedStringList(event.context.paths, MAX_CHANGED_PATHS)
    .map(safeRelativePath)
    .filter((entry): entry is string => entry !== null);
  const artifactRefs = artifactPaths(
    event.evidence.filter((entry) => entry.source !== undefined).map((entry) => entry.source),
  );
  const verificationEvidence = event.evidence.filter(
    (entry) => entry.kind === 'verification' && entry.command !== undefined,
  );
  const verificationCommands = boundedStringList(
    verificationEvidence.map((entry) => entry.command),
    MAX_VERIFICATION_COMMANDS,
  );
  const results = verificationResults(
    verificationEvidence.map((entry) => ({ command: entry.command, success: entry.success })),
  );
  const structured =
    changedPaths.length > 0 ||
    artifactRefs.length > 0 ||
    verificationCommands.length > 0 ||
    results.length > 0;
  if (
    !structured &&
    !['review.resolved', 'failure.resolved', 'change.archived'].includes(event.type)
  ) {
    return null;
  }
  const workflow = boundedString(
    event.context.workflow,
    event.source.workflow ?? event.source.name,
  );
  const changeId = boundedString(event.context.changeId, event.source.changeId ?? event.episodeId);
  if (!workflow || !changeId) return null;
  return {
    eventName: event.type,
    workflow,
    changeId,
    success:
      event.outcome?.status !== 'contributed-to-failure' &&
      event.evidence.every((entry) => entry.success !== false),
    ...(boundedString(event.context.operation)
      ? { operation: boundedString(event.context.operation) }
      : {}),
    ...(boundedString(event.context.phase) ? { phase: boundedString(event.context.phase) } : {}),
    changedPaths,
    artifactRefs,
    verificationCommands,
    verificationResults: results,
  };
}

export async function createProjectKnowledgeReviewPacket(
  event: AgentExperienceEvent,
  options: ProjectKnowledgeReviewPacketOptions,
): Promise<ProjectKnowledgeReviewPacket | null> {
  if (
    ![
      'verification.completed',
      'review.resolved',
      'failure.resolved',
      'change.archived',
      'repository.changed',
    ].includes(event.type)
  ) {
    return null;
  }
  const changedHint = createProjectKnowledgeChangedHint(event);
  if (changedHint === null) return null;
  const sources = [...new Set([...changedHint.changedPaths, ...changedHint.artifactRefs])];
  const output: ProjectKnowledgeReviewSource[] = [];
  let total = 0;
  for (const source of sources.slice(0, MAX_CHANGED_PATHS)) {
    if (total >= (options.maxTotalSourceBytes ?? MAX_SOURCE_TOTAL_BYTES)) break;
    try {
      const inspected = await inspectProtectedProjectPath(options.projectRoot, source, {
        label: source,
        expected: 'file',
      });
      if (!inspected.exists) continue;
      const read = await readProtectedProjectFile(
        options.projectRoot,
        source,
        Math.min(
          options.maxSourceBytes ?? MAX_SOURCE_BYTES,
          (options.maxTotalSourceBytes ?? MAX_SOURCE_TOTAL_BYTES) - total,
        ),
        { label: source },
      );
      const text = read.bytes.toString('utf8');
      total += read.bytes.length;
      output.push({
        source,
        text,
        size: Number(read.stat.size),
        modifiedAt: Number(read.stat.mtimeMs),
      });
    } catch {
      // A single unreadable source does not stop the other sources from being reviewed.
    }
  }
  return {
    eventName: changedHint.eventName,
    workflow: changedHint.workflow,
    changeId: changedHint.changeId,
    success: changedHint.success,
    occurredAt: event.occurredAt,
    ...(changedHint.operation === undefined ? {} : { operation: changedHint.operation }),
    ...(changedHint.phase === undefined ? {} : { phase: changedHint.phase }),
    ...(boundedString(
      event.outcome?.summary,
      event.evidence.find((entry) => entry.summary.trim().length > 0)?.summary ?? '',
    )
      ? {
          summary: boundedString(
            event.outcome?.summary,
            event.evidence.find((entry) => entry.summary.trim().length > 0)?.summary ?? '',
          ),
        }
      : {}),
    changedHint,
    sources: output,
  };
}

function isVerified(packet: ProjectKnowledgeReviewPacket): boolean {
  if (!packet.success) return false;
  const results = packet.changedHint.verificationResults;
  if (results.length > 0) return results.every((entry) => entry.success === true);
  return ['review.resolved', 'failure.resolved', 'change.archived'].includes(packet.eventName);
}

function experiencePolicyRecord(
  packet: ProjectKnowledgeReviewPacket,
  projectRoot: string,
  language: MemoryLanguage,
): ProjectKnowledgeRecord | null {
  const type = {
    'review.resolved': 'decision',
    'failure.resolved': 'failure-resolution',
    'verification.completed': 'constraint',
    'change.archived': 'procedure',
  }[packet.eventName] as ProjectKnowledgeRecord['type'] | undefined;
  if (type === undefined) return null;
  const verification =
    type === 'constraint'
      ? packet.changedHint.verificationResults
          .filter((entry) => entry.success)
          .map((entry) => ({ command: entry.command, expected: 'pass' }))
      : [];
  if (type === 'constraint' && verification.length === 0) return null;
  const defaultSummary =
    type === 'constraint'
      ? language === 'en'
        ? `The project successfully ran: ${verification.map((entry) => entry.command).join(', ')}.`
        : `项目已成功运行验证命令：${verification.map((entry) => entry.command).join('、')}。`
      : type === 'failure-resolution'
        ? language === 'en'
          ? 'This failure was resolved; similar tasks should reuse the verified resolution.'
          : '本次失败已经解决，后续相似任务应复用已验证的处理方式。'
        : type === 'decision'
          ? language === 'en'
            ? 'This review decision was accepted and can guide similar project changes.'
            : '本次评审结论已通过，可作为后续相似变更的项目决策依据。'
          : language === 'en'
            ? 'This archived change provides a reusable completion and verification workflow.'
            : '本次变更已经归档，可复用其完成与验证流程。';
  const summary = packet.summary ?? defaultSummary;
  const sourceRefs = packet.sources.slice(0, 8).map((source) => ({ source: source.source }));
  const signature = createHash('sha256')
    .update(
      JSON.stringify({
        type,
        workflow: packet.workflow,
        summary,
        operation: packet.operation,
        verification,
        paths: packet.changedHint.changedPaths,
      }),
    )
    .digest('hex')
    .slice(0, 20);
  return validateProjectKnowledgeRecordShape({
    id: `learned-${type}-${signature}`,
    projectId: resolveStableProjectId(projectRoot),
    type,
    state: 'proven',
    authority: 'automatic',
    title:
      type === 'constraint'
        ? language === 'en'
          ? 'Verified project command'
          : '已验证的项目命令'
        : type === 'failure-resolution'
          ? language === 'en'
            ? 'Resolved failure experience'
            : '已解决的问题经验'
          : type === 'decision'
            ? language === 'en'
              ? 'Review-confirmed project decision'
              : '评审确认的项目决策'
            : language === 'en'
              ? 'Archived change workflow'
              : '已归档的变更流程',
    summary,
    applicablePaths: packet.changedHint.changedPaths,
    operations: packet.operation === undefined ? [] : [packet.operation],
    phases: packet.phase === undefined ? [] : [packet.phase],
    conclusions: sourceRefs.length === 0 ? [] : [{ text: summary, sources: sourceRefs }],
    relations: [],
    verification,
    sourceVersions: packet.sources.slice(0, 8).map((source) => ({
      source: source.source,
      size: source.size,
      modifiedAt: Math.trunc(source.modifiedAt),
    })),
    applicationCount: 0,
    successCount: 0,
    failureCount: 0,
    updatedAt: packet.occurredAt,
  });
}

async function reviewSourcesStillCurrent(
  packet: ProjectKnowledgeReviewPacket,
  projectRoot: string,
): Promise<string | null> {
  for (const source of packet.sources) {
    try {
      const inspected = await inspectProtectedProjectPath(projectRoot, source.source, {
        label: source.source,
        expected: 'file',
      });
      if (!inspected.exists) return source.source;
      const stat = await fs.stat(inspected.target);
      if (Number(stat.size) !== source.size || Number(stat.mtimeMs) !== source.modifiedAt) {
        return source.source;
      }
    } catch {
      return source.source;
    }
  }
  return null;
}

async function recordSourcesStillCurrent(
  record: ProjectKnowledgeRecord,
  projectRoot: string,
): Promise<string | null> {
  for (const version of record.sourceVersions) {
    try {
      const inspected = await inspectProtectedProjectPath(projectRoot, version.source, {
        label: version.source,
        expected: 'file',
      });
      if (!inspected.exists) return version.source;
      const stat = await fs.stat(inspected.target);
      if (
        Number(stat.size) !== version.size ||
        Math.trunc(Number(stat.mtimeMs)) !== version.modifiedAt
      ) {
        return version.source;
      }
    } catch {
      return version.source;
    }
  }
  const references = [
    ...record.conclusions.flatMap((conclusion) => conclusion.sources),
    ...record.relations.flatMap((relation) => relation.sources),
  ];
  const versionSources = new Set(record.sourceVersions.map((version) => version.source));
  const referencesBySource = new Map<string, typeof references>();
  for (const reference of references) {
    if (!versionSources.has(reference.source)) return reference.source;
    const current = referencesBySource.get(reference.source) ?? [];
    referencesBySource.set(reference.source, [...current, reference]);
  }
  for (const [source, sourceReferences] of referencesBySource) {
    try {
      const text = (
        await readProtectedProjectFile(projectRoot, source, MAX_SOURCE_VALIDATION_BYTES, {
          label: source,
        })
      ).bytes.toString('utf8');
      if (
        !sourceReferences.every((reference) =>
          projectKnowledgeSourceReferenceMatchesText(text, reference),
        )
      ) {
        return source;
      }
    } catch {
      return source;
    }
  }
  return null;
}

export class ProjectKnowledgeLearningService {
  private readonly projectRoot: string;
  private readonly provider: ProjectKnowledgeProvider;
  private readonly language: MemoryLanguage;
  private readonly reviewer?: ProjectKnowledgeSemanticReviewer;
  private readonly reportDiagnostic?: ProjectKnowledgeLearningOptions['reportDiagnostic'];

  public constructor(options: ProjectKnowledgeLearningOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.provider = options.provider;
    this.language = options.language ?? 'zh-CN';
    this.reviewer = options.reviewer;
    this.reportDiagnostic = options.reportDiagnostic;
  }

  public async bootstrapProjectModel(
    knowledgeSources: readonly string[] = [],
  ): Promise<ProjectKnowledgeLearningResult> {
    const diagnostics: ProjectKnowledgeLearningDiagnostic[] = [];
    const report = (diagnostic: ProjectKnowledgeLearningDiagnostic): void => {
      diagnostics.push(diagnostic);
      this.reportDiagnostic?.(diagnostic);
    };
    let candidates: readonly ProjectKnowledgeRecord[] = [];
    try {
      candidates = await extractDeterministicProjectRecords({
        projectRoot: this.projectRoot,
        knowledgeSources,
        language: this.language,
      });
    } catch {
      report({
        code: 'deterministic-extractor',
        message: '确定性项目知识提取暂不可用，已跳过本次写入。',
      });
    }
    const persisted: string[] = [];
    const proven: string[] = [];
    for (const candidate of candidates.slice(0, 16)) {
      try {
        const record = validateProjectKnowledgeRecordShape(candidate);
        const changedSource = await recordSourcesStillCurrent(record, this.projectRoot);
        if (changedSource !== null) {
          report({
            code: 'source-changed',
            message: '首次建模期间项目来源发生变化，已跳过本次记录。',
            source: changedSource,
          });
          continue;
        }
        const result = await this.provider.apply({ kind: 'upsert', record });
        for (const diagnostic of result.diagnostics) report(diagnostic);
        if (result.changed) persisted.push(record.id);
        if (
          result.changed &&
          (result.record?.state === 'proven' || result.record?.state === 'enforced')
        ) {
          proven.push(record.id);
        }
      } catch {
        report({ code: 'provider-write', message: '项目知识记录未能写入 Provider。' });
      }
    }
    return {
      skipped: candidates.length === 0,
      persisted,
      proven,
      superseded: [],
      diagnostics,
    };
  }

  public async reflectEvent(
    event: AgentExperienceEvent,
  ): Promise<ProjectKnowledgeReflectionResult> {
    const diagnostics: ProjectKnowledgeLearningDiagnostic[] = [];
    const report = (diagnostic: ProjectKnowledgeLearningDiagnostic): void => {
      diagnostics.push(diagnostic);
      this.reportDiagnostic?.(diagnostic);
    };
    const packet = await createProjectKnowledgeReviewPacket(event, {
      projectRoot: this.projectRoot,
    });
    if (packet === null || !isVerified(packet)) {
      return {
        skipped: true,
        deferred: false,
        deltas: [],
        ...(packet === null ? {} : { changedHint: packet.changedHint }),
        diagnostics,
      };
    }
    let reviewActions: readonly ProjectKnowledgeReviewAction[] = [];
    let deferred = false;
    if (this.reviewer !== undefined) {
      try {
        const reviewed = await this.reviewer.review(packet);
        reviewActions = Array.isArray(reviewed) ? reviewed.slice(0, MAX_REVIEW_ACTIONS) : [];
      } catch {
        deferred = true;
        report({
          code: 'reviewer-unavailable',
          message: '项目知识语义评审暂不可用，已继续确定性学习并延后语义策略。',
        });
      }
    }
    const changedSource = await reviewSourcesStillCurrent(packet, this.projectRoot);
    if (changedSource !== null) {
      report({
        code: 'source-changed',
        message: '语义评审期间项目来源发生变化，已跳过本次写入。',
        source: changedSource,
      });
      return {
        skipped: true,
        deferred,
        deltas: [],
        changedHint: packet.changedHint,
        diagnostics,
      };
    }
    const deltas: AgentLearningDelta[] = [];
    let candidates: readonly ProjectKnowledgeRecord[] = [];
    try {
      candidates = await extractDeterministicProjectRecords({
        projectRoot: this.projectRoot,
        changedPaths: packet.changedHint.changedPaths,
        language: this.language,
      });
    } catch {
      report({
        code: 'deterministic-extractor',
        message: '确定性项目知识提取暂不可用，已跳过本次写入。',
      });
    }
    const learnedPolicy = experiencePolicyRecord(packet, this.projectRoot, this.language);
    if (learnedPolicy !== null) candidates = [...candidates, learnedPolicy];
    for (const candidate of candidates.slice(0, 16)) {
      try {
        const record = validateProjectKnowledgeRecordShape({
          ...candidate,
        });
        const changedRecordSource = await recordSourcesStillCurrent(record, this.projectRoot);
        if (changedRecordSource !== null) {
          report({
            code: 'source-changed',
            message: '确定性记录校验期间项目来源发生变化，已跳过本次记录。',
            source: changedRecordSource,
          });
          continue;
        }
        deltas.push(projectRecordDelta(event, record));
      } catch {
        report({ code: 'record-invalid', message: '项目知识记录无效，已跳过该记录。' });
      }
    }
    for (const action of reviewActions) {
      try {
        if (action.action === 'supersede') {
          deltas.push({
            action: 'supersede',
            owner: 'comet.project-knowledge',
            targetId: action.recordId,
            memoryType: 'project-policy',
            kind: 'semantic-review',
            statement: 'semantic-review',
            applicability: {
              projectId: event.projectId ?? resolveStableProjectId(this.projectRoot),
            },
            evidence: event.evidence,
            authority: 'repository',
            recommendedState: 'superseded',
          });
          continue;
        }
        const record = validateProjectKnowledgeRecordShape({
          ...(action.record as Record<string, unknown>),
          state: 'trial',
          authority: 'automatic',
          applicationCount: 0,
          successCount: 0,
          failureCount: 0,
        });
        const changedRecordSource = await recordSourcesStillCurrent(record, this.projectRoot);
        if (changedRecordSource !== null) {
          report({
            code: 'source-changed',
            message: '语义记录校验期间项目来源发生变化，已跳过本次记录。',
            source: changedRecordSource,
          });
          continue;
        }
        deltas.push(projectRecordDelta(event, record));
      } catch {
        report({ code: 'review-action-invalid', message: '语义评审动作无效，已跳过该动作。' });
      }
    }
    if (
      packet.eventName === 'verification.completed' &&
      packet.changedHint.verificationResults.length > 0
    ) {
      try {
        const commands = packet.changedHint.verificationResults
          .filter((entry) => entry.success)
          .map((entry) => entry.command);
        deltas.push({
          action: 'update',
          owner: 'comet.project-knowledge',
          memoryType: 'project-policy',
          kind: 'verification-status',
          statement: commands.join('\n'),
          applicability: { projectId: resolveStableProjectId(this.projectRoot) },
          evidence: event.evidence,
          authority: 'repository',
          verification: commands.map((command) => ({ command, expected: 'pass' })),
          payload: {
            kind: 'verify',
            projectId: resolveStableProjectId(this.projectRoot),
            commands,
            updatedAt: packet.occurredAt,
          },
          recommendedState: 'enforced',
        });
      } catch {
        report({ code: 'verification-invalid', message: '项目知识验证状态无效，已跳过。' });
      }
    }
    return {
      skipped: false,
      deferred,
      deltas,
      changedHint: packet.changedHint,
      diagnostics,
    };
  }

  public async processEvent(event: AgentExperienceEvent): Promise<ProjectKnowledgeLearningResult> {
    const reflection = await this.reflectEvent(event);
    const diagnostics = [...reflection.diagnostics];
    const persisted: string[] = [];
    const proven: string[] = [];
    const superseded: string[] = [];
    for (const [index, delta] of reflection.deltas.entries()) {
      try {
        const result = await this.provider.apply({
          kind: 'experience-delta',
          delta,
          idempotencyKey: `direct:${event.eventId}:${index}`,
          updatedAt: event.occurredAt,
        });
        diagnostics.push(...result.diagnostics);
        if (!result.changed) continue;
        const ids = [
          ...(result.record ? [result.record.id] : []),
          ...(result.records ?? []).map((record) => record.id),
          ...(delta.targetId ? [delta.targetId] : []),
        ];
        for (const id of [...new Set(ids)]) {
          if (delta.action === 'supersede' || delta.action === 'forget') superseded.push(id);
          else persisted.push(id);
        }
        for (const record of [
          ...(result.record ? [result.record] : []),
          ...(result.records ?? []),
        ]) {
          if (record.state === 'proven' || record.state === 'enforced') proven.push(record.id);
        }
      } catch {
        diagnostics.push({ code: 'provider-write', message: '项目知识记录未能写入 Provider。' });
      }
    }
    return {
      skipped: reflection.skipped,
      persisted: [...new Set(persisted)],
      proven: [...new Set(proven)],
      superseded: [...new Set(superseded)],
      ...(reflection.changedHint === undefined ? {} : { changedHint: reflection.changedHint }),
      diagnostics,
    };
  }
}

function projectRecordDelta(
  event: AgentExperienceEvent,
  record: ProjectKnowledgeRecord,
): AgentLearningDelta {
  const projectModel = ['topology', 'fact', 'dependency'].includes(record.type);
  return {
    action: 'create',
    owner: 'comet.project-knowledge',
    targetId: record.id,
    memoryType: projectModel ? 'project-model' : 'project-policy',
    kind: record.type,
    title: record.title,
    statement: record.summary,
    applicability: {
      projectId: record.projectId,
      paths: record.applicablePaths,
      operations: record.operations,
      phases: record.phases,
    },
    evidence: event.evidence,
    authority: record.authority === 'user' ? 'user' : 'repository',
    verification: record.verification,
    payload: { kind: 'record', record },
    recommendedState: record.state,
  };
}

export async function projectKnowledgeLearningSourceExists(
  projectRoot: string,
  source: string,
): Promise<boolean> {
  try {
    return (await fs.stat(path.join(projectRoot, source))).isFile();
  } catch {
    return false;
  }
}
