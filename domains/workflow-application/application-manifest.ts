import path from 'node:path';
import { SDK_APPLICATIONS } from '../workflow-contract/change-runtime-owner.js';
import { validateWorkflowApplicationDefinitionPath } from './application-definition.js';
import { validateApplicationArtifactContracts } from './artifact-contract.js';
import { applicationError } from './skill-adapter.js';
import type { WorkflowApplicationManifest } from './types.js';

export function isWorkflowApplicationId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(id);
}

export function requireWorkflowApplicationId(id: string): string {
  if (!isWorkflowApplicationId(id)) applicationError('应用身份必须是小写名称');
  return id;
}

export function parseWorkflowApplicationManifest(value: unknown): WorkflowApplicationManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    applicationError('应用文件必须是 JSON 对象');
  const manifest = value as WorkflowApplicationManifest;
  if (manifest.artifactContracts !== undefined)
    validateApplicationArtifactContracts(manifest.artifactContracts);
  if (manifest.schema !== 'comet.workflow.application.v1')
    applicationError('应用格式不受支持，请重新生成 SDK 应用；原文件会保留');
  if (manifest.definition !== undefined)
    validateWorkflowApplicationDefinitionPath(manifest.definition);
  if (
    manifest.rule !== undefined &&
    (typeof manifest.rule !== 'string' ||
      !manifest.rule.endsWith('.md') ||
      path.isAbsolute(manifest.rule) ||
      manifest.rule.includes('\\') ||
      manifest.rule.includes(':') ||
      manifest.rule.split('/').some((part) => !part || part === '.' || part === '..'))
  )
    applicationError('应用规则 Rule 必须声明固定包内的 Markdown 相对路径');
  requireWorkflowApplicationId(manifest.id);
  if ((SDK_APPLICATIONS as readonly string[]).includes(manifest.id))
    applicationError(`应用身份 ${manifest.id} 与内置应用冲突，请使用独立名称`);
  if (
    !manifest.version?.trim() ||
    !['standalone', 'native', 'classic-full', 'classic-hotfix', 'classic-tweak'].includes(
      manifest.base,
    ) ||
    !manifest.runtimeVersion?.trim() ||
    !manifest.entrySkill?.trim() ||
    !manifest.module?.endsWith('.mjs') ||
    !Array.isArray(manifest.skills) ||
    !Array.isArray(manifest.bindings)
  )
    applicationError('应用定义缺少版本、基础流程、入口或绑定');
  return manifest;
}
