import type { AgentContextVerification, AgentLearningState } from './types.js';

export type ProjectPolicyKind =
  | 'decision'
  | 'pattern'
  | 'procedure'
  | 'constraint'
  | 'failure-resolution';

export type ProjectPolicyActivation =
  | { readonly kind: 'context' }
  | { readonly kind: 'verification'; readonly commands: readonly AgentContextVerification[] }
  | { readonly kind: 'skill-candidate'; readonly reason: string };

export interface CompilableProjectPolicy {
  readonly kind: ProjectPolicyKind;
  readonly state: AgentLearningState;
  readonly verification: readonly AgentContextVerification[];
  readonly steps?: readonly string[];
  readonly applicationCount?: number;
  readonly successCount?: number;
  readonly failureCount?: number;
}

export function compileProjectPolicy(policy: CompilableProjectPolicy): ProjectPolicyActivation {
  if (
    policy.kind === 'constraint' &&
    policy.state === 'enforced' &&
    policy.verification.length > 0
  ) {
    return { kind: 'verification', commands: [...policy.verification] };
  }
  if (
    policy.kind === 'procedure' &&
    policy.state === 'proven' &&
    (policy.steps?.length ?? 0) >= 3 &&
    (policy.applicationCount ?? 0) >= 2 &&
    (policy.successCount ?? 0) >= 2 &&
    (policy.failureCount ?? 0) === 0
  ) {
    return {
      kind: 'skill-candidate',
      reason: 'stable-multi-step-procedure',
    };
  }
  return { kind: 'context' };
}
