#!/usr/bin/env node

import { build } from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { readRepositoryLayout, resolveRepositoryPath } from '../lib/repository-layout.mjs';

const layout = readRepositoryLayout();
const repoRoot = resolveRepositoryPath('.');
const runtimeOutput = layout.classicRuntime.outputs.runtime;
const runtimeEntry = layout.classicRuntime.entries.runtime;

if (!runtimeOutput || !runtimeEntry) {
  throw new Error('Classic runtime requires entries.runtime and outputs.runtime');
}

const commandOutputs = Object.entries(layout.classicRuntime.outputs)
  .filter(([name]) => name !== 'runtime')
  .map(([name, output]) => ({
    name,
    command: name === 'hookGuard' ? 'hook-guard' : name,
    output,
    outputFile: resolveRepositoryPath(output),
  }));

async function bundledRuntime(entry) {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [entry],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: ['node20'],
    packages: 'bundle',
    sourcemap: false,
    legalComments: 'none',
    charset: 'utf8',
    treeShaking: true,
    banner: {
      js: [
        '#!/usr/bin/env node',
        "import { createRequire as __cometCreateRequire } from 'module';",
        'const require = __cometCreateRequire(import.meta.url);',
      ].join('\n'),
    },
  });

  if (result.outputFiles.length !== 1) {
    throw new Error(`Expected one Classic runtime output, got ${result.outputFiles.length}`);
  }
  return result.outputFiles[0].contents;
}

function launcher(command) {
  return Buffer.from(
    [
      '#!/usr/bin/env node',
      "import { main } from './comet-runtime.mjs';",
      `process.exitCode = await main([${JSON.stringify(command)}, ...process.argv.slice(2)]);`,
      '',
    ].join('\n'),
  );
}

async function checkFreshness(script, expected) {
  let actual;
  try {
    actual = await fs.readFile(script.outputFile);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Classic runtime script is missing: ${script.output}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (!actual.equals(expected)) {
    console.error(
      `Classic runtime script is stale: ${script.output}; run node scripts/build/build-classic-runtime.mjs`,
    );
    process.exitCode = 1;
  }
}

const outputs = [
  {
    script: {
      name: 'runtime',
      output: runtimeOutput,
      outputFile: resolveRepositoryPath(runtimeOutput),
    },
    output: Buffer.from(await bundledRuntime(runtimeEntry)),
  },
  ...commandOutputs.map((script) => ({
    script,
    output: launcher(script.command),
  })),
];

if (process.argv.includes('--check')) {
  for (const { script, output } of outputs) {
    await checkFreshness(script, output);
  }
} else {
  for (const { script, output } of outputs) {
    await fs.mkdir(path.dirname(script.outputFile), { recursive: true });
    await fs.writeFile(script.outputFile, output);
  }
}
