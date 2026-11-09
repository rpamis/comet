import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RuntimeAction, WorkflowRun } from '../engine/runtime.js';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import { inspectProtectedProjectPath } from '../workflow-contract/protected-project-path.js';
import { archivedClassicDocumentRef } from './classic-archive-annotation.js';
import { resolveClassicLayout } from './classic-layout.js';
import { classicArchiveDocumentOutputs } from './classic-sdk-archive-documents.js';
import { resolveClassicStateFile } from './classic-state-file.js';

/** 旧 Archive 没有清单时，沿用原 Run 已批准的目录与文档路径；不恢复文件摘要。 */
export async function readLegacyClassicArchiveInputs(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  archiveRef: string,
): Promise<{
  paths: string[];
  sourcePaths: string[];
  stateFiles: string[];
  optionalPaths: string[];
}> {
  const activeRef = (run.input as { changeDir: string }).changeDir;
  normalizeWorkflowRelativePath(activeRef, 'Classic active path');
  normalizeWorkflowRelativePath(archiveRef, 'Classic archive path');
  if (
    action.status !== 'succeeded' ||
    action.outcome?.status !== 'succeeded' ||
    action.claim?.executorId !== 'comet-classic-archive' ||
    (action.outcome.output as { archiveDirectory?: string })?.archiveDirectory !== archiveRef
  )
    throw new Error('旧 Archive 缺少成功的原执行结果');
  const paths: string[] = [];
  const optionalPaths: string[] = [];
  async function walk(ref: string) {
    const target = await inspectProtectedProjectPath(root, ref, {
      label: 'Classic legacy archive path',
      expected: 'any',
    });
    if (!target.exists) return;
    if (target.kind === 'directory') {
      for (const name of await fs.readdir(target.target)) {
        if (['.comet-state.lock', '.comet-state-transaction.json'].includes(name)) {
          const fence = ref + '/' + name + '/.comet-runtime-migration.json';
          const target = await inspectProtectedProjectPath(root, fence, {
            label: 'Classic legacy migration marker',
            expected: 'file',
          });
          if (target.exists) {
            optionalPaths.push(fence);
            paths.push(activeRef + '/' + fence.slice(archiveRef.length + 1));
          }
          continue;
        }
        await walk(ref + '/' + name);
      }
    } else paths.push(ref);
  }
  await walk(archiveRef);
  const specsRef = path
    .relative(root, (await resolveClassicLayout(root)).specsDir)
    .replaceAll('\\', '/');
  for (const ref of [...paths])
    if (ref.startsWith(archiveRef + '/specs/') && ref.endsWith('/spec.md'))
      paths.push(specsRef + '/' + ref.slice((archiveRef + '/specs/').length));
  const outputs = classicArchiveDocumentOutputs(run, action).outputs;
  const design = (outputs['full.design.document'] as { designDoc?: string } | undefined)?.designDoc;
  const plan = (outputs['full.build.plan'] as { plan?: string } | undefined)?.plan;
  for (const ref of [design, plan])
    if (ref) paths.push(archivedClassicDocumentRef(ref, activeRef, archiveRef)!);
  const stateRef = path
    .relative(root, await resolveClassicStateFile(path.join(root, archiveRef)))
    .replaceAll('\\', '/');
  const sourcePaths = paths
    .filter((ref) => ref.startsWith(archiveRef + '/'))
    .map((ref) => activeRef + '/' + ref.slice(archiveRef.length + 1));
  return {
    paths: [...new Set([...paths, ...sourcePaths])],
    sourcePaths,
    stateFiles: [stateRef, activeRef + '/' + path.posix.basename(stateRef)],
    optionalPaths,
  };
}
