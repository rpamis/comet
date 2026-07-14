import { promises as fs } from 'fs';
import path from 'path';

import { NATIVE_RUN_STORAGE } from '../engine/storage-layout.js';
import { readRunStateAt } from '../engine/storage-run.js';
import {
  validateNativeBrief,
  validateNativeSpecChanges,
  validateNativeVerification,
} from './native-artifacts.js';
import { nativeChangeDir } from './native-change.js';
import { isInsidePath } from './native-paths.js';
import type {
  NativeAdvanceEvidence,
  NativeArtifactValidation,
  NativeChangeState,
  NativeFinding,
  NativeProjectPaths,
} from './native-types.js';

function validation(findings: NativeFinding[]): NativeArtifactValidation {
  return { valid: findings.length === 0, findings };
}

async function validateBuildArtifacts(
  paths: NativeProjectPaths,
  evidence: NativeAdvanceEvidence,
): Promise<NativeFinding[]> {
  const findings: NativeFinding[] = [];
  if ((evidence.noCodeReason ?? '').trim().length > 0) return findings;
  if (!evidence.artifacts || evidence.artifacts.length === 0) {
    return [
      {
        code: 'build-evidence-missing',
        message: 'Build requires an artifact reference or an explicit no-code reason',
      },
    ];
  }
  for (const artifact of evidence.artifacts) {
    if (
      path.isAbsolute(artifact) ||
      artifact.split(/[\\/]/u).includes('..') ||
      /^(?:[A-Za-z]:|~|[\\/])/u.test(artifact)
    ) {
      findings.push({
        code: 'build-artifact-unsafe',
        message: `Unsafe build artifact: ${artifact}`,
      });
      continue;
    }
    const target = path.resolve(paths.projectRoot, ...artifact.split(/[\\/]/u));
    if (!isInsidePath(paths.projectRoot, target)) {
      findings.push({
        code: 'build-artifact-unsafe',
        message: `Unsafe build artifact: ${artifact}`,
      });
      continue;
    }
    try {
      await fs.access(target);
    } catch {
      findings.push({
        code: 'build-artifact-missing',
        message: `Build artifact does not exist: ${artifact}`,
        path: artifact,
      });
    }
  }
  return findings;
}

export async function inspectNativeGuard(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  evidence: NativeAdvanceEvidence;
}): Promise<NativeArtifactValidation> {
  const findings: NativeFinding[] = [];
  const changeDir = nativeChangeDir(options.paths, options.state.name);
  if (options.evidence.summary.trim().length === 0) {
    findings.push({
      code: 'transition-summary-missing',
      message: 'Phase transition requires a summary',
    });
  }
  if (options.state.run_id) {
    const run = await readRunStateAt(changeDir, NATIVE_RUN_STORAGE);
    if (!run) {
      findings.push({
        code: 'run-state-missing',
        message: 'Native change references a missing Run state',
      });
    } else if (run.pending || run.status === 'waiting') {
      findings.push({
        code: 'run-action-pending',
        message: 'Native Run has an unresolved pending action',
      });
    } else if (run.currentStep !== options.state.phase) {
      findings.push({
        code: 'run-phase-mismatch',
        message: `Native Run step ${run.currentStep ?? '(none)'} does not match phase ${options.state.phase}`,
      });
    }
  }
  if (options.state.phase === 'shape') {
    const brief = await validateNativeBrief(changeDir, options.state.brief);
    const specs = await validateNativeSpecChanges(options.paths, options.state);
    findings.push(...brief.findings, ...specs.findings);
    if (options.state.confirmation_required && options.state.approval !== 'confirmed') {
      findings.push({
        code: 'shape-confirmation-required',
        message: 'Shape requires explicit user confirmation',
      });
    }
  } else if (options.state.phase === 'build') {
    findings.push(...(await validateBuildArtifacts(options.paths, options.evidence)));
  } else if (options.state.phase === 'verify') {
    const report = options.evidence.verificationReport ?? options.state.verification_report;
    if (!report) {
      findings.push({
        code: 'verification-report-missing',
        message: 'Verify requires a report path',
      });
    } else {
      findings.push(...(await validateNativeVerification(changeDir, report)).findings);
    }
    if (!options.evidence.verificationResult) {
      findings.push({
        code: 'verification-result-missing',
        message: 'Verify requires pass or fail',
      });
    }
    findings.push(...(await validateNativeSpecChanges(options.paths, options.state)).findings);
  } else {
    findings.push({
      code: 'archive-command-required',
      message: 'Use comet native archive for the Archive phase',
    });
  }
  return validation(findings);
}
