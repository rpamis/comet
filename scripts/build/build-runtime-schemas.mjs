#!/usr/bin/env node

import { build } from 'esbuild';
import { Ajv } from 'ajv';
import { format, resolveConfig } from 'prettier';
import standaloneCode from 'ajv/dist/standalone/index.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRepositoryPath } from '../lib/repository-layout.mjs';

// 从领域公开工厂取得 schema；不复制定义，也不以 $id 作为可信身份。
export async function collectBuiltinRuntimeSchemas() {
  const result = await build({
    absWorkingDir: resolveRepositoryPath('.'),
    stdin: {
      contents: `export { defineClassicWorkflowApplication } from './domains/comet-classic/classic-sdk-application.ts';
export { canonicalRuntimeJson } from './domains/engine/runtime-json.ts';`,
      resolveDir: resolveRepositoryPath('.'),
      sourcefile: 'runtime-schema-build-entry.ts',
      loader: 'ts',
    },
    plugins: [
      {
        name: 'schema-bootstrap',
        setup(build) {
          build.onLoad({ filter: /runtime-schema\.generated\.ts$/ }, () => ({
            contents: 'export const precompiledRuntimeSchemas = new Map();',
            loader: 'ts',
          }));
        },
      },
    ],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    banner: {
      js: `import { createRequire as __schemaRequire } from 'node:module'; const require = __schemaRequire(${JSON.stringify(pathToFileURL(resolveRepositoryPath('package.json')).href)});`,
    },
  });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-schema-build-'));
  let module;
  try {
    const entry = path.join(temporary, 'schemas.mjs');
    await fs.writeFile(entry, result.outputFiles[0].contents);
    module = await import(pathToFileURL(entry).href);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
  const { defineClassicWorkflowApplication, canonicalRuntimeJson } = module;
  const schemas = new Set();
  for (const profile of ['full', 'hotfix', 'tweak']) {
    const { workflow } = defineClassicWorkflowApplication(profile);
    if (workflow.stateSchema !== undefined) schemas.add(canonicalRuntimeJson(workflow.stateSchema));
    for (const step of Object.values(workflow.steps)) {
      if (step.outputSchema !== undefined) schemas.add(canonicalRuntimeJson(step.outputSchema));
    }
  }
  return [...schemas].sort();
}

export async function generateRuntimeSchemas() {
  const schemas = await collectBuiltinRuntimeSchemas();
  const helpers = new Map();
  const declarations = schemas.map((content, index) => {
    // 每个 schema 都使用独立 AJV，保持运行时外部引用隔离契约。
    const ajv = new Ajv({ strict: true, allErrors: true, code: { source: true } });
    const validate = ajv.compile(JSON.parse(content));
    const code = standaloneCode(ajv, validate).replace(
      /require\("([^"]+)"\)\.default/g,
      (_, specifier) => {
        if (!helpers.has(specifier)) helpers.set(specifier, `__helper${helpers.size}`);
        const helper = helpers.get(specifier);
        return `(${helper}.default ?? ${helper})`;
      },
    );
    if (/\brequire\s*\(/.test(code))
      throw new Error(
        'Unsupported AJV standalone dependency; add an ESM helper mapping before publishing',
      );
    return `const validator${index} = (() => { const module = { exports: {} };\n${code}\nreturn module.exports; })();`;
  });
  return format(
    `/* eslint-disable */\n// @ts-nocheck\n// 由 scripts/build/build-runtime-schemas.mjs 生成；请勿手动编辑。\n${[...helpers].map(([specifier, name]) => `import ${name} from '${specifier}.js';`).join('\n')}\n${declarations.join('\n')}\nexport const precompiledRuntimeSchemas = new Map([\n${schemas.map((content, index) => `[${JSON.stringify(content)}, validator${index}]`).join(',\n')}\n]);\n`,
    { ...(await resolveConfig(resolveRepositoryPath('package.json'))), parser: 'typescript' },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const output = resolveRepositoryPath('domains/engine/runtime-schema.generated.ts');
  const expected = await generateRuntimeSchemas();
  if (process.argv.includes('--check')) {
    const actual = await fs.readFile(output, 'utf8').catch(() => '');
    if (actual !== expected)
      throw new Error(
        'Runtime schema validators are stale; run node scripts/build/build-runtime-schemas.mjs',
      );
  } else {
    await fs.writeFile(output, expected);
  }
}
