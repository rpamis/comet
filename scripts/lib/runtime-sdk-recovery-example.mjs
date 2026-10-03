#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createFileRuntimeStore,
  createRuntime,
  createRuntimeExecutor,
  defineRuntimeHandler,
  tool,
} from '@rpamis/comet/runtime';

const index = process.argv.indexOf('--root-dir');
const rootDir = path.resolve(
  index < 0 ? '.comet/runtime-sdk-recovery-example' : process.argv[index + 1],
);
const receiptFile = path.join(rootDir, 'external-receipt.json');
const runId = 'recovery-example';
const workflow = {
  id: 'recovery-example',
  version: '1',
  entry: 'send',
  steps: { send: tool({ ref: 'example.send' }) },
};
const runtime = createRuntime({
  store: createFileRuntimeStore({ rootDir: path.join(rootDir, 'state') }),
  workflows: [workflow],
  executors: [
    createRuntimeExecutor({
      id: 'example-host',
      handlers: {
        'example.send': defineRuntimeHandler({
          type: 'call_tool',
          parseInput: ({ input }) => {
            if (typeof input?.message !== 'string') throw new Error('Expected a message');
            return input.message;
          },
          async execute(message, { action }) {
            // This local receipt stands in for an external system's queryable operation record.
            await fs.mkdir(rootDir, { recursive: true });
            await fs.writeFile(
              receiptFile,
              JSON.stringify({
                actionId: action.id,
                attempt: action.attempt,
                inputHash: action.inputHash,
                message,
              }),
              { flag: 'wx' },
            );
            throw new Error('Simulated disconnect after completing the external operation');
          },
        }),
      },
    }),
  ],
});
await runtime.start({
  runId,
  workflow: { id: workflow.id, version: workflow.version },
  input: { message: 'Send once' },
});

if (process.argv.includes('--reconcile')) {
  if (!process.argv.includes('--confirmed-stopped'))
    throw new Error('Confirm the former executor has stopped with --confirmed-stopped');
  const run = await runtime.inspect(runId);
  const action = run.actions.find((item) => item.status === 'unknown');
  if (action) {
    const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
    if (
      receipt.actionId !== action.id ||
      receipt.attempt !== action.attempt ||
      receipt.inputHash !== action.inputHash ||
      receipt.message !== run.input.message
    )
      throw new Error('The external receipt does not match this execution');
    // The operation happened: submit its observed result, never retry it as "not-executed".
    await runtime.recordOutcome({
      runId,
      outcome: {
        actionId: action.id,
        attempt: action.attempt,
        inputHash: action.inputHash,
        claimToken: action.claim.token,
        outcomeId: `reconciled:${action.id}:${action.attempt}`,
        status: 'succeeded',
        output: { message: receipt.message },
      },
    });
  }
}
const progress = await runtime.runUntilBlocked({ runId, executorId: 'example-host' });
const action = progress.run.actions[0];
console.log(
  JSON.stringify(
    { reason: progress.reason, runId, actionId: action.id, attempt: action.attempt },
    null,
    2,
  ),
);
