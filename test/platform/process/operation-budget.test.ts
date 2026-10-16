import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import {
  withOperationBudget,
  operationSignal,
  throwIfOperationAborted,
} from '../../../platform/process/operation-budget.js';
import { runBoundedHttpRequest } from '../../../platform/http/bounded-request.js';

test('cancels real HTTP work with a shared budget and prevents later requests in that operation', async () => {
  const sockets = new Set<import('node:net').Socket>();
  let requests = 0;
  const server = createServer((request) => {
    requests++;
    sockets.add(request.socket);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const started = performance.now();
    await withOperationBudget({ timeoutMs: 150 }, async () => {
      await expect(
        runBoundedHttpRequest({
          url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
          init: { method: 'GET' },
          timeoutMs: 120000,
          maxResponseBytes: 100,
        }),
      ).rejects.toMatchObject({ code: 'timeout' });
      expect(operationSignal()?.aborted).toBe(true);
      expect(() => throwIfOperationAborted()).toThrow('budget');
    });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(requests).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect([...sockets].every((socket) => socket.destroyed)).toBe(true);
    expect(operationSignal()).toBeUndefined();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
