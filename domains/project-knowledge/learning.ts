import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { PluginEvent } from '../comet-plugin/index.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { extractDeterministicProjectRecords } from './deterministic-extractors.js';
import { validateProjectKnowledgeRecordShape, type ProjectKnowledgeRecord } from './records.js';
import type { ProjectKnowledgeProvider } from './types.js';

const MAX_CHANGED_PATHS = 24;
const MAX_ARTIFACT_REFS = 16;
const MAX_VERIFICATION_COMMANDS = 16;
const MAX_VERIFICATION_RESULTS = 16;
const MAX_SOURCE_BYTES = 48 * 1024;
const MAX_SOURCE_TOTAL_BYTES = 256 * 1024;
const MAX_HINT_STRING = 512;

export interface ProjectKnowledgeChangedHint {
  readonly eventName: string;
  readonly workflow: string;
  readonly changeId: string;
  readonly success: boolean;
  readonly operation?: string;
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
  readonly changedHint: ProjectKnowledgeChangedHint;
  readonly sources: readonly ProjectKnowledgeReviewSource[];
}

export type ProjectKnowledgeReviewAction =
  | { readonly action: 'create' | 'update'; readonly record: unknown }
  | { readonly action: 'retire'; readonly recordId: string };

export interface ProjectKnowledgeSemanticReviewer {
  review(
    packet: ProjectKnowledgeReviewPacket,
  ): readonly ProjectKnowledgeReviewAction[] | Promise<readonly ProjectKnowledgeReviewAction[]>;
}

export interface ProjectKnowledgeLearningOptions {
  readonly projectRoot: string;
  readonly provider: ProjectKnowledgeProvider;
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
  readonly activated: readonly string[];
  readonly retired: readonly string[];
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

function eventPayload(event: PluginEvent): Readonly<Record<string, unknown>> {
  return event.payload ?? {};
}

function eventValue(event: PluginEvent, key: string): unknown {
  return eventPayload(event)[key];
}

export function createProjectKnowledgeChangedHint(
  event: PluginEvent,
): ProjectKnowledgeChangedHint | null {
  const changedPaths = boundedStringList(eventValue(event, 'changedPaths'), MAX_CHANGED_PATHS)
    .map(safeRelativePath)
    .filter((entry): entry is string => entry !== null);
  const artifactRefs = artifactPaths(eventValue(event, 'artifactRefs'));
  const verificationCommands = boundedStringList(
    eventValue(event, 'verificationCommands'),
    MAX_VERIFICATION_COMMANDS,
  );
  const results = verificationResults(eventValue(event, 'verificationResults'));
  const structured =
    changedPaths.length > 0 ||
    artifactRefs.length > 0 ||
    verificationCommands.length > 0 ||
    results.length > 0;
  if (event.name === 'task.completed' && !structured) return null;
  if (!structured) return null;
  const workflow = boundedString(eventValue(event, 'workflow'), event.source.name);
  const changeId = boundedString(eventValue(event, 'changeId'), event.source.change ?? '');
  if (!workflow || !changeId) return null;
  const success = eventValue(event, 'success');
  return {
    eventName: event.name,
    workflow,
    changeId,
    success: success === true,
    ...(boundedString(eventValue(event, 'operation'))
      ? { operation: boundedString(eventValue(event, 'operation')) }
      : {}),
    changedPaths,
    artifactRefs,
    verificationCommands,
    verificationResults: results,
  };
}

export async function createProjectKnowledgeReviewPacket(
  event: PluginEvent,
  options: ProjectKnowledgeReviewPacketOptions,
): Promise<ProjectKnowledgeReviewPacket | null> {
  if (!['verification.completed', 'change.completed', 'task.completed'].includes(event.name)) {
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
    ...(changedHint.operation === undefined ? {} : { operation: changedHint.operation }),
    changedHint,
    sources: output,
  };
}

function isVerified(packet: ProjectKnowledgeReviewPacket): boolean {
  if (!packet.success) return false;
  const results = packet.changedHint.verificationResults;
  return results.length > 0 && results.every((entry) => entry.success === true);
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
  return null;
}

export class ProjectKnowledgeLearningService {
  private readonly projectRoot: string;
  private readonly provider: ProjectKnowledgeProvider;
  private readonly reviewer?: ProjectKnowledgeSemanticReviewer;
  private readonly reportDiagnostic?: ProjectKnowledgeLearningOptions['reportDiagnostic'];

  public constructor(options: ProjectKnowledgeLearningOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.provider = options.provider;
    this.reviewer = options.reviewer;
    this.reportDiagnostic = options.reportDiagnostic;
  }

  public async processEvent(event: PluginEvent): Promise<ProjectKnowledgeLearningResult> {
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
        persisted: [],
        activated: [],
        retired: [],
        ...(packet === null ? {} : { changedHint: packet.changedHint }),
        diagnostics,
      };
    }
    if (this.reviewer !== undefined) {
      try {
        // Semantic review is optional enrichment. It is deliberately not used
        // as the source of truth and never gates deterministic learning.
        await this.reviewer.review(packet);
      } catch {
        report({
          code: 'reviewer-unavailable',
          message: '项目知识语义评审暂不可用，已继续确定性学习。',
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
        persisted: [],
        activated: [],
        retired: [],
        changedHint: packet.changedHint,
        diagnostics,
      };
    }
    const persisted: string[] = [];
    const activated: string[] = [];
    const retired: string[] = [];
    let candidates: readonly ProjectKnowledgeRecord[] = [];
    try {
      candidates = await extractDeterministicProjectRecords({
        projectRoot: this.projectRoot,
        changedPaths: packet.changedHint.changedPaths,
      });
    } catch {
      report({
        code: 'deterministic-extractor',
        message: '确定性项目知识提取暂不可用，已跳过本次写入。',
      });
    }
    for (const candidate of candidates.slice(0, 16)) {
      try {
        const record = validateProjectKnowledgeRecordShape({
          ...candidate,
          state: 'active',
          authority: 'automatic',
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
        const result = await this.provider.apply({ kind: 'upsert', record });
        for (const diagnostic of result.diagnostics) report(diagnostic);
        if (result.changed) persisted.push(record.id);
        if (result.record?.state === 'active' && result.changed) activated.push(record.id);
      } catch {
        report({ code: 'provider-write', message: '项目知识记录未能写入 Provider。' });
      }
    }
    return {
      skipped: false,
      persisted,
      activated,
      retired,
      changedHint: packet.changedHint,
      diagnostics,
    };
  }
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
