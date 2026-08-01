import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
import { discoverNativeProject } from '../comet-native/native-paths.js';
import { readWorkflowProjectConfig } from '../workflow-contract/project-config-reader.js';

/**
 * Shared memoized project-rooted reads for the entry layer.
 *
 * Both the Hook path (`runWithHookReadCache` activated by the hook-router
 * entry) and the resume-probe path (`runWithHookReadCache` activated by the
 * resume-probe entry) consult these wrappers. When no cache scope is active
 * (CLI commands that bypass the entry point), they degrade to the raw reads.
 *
 * `discoverNativeProject` walks the directory tree upward with an lstat per
 * level; `readWorkflowProjectConfig` opens, parses, and hashes
 * `.comet/config.yaml`. Within a single decision both are immutable, so
 * memoizing them removes the 2-3x repeat reads the entry resolution used to
 * perform.
 */
export const readCachedProjectConfig = memoizedHookRead(
  'readWorkflowProjectConfig',
  (projectRoot: string) => readWorkflowProjectConfig(projectRoot),
);

export const discoverCachedNativeProject = memoizedHookRead(
  'discoverNativeProject',
  (startPath: string) => discoverNativeProject(startPath),
);
