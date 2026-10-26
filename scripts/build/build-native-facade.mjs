#!/usr/bin/env node

import { build } from 'esbuild';
import ts from 'typescript';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveRepositoryPath } from '../lib/repository-layout.mjs';

// 聚合后仍让每个模块以其发布目录定位 worker、资源与动态插件。
// 使用语法树识别表达式，避免改写示例字符串、注释或模板内容。
export function relocateModuleUrls(
  source,
  sourcePath,
  outputPath,
  root = resolveRepositoryPath('.'),
) {
  const publishedPath = path
    .join(root, 'dist', path.relative(root, sourcePath))
    .replace(/\.tsx?$/, '.js');
  let relative = path.relative(path.dirname(outputPath), publishedPath).split(path.sep).join('/');
  if (!relative.startsWith('.')) relative = `./${relative}`;
  const replacement = `new URL(${JSON.stringify(relative)}, import.meta.url).href`;
  const tree = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'url' &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
    ) {
      edits.push([node.getStart(tree), node.end]);
    } else ts.forEachChild(node, visit);
  }
  visit(tree);
  for (const [start, end] of edits.reverse())
    source = source.slice(0, start) + replacement + source.slice(end);
  return source;
}

export async function buildNativeFacade(
  outputPath = resolveRepositoryPath('dist/app/commands/native.bundle.js'),
) {
  const root = resolveRepositoryPath('.');
  const version = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version;
  return build({
    absWorkingDir: root,
    tsconfig: path.join(root, 'tsconfig.json'),
    entryPoints: ['app/commands/native.ts'],
    outfile: outputPath,
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: ['node22'],
    minify: true,
    legalComments: 'none',
    define: { __COMET_VERSION__: JSON.stringify(version) },
    banner: {
      js: "import { createRequire as __cometCreateRequire } from 'node:module'; const require = __cometCreateRequire(import.meta.url);",
    },
    plugins: [
      {
        name: 'preserve-published-module-urls',
        setup(builder) {
          builder.onLoad({ filter: /\.tsx?$/ }, async ({ path: sourcePath }) => {
            if (sourcePath.includes(`${path.sep}node_modules${path.sep}`)) return;
            const source = await fs.readFile(sourcePath, 'utf8');
            if (!source.includes('import.meta')) return;
            return {
              contents: relocateModuleUrls(source, sourcePath, outputPath, root),
              loader: sourcePath.endsWith('.tsx') ? 'tsx' : 'ts',
            };
          });
        },
      },
    ],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildNativeFacade();
  for (const file of result.outputFiles) {
    await fs.mkdir(path.dirname(file.path), { recursive: true });
    await fs.writeFile(file.path, file.contents);
  }
}
