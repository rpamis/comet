import { build } from 'esbuild';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readRepositoryLayout, resolveRepositoryPath } from './repository-layout.mjs';
import { writeFileWithTransientRetry } from './transient-file-write.mjs';

/** Use the same build options for each self-contained command and its freshness check. */
export async function buildRuntimeBundles(runtime, { label, script, plugins = () => [] }) {
  const { entries, outputs } = readRepositoryLayout()[runtime] ?? {};
  if (!entries?.runtime || !outputs?.runtime) {
    throw new Error(`${label} runtime requires entries.runtime and outputs.runtime`);
  }
  for (const name of Object.keys(entries)) {
    if (!outputs[name]) throw new Error(`${label} runtime output is missing for ${name}`);
  }
  const repoRoot = resolveRepositoryPath('.');
  const { version } = JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  for (const [name, entry] of Object.entries(entries)) {
    const result = await build({
      absWorkingDir: repoRoot,
      tsconfig: path.join(repoRoot, 'tsconfig.json'),
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      target: ['node20'],
      packages: 'bundle',
      preserveSymlinks: false,
      sourcemap: false,
      legalComments: 'none',
      charset: 'utf8',
      treeShaking: true,
      minify: true,
      define: { __COMET_VERSION__: JSON.stringify(version) },
      plugins: plugins(name),
      banner: {
        js: [
          '#!/usr/bin/env node',
          "import { createRequire as __cometCreateRequire } from 'module';",
          'const require = __cometCreateRequire(import.meta.url);',
        ].join('\n'),
      },
    });
    if (result.outputFiles.length !== 1) {
      throw new Error(`Expected one ${label} runtime output, got ${result.outputFiles.length}`);
    }
    const expected = Buffer.from(result.outputFiles[0].contents);
    const output = outputs[name];
    const outputFile = resolveRepositoryPath(output);
    if (process.argv.includes('--check')) {
      let actual;
      try {
        actual = await fs.readFile(outputFile);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        console.error(`${label} runtime script is missing: ${output}`);
        process.exitCode = 1;
        continue;
      }
      if (!actual.equals(expected)) {
        console.error(`${label} runtime script is stale: ${output}; run node ${script}`);
        process.exitCode = 1;
      }
    } else {
      await fs.mkdir(path.dirname(outputFile), { recursive: true });
      await writeFileWithTransientRetry(outputFile, expected);
    }
  }
}
