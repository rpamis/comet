import path from 'node:path';
import { readWorkflowProjectConfigDocument } from '../workflow-contract/project-config-reader.js';
export async function classicForeignChangeRoots(root: string): Promise<string[]> {
  const config = await readWorkflowProjectConfigDocument(root, {
    allowPartialProject: true,
    allowMissingNativeFields: true,
  });
  // 检查可以依赖其他 change 的草稿，但检查覆盖不代表获准交付这些草稿。
  return config?.native ? [path.posix.join(config.native.artifact_root, 'comet', 'changes')] : [];
}
export function isClassicInputUnderRoot(ref: string, roots: string[]) {
  return roots.some((root) => ref === root || ref.startsWith(`${root}/`));
}
