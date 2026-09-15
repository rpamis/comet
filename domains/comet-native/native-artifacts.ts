import { promises as fs } from 'fs';
import path from 'path';

import { nativeHeadingKey, nativeVerificationHeadingKey } from './native-artifact-language.js';
import { nativeChangeDir } from './native-change.js';
import {
  DEFAULT_NATIVE_ARTIFACT_MAX_BYTES,
  readNativeBoundedTextFile,
} from './native-bounded-file.js';
import { sha256File } from './native-hash.js';
import { isInsidePath, resolveContainedNativePath } from './native-paths.js';
import type {
  NativeArtifactValidation,
  NativeChangeState,
  NativeFinding,
  NativeProjectPaths,
} from './native-types.js';

const BRIEF_REQUIRED = ['outcome', 'scope', 'nonGoals', 'acceptanceExamples'];
const BRIEF_ALL = [
  ...BRIEF_REQUIRED,
  'constraints',
  'decisions',
  'openQuestions',
  'verificationExpectations',
];
const VERIFICATION_ALL = [
  'acceptanceEvidence',
  'commandsAndResults',
  'skippedChecks',
  'specConsistency',
  'knownLimitationsAndRisks',
  'conclusion',
];

const BRIEF_NONE_ALLOWED = new Set(['nonGoals', 'decisions', 'openQuestions']);

export interface NativeBriefValidationOptions {
  /** Apply the full completeness rule used at new/reconfirmed Shape boundaries. */
  strict?: boolean;
}

export const NATIVE_ARTIFACT_VALIDATION_LIMITS = {
  maxFileBytes: DEFAULT_NATIVE_ARTIFACT_MAX_BYTES,
} as const;

function markdownSections(source: string): Map<string, string> {
  const sections = new Map<string, string>();
  let heading: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (heading !== null) sections.set(heading, body.join('\n').trim());
  };
  for (const line of source.split(/\r?\n/u)) {
    const match = /^# ([^#].*)$/u.exec(line);
    if (match) {
      flush();
      heading = match[1].trim();
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

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

function meaningfulMarkdown(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/gu, '').trim();
}

function markdownBody(source: string): string {
  const lines = meaningfulMarkdown(source).split(/\r?\n/u);
  const body: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^\s*#{1,6}\s*$/u.test(line)) continue;
    if (!inFence && /^\s*#{1,6}\s+/u.test(line)) continue;
    if (!inFence && /^\s*(?:[-*+]\s*|\d+[.)]\s*)$/u.test(line)) continue;
    body.push(line);
  }
  return body.join('\n').trim();
}

