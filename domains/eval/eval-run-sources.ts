import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { runWithHookReadCache } from '../../platform/process/hook-read-cache.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { evalStoragePath, readEvalRun } from './eval-run-store.js';
import { evalArchiveRoot, readEvalArchiveManifest } from './eval-archives.js';
import type { EvalRunDetail, EvalRunSummary } from './eval-run-types.js';

// 目录指纹用于发现新增、删除和替换；即使运行已完成，也逐次检查文件指纹，
// 避免复用目录列表时漏掉文件的原地修改。
const directoryEntries = new Map<string, { stamp: string; names: string[] }>();
async function sourceNames(directory: string): Promise<string[]> {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Eval 观测来源必须是真实目录');
  const stamp = JSON.stringify([
    stat.dev,
    stat.ino,
    stat.mode,
    stat.size,
    stat.mtimeMs,
    stat.ctimeMs,
  ]);
  const cached = directoryEntries.get(directory);
  if (cached?.stamp === stamp) return cached.names;
  directoryEntries.delete(directory);
  const names = await fs.readdir(directory);
  const after = await fs.lstat(directory);
  if (
    stamp ===
      JSON.stringify([
        after.dev,
        after.ino,
        after.mode,
        after.size,
        after.mtimeMs,
        after.ctimeMs,
      ]) &&
    names.length <= 256
  ) {
    directoryEntries.set(directory, { stamp, names });
    while (directoryEntries.size > 4096)
      directoryEntries.delete(directoryEntries.keys().next().value!);
  }
  return names;
}

export async function evalSourceFingerprint(
  project: string,
  relative: string,
  includeReports = false,
): Promise<string> {
  const inspected = await inspectProtectedProjectPath(project, relative, {
    label: 'Eval 观测来源',
    expected: 'directory',
  });
  if (!inspected.exists) return 'missing';
  const rows: unknown[] = [];
  async function stamp(directory: string, prefix: string, predicate: (name: string) => boolean) {
    const entries = await sourceNames(directory);
    for (let i = 0; i < entries.length; i += 16)
      await Promise.all(
        entries
          .slice(i, i + 16)
          .filter(predicate)
          .map(async (entry) => {
            const stat = await fs.lstat(path.join(directory, entry));
            if (stat.isSymbolicLink()) throw new Error('Eval 观测来源不能是符号链接');
            rows.push([prefix + entry, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]);
          }),
      );
  }
  await stamp(inspected.target, '', (name) =>
    includeReports
      ? [
          'metadata.json',
          'application-result.json',
          'dashboard-run.json',
          'expected-case-matrix.json',
          'progress.json',
          'execution-state.json',
          'managed-record-recovery.json',
          'reports',
        ].includes(name)
      : name === 'archive.json',
  );
  if (includeReports) {
    const reports = await inspectProtectedProjectPath(project, `${relative}/reports`, {
      label: 'Eval 用例报告',
      expected: 'directory',
    });
    if (reports.exists)
      await stamp(reports.target, 'reports/', (name) => /^[\w.-]+_report\.json$/u.test(name));
  } else {
    const archive = await readEvalArchiveManifest(project, path.basename(relative));
    for (const ref of archive.runs) {
      const file = await inspectProtectedProjectPath(project, `${relative}/${ref.file}`, {
        label: '归档运行来源',
        expected: 'file',
      });
      const stat = await fs.lstat(file.target);
      rows.push([ref.file, stat.size, stat.mtimeMs, stat.ctimeMs, stat.ino]);
    }
  }
  return createHash('sha256')
    .update(JSON.stringify(rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))))
    .digest('hex');
}

export async function listEvalRunSources(project: string) {
  return runWithHookReadCache(async () => {
    const root = await evalStoragePath(project, 'runs');
    const entries = await fs
      .readdir(root, { withFileTypes: true })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
    const runs = entries.filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(entry.name),
    );
    const result: { id: string; fingerprint: string }[] = [];
    for (let offset = 0; offset < runs.length; offset += 16) {
      result.push(
        ...(await Promise.all(
          runs.slice(offset, offset + 16).map(async ({ name: id }) => {
            try {
              return {
                id,
                fingerprint: await evalSourceFingerprint(project, `.comet/eval/runs/${id}`, true),
              };
            } catch (error) {
              return {
                id,
                fingerprint: `unreadable:${error instanceof Error ? error.message : String(error)}`,
              };
            }
          }),
        )),
      );
    }
    return result;
  });
}

export async function listEvalArchiveSources(project: string) {
  const root = await inspectProtectedProjectPath(project, 'eval/archives', {
    label: 'Eval 归档',
    expected: 'directory',
  });
  if (!root.exists) return [];
  const result = [];
  for (const entry of await fs.readdir(root.target, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(entry.name)
    )
      continue;
    try {
      result.push({
        id: entry.name,
        fingerprint: await evalSourceFingerprint(project, evalArchiveRoot(entry.name)),
        error: null,
      });
    } catch (error) {
      result.push({
        id: entry.name,
        fingerprint: 'unreadable',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

export function summarizeEvalRun(run: EvalRunDetail): EvalRunSummary {
  const {
    id,
    origin,
    createdAt,
    completedAt,
    executionStatus,
    conclusion,
    target,
    passed,
    total,
    expectedTotal,
    metrics,
    baselineScope,
    baselineRunId,
    boundBaselineRunId,
    isBaseline,
    baselineEligible,
    baselineDisabledReason,
    availableActions,
    stale,
    diagnostics,
    archiveId,
    archiveAssessment,
  } = run;
  return {
    id,
    origin,
    createdAt,
    completedAt,
    executionStatus,
    conclusion,
    target,
    passed,
    total,
    expectedTotal,
    metrics,
    baselineScope,
    baselineRunId,
    boundBaselineRunId,
    isBaseline,
    baselineEligible,
    baselineDisabledReason,
    availableActions,
    stale,
    diagnostics,
    archiveId,
    archiveAssessment,
    model: run.config.model ?? run.cases[0]?.model ?? null,
    agent: run.config.agent ?? run.cases[0]?.agent ?? null,
    retrySourceRunId: run.config.retrySourceRunId,
  };
}

export async function readEvalRunSummary(project: string, id: string): Promise<EvalRunSummary> {
  return summarizeEvalRun(await readEvalRun(project, id, { includeCaseContent: false }));
}
