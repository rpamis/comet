/**
 * Dashboard data contracts.
 *
 * Matches the API shape consumed by the dashboard frontend (see
 * `domains/dashboard/web/app.js`). Field names are stable; renaming requires
 * coordinated changes in the collector, the frontend, and any docs that
 * reference the JSON payload.
 */

import type { NativeDashboardChangeListItem, NativeDashboardProjection } from './native-adapter.js';

export type ChangeStatus = 'active' | 'archived';

export type ChangePhase = 'open' | 'design' | 'build' | 'verify' | 'archive' | 'unknown';

export type PhaseStepStatus = 'done' | 'current' | 'pending' | 'failed' | 'unknown';

export type VerifyResult = 'pending' | 'pass' | 'fail' | 'unknown';

export type RiskLevel = 'info' | 'warning' | 'error';

export interface DashboardRisk {
  level: RiskLevel;
  code: string;
  message: string;
  suggestion?: string;
}

export interface TaskSectionSummary {
  title: string;
  completed: number;
  total: number;
  status: 'done' | 'active' | 'pending';
}

export interface TasksSummary {
  completed: number;
  total: number;
  incomplete: string[];
  sections: TaskSectionSummary[];
}

export type ArtifactSource = 'openspec' | 'superpowers' | 'comet';

export interface GroupedArtifact {
  key: string;
  label: string;
  source: ArtifactSource;
  exists: boolean;
  path: string;
  notApplicable?: boolean;
}

export interface ArtifactsSummary {
  proposal: boolean;
  design: boolean;
  tasks: boolean;
  plan: boolean;
  verifyReport: boolean;
  cometYaml: boolean;
  grouped: GroupedArtifact[];
}

export interface ArtifactPreview {
  key: string;
  label: string;
  path: string;
  exists: boolean;
  content?: string;
  truncated?: boolean;
  size?: number;
  updatedAt?: string;
}

export interface VerifySummary {
  result: VerifyResult;
  reportExists: boolean;
  summary?: string;
}

export interface NextAction {
  command: string | null;
  reason: string;
  description: string;
}

export interface ArchiveInfo {
  archiveName: string;
  originalName?: string;
  archivedAt?: string;
  archivePath: string;
}

export interface ChangeDashboardItem {
  id: string;
  name: string;
  displayName: string;
  status: ChangeStatus;
  path: string;
  relativePath: string;
  workflow: string | null;
  phase: ChangePhase;
  updatedAt?: string;
  archive?: ArchiveInfo;
  tasks: TasksSummary;
  artifacts: ArtifactsSummary;
  artifactPreviews: ArtifactPreview[];
  verify: VerifySummary;
  next?: NextAction;
  risks: DashboardRisk[];
}

export interface GitSnapshot {
  branch: string | null;
  head: string | null;
  dirtyFiles: number;
  dirtyFileList: string[];
  recentCommits: string[];
}

export interface DashboardProject {
  name: string;
  path: string;
  generatedAt: string;
}

export interface DashboardSummary {
  activeChanges: number;
  archivedChanges: number;
  verifyFailed: number;
  tasksIncomplete: number;
  dirtyFiles: number;
}

export type DashboardChangeTab = 'active' | 'archived' | 'all';

export interface DashboardChangeListItem {
  id: string;
  name: string;
  displayName: string;
  status: ChangeStatus;
  relativePath: string;
  workflow: string | null;
  phase: ChangePhase;
  updatedAt?: string;
  tasks: Pick<TasksSummary, 'completed' | 'total'>;
  verify: Pick<VerifySummary, 'result'>;
}

export interface DashboardChangePage {
  status: DashboardChangeTab;
  items: DashboardChangeListItem[];
  total: number;
  nextCursor: string | null;
}

export interface NativeDashboardChangePage {
  status: DashboardChangeTab;
  items: NativeDashboardChangeListItem[];
  total: number;
  nextCursor: string | null;
}

export interface DashboardOverview {
  project: DashboardProject;
  summary: DashboardSummary;
  initialChanges: DashboardChangePage;
  git: GitSnapshot;
  risks: DashboardRisk[];
  native?: NativeDashboardProjection;
  nativeError?: { code: 'native-dashboard-unavailable' };
  classicError?: { code: 'classic-dashboard-unavailable'; message: string };
}

export interface DashboardSnapshot {
  project: DashboardProject;
  summary: DashboardSummary;
  changes: {
    active: ChangeDashboardItem[];
    archived: ChangeDashboardItem[];
  };
  git: GitSnapshot;
  risks: DashboardRisk[];
  native?: NativeDashboardProjection;
  nativeError?: { code: 'native-dashboard-unavailable' };
  classicError?: { code: 'classic-dashboard-unavailable'; message: string };
}
