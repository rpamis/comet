#!/usr/bin/env node

import { runSemanticMemoryEval } from '../../dist/domains/eval/semantic-memory-eval.js';

const report = await runSemanticMemoryEval();
const markdown = process.argv.includes('--markdown');

if (markdown) {
  process.stdout.write(`${report.markdown}\n`);
} else {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
