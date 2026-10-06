import { Ajv } from 'ajv';
import { describe, expect, it, vi } from 'vitest';
import { compileRuntimeSchema } from '../../../domains/engine/runtime-schema.js';
import { createRuntime } from '../../../domains/engine/runtime-service.js';
import { createMemoryRuntimeStore } from '../../../domains/engine/runtime-store.js';
import {
  defineWorkflow,
  type DefineWorkflowOptions,
} from '../../../domains/engine/workflow-definition.js';
import type { WorkflowRun } from '../../../domains/engine/workflow-run.js';

describe('content-bound Runtime schema compilation', () => {
  it('compiles identical state and output schemas once across fresh runtimes', async () => {
    const schema = {
      $id: 'https://example.invalid/runtime-compilation-budget',
      type: 'object',
      properties: { answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    };
    const definition: DefineWorkflowOptions = {
      id: 'schema-budget',
      version: '1',
      entry: 'answer',
      initialState: { answer: 'ready' },
      stateSchema: schema,
      steps: { answer: { type: 'call_tool', ref: 'answer', outputSchema: schema } },
    };
    const compile = vi.spyOn(Ajv.prototype, 'compile');
    try {
      for (let index = 0; index < 20; index += 1) {
        const runtime = createRuntime({
          store: createMemoryRuntimeStore<WorkflowRun>(),
          workflows: [structuredClone(definition)],
        });
        const run = await runtime.start({
          runId: `schema-budget-${index}`,
          workflow: definition,
          input: null,
        });
        const action = run.actions[0];
        await runtime.claim({
          runId: run.runId,
          actionId: action.id,
          attempt: action.attempt,
          inputHash: action.inputHash,
          executorId: 'host',
          claimToken: 'claim',
        });
        const completed = await runtime.recordOutcome({
          runId: run.runId,
          outcome: {
            actionId: action.id,
            attempt: action.attempt,
            inputHash: action.inputHash,
            claimToken: 'claim',
            outcomeId: 'answer',
            status: 'succeeded',
            output: { answer: 'done' },
          },
        });
        expect(completed.status).toBe('completed');
        expect(await runtime.inspect(run.runId)).toEqual(completed);
      }
      expect(compile).toHaveBeenCalledTimes(1);
    } finally {
      compile.mockRestore();
    }
  });

  it('revalidates changed content under the same workflow version, schema id and object', async () => {
    const schema = {
      $id: 'https://example.invalid/runtime-schema-changes',
      type: 'string',
    };
    const definition: DefineWorkflowOptions = {
      id: 'schema-changes',
      version: '1',
      entry: 'answer',
      initialState: 'ready',
      stateSchema: schema,
      steps: { answer: { type: 'call_tool', ref: 'answer', outputSchema: schema } },
    };
    const store = createMemoryRuntimeStore<WorkflowRun>();
    const original = createRuntime({ store, workflows: [definition] });
    await original.start({ runId: 'original', workflow: definition, input: null });
    schema.type = 'number';
    const changed = createRuntime({ store, workflows: [definition] });
    await expect(changed.inspect('original')).rejects.toThrow(/WORKFLOW_CHANGED/u);
    await expect(
      changed.start({ runId: 'changed', workflow: definition, input: null }),
    ).rejects.toThrow(/INITIAL_STATE_INVALID/u);
    // 已注册的 Runtime 只持有定义副本，不受调用方之后的修改影响。
    expect((await original.inspect('original')).state).toBe('ready');
    schema.type = 'unsupported-type';
    expect(() => createRuntime({ store, workflows: [definition] })).toThrow(/INVALID_WORKFLOW/u);
    schema.type = 'string';
    Object.assign(schema, { unsupportedKeyword: true });
    expect(() => defineWorkflow(definition)).toThrow(/INVALID_WORKFLOW/u);
  });

  it('does not let a cached schema satisfy another schema external reference', () => {
    const id = 'https://example.invalid/isolated-runtime-schema';
    compileRuntimeSchema({ $id: id, type: 'string' });
    expect(() => compileRuntimeSchema({ $ref: id })).toThrow();
  });

  it('uses canonical content rather than insertion order and isolates caller mutations', () => {
    const schema = { type: 'string', minLength: 3, $comment: 'canonical-cache-key' };
    const first = compileRuntimeSchema(schema);
    expect(
      compileRuntimeSchema({ $comment: 'canonical-cache-key', minLength: 3, type: 'string' }),
    ).toBe(first);
    schema.minLength = 8;
    const changed = compileRuntimeSchema(schema);
    expect(changed).not.toBe(first);
    expect(first.validate('short')).toBe(true);
    expect(changed.validate('short')).toBe(false);
  });

  it('evicts old compiled schemas instead of growing without bound', () => {
    const schema = { type: 'string', $comment: 'eviction-first' };
    const first = compileRuntimeSchema(schema);
    let newest = first;
    for (let index = 0; index < 128; index += 1) {
      newest = compileRuntimeSchema({ type: 'string', $comment: `eviction-${index}` });
    }
    expect(compileRuntimeSchema({ type: 'string', $comment: 'eviction-127' })).toBe(newest);
    expect(compileRuntimeSchema(schema)).not.toBe(first);
  });
});
