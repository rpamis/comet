import { promises as fs } from 'fs';
import path from 'path';

import {
  DEFAULT_NATIVE_ARTIFACT_MAX_BYTES,
  readNativeBoundedTextFile,
} from './native-bounded-file.js';
import { nativeChangeDir } from './native-change.js';
import { sha256File } from './native-hash.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import type {
  NativeArtifactValidation,
  NativeChangeState,
  NativeFinding,
  NativeProjectPaths,
} from './native-types.js';

export interface NativeBriefValidationOptions {
  /** Apply the full completeness rule used at new/reconfirmed Shape boundaries. */
  strict?: boolean;
  /** Require the four core sections; validate optional sections when present. */
  compact?: boolean;
  /** Require the directory structure section under Scope (document constraints v3). */
  structure?: boolean;
  /** Portable Shape validates its actual complete document without a size budget. */
  maxBytes?: number | null;
}

export class NativeDocumentConstraintError extends Error {
  constructor(
    message: string,
    readonly findings: readonly NativeFinding[],
    readonly change: string,
  ) {
    super(message);
    this.name = 'NativeDocumentConstraintError';
  }
}

export const NATIVE_ARTIFACT_VALIDATION_LIMITS = {
  maxFileBytes: DEFAULT_NATIVE_ARTIFACT_MAX_BYTES,
} as const;

async function readContainedFile(root: string, relativeRef: string): Promise<string> {
  const target = path.resolve(root, ...relativeRef.split(/[\\/]/u));
  if (!isInsidePath(root, target))
    throw new Error(`Artifact escapes Native change: ${relativeRef}`);
  const realRoot = await fs.realpath(root);
  const realTarget = await fs.realpath(target);
  if (!isInsidePath(realRoot, realTarget)) {
    throw new Error(`Artifact symlink escapes Native change: ${relativeRef}`);
  }
  if (!(await fs.stat(realTarget)).isFile())
    throw new Error(`Artifact is not a file: ${relativeRef}`);
  return realTarget;
}

function result(findings: NativeFinding[]): NativeArtifactValidation {
  return { valid: findings.length === 0, findings };
}

export function stripMarkdownHtmlComments(source: string): string {
  const visible: string[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<!--', cursor);
    if (start < 0) {
      visible.push(source.slice(cursor));
      break;
    }
    visible.push(source.slice(cursor, start));
    const end = source.indexOf('-->', start + 4);
    if (end < 0) {
      // Preserve malformed comments so validation can still inspect their text.
      visible.push(source.slice(start));
      break;
    }
    cursor = end + 3;
  }
  return visible.join('');
}

export function validateNativeSpecDocumentText(
  source: string,
  documentRef: string,
): NativeArtifactValidation {
  return result(
    source.trim()
      ? []
      : [
          {
            code: 'spec-document-empty',
            message: 'Native target Spec is empty: ' + documentRef,
            path: documentRef,
          },
        ],
  );
}

export function nativeBriefHasBlockingQuestion(source: string): boolean {
  const mappingKeys = new Set([
    'blocker',
    'blocking',
    'coverage',
    'decision',
    'open_question',
    'question',
    'requirement',
    'requirements',
    'source',
    'source_coverage',
    'state',
    'status',
    '决策',
    '来源',
    '覆盖',
    '问题',
    '状态',
    '需求',
    '阻塞',
  ]);
  const fence: MarkdownFenceState = { marker: null, length: 0 };
  for (const line of source.split(/\r?\n/u)) {
    if (markdownFenceTransition(line, fence) !== null) continue;
    if (fence.marker !== null) continue;

    const value = line.trim();
    if (/^(?:[-*+]\s+|\d+[.)]\s+)(?:\[[ xX]\]\s+)?\[blocking\](?=$|[\s:：—-])/iu.test(value)) {
      return true;
    }
    if (
      value.includes('|') &&
      value.split('|').some((cell) => /^\s*\[blocking\](?=$|[\s:：—-])/iu.test(cell))
    ) {
      return true;
    }
    const mapping = value.match(/^([\p{L}\p{N}_./-]+)\s*[:：]\s*\[blocking\](?=$|[\s:：—-])/iu);
    if (mapping) {
      const key = mapping[1]?.toLocaleLowerCase('en-US') ?? '';
      if (mappingKeys.has(key) || /[./_-]/u.test(key)) return true;
    }
  }
  return false;
}

interface MarkdownFenceState {
  marker: '`' | '~' | null;
  length: number;
}

