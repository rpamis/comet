#!/usr/bin/env node

import { build } from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { readRepositoryLayout, resolveRepositoryPath } from '../lib/repository-layout.mjs';

const layout = readRepositoryLayout();
const repoRoot = resolveRepositoryPath('.');
const runtimeEntry = layout.nativeRuntime?.entries?.runtime;
const runtimeOutput = layout.nativeRuntime?.outputs?.runtime;

if (!runtimeEntry || !runtimeOutput) {
  throw new Error('Native runtime requires entries.runtime and outputs.runtime');
}

const commandEntries = Object.entries(layout.nativeRuntime.entries).filter(
  ([name]) => name !== 'runtime',
);
const commandOutputByName = new Map(
  Object.entries(layout.nativeRuntime.outputs).filter(([name]) => name !== 'runtime'),
);

const banner = {
  js: [
    '#!/usr/bin/env node',
    "import { createRequire as __cometCreateRequire } from 'module';",
    'const require = __cometCreateRequire(import.meta.url);',
  ].join('\n'),
};

const esbuildOptions = {
  absWorkingDir: repoRoot,
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
  minify: true,
  banner,
};

async function bundledRuntime(entry) {
  const result = await build({ ...esbuildOptions, entryPoints: [entry] });
  if (result.outputFiles.length !== 1) {
    throw new Error(`Expected one Native runtime output, got ${result.outputFiles.length}`);
  }
  return result.outputFiles[0].contents;
}

async function checkFreshness(outputRelative, outputFile, expected) {
  let actual;
  try {
    actual = await fs.readFile(outputFile);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Native runtime script is missing: ${outputRelative}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  if (!actual.equals(expected)) {
    console.error(
      `Native runtime script is stale: ${outputRelative}; run node scripts/build/build-native-runtime.mjs`,
    );
    process.exitCode = 1;
  }
}

// Build outputs: the shared runtime (for the in-process CLI facade) plus one
// self-contained bundle per command entry. Each per-command output replaces
// the former thin launcher, so running e.g. `comet-native-hook-guard.mjs` only
// loads the hook-guard command's dependency graph instead of the whole Native
// domain.
const outputs = [
  {
    outputRelative: runtimeOutput,
    outputFile: resolveRepositoryPath(runtimeOutput),
    output: Buffer.from(await bundledRuntime(runtimeEntry)),
  },
];

for (const [name, entry] of commandEntries) {
  const outputRelative = commandOutputByName.get(name);
  if (!outputRelative) {
    throw new Error(`Native runtime entry '${name}' has no matching output`);
  }
  outputs.push({
    outputRelative,
    outputFile: resolveRepositoryPath(outputRelative),
    output: Buffer.from(await bundledRuntime(entry)),
  });
}

if (process.argv.includes('--check')) {
  for (const { outputRelative, outputFile, output } of outputs) {
    await checkFreshness(outputRelative, outputFile, output);
  }
} else {
  for (const { outputFile, output } of outputs) {
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, output);
  }
}
