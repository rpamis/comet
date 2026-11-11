import { promises as fs } from 'node:fs';
import path from 'node:path';
import { importLegacyBusinessFile } from '../workflow-contract/legacy-runtime-import.js';
import { ensureWorkspaceRuntimeRoot } from '../workflow-contract/workspace-runtime.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { isWorkspaceRuntimeMigrationFence } from '../workflow-contract/workspace-runtime.js';
import { runGitCommand } from '../../platform/process/git.js';
import {
  readClassicDelivery,
  parseClassicDeliveryReceipt,
  classicDeliveryReceiptFilename,
} from './classic-progress.js';
import { resolveClassicLayout } from './classic-layout.js';
import { resolveClassicRunDirectory, CLASSIC_LOCAL_RECORDS } from './classic-runtime-paths.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import { readWorkflowProjectConfigDocument } from '../workflow-contract/project-config-reader.js';

/** 安装升级时导入已知项目的 Classic 业务材料；普通命令不搬迁旧布局。 */
export async function importClassicLegacyRuntimeData(projectRoot: string) {
  const document = await readWorkflowProjectConfigDocument(projectRoot, {
    allowPartialProject: true,
    allowMissingNativeFields: true,
  });
  if (
    !document?.config ||
    !(document.config.workflows ?? [document.config.default_workflow]).includes('classic')
  )
    return [];
  const layout = await resolveClassicLayout(
      projectRoot,
      document.classic?.artifact_layout ?? 'legacy',
    ),
    imported: string[] = [];
  for (const directory of [layout.changesDir, layout.archiveDir]) {
    const relative = path.relative(projectRoot, directory).replaceAll('\\', '/');
    const root = await inspectProtectedProjectPath(projectRoot, relative, {
      label: 'Classic 升级来源',
      expected: 'directory',
    });
    if (!root.exists) continue;
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === 'archive') continue;
      const change = path.join(directory, entry.name),
        state = await resolveClassicStateFile(change);
      if (
        !(
          await inspectProtectedProjectPath(projectRoot, path.relative(projectRoot, state), {
            label: 'Classic 旧业务状态',
            expected: 'file',
          })
        ).exists
      )
        continue;
      const local = await resolveClassicRunDirectory(change, projectRoot),
        runtime = await ensureWorkspaceRuntimeRoot(projectRoot);
      for (const file of CLASSIC_LOCAL_RECORDS)
        await importLegacyBusinessFile(
          projectRoot,
          path.relative(projectRoot, path.join(change, '.comet', file)).replaceAll('\\', '/'),
          runtime,
          path.relative(runtime, path.join(local, '.comet', file)).replaceAll('\\', '/'),
          imported,
        );
      await importLegacyBusinessFile(
        projectRoot,
        path
          .relative(projectRoot, path.join(change, '.comet-state-transaction.json'))
          .replaceAll('\\', '/'),
        runtime,
        path
          .relative(runtime, path.join(local, '.comet-state-transaction.json'))
          .replaceAll('\\', '/'),
        imported,
      );
      await importLegacyClassicDeliveryReceipt(projectRoot, change, runtime, imported);
    }
  }
  return imported;
}

async function importLegacyClassicDeliveryReceipt(
  projectRoot: string,
  change: string,
  runtime: string,
  imported: string[],
) {
  const { delivery } = await readClassicDelivery(projectRoot, change, { evidence: false });
  if (!delivery) return;
  const filename = classicDeliveryReceiptFilename(delivery.changeIdentity),
    targetRef = 'classic-delivery-receipts/' + filename;
  if (
    (
      await inspectProtectedProjectPath(runtime, targetRef, {
        label: 'Current Classic delivery receipt',
        expected: 'file',
      })
    ).exists
  )
    return;
  const sources = [{ root: projectRoot, ref: '.comet/classic-deliveries/' + filename }];
  const git = await inspectProtectedProjectPath(projectRoot, '.git', {
    label: 'Classic Git metadata',
  });
  const common = git.exists ? runGitCommand(projectRoot, ['rev-parse', '--git-common-dir']) : null;
  if (common) {
    const root = await fs.realpath(path.resolve(projectRoot, common));
    sources.push({ root, ref: 'comet/classic-deliveries/' + filename });
  }
  let selected: (typeof sources)[number] | undefined,
    selectedReceipt: ReturnType<typeof parseClassicDeliveryReceipt> | undefined;
  for (const source of sources) {
    const entry = await inspectProtectedProjectPath(source.root, source.ref, {
      label: 'Legacy Classic delivery receipt',
      expected: 'file',
    });
    if (!entry.exists || (await isWorkspaceRuntimeMigrationFence(entry.target))) continue;
    const receipt = parseClassicDeliveryReceipt(
      JSON.parse(
        (
          await readProtectedProjectFile(source.root, source.ref, Number.MAX_SAFE_INTEGER, {
            label: 'Legacy Classic delivery receipt',
          })
        ).bytes.toString('utf8'),
      ),
      delivery.changeIdentity,
    );
    if (receipt.authorizationId !== delivery.authorizationId)
      throw new Error('Legacy Classic delivery receipt does not match the original authorization');
    if (delivery.commit && receipt.commit && delivery.commit !== receipt.commit)
      throw new Error('Classic delivery receipt conflicts with authorization evidence');
    if (selectedReceipt && JSON.stringify(selectedReceipt) !== JSON.stringify(receipt))
      throw new Error('Conflicting legacy Classic delivery receipts');
    selected = source;
    selectedReceipt = receipt;
  }
  if (selected)
    await importLegacyBusinessFile(selected.root, selected.ref, runtime, targetRef, imported);
}
