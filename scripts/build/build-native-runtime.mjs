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

async function bundledRuntime() {
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [runtimeEntry],
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
    throw new Error(`Expected one Native runtime output, got ${result.outputFiles.length}`);
  }
  return Buffer.from(result.outputFiles[0].contents);
}

const outputFile = resolveRepositoryPath(runtimeOutput);
const expected = await bundledRuntime();

if (process.argv.includes('--check')) {
  let actual;
  try {
    actual = await fs.readFile(outputFile);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Native runtime script is missing: ${runtimeOutput}`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
  if (actual && !actual.equals(expected)) {
    console.error(
      `Native runtime script is stale: ${runtimeOutput}; run node scripts/build/build-native-runtime.mjs`,
    );
    process.exitCode = 1;
  }
} else {
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, expected);
}
