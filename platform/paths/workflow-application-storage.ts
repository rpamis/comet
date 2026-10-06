import os from 'node:os';
import path from 'node:path';

/** 用户应用与项目应用使用相同的存储布局；测试传入隔离 home。 */
export function workflowApplicationStorageRoot(
  projectRoot: string,
  scope: 'project' | 'user',
  userRoot = os.homedir(),
): string {
  return path.join(scope === 'project' ? projectRoot : userRoot, '.comet/applications');
}
