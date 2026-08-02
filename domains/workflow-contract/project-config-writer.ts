import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';

import { atomicWriteContainedText, publishFileExclusively } from './contained-atomic-write.js';
import {
  mergeWorkflowProjectConfigDocument,
  parseWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
  WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
} from './project-config.js';
import {
  readWorkflowProjectConfigIdentity,
  readWorkflowProjectConfigSnapshot,
  workflowProjectConfigIdentityEquals,
  WORKFLOW_PROJECT_CONFIG_PATH,
  type WorkflowProjectConfigIdentity,
} from './project-config-reader.js';
import { inspectProtectedProjectPath, readProtectedProjectFile } from './protected-project-path.js';
import type { ProjectConfigLanguage, WorkflowProjectConfig } from './types.js';
import {
  beginWorkflowProjectConfigTransaction,
  inspectWorkflowProjectConfigTransaction,
  repairWorkflowProjectConfigTransaction,
} from './project-config-transaction.js';

export interface WorkflowProjectConfigWriteOptions {
  allowPartialProject?: boolean;
  expectedIdentity?: WorkflowProjectConfigIdentity;
  beforeCommit?: () => void | Promise<void>;
  beforePublish?: () => void | Promise<void>;
}

export async function assertWorkflowProjectConfigIdentity(
  projectRoot: string,
  expectedIdentity: WorkflowProjectConfigIdentity | undefined,
): Promise<void> {
  if (!expectedIdentity) return;
  const current = await readWorkflowProjectConfigIdentity(projectRoot);
  if (!workflowProjectConfigIdentityEquals(current, expectedIdentity)) {
    throw new Error('Project config changed before commit; rerun the operation');
  }
}

export async function writeWorkflowProjectConfigSource(
  projectRoot: string,
  output: string,
  options: WorkflowProjectConfigWriteOptions = {},
): Promise<void> {
  parseWorkflowProjectConfigDocument(output, {
    allowPartialProject: options.allowPartialProject ?? false,
  });

  const root = path.resolve(projectRoot);
  if (await inspectWorkflowProjectConfigTransaction(root)) {
    throw new Error(
      'An unfinished project config write transaction exists; run comet doctor --repair',
    );
  }
  const expectedIdentity =
    options.expectedIdentity ?? (await readWorkflowProjectConfigIdentity(root));
  await assertWorkflowProjectConfigIdentity(root, expectedIdentity);
  const finalInspection = await inspectProtectedProjectPath(root, WORKFLOW_PROJECT_CONFIG_PATH, {
    label: WORKFLOW_PROJECT_CONFIG_PATH,
    expected: 'file',
  });
  const transactionId = randomUUID();
  const expectedOutputHash = createHash('sha256').update(output).digest('hex');
  const transactionPaths =
    expectedIdentity.exists && expectedIdentity.sha256
      ? await beginWorkflowProjectConfigTransaction(
          root,
          transactionId,
          expectedIdentity.sha256,
          expectedOutputHash,
        )
      : null;
  let transactionOpen = transactionPaths !== null;
  const temporaryRelative =
    transactionPaths?.candidate ?? `.comet/config.yaml.${transactionId}.next`;
  const temporary = path.join(root, ...temporaryRelative.split('/'));
  const quarantineRelative = transactionPaths?.quarantine ?? null;
  try {
    await atomicWriteContainedText(temporary, output, {
      containedRoot: root,
      exclusive: true,
    });
    await options.beforeCommit?.();
    await assertWorkflowProjectConfigIdentity(root, expectedIdentity);
    await inspectProtectedProjectPath(root, temporaryRelative, {
      label: 'project config candidate',
      expected: 'file',
    });

    if (expectedIdentity.exists) {
      if (!quarantineRelative) {
        throw new Error('Project config write transaction was not created');
      }
      const quarantine = path.join(root, ...quarantineRelative.split('/'));
      await inspectProtectedProjectPath(root, WORKFLOW_PROJECT_CONFIG_PATH, {
        label: WORKFLOW_PROJECT_CONFIG_PATH,
        expected: 'file',
      });
      const quarantineInspection = await inspectProtectedProjectPath(root, quarantineRelative, {
        label: 'project config quarantine',
        expected: 'file',
      });
      if (quarantineInspection.exists) {
        throw new Error('Project config quarantine already exists');
      }
      await fs.rename(finalInspection.target, quarantine);
      const { bytes } = await readProtectedProjectFile(
        root,
        quarantineRelative,
        WORKFLOW_PROJECT_CONFIG_MAX_BYTES,
        { label: 'project config quarantine' },
      );
      const quarantinedHash = createHash('sha256').update(bytes).digest('hex');
      if (quarantinedHash !== expectedIdentity.sha256) {
        throw new Error('Project config changed before final publish; successor was preserved');
      }
    } else if (finalInspection.exists) {
      throw new Error('Project config changed before final publish; successor was preserved');
    }

    await options.beforePublish?.();
    await inspectProtectedProjectPath(root, temporaryRelative, {
      label: 'project config candidate',
      expected: 'file',
    });
    try {
      await publishFileExclusively(temporary, finalInspection.target);
    } catch (error) {
      throw new Error('Project config final publish failed; successor was preserved', {
        cause: error,
      });
    }
    const published = await readWorkflowProjectConfigIdentity(root);
    if (!published.exists || published.sha256 !== expectedOutputHash) {
      throw new Error('Project config changed during final publish; successor was preserved');
    }
    if (transactionOpen) {
      await repairWorkflowProjectConfigTransaction(root, { ownerId: transactionId });
      transactionOpen = false;
    }
  } catch (error) {
    if (transactionOpen) {
      try {
        if (await repairWorkflowProjectConfigTransaction(root, { ownerId: transactionId })) {
          transactionOpen = false;
        }
      } catch {
        // Keep the durable transaction, candidate, and quarantine for doctor recovery.
      }
    }
    throw error;
  } finally {
    if (!transactionOpen) {
      await removeProtectedConfigFile(root, temporaryRelative).catch(() => false);
    }
  }
}

async function removeProtectedConfigFile(
  projectRoot: string,
  relativePath: string,
): Promise<boolean> {
  const inspection = await inspectProtectedProjectPath(projectRoot, relativePath, {
    label: relativePath,
    expected: 'file',
  });
  if (!inspection.exists) return false;
  await fs.unlink(inspection.target);
  return true;
}

export async function writeWorkflowProjectConfigDocument(
  projectRoot: string,
  document: Record<string, unknown>,
  language: ProjectConfigLanguage,
  options: Omit<WorkflowProjectConfigWriteOptions, 'allowPartialProject'> = {},
): Promise<void> {
  await writeWorkflowProjectConfigSource(
    projectRoot,
    renderStructuredProjectConfig(document, language),
    options,
  );
}

export async function writeWorkflowProjectConfig(
  projectRoot: string,
  config: WorkflowProjectConfig,
  options: Omit<WorkflowProjectConfigWriteOptions, 'allowPartialProject'> = {},
): Promise<void> {
  const snapshot = await readWorkflowProjectConfigSnapshot(projectRoot, {
    allowPartialProject: true,
    allowMissingNativeFields: true,
  });
  const document = mergeWorkflowProjectConfigDocument(snapshot.document?.value ?? {}, config);
  const language =
    config.native?.language === 'zh-CN' || config.classic?.language === 'zh-CN' ? 'zh-CN' : 'en';
  await writeWorkflowProjectConfigDocument(projectRoot, document, language, {
    ...options,
    expectedIdentity: options.expectedIdentity ?? snapshot.identity,
  });
}
