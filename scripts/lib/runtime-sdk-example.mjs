#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  createFileRuntimeStore,
  createRuntime,
  createRuntimeExecutor,
  defineRuntimeHandler,
  skill,
  tool,
  approval,
} from '@rpamis/comet/runtime';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

const rootDir = path.resolve(option('--root-dir', '.comet/runtime-sdk-example'));
const topic = option('--topic', 'skill harness design');
const runId = option('--run-id', 'runtime-sdk-example');
const approve = process.argv.includes('--approve');

const workflow = {
  id: 'report',
  version: '1',
  entry: 'collect',
  steps: {
    collect: skill({ ref: 'research.collect' }),
    approve: approval({ proposalFrom: 'collect' }),
    publish: tool({ ref: 'reports.write' }),
  },
  transitions: [
    { from: 'collect', to: 'approve' },
    { from: 'approve', to: 'publish', on: 'approved' },
  ],
};

const runtime = createRuntime({
  store: createFileRuntimeStore({ rootDir: path.join(rootDir, 'state') }),
  workflows: [workflow],
  executors: [
    createRuntimeExecutor({
      id: 'example-host',
      handlers: {
        'research.collect': defineRuntimeHandler({
          type: 'invoke_skill',
          parseInput: ({ input }) => {
            if (typeof input?.topic !== 'string') throw new Error('Expected a topic');
            return input.topic;
          },
          execute: (topic) => ({
            status: 'succeeded',
            output: {
              title: `Report: ${topic}`,
              body: `This local example collected a report for “${topic}”.`,
            },
          }),
        }),
        'reports.write': defineRuntimeHandler({
          type: 'call_tool',
          parseInput: ({ outputs }) => {
            if (outputs.approve?.choice !== 'approved')
              throw new Error('Explicit approval required');
            const report = outputs.collect;
            if (typeof report?.title !== 'string' || typeof report?.body !== 'string')
              throw new Error('Expected a report');
            return { title: report.title, body: report.body };
          },
          async execute(report) {
            const file = path.join(rootDir, 'published', 'report.md');
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, `# ${report.title}\n\n${report.body}\n`);
            return { status: 'succeeded', output: { path: file } };
          },
        }),
      },
    }),
  ],
});

await runtime.start({
  runId,
  workflow: { id: workflow.id, version: workflow.version },
  input: { topic },
});

let progress = await runtime.runUntilBlocked({ runId, executorId: 'example-host' });
if (progress.reason === 'approval-required' && approve) {
  const wait = progress.run.waits.find((candidate) => candidate.status === 'pending');
  await runtime.resolveWait({
    runId,
    waitId: wait.id,
    proposalHash: wait.proposalHash,
    decisionId: `approve-${wait.id}`,
    choice: 'approved',
  });
  progress = await runtime.runUntilBlocked({ runId, executorId: 'example-host' });
}
console.log(
  JSON.stringify(
    {
      status: progress.run.status,
      reason: progress.reason,
      runId,
      wait: progress.run.waits.find((candidate) => candidate.status === 'pending'),
      outputs: progress.run.outputs,
    },
    null,
    2,
  ),
);
if (!['completed', 'approval-required'].includes(progress.reason)) process.exitCode = 1;
