/**
 * Compatibility exports for callers that historically imported selection from
 * the Entry domain. The selection document is a cross-workflow contract and
 * its implementation lives in workflow-contract.
 */
export * from '../workflow-contract/current-selection.js';