function isExplicitNone(source: string): boolean {
  const normalized = markdownBody(source)
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gmu, '')
    .replace(/[*_`>#\x5b\x5d()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
  return /^(?:none|n\/a|not applicable|no(?:ne)?(?:\s+at\s+this\s+time)?|no\s+(?:additional\s+)?(?:non-goals?|decisions?|open\s+questions?|questions?)|无|无相关事项|没有(?:额外)?(?:非目标|决定|待解决问题)|不适用|暂无)[.!。；;：:，,、 -]*$/iu.test(
    normalized,
  );
}

function isTemplateOnly(source: string): boolean {
  const normalized = markdownBody(source)
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (normalized.length === 0) return false;
  const placeholderCandidate = normalized
    .replace(/[*_`]/gu, '')
    .replace(/^\s*>+\s?/gmu, '')
    .replace(/\s+/gu, ' ')
    .trim();
  if (/^(?:<[^>\r\n]+>|\{\{[^}\r\n]+\}\})[.!。；;：:，,、 -]*$/iu.test(placeholderCandidate))
    return true;
  const decorated = normalized
    .replace(/[*_`>#\x5b\x5d()]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return /^(?:(?:todo|tbd|fixme)(?:\s*[:：-]\s*.+)?|fill(?:\s+this\s+in)?(?:\s*[:：-]\s*.+)?|placeholder(?:\s*[:：-]\s*.+)?|待填写\S*|待补充\S*|<[^>]+>|\{\{[^}]+\}\})[.!。；;：:，,、 -]*$/iu.test(
    decorated,
  );
}

export function validateNativeSpecDocumentText(
  source: string,
  documentRef: string,
): NativeArtifactValidation {
  const findings: NativeFinding[] = [];
  const body = markdownBody(source);
  if (body.length === 0) {
    findings.push({
      code: 'spec-document-empty',
      message: `Native target Spec is empty: ${documentRef}. Add the complete target requirements or use an explicit no-product-behavior exemption in brief.md.`,
      path: documentRef,
    });
  } else if (isTemplateOnly(source)) {
    findings.push({
      code: 'spec-document-placeholder',
      message: `Native target Spec contains only template placeholder content: ${documentRef}. Replace it with complete target requirements.`,
      path: documentRef,
    });
  }
  return result(findings);
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
  let fence: '`' | '~' | null = null;
  for (const line of source.split(/\r?\n/u)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.[0] as '`' | '~';
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

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

export async function validateNativeBrief(
  changeDir: string,
  briefRef: string,
  options: NativeBriefValidationOptions = {},
): Promise<NativeArtifactValidation> {
  const findings: NativeFinding[] = [];
  let source: string;
  try {
    source = (
      await readNativeBoundedTextFile({
        root: changeDir,
        ref: briefRef,
        maxBytes: NATIVE_ARTIFACT_VALIDATION_LIMITS.maxFileBytes,
      })
    ).text;
  } catch (error) {
    return result([{ code: 'brief-missing', message: (error as Error).message, path: briefRef }]);
  }
  const sections = new Map<string, string>();
  for (const [heading, body] of markdownSections(source)) {
    sections.set(nativeHeadingKey(heading) ?? heading, body);
  }
  for (const heading of BRIEF_ALL) {
    if (!sections.has(heading)) {
      findings.push({
        code: 'brief-section-missing',
        message: `Missing brief section: ${heading}`,
        path: briefRef,
      });
    }
  }
  const nonEmptySections = options.strict ? BRIEF_ALL : BRIEF_REQUIRED;
  for (const heading of nonEmptySections) {
    const section = sections.get(heading) ?? '';
    if (markdownBody(section).length === 0) {
      findings.push({
        code: 'brief-section-empty',
        message: `Brief section is empty: ${heading}`,
        path: briefRef,
      });
    } else if (isTemplateOnly(section)) {
      findings.push({
        code: 'brief-section-placeholder',
        message: `Brief section contains only template placeholder content: ${heading}`,
        path: briefRef,
      });
    } else if (options.strict && !BRIEF_NONE_ALLOWED.has(heading) && isExplicitNone(section)) {
      findings.push({
        code: 'brief-section-empty',
        message: `Brief section must describe the confirmed work instead of declaring no items: ${heading}`,
        path: briefRef,
      });
    }
  }
  if (nativeBriefHasBlockingQuestion(source)) {
    findings.push({
      code: 'brief-blocking-question',
      message: 'Brief has a blocking open question',
      path: briefRef,
    });
  }
  return result(findings);
}

export async function validateNativeVerification(
  changeDir: string,
  reportRef: string,
): Promise<NativeArtifactValidation> {
  const findings: NativeFinding[] = [];
  let source: string;
  try {
    source = (
      await readNativeBoundedTextFile({
        root: changeDir,
        ref: reportRef,
        maxBytes: NATIVE_ARTIFACT_VALIDATION_LIMITS.maxFileBytes,
      })
    ).text;
  } catch (error) {
    return result([
      { code: 'verification-missing', message: (error as Error).message, path: reportRef },
    ]);
  }
  const sections = new Map<string, string>();
  for (const [heading, body] of markdownSections(source)) {
    sections.set(nativeVerificationHeadingKey(heading) ?? heading, body);
  }
  for (const heading of VERIFICATION_ALL) {
    if (!sections.has(heading)) {
      findings.push({
        code: 'verification-section-missing',
        message: `Missing verification section: ${heading}`,
        path: reportRef,
      });
    } else if ((sections.get(heading) ?? '').length === 0) {
      findings.push({
        code: 'verification-section-empty',
        message: `Verification section is empty: ${heading}`,
        path: reportRef,
      });
    }
  }
  return result(findings);
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
