import { promises as fs } from 'node:fs';

import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import type { MemoryLanguage } from '../comet-memory/types.js';
import {
  discoverExpectedProjectModelRecordIds,
  extractDeterministicProjectRecords,
} from './deterministic-extractors.js';
import type { ProjectKnowledgeDiagnosticReporter, ProjectKnowledgeProvider } from './types.js';

export interface ProjectKnowledgeReadinessOptions {
  readonly projectRoot: string;
  readonly provider: ProjectKnowledgeProvider;
  readonly language?: MemoryLanguage;
  readonly reportDiagnostic?: ProjectKnowledgeDiagnosticReporter;
}

export async function ensureProjectKnowledgeReady(
  options: ProjectKnowledgeReadinessOptions,
): Promise<void> {
  try {
    await fs.access(options.projectRoot);
  } catch {
    return;
  }
  const projectId = resolveStableProjectId(options.projectRoot);
  const refreshed = await options.provider.apply({ kind: 'refresh', projectId });
  for (const diagnostic of refreshed.diagnostics) options.reportDiagnostic?.(diagnostic);
  const listed = await options.provider.query({
    kind: 'list',
    projectId,
    state: 'all',
    limit: 500,
  });
  for (const diagnostic of listed.diagnostics) options.reportDiagnostic?.(diagnostic);
  const activeIds = new Set(
    listed.kind === 'list'
      ? listed.records.filter((record) => record.state !== 'superseded').map((record) => record.id)
      : [],
  );
  const expectedIds = await discoverExpectedProjectModelRecordIds({
    projectRoot: options.projectRoot,
    reportDiagnostic: options.reportDiagnostic,
  });
  const candidates = await extractDeterministicProjectRecords({
    projectRoot: options.projectRoot,
    preferredRecordIds: expectedIds.filter((id) => !activeIds.has(id)),
    language: options.language ?? 'zh-CN',
    reportDiagnostic: options.reportDiagnostic,
  });
  for (const record of candidates.slice(0, 66)) {
    const result = await options.provider.apply({ kind: 'upsert', record });
    for (const diagnostic of result.diagnostics) options.reportDiagnostic?.(diagnostic);
  }
}
