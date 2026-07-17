import { promises as fs } from 'fs';
import path from 'path';

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

const BRIEF_REQUIRED = ['Outcome', 'Scope', 'Non-goals', 'Acceptance examples'];
const BRIEF_ALL = [
  ...BRIEF_REQUIRED,
  'Constraints and invariants',
  'Decisions',
  'Open questions',
  'Verification expectations',
];
const VERIFICATION_ALL = [
  'Acceptance evidence',
  'Commands and results',
  'Skipped checks',
  'Spec consistency',
  'Known limitations and risks',
  'Conclusion',
];

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

export async function validateNativeBrief(
  changeDir: string,
  briefRef: string,
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
  const sections = markdownSections(source);
  for (const heading of BRIEF_ALL) {
    if (!sections.has(heading)) {
      findings.push({
        code: 'brief-section-missing',
        message: `Missing brief section: ${heading}`,
        path: briefRef,
      });
    }
  }
  for (const heading of BRIEF_REQUIRED) {
    if ((sections.get(heading) ?? '').length === 0) {
      findings.push({
        code: 'brief-section-empty',
        message: `Brief section is empty: ${heading}`,
        path: briefRef,
      });
    }
  }
  const openQuestions = sections.get('Open questions') ?? '';
  if (/^\s*-\s*\[blocking\]/imu.test(openQuestions)) {
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
  const sections = markdownSections(source);
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
