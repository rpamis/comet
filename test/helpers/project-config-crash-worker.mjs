import { build } from 'esbuild';
import path from 'node:path';

const projectRoot = process.argv[2];
if (!projectRoot) process.exit(64);

const entry = [
  "import { writeWorkflowProjectConfig } from './domains/workflow-contract/project-config-writer.ts';",
  "import { defaultWorkflowProjectConfig } from './domains/workflow-contract/project-config.ts';",
  `await writeWorkflowProjectConfig(${JSON.stringify(projectRoot)}, defaultWorkflowProjectConfig('crash-output'), {`,
  '  beforePublish: () => process.exit(73),',
  '});',
].join('\n');

const result = await build({
  stdin: {
    contents: entry,
    resolveDir: process.cwd(),
    sourcefile: 'test/helpers/project-config-crash-worker-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  banner: {
    js: [
      "import { createRequire as __cometCreateRequire } from 'module';",
      `const require = __cometCreateRequire(${JSON.stringify(
        path.join(process.cwd(), 'test/helpers/project-config-crash-worker.mjs'),
      )});`,
    ].join('\n'),
  },
});

const [output] = result.outputFiles;
if (!output) throw new Error('Unable to bundle project config crash worker');
await import(`data:text/javascript;base64,${Buffer.from(output.contents).toString('base64')}`);
