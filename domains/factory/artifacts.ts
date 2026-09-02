import { createHash } from 'crypto';
import type { WorkflowProtocol } from '../workflow-contract/index.js';

export type FactoryAuthoringLane =
  | 'skill-core'
  | 'workflow-entry'
  | 'script-contract'
  | 'platform-agent'
  | 'reference'
  | 'pause-points'
  | 'eval'
  | 'skill-review';

export type FactoryPackageArtifactKind = 'skill' | 'script' | 'reference' | 'engine' | 'agent';

export type FactoryArtifactAuthorKind = 'deterministic-adapter' | 'subagent';

export type FactoryArtifactClaimKind =
  'workflow-entry' | 'node-skill' | 'script' | 'reference' | 'pause-point' | 'eval' | 'review';

export interface FactoryPackageArtifact {
  path: string;
  kind: FactoryPackageArtifactKind;
  content: string;
  executable?: boolean;
}

export interface FactoryArtifactAuthorMetadata {
  id: string;
  kind: FactoryArtifactAuthorKind;
  label: string;
}

export interface FactoryArtifactClaim {
  kind: FactoryArtifactClaimKind;
  id: string;
  paths: string[];
  summary: string;
  nodeSkill?: string;
}

export interface FactoryReviewFinding {
  severity: 'blocking' | 'warning';
  code: string;
  message: string;
  lane?: FactoryAuthoringLane;
  path?: string;
}

export interface FactoryArtifactProposal {
  lane: FactoryAuthoringLane;
  protocolHash: string;
  author?: FactoryArtifactAuthorMetadata;
  artifacts: FactoryPackageArtifact[];
  claims?: FactoryArtifactClaim[];
  findings?: FactoryReviewFinding[];
}

export interface FactoryGeneratedPackageReview {
  passed: boolean;
  blockingFindings: FactoryReviewFinding[];
  warnings: FactoryReviewFinding[];
}

export interface FactoryPackageDraft {
  workflow: WorkflowProtocol;
  protocolHash: string;
  proposals: FactoryArtifactProposal[];
  artifacts: FactoryPackageArtifact[];
  review: FactoryGeneratedPackageReview;
}

export function workflowProtocolHash(workflow: WorkflowProtocol): string {
  return createHash('sha256').update(JSON.stringify(workflow)).digest('hex');
}

export function collectProposalArtifacts(
  proposals: FactoryArtifactProposal[],
): FactoryPackageArtifact[] {
  return proposals.flatMap((proposal) => proposal.artifacts);
}
