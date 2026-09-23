#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createFileRuntimeStore, createRuntime } from '@rpamis/comet/runtime';

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
    collect: { type: 'invoke_skill', ref: 'research.collect' },
    approve: { type: 'ask_user', proposalFrom: 'collect' },
    publish: { type: 'call_tool', ref: 'reports.write' },
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
    {
      id: 'example-host',
      capabilities: [],
      supports: (action) => ['invoke_skill', 'call_tool'].includes(action.type),
      async execute(action) {
        const request = action.input.input;
        const outputs = action.input.outputs;
        if (action.ref === 'research.collect') {
          return {
            status: 'succeeded',
            output: {
              title: `Report: ${request.topic}`,
              body: `This local example collected a report for “${request.topic}”.`,
            },
          };
        }
        if (action.ref === 'reports.write') {
          if (outputs.approve?.choice !== 'approved') {
            throw new Error('The report cannot be written before explicit approval');
          }
          const report = outputs.collect;
          const file = path.join(rootDir, 'published', 'report.md');
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(file, `# ${report.title}\n\n${report.body}\n`);
          return { status: 'succeeded', output: { path: file } };
        }
        throw new Error(`Unsupported example action: ${action.ref}`);
      },
    },
  ],
});

let run = await runtime.start({
  runId,
  workflow: { id: workflow.id, version: workflow.version },
  input: { topic },
});

while (true) {
  const action = run.actions.find((candidate) => candidate.status === 'pending');
  if (action) {
    run = await runtime.execute({ runId, actionId: action.id, executorId: 'example-host' });
    continue;
  }

  const wait = run.waits.find((candidate) => candidate.status === 'pending');
  if (wait) {
    if (!approve) {
      console.log(JSON.stringify({ status: 'waiting', runId, wait }, null, 2));
      break;
    }
    run = await runtime.resolveWait({
      runId,
      waitId: wait.id,
      proposalHash: wait.proposalHash,
      decisionId: `approve-${wait.id}`,
      choice: 'approved',
    });
    continue;
  }

  console.log(JSON.stringify({ status: run.status, runId, outputs: run.outputs }, null, 2));
  if (run.status === 'failed' || run.status === 'cancelled') process.exitCode = 1;
  break;
}
