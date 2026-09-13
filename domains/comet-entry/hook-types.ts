/**
 * Compatibility type exports for Entry callers. The normalized Hook protocol
 * is defined by the platform adapter so workflow domains do not need to own
 * host payload details.
 */
export type {
  CometHookIntent,
  CometHookProcessOutput,
  CometHookRequest,
} from '../../platform/process/hook-adapter.js';
export type { CometHookDecision } from '../workflow-contract/hook.js';
