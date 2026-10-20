import type { ApplicationIdentity } from '../workflow-application/index.js';

export type DashboardApplicationRunKind = 'creator' | 'application';
export type DashboardApplicationStatus =
  | 'running'
  | 'waiting'
  | 'completed'
  | 'delivered'
  | 'stopped'
  | 'failed'
  | 'cancelled'
  | 'unknown'
  | 'unreadable';
export interface DashboardApplicationIdentity {
  id: string;
  version: string;
  base: string;
  contentHash: string | null;
  packageHash: string | null;
}
export interface DashboardApplicationRunSummary {
  archive?: { id: string; title: string };
  locator: string;
  kind: DashboardApplicationRunKind;
  isChild: boolean;
  parentRunId: string | null;
  parentLocator: string | null;
  runId: string | null;
  title: string;
  goal: string | null;
  status: DashboardApplicationStatus;
  revision: number | null;
  application: DashboardApplicationIdentity | null;
  applicationId: string | null;
  activity: {
    pending: number;
    running: number;
    unknown: number;
    decisions: number;
    evidence: number;
    children: number;
  };
  error: { code: string; message: string } | null;
}
export interface DashboardApplicationRunPage {
  indexing?: boolean;
  indexedCount?: number;
  sourceCount?: number;
  items: DashboardApplicationRunSummary[];
  total: number;
  nextCursor: string | null;
  fingerprint: string;
  readAt: string;
  errors: { source: DashboardApplicationRunKind; message: string }[];
}
export interface DashboardApplicationRecord {
  id: string;
  stepId: string;
  kind: 'action' | 'decision' | 'evidence' | 'ready';
  title: string;
  phase: string;
  sequence: number | null;
  status: string;
  attempt: number | null;
  type: string;
  active: boolean;
  data: unknown;
  childLocator: string | null;
  childRunId: string | null;
}
export interface DashboardApplicationArtifact {
  id: string;
  label: string;
  recordId: string | null;
  uri: string | null;
  sha256: string | null;
  value?: unknown;
}
export interface DashboardApplicationEvidence {
  kind: 'local' | 'model' | 'host';
  status: 'passed' | 'failed' | 'incomplete' | 'stale' | 'not-recorded' | 'unavailable' | 'skipped';
  version: string | null;
  contentHash: string | null;
  sourceLocator: string | null;
  sourceRunId: string | null;
  report: string | null;
  evalRunId: string | null;
  summary: string;
  details: unknown;
}
export interface DashboardApplicationRunDetail extends DashboardApplicationRunSummary {
  readAt: string;
  sequence: number | null;
  workflow: { id: string; version: string } | null;
  records: DashboardApplicationRecord[];
  recordPage?: { total: number; nextCursor: string | null };
  currentIds: string[];
  artifacts: DashboardApplicationArtifact[];
  evidence: DashboardApplicationEvidence[];
  otherEvidence: DashboardApplicationEvidence[];
  definitionStatus: 'observed' | 'unreadable';
  material: { status: 'matched' | 'changed' | 'unavailable' | 'not-generated'; message?: string };
  fixedIdentity: ApplicationIdentity | null;
  sourceCreators: { locator: string; runId: string; version: string }[];
  children: {
    locator: string | null;
    runId: string;
    actionId: string;
    workflow: { id: string; version: string };
  }[];
  inspection: { commandArgs: string[]; request: unknown } | null;
  relatedChange: {
    workflow: 'native' | 'classic';
    locator: string;
    name: string;
    status: 'active' | 'archived';
  } | null;
}
