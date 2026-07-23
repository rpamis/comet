import path from 'path';

import { nativeChangeDir } from './native-change.js';
import { isInsidePath } from './native-paths.js';
import type {
  NativeChangeState,
  NativeFinding,
  NativeFindingSeverity,
  NativeFindingSummary,
  NativeProjectPaths,
  NativeStructuredFinding,
} from './native-types.js';
import { isNativeWorkspaceAdvisoryCode } from './native-workspace.js';

const FINDING_SUMMARY_CODE_BUDGET = 8;

interface FindingMetadata {
  severity: NativeFindingSeverity;
  requiredAction: string;
  retry: 'next' | 'status' | 'none';
  repair: 'doctor' | 'none';
}

const EXACT_METADATA: Record<string, FindingMetadata> = {
  'brief-blocking-question': {
    severity: 'error',
    requiredAction: 'answer-blocking-question',
    retry: 'next',
    repair: 'none',
  },
  'shape-confirmation-required': {
    severity: 'error',
    requiredAction: 'confirm-shared-understanding',
    retry: 'next',
    repair: 'none',
  },
  'transition-incomplete': {
    severity: 'error',
    requiredAction: 'recover-transition',
    retry: 'status',
    repair: 'doctor',
  },
  'trajectory-tail-incomplete': {
    severity: 'error',
    requiredAction: 'repair-trajectory-tail',
    retry: 'status',
    repair: 'doctor',
  },
  'checkpoint-progress-invalid': {
    severity: 'error',
    requiredAction: 'manually-isolate-invalid-checkpoint',
    retry: 'none',
    repair: 'none',
  },
  'checkpoint-progress-incomplete': {
    severity: 'error',
    requiredAction: 'recover-progress-checkpoint',
    retry: 'status',
    repair: 'doctor',
  },
  'checkpoint-manifest-invalid': {
    severity: 'error',
    requiredAction: 'record-checkpoint-again',
    retry: 'status',
    repair: 'none',
  },
  'verification-scope-partial': {
    severity: 'error',
    requiredAction: 'confirm-partial-verification-scope',
    retry: 'next',
    repair: 'none',
  },
  'native-change-conflict': {
    severity: 'error',
    requiredAction: 'resolve-native-change-conflict',
    retry: 'status',
    repair: 'none',
  },
  'native-change-overlap': {
    severity: 'error',
    requiredAction: 'inspect-native-change-overlap',
    retry: 'status',
    repair: 'none',
  },
  'contract-changed-after-approval': {
    severity: 'error',
    requiredAction: 're-confirm-contract',
    retry: 'next',
    repair: 'none',
  },
  'baseline-snapshot-incomplete': {
    severity: 'error',
    requiredAction: 'resolve-native-baseline',
    retry: 'none',
    repair: 'none',
  },
  'baseline-snapshot-missing': {
    severity: 'error',
    requiredAction: 'resolve-native-baseline',
    retry: 'none',
    repair: 'none',
  },
  'workspace-inspection-unavailable': {
    severity: 'info',
    requiredAction: 'migrate-workspace-identity',
    retry: 'status',
    repair: 'doctor',
  },
  'repair-stagnation-warning': {
    severity: 'warning',
    requiredAction: 'change-repair-approach',
    retry: 'next',
    repair: 'none',
  },
  'repair-stagnation-stop': {
    severity: 'error',
    requiredAction: 'make-progress-or-explicitly-override-repair',
    retry: 'none',
    repair: 'none',
  },
  'repair-iteration-limit': {
    severity: 'error',
    requiredAction: 'change-implementation-before-starting-a-new-repair-episode',
    retry: 'next',
    repair: 'none',
  },
  'repair-override-exhausted': {
    severity: 'error',
    requiredAction: 'review-repeated-failure-after-override',
    retry: 'none',
    repair: 'none',
  },
};

