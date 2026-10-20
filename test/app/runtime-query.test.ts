import { test, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runtimeDispatchCommand } from '../../app/commands/runtime.js';
import {
  createRuntime,
  createFileRuntimeStore,
  type WorkflowRun,
} from '../../domains/engine/runtime.js';
test('CLI query reads persisted Run without evaluating workflow files and validates selectors', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-query-'));
  try {
    const runtime = createRuntime({
      store: createFileRuntimeStore<WorkflowRun>({ rootDir: path.join(root, 'store') }),
      workflows: [
        { id: 'q', version: '1', entry: 'a', steps: { a: { type: 'call_tool', ref: 'a' } } },
      ],
    });
    await runtime.start({ runId: 'q', workflow: { id: 'q', version: '1' }, input: null });
    const request = path.join(root, 'request.json');
    await fs.writeFile(
      request,
      JSON.stringify({ operation: 'query', runId: 'q', view: 'current' }),
    );
    const result = await runtimeDispatchCommand({
      request,
      rootDir: path.join(root, 'store'),
      workflow: [path.join(root, 'must-not-be-read.json')],
    });
    expect(result.exitCode, JSON.stringify(result.response)).toBe(0);
    expect(result.response.status === 'succeeded' && result.response.data.actions).toHaveLength(1);
    await fs.writeFile(
      request,
      JSON.stringify({ operation: 'query', runId: 'q', view: 'history', limit: 101 }),
    );
    expect(
      (await runtimeDispatchCommand({ request, rootDir: path.join(root, 'store') })).exitCode,
    ).toBe(64);
    await fs.writeFile(request, JSON.stringify({ operation: 'inspect-storage-index' }));
    expect((await runtimeDispatchCommand({ request, application: 'native' })).exitCode).toBe(64);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
