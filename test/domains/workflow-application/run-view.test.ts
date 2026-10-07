import { describe, expect, it } from 'vitest';
import { createRuntimeAction } from '../../../domains/engine/runtime-action.js';
import type { WorkflowRun } from '../../../domains/engine/runtime.js';
import { projectWorkflowApplicationRun } from '../../../domains/workflow-application/run-view.js';
import type { LoadedWorkflowApplication } from '../../../domains/workflow-application/types.js';

const application = {
  identity: { id: 'sample', projectRoot: '/project' },
  implementation: { workflows: [] },
} as unknown as LoadedWorkflowApplication;

function childRun(status: 'pending' | 'running' | 'unknown'): WorkflowRun {
  const action = createRuntimeAction({
    id: 'parent:1',
    runId: 'parent',
    stepId: 'child',
    type: 'child_workflow',
    ref: 'child',
    input: {},
    retry: 'reconcile',
  });
  action.status = status;
  return {
    protocolVersion: 1,
    schemaVersion: 1,
    runId: 'parent',
    revision: 2,
    workflow: { id: 'parent', version: '1', hash: 'fixed' },
    definitionHashes: {},
    input: {},
    status: 'running',
    sequence: 1,
    actions: [action],
    actionContexts: {},
    waits: [],
    evidenceWaits: [],
    ready: [],
    joins: {},
    outputs: {},
    children: [{ actionId: action.id, runId: 'child-run', status: 'running' }],
    lineage: [],
  } as WorkflowRun;
}

describe('application continuation state matrix', () => {
  it.each([
    ['pending', 'execute'],
    ['running', 'execute'],
    ['unknown', 'reconcile'],
  ] as const)('keeps runtime-managed child %s on the legal %s path', (status, mode) => {
    const run = childRun(status);
    const view = projectWorkflowApplicationRun(application, run);
    expect(view.continuation.mode).toBe(mode);
    expect(view.current.actions[0]).not.toHaveProperty('outcomeRequest');
    if (mode === 'execute') {
      expect(view.continuation.nextRequest).toEqual({
        operation: 'next',
        runId: 'parent',
        expectedRevision: 2,
      });
      expect(view.continuation.instruction).toContain('nextRequest');
      expect(view.current.children[0].inspection).toEqual({
        operation: 'inspect',
        runId: 'child-run',
      });
    } else {
      expect(view.continuation.nextRequest).toBeUndefined();
    }
  });

  it.each(['completed', 'cancelled', 'failed'] as const)(
    'never executes residual child work after %s',
    (status) => {
      const run = childRun('running');
      run.status = status;
      const view = projectWorkflowApplicationRun(application, run);
      expect(view.continuation.mode).toBe(status === 'failed' ? 'reconcile' : 'done');
      expect(view.continuation.nextRequest).toBeUndefined();
    },
  );
});
