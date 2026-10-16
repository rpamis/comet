import { promises as fs } from 'node:fs';

import { resolveStableProjectId } from '../../platform/paths/project-identity.js';
import type { MemoryLanguage } from '../comet-memory/types.js';
import {
  discoverExpectedProjectModelRecordIds,
  extractDeterministicProjectRecords,
} from './deterministic-extractors.js';
import type { ProjectKnowledgeDiagnosticReporter, ProjectKnowledgeProvider } from './types.js';
import { RemoteProjectKnowledgeProvider } from './remote-provider.js';

export interface ProjectKnowledgeReadinessOptions {
  readonly projectRoot: string;
  readonly provider: ProjectKnowledgeProvider;
  readonly language?: MemoryLanguage;
  readonly reportDiagnostic?: ProjectKnowledgeDiagnosticReporter;
  /** Query callers validate selected sources at delivery instead of refreshing all records. */
  readonly refreshSources?: boolean;
}

export async function ensureProjectKnowledgeReady(
  options: ProjectKnowledgeReadinessOptions,
): Promise<void> {
  // Local model maintenance must not turn Remote inspection into uploads.
  if (options.provider instanceof RemoteProjectKnowledgeProvider) return;
  try {
    await prepareProjectKnowledge(options);
  } catch (error) {
    options.reportDiagnostic?.({
      code: 'readiness-failed',
      message: `项目知识准备未完成：${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

async function prepareProjectKnowledge(options: ProjectKnowledgeReadinessOptions): Promise<void> {
  try {
    await fs.access(options.projectRoot);
  } catch {
    return;
  }
  const projectId = resolveStableProjectId(options.projectRoot);
  if (options.refreshSources !== false) {
    const refreshed = await options.provider.apply({ kind: 'refresh', projectId });
    for (const diagnostic of refreshed.diagnostics) options.reportDiagnostic?.(diagnostic);
  }
  const expectedIds = await discoverExpectedProjectModelRecordIds({
    projectRoot: options.projectRoot,
    reportDiagnostic: options.reportDiagnostic,
  });
  const activeIds = new Set<string>();
  for (const id of expectedIds) {
    const response = await options.provider.query({ kind: 'get', projectId, id });
    for (const diagnostic of response.diagnostics) options.reportDiagnostic?.(diagnostic);
    if (response.kind === 'get' && response.record && response.record.state !== 'superseded')
      activeIds.add(id);
  }
  const missingIds = expectedIds.filter((id) => !activeIds.has(id));
  if (missingIds.length === 0) return;
  const candidates = await extractDeterministicProjectRecords({
    projectRoot: options.projectRoot,
    preferredRecordIds: missingIds,
    recordIds: missingIds,
    language: options.language ?? 'zh-CN',
    reportDiagnostic: options.reportDiagnostic,
  });
  for (const record of candidates.slice(0, 66)) {
    try {
      const result = await options.provider.apply({ kind: 'upsert', record });
      for (const diagnostic of result.diagnostics) options.reportDiagnostic?.(diagnostic);
    } catch (error) {
      options.reportDiagnostic?.({
        code: 'readiness-upsert-failed',
        message: `项目知识记录准备失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }
}
