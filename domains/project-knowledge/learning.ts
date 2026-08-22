import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { PluginEvent } from '../comet-plugin/index.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import {
  ProjectKnowledgeUnitRepository,
  validateProjectKnowledgeUnitShape,
  validateProjectKnowledgeUnitSources,
  type ProjectKnowledgeUnit,
} from './units.js';

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
  | { readonly action: 'create' | 'update'; readonly unit: unknown }
  | { readonly action: 'retire'; readonly unitId: string };

export interface ProjectKnowledgeSemanticReviewer {
  review(
    packet: ProjectKnowledgeReviewPacket,
  ): readonly ProjectKnowledgeReviewAction[] | Promise<readonly ProjectKnowledgeReviewAction[]>;
}

export interface ProjectKnowledgeLearningOptions {
  readonly projectRoot: string;
  readonly repository: ProjectKnowledgeUnitRepository;
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

function createChangedHint(event: PluginEvent): ProjectKnowledgeChangedHint | null {
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
  const changedHint = createChangedHint(event);
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

function validUnitId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{1,127}$/u.test(value);
}

export class ProjectKnowledgeLearningService {
  private readonly projectRoot: string;
  private readonly repository: ProjectKnowledgeUnitRepository;
  private readonly reviewer?: ProjectKnowledgeSemanticReviewer;
  private readonly reportDiagnostic?: ProjectKnowledgeLearningOptions['reportDiagnostic'];

  public constructor(options: ProjectKnowledgeLearningOptions) {
    this.projectRoot = path.resolve(options.projectRoot);
    this.repository = options.repository;
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
    if (packet === null || this.reviewer === undefined) {
      return {
        skipped: true,
        persisted: [],
        activated: [],
        retired: [],
        ...(packet === null ? {} : { changedHint: packet.changedHint }),
        diagnostics,
      };
    }
    let actions: readonly ProjectKnowledgeReviewAction[];
    try {
      actions = await this.reviewer.review(packet);
    } catch {
      report({ code: 'reviewer-unavailable', message: '项目知识语义评审暂不可用，已跳过。' });
      return {
        skipped: true,
        persisted: [],
        activated: [],
        retired: [],
        changedHint: packet.changedHint,
        diagnostics,
      };
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
    for (const action of actions.slice(0, 16)) {
      try {
        if (action.action === 'retire') {
          if (!validUnitId(action.unitId)) throw new Error('unit id is invalid');
          const current = await this.repository.read(action.unitId);
          if (current === null || current.origin !== 'generated')
            throw new Error('unit is not generated');
          await this.repository.writeGenerated({ ...current, state: 'retired' });
          retired.push(current.id);
          continue;
        }
        const unit = validateProjectKnowledgeUnitShape(action.unit);
        if (unit.origin !== 'generated')
          throw new Error('generated review must use generated origin');
        const sourceValidation = await validateProjectKnowledgeUnitSources(unit, {
          projectRoot: this.projectRoot,
        });
        if (!sourceValidation.valid) {
          report({
            code: 'source-invalid',
            message: '评审结论的来源无法通过当前项目校验。',
            source: unit.id,
          });
          continue;
        }
        const next: ProjectKnowledgeUnit = {
          ...unit,
          state: isVerified(packet) ? 'active' : 'draft',
          origin: 'generated',
        };
        await this.repository.writeGenerated(next);
        persisted.push(next.id);
        if (next.state === 'active') activated.push(next.id);
      } catch {
        report({ code: 'review-invalid', message: '项目知识语义评审输出未通过格式或来源校验。' });
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

export interface ProjectKnowledgeSharedPreference {
  readonly category: string;
  readonly text: string;
  readonly title?: string;
  readonly pathPatterns?: readonly string[];
  readonly operations?: readonly string[];
  readonly sources?: readonly { readonly source: string; readonly anchor?: string }[];
}

export function sanitizeProjectPreferenceForSharing(
  preference: ProjectKnowledgeSharedPreference,
): ProjectKnowledgeUnit {
  const stripPersonal = (value: string): string =>
    value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, '[email removed]')
      .replace(/\b(?:bearer|basic)\s+[A-Z0-9._~+/=-]+/giu, '[credential removed]')
      .replace(
        /\b(?:api[_ -]?key|token|secret|password|passwd|credential|authorization)\s*[:=]\s*[^\s,;]+/giu,
        '[credential removed]',
      )
      .replace(/(?:密钥|口令|密码|凭证|授权)\s*[:：=]\s*[^\s，；;]+/gu, '[凭证已移除]')
      .replace(/\b(?:I|me|my|mine|we|our|ours)\b/giu, '')
      .replace(/(?:我|我的|本人|我们|我们的)(?=偏好|习惯|项目|代码|要求)/gu, '')
      .replace(/(?:姓名|名字|用户名|作者)\s*[:：=]\s*[^\s，；;]+/gu, '[个人信息已移除]')
      .replace(/(?:允许|可以|授权|自动)\s*(?:提交|推送|发布|删除|覆盖|执行)/gu, '[授权表述已移除]')
      .replace(/\s{2,}/gu, ' ')
      .trim();
  const text = stripPersonal(preference.text);
  if (!text) throw new Error('个人项目偏好在去除个人信息后为空');
  return {
    schema: 'comet.project-knowledge.unit.v1',
    id: `shared-${Date.now().toString(36)}`,
    kind: 'behavior-note',
    state: 'draft',
    origin: 'maintained',
    title: stripPersonal(preference.title ?? preference.category),
    summary: text,
    applicablePaths: [...(preference.pathPatterns ?? [])].slice(0, 32),
    operations: [...(preference.operations ?? [])].slice(0, 32),
    conclusions: [
      {
        text,
        sources: (preference.sources ?? []).slice(0, 8),
      },
    ],
    relations: [],
    verification: [],
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