function inferredMetadata(code: string): FindingMetadata {
  const exact = EXACT_METADATA[code];
  if (exact) return exact;
  if (
    /^(?:run-|trajectory-|checkpoint-(?:missing|mismatch|invalid)|transition-invalid)/u.test(code)
  ) {
    return {
      severity: 'error',
      requiredAction: 'isolate-or-restore-native-runtime-from-a-trusted-copy',
      retry: 'none',
      repair: 'none',
    };
  }
  if (code.startsWith('brief-')) {
    return {
      severity: 'error',
      requiredAction: 'complete-brief',
      retry: 'next',
      repair: 'none',
    };
  }
  if (code.startsWith('spec-')) {
    return {
      severity: 'error',
      requiredAction: 'resolve-spec-state',
      retry: 'next',
      repair: 'none',
    };
  }
  if (code.startsWith('verification-')) {
    return {
      severity: 'error',
      requiredAction: 'complete-verification-evidence',
      retry: 'next',
      repair: 'none',
    };
  }
  if (code.startsWith('build-')) {
    return {
      severity: 'error',
      requiredAction: 'record-build-evidence',
      retry: 'next',
      repair: 'none',
    };
  }
  if (isNativeWorkspaceAdvisoryCode(code)) {
    return {
      severity: code === 'workspace-inspection-unavailable' ? 'info' : 'warning',
      requiredAction: 'inspect-workspace-advisory',
      retry: 'status',
      repair: 'none',
    };
  }
  return {
    severity: 'error',
    requiredAction: 'resolve-finding',
    retry: 'status',
    repair: 'none',
  };
}

function projectRelativePath(
  paths: NativeProjectPaths,
  state: NativeChangeState,
  finding: NativeFinding,
): string | null {
  if (!finding.path) return null;
  let target: string;
  if (path.isAbsolute(finding.path)) {
    target = path.resolve(finding.path);
  } else if (/^(?:brief-|verification-|spec-source)/u.test(finding.code)) {
    target = path.resolve(nativeChangeDir(paths, state.name), ...finding.path.split(/[\\/]/u));
  } else {
    target = path.resolve(paths.projectRoot, ...finding.path.split(/[\\/]/u));
  }
  if (!isInsidePath(paths.projectRoot, target)) return null;
  const relative = path.relative(paths.projectRoot, target).replaceAll('\\', '/');
  return relative === '' ? '.' : relative;
}

function retryCommand(
  retry: FindingMetadata['retry'],
  state: NativeChangeState,
  code: string,
): string | null {
  if (retry === 'next') {
    return `comet native next ${state.name} --summary "<summary>"${
      code === 'contract-changed-after-approval' || code === 'shape-confirmation-required'
        ? ' --confirmed'
        : ''
    }`;
  }
  if (retry === 'status') return `comet native status ${state.name} --details`;
  return null;
}

export function structureNativeFindings(options: {
  paths: NativeProjectPaths;
  state: NativeChangeState;
  findings: readonly NativeFinding[];
}): NativeStructuredFinding[] {
  return options.findings
    .map((finding): NativeStructuredFinding => {
      const metadata = inferredMetadata(finding.code);
      return {
        code: finding.code,
        message: finding.message,
        severity: metadata.severity,
        path: projectRelativePath(options.paths, options.state, finding),
        requiredAction: metadata.requiredAction,
        retryCommand: retryCommand(metadata.retry, options.state, finding.code),
        repairCommand:
          metadata.repair === 'doctor'
            ? `comet native doctor ${options.state.name} --repair${
                finding.code.startsWith('transition-') ? ' --strategy continue' : ''
              }`
            : null,
        // This is intentionally code-based, not severity-based. Model-actionable
        // missing data must never be presented as a user decision.
        requiresUserDecision:
          finding.code === 'brief-blocking-question' ||
          finding.code === 'shape-confirmation-required' ||
          finding.code === 'contract-changed-after-approval' ||
          finding.code === 'verification-scope-partial' ||
          finding.code === 'repair-iteration-limit' ||
          finding.code === 'repair-override-exhausted',
      };
    })
    .sort((left, right) => {
      const severityRank = { error: 0, warning: 1, info: 2 } as const;
      return (
        severityRank[left.severity] - severityRank[right.severity] ||
        left.code.localeCompare(right.code) ||
        (left.path ?? '').localeCompare(right.path ?? '') ||
        left.message.localeCompare(right.message)
      );
    });
}

export function summarizeNativeFindings(
  findings: readonly NativeStructuredFinding[],
): NativeFindingSummary {
  const codes = [...new Set(findings.map((finding) => finding.code))];
  return {
    total: findings.length,
    errors: findings.filter((finding) => finding.severity === 'error').length,
    warnings: findings.filter((finding) => finding.severity === 'warning').length,
    info: findings.filter((finding) => finding.severity === 'info').length,
    requiresUserDecision: findings.some((finding) => finding.requiresUserDecision),
    codes: codes.slice(0, FINDING_SUMMARY_CODE_BUDGET),
    truncated: codes.length > FINDING_SUMMARY_CODE_BUDGET,
  };
}