/**
 * CommonMark fence pairing: a fence closes only when it repeats the opening
 * marker character with at least the opening length and nothing else on the line,
 * so a stray tilde line cannot close a backtick block and vice versa.
 */
function markdownFenceTransition(
  line: string,
  state: MarkdownFenceState,
): 'opened' | 'closed' | null {
  const match = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
  if (match === null) return null;
  const fence = match[1] ?? '';
  const marker = fence[0] as '`' | '~';
  if (state.marker === null) {
    state.marker = marker;
    state.length = fence.length;
    return 'opened';
  }
  if (marker === state.marker && fence.length >= state.length && line.trim() === fence) {
    state.marker = null;
    state.length = 0;
    return 'closed';
  }
  return null;
}

/** 文档语义由 Agent 核对；这里仅检查实际输入及明确的未决标记。 */
export async function validateNativeBrief(
  changeDir: string,
  briefRef: string,
  options: NativeBriefValidationOptions = {},
): Promise<NativeArtifactValidation> {
  let source: string;
  try {
    source = (
      await readNativeBoundedTextFile({
        root: changeDir,
        ref: briefRef,
        maxBytes: options.maxBytes ?? null,
        includeHash: false,
      })
    ).text;
  } catch (error) {
    return result([{ code: 'brief-missing', message: (error as Error).message, path: briefRef }]);
  }
  const findings: NativeFinding[] = [];
  if (!source.trim())
    findings.push({
      code: 'brief-empty',
      message: 'Native brief is empty: ' + briefRef,
      path: briefRef,
    });
  if (nativeBriefHasBlockingQuestion(source))
    findings.push({
      code: 'brief-blocking-question',
      message: 'Brief has a blocking open question',
      path: briefRef,
    });
  return result(findings);
}

export async function validateNativeVerification(
  changeDir: string,
  reportRef: string,
): Promise<NativeArtifactValidation> {
  try {
    const source = (
      await readNativeBoundedTextFile({
        root: changeDir,
        ref: reportRef,
        maxBytes: null,
        includeHash: false,
      })
    ).text;
    return result(
      source.trim()
        ? []
        : [
            {
              code: 'verification-empty',
              message: 'Native verification report is empty: ' + reportRef,
              path: reportRef,
            },
          ],
    );
  } catch (error) {
    return result([
      { code: 'verification-missing', message: (error as Error).message, path: reportRef },
    ]);
  }
}

export function canonicalSpecPath(paths: NativeProjectPaths, capability: string): string {
  return path.join(paths.specsDir, capability, 'spec.md');
}

export async function validateNativeSpecChanges(
  paths: NativeProjectPaths,
  state: NativeChangeState,
): Promise<NativeArtifactValidation> {
  const findings: NativeFinding[] = [];
  const changeDir = nativeChangeDir(paths, state.name);
  for (const change of state.spec_changes) {
    const canonical = canonicalSpecPath(paths, change.capability);
    let canonicalHash: string | null = null;
    try {
      await resolveContainedNativePath(paths.nativeRoot, canonical);
      canonicalHash = await sha256File(canonical);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        findings.push({
          code: 'spec-canonical-unsafe',
          message: (error as Error).message,
          path: canonical,
        });
        continue;
      }
    }
    if (change.operation === 'create' && canonicalHash !== null) {
      findings.push({
        code: 'spec-create-exists',
        message: `Canonical spec already exists: ${change.capability}`,
        path: canonical,
      });
    }
    if (change.operation !== 'create' && canonicalHash === null) {
      findings.push({
        code: 'spec-base-missing',
        message: `Canonical spec is missing: ${change.capability}`,
        path: canonical,
      });
    }
    if (
      change.operation !== 'create' &&
      canonicalHash !== null &&
      canonicalHash !== change.base_hash
    ) {
      findings.push({
        code: 'spec-base-conflict',
        message: `Canonical spec changed for ${change.capability}: expected ${change.base_hash}, actual ${canonicalHash}`,
        path: canonical,
      });
    }
    if (change.source) {
      try {
        await readContainedFile(changeDir, change.source);
      } catch (error) {
        findings.push({
          code: 'spec-source-invalid',
          message: (error as Error).message,
          path: change.source,
        });
      }
    }
  }
  return result(findings);
}

export async function resolveNativeArtifactFile(
  changeDir: string,
  relativeRef: string,
): Promise<string> {
  return readContainedFile(changeDir, relativeRef);
}
