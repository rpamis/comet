#!/usr/bin/env node

import { build } from 'esbuild';
import { promises as fs } from 'fs';
import path from 'path';
import { readRepositoryLayout, resolveRepositoryPath } from '../lib/repository-layout.mjs';

const layout = readRepositoryLayout();
const repoRoot = resolveRepositoryPath('.');
const runtimeEntries = Object.entries(layout.entryRuntime?.entries ?? {});
const runtimeOutputs = layout.entryRuntime?.outputs ?? {};
if (runtimeEntries.length === 0) throw new Error('Entry runtime requires at least one entry');
for (const [name] of runtimeEntries) {
  if (!runtimeOutputs[name]) throw new Error(`Entry runtime output is missing for ${name}`);
}

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
    throw new Error(`Expected one entry resolver runtime output, got ${result.outputFiles.length}`);
  }
  return Buffer.from(result.outputFiles[0].contents);
}

for (const [name, entry] of runtimeEntries) {
  const runtimeOutput = runtimeOutputs[name];
  const outputFile = resolveRepositoryPath(runtimeOutput);
  const expected = await bundledRuntime(entry);

  if (process.argv.includes('--check')) {
    let actual;
    try {
      actual = await fs.readFile(outputFile);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error(`Entry runtime script is missing: ${runtimeOutput}`);
        process.exitCode = 1;
      } else {
        throw error;
      }
    }
    if (actual && !actual.equals(expected)) {
      console.error(
        `Entry runtime script is stale: ${runtimeOutput}; run node scripts/build/build-entry-runtime.mjs`,
      );
      process.exitCode = 1;
    }
  } else {
    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(outputFile, expected);
  }
}
