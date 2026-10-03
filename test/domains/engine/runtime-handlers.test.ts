import { describe, expect, it } from 'vitest';
import * as sdk from '../../../domains/engine/runtime.js';
import type { RuntimeValue } from '../../../domains/engine/runtime.js';

function text(value: RuntimeValue): string {
  if (typeof value !== 'string') throw new Error('Expected a string');
  return value;
}

describe('typed Runtime handlers', () => {
  it('routes by ref and Action type and supplies decoded input and previous outputs', async () => {
    const executor = sdk.createRuntimeExecutor({
      id: 'host',
      handlers: {
        collect: sdk.defineRuntimeHandler({
          type: 'invoke_skill',
          parseInput: ({ input }) => text(input),
          execute: (topic, { context }) => ({
            status: 'succeeded',
            output: { topic, request: context?.requestId ?? '' },
          }),
        }),
        publish: sdk.defineRuntimeHandler({
          type: 'call_tool',
          parseInput: ({ outputs }) => {
            const result = outputs.collect;
            if (!result || typeof result !== 'object' || Array.isArray(result))
              throw new Error('Missing report');
            return text(result.topic);
          },
          execute: (topic, { action, run }) => ({
            status: 'succeeded',
            output: {
              published: topic,
              claimed: action.status === 'running',
              state: run?.state ?? null,
            },
          }),
        }),
      },
    });
    const workflow = {
      id: 'report',
      version: '1',
      entry: 'collect',
      initialState: { owner: 'host' },
      stateSchema: { type: 'object', properties: { owner: { type: 'string' } } },
      steps: { collect: sdk.skill({ ref: 'collect' }), publish: sdk.tool({ ref: 'publish' }) },
      transitions: [{ from: 'collect', to: 'publish' }],
    };
    const runtime = sdk.createRuntime({
      store: sdk.createMemoryRuntimeStore(),
      workflows: [workflow],
      executors: [executor],
    });
    await runtime.start({ runId: 'r', workflow, input: 'SDK usability' });
    const result = await runtime.runUntilBlocked({
      runId: 'r',
      executorId: 'host',
      context: { requestId: 'request' },
    });
    expect(result.reason).toBe('completed');
    expect(result.run.outputs.collect.value).toEqual({
      topic: 'SDK usability',
      request: 'request',
    });
    expect(result.run.outputs.publish.value).toEqual({
      published: 'SDK usability',
      claimed: true,
      state: { owner: 'host' },
    });
  });

  it('does not match another Action type with the same ref or inherit object properties', async () => {
    const executor = sdk.createRuntimeExecutor({
      id: 'host',
      handlers: {
        collect: sdk.defineRuntimeHandler({
          type: 'invoke_skill',
          parseInput: ({ input }) => input,
          execute: () => ({ status: 'succeeded', output: null }),
        }),
      },
    });
    for (const ref of ['collect', 'toString', '__proto__']) {
      const workflow = {
        id: 'wrong',
        version: '1',
        entry: 'one',
        steps: { one: sdk.tool({ ref }) },
      };
      const runtime = sdk.createRuntime({
        store: sdk.createMemoryRuntimeStore(),
        workflows: [workflow],
        executors: [executor],
      });
      await runtime.start({ runId: 'r', workflow, input: null });
      const result = await runtime.runUntilBlocked({ runId: 'r', executorId: 'host' });
      expect(result.reason).toBe('executor-required');
      expect(result.run.actions[0].status).toBe('pending');
    }
  });

  it('validates input before invoking a handler with external effects', async () => {
    let writes = 0;
    const executor = sdk.createRuntimeExecutor({
      id: 'host',
      handlers: {
        write: sdk.defineRuntimeHandler({
          type: 'call_tool',
          parseInput: ({ input }) => text(input),
          execute: () => {
            writes++;
            return { status: 'succeeded', output: null };
          },
        }),
      },
    });
    const workflow = {
      id: 'write',
      version: '1',
      entry: 'write',
      steps: { write: sdk.tool({ ref: 'write' }) },
    };
    const runtime = sdk.createRuntime({
      store: sdk.createMemoryRuntimeStore(),
      workflows: [workflow],
      executors: [executor],
    });
    await runtime.start({ runId: 'r', workflow, input: 42 });
    const result = await runtime.runUntilBlocked({ runId: 'r', executorId: 'host' });
    expect(result.reason).toBe('execution-unknown');
    expect(writes).toBe(0);
    expect(result.run.actions[0].reason).toContain('Expected a string');
  });

  it('preserves a handler failure result rather than classifying it as unknown', async () => {
    const executor = sdk.createRuntimeExecutor({
      id: 'host',
      handlers: {
        check: sdk.defineRuntimeHandler({
          type: 'call_tool',
          parseInput: ({ input }) => input,
          execute: () => ({ status: 'failed', output: { exitCode: 1 }, summary: 'Check failed' }),
        }),
      },
    });
    const workflow = {
      id: 'check',
      version: '1',
      entry: 'check',
      steps: { check: sdk.tool({ ref: 'check' }) },
    };
    const runtime = sdk.createRuntime({
      store: sdk.createMemoryRuntimeStore(),
      workflows: [workflow],
      executors: [executor],
    });
    await runtime.start({ runId: 'r', workflow, input: null });
    const result = await runtime.runUntilBlocked({ runId: 'r', executorId: 'host' });
    expect(result.reason).toBe('failed');
    expect(result.run.actions[0].outcome?.output).toEqual({ exitCode: 1 });
  });
});
