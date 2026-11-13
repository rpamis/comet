import { continueNativeTransitionLocked } from './native-transition-journal.js';
import type { NativeProjectPaths } from './native-types.js';

/** 完成原业务转换 WAL；不恢复旧 progress 内容快照或其摘要清单。 */
export async function settleNativeChangeJournalsLocked(
  paths: NativeProjectPaths,
  name: string,
): Promise<void> {
  await continueNativeTransitionLocked(paths, name);
}
