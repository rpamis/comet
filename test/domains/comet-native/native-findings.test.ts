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

  it('reserves user-decision pauses for explicit clarification decisions', () => {
    const findings = structureNativeFindings({
      paths,
      state,
      findings: [
        { code: 'brief-blocking-question', message: 'decision needed', path: 'brief.md' },
        {
          code: 'shape-confirmation-required',
          message: 'shared understanding must be confirmed',
        },
        { code: 'build-evidence-missing', message: 'model work needed' },
      ],
    });
    expect(findings.find((finding) => finding.code === 'brief-blocking-question')).toMatchObject({
      requiredAction: 'answer-blocking-question',
      requiresUserDecision: true,
    });
    expect(
      findings.find((finding) => finding.code === 'shape-confirmation-required'),
    ).toMatchObject({
      requiredAction: 'confirm-shared-understanding',
      retryCommand: 'comet native next finding-shape --summary "<summary>" --confirmed',
      requiresUserDecision: true,
    });
    expect(findings.find((finding) => finding.code === 'build-evidence-missing')).toMatchObject({
      requiredAction: 'record-build-evidence',
      requiresUserDecision: false,
    });
    expect(summarizeNativeFindings(findings)).toMatchObject({
      total: 3,
      errors: 3,
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

  it('advertises doctor only for findings with a real automatic repair path', () => {
    const repairable = structureNativeFindings({
      paths,
      state,
      findings: [
        { code: 'transition-incomplete', message: 'valid journal is pending' },
        { code: 'trajectory-tail-incomplete', message: 'partial final line' },
        { code: 'checkpoint-progress-incomplete', message: 'valid checkpoint journal is pending' },
      ],
    });
    expect(repairable.every((finding) => finding.repairCommand?.includes('doctor'))).toBe(true);

    const notAutomaticallyRepairable = structureNativeFindings({
      paths,
      state,
      findings: [
        { code: 'run-state-missing', message: 'missing Run state' },
        { code: 'run-id-mismatch', message: 'mismatched Run ID' },
        { code: 'trajectory-invalid', message: 'complete but invalid trajectory' },
        { code: 'checkpoint-missing', message: 'missing checkpoint' },
        { code: 'checkpoint-mismatch', message: 'mismatched checkpoint' },
        { code: 'checkpoint-invalid', message: 'invalid checkpoint' },
        { code: 'transition-invalid', message: 'invalid transition journal' },
      ],
    });
    for (const finding of notAutomaticallyRepairable) {
      expect(finding).toMatchObject({
        requiredAction: 'isolate-or-restore-native-runtime-from-a-trusted-copy',
        retryCommand: null,
        repairCommand: null,
      });
    }
  });
});
