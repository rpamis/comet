import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNativeChange } from '../../../domains/comet-native/native-change.js';
import {
  structureNativeFindings,
  summarizeNativeFindings,
} from '../../../domains/comet-native/native-findings.js';
import { nativeProjectPaths } from '../../../domains/comet-native/native-paths.js';
import type {
  NativeChangeState,
  NativeProjectPaths,
} from '../../../domains/comet-native/native-types.js';

describe('Native structured findings', () => {
  let projectRoot: string;
  let paths: NativeProjectPaths;
  let state: NativeChangeState;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-findings-'));
    paths = await nativeProjectPaths(projectRoot, '.');
    state = await createNativeChange({ paths, name: 'finding-shape', language: 'en' });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('normalizes project-relative paths and emits stable metadata order', () => {
    const findings = structureNativeFindings({
      paths,
      state,
      findings: [
        { code: 'spec-base-conflict', message: 'spec conflict', path: paths.specsDir },
        { code: 'brief-section-empty', message: 'empty brief', path: 'brief.md' },
      ],
    });

    expect(findings.map((finding) => finding.code)).toEqual([
      'brief-section-empty',
      'spec-base-conflict',
    ]);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      path: 'comet/changes/finding-shape/brief.md',
      requiredAction: 'complete-brief',
      retryCommand: 'comet native next finding-shape --summary "<summary>"',
      repairCommand: null,
      requiresUserDecision: false,
    });
    expect(findings[1].path).toBe('comet/specs');
  });

  it('reserves user-decision pauses for brief blocking questions only', () => {
    const findings = structureNativeFindings({
      paths,
      state,
      findings: [
        { code: 'brief-blocking-question', message: 'decision needed', path: 'brief.md' },
        { code: 'build-evidence-missing', message: 'model work needed' },
      ],
    });
    expect(findings.find((finding) => finding.code === 'brief-blocking-question')).toMatchObject({
      requiredAction: 'answer-blocking-question',
      requiresUserDecision: true,
    });
    expect(findings.find((finding) => finding.code === 'build-evidence-missing')).toMatchObject({
      requiredAction: 'record-build-evidence',
      requiresUserDecision: false,
    });
    expect(summarizeNativeFindings(findings)).toMatchObject({
      total: 2,
      errors: 2,
      requiresUserDecision: true,
      truncated: false,
    });
  });

  it('fails closed without advertising an impossible repair for an invalid checkpoint', () => {
    const [finding] = structureNativeFindings({
      paths,
      state,
      findings: [
        {
          code: 'checkpoint-progress-invalid',
          message: 'checkpoint document is malformed',
          path: 'comet/changes/finding-shape/runtime/checkpoints/progress.json',
        },
      ],
    });

    expect(finding).toMatchObject({
      requiredAction: 'manually-isolate-invalid-checkpoint',
      retryCommand: null,
      repairCommand: null,
      requiresUserDecision: false,
    });
  });
});
