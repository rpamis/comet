/** Comet application assembly, including the default memory and knowledge plugins. */
export { CometPluginBridge, createDefaultCometPluginBridge } from './integration.js';
export type {
  CometPluginBridgeOptions,
  CometPluginContextContribution,
  CometPluginContextRequest,
} from './integration.js';
