import path from 'path';

import { atomicWriteContainedText } from './contained-atomic-write.js';
import {
  mergeWorkflowProjectConfigDocument,
  parseWorkflowProjectConfigDocument,
  renderStructuredProjectConfig,
} from './project-config.js';
import {
  readWorkflowProjectConfigIdentity,
  readWorkflowProjectConfigSnapshot,
  workflowProjectConfigIdentityEquals,
  WORKFLOW_PROJECT_CONFIG_PATH,
  type WorkflowProjectConfigIdentity,
} from './project-config-reader.js';
import { inspectProtectedProjectPath } from './protected-project-path.js';
import type { ProjectConfigLanguage, WorkflowProjectConfig } from './types.js';

export interface WorkflowProjectConfigWriteOptions {
  allowPartialProject?: boolean;
  expectedIdentity?: WorkflowProjectConfigIdentity;
  beforeCommit?: () => void | Promise<void>;
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
  await assertWorkflowProjectConfigIdentity(root, options.expectedIdentity);
  const finalInspection = await inspectProtectedProjectPath(root, WORKFLOW_PROJECT_CONFIG_PATH, {
    label: WORKFLOW_PROJECT_CONFIG_PATH,
    expected: 'file',
  });
  await atomicWriteContainedText(finalInspection.target, output, {
    containedRoot: root,
    beforeCommit: async () => {
      await options.beforeCommit?.();
      await assertWorkflowProjectConfigIdentity(root, options.expectedIdentity);
      await inspectProtectedProjectPath(root, WORKFLOW_PROJECT_CONFIG_PATH, {
        label: WORKFLOW_PROJECT_CONFIG_PATH,
        expected: 'file',
      });
    },
  });
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
  });
  const document = mergeWorkflowProjectConfigDocument(snapshot.document?.value ?? {}, config);
  const language =
    config.native?.language === 'zh-CN' || config.classic?.language === 'zh-CN' ? 'zh-CN' : 'en';
  await writeWorkflowProjectConfigDocument(projectRoot, document, language, {
    ...options,
    expectedIdentity: options.expectedIdentity ?? snapshot.identity,
  });
}
