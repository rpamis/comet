#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Extractor, ExtractorConfig } from '@microsoft/api-extractor';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arguments_ = process.argv.slice(2);
const rootIndex = arguments_.indexOf('--project-root');
const projectRoot = rootIndex < 0 ? repositoryRoot : path.resolve(arguments_[rootIndex + 1]);
const update = arguments_.includes('--update');
const entrypoints = [
  './runtime',
  './applications',
  './applications/native',
  './applications/classic',
  './plugins',
  './plugins/comet',
];

async function main() {
  const packageJsonPath = path.join(projectRoot, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-sdk-api-report-'));
  const reportFolder = path.join(projectRoot, 'config/sdk-api');
  try {
    if (update) await fs.mkdir(reportFolder, { recursive: true });
    let succeeded = true;
    for (const entrypoint of entrypoints) {
      const declaration = packageJson.exports?.[entrypoint]?.types;
      if (typeof declaration !== 'string' || !declaration.endsWith('.d.ts')) {
        throw new Error(`SDK 类型声明缺失：${entrypoint}；请先执行 pnpm build`);
      }
      const declarationPath = path.resolve(projectRoot, declaration);
      try {
        await fs.access(declarationPath);
      } catch {
        throw new Error(`SDK 类型声明缺失：${declarationPath}；请先执行 pnpm build`);
      }
      const reportName = entrypoint.slice(2).replaceAll('/', '-');
      const config = ExtractorConfig.prepare({
        configObject: {
          projectFolder: projectRoot,
          mainEntryPointFilePath: declarationPath,
          compiler: {
            overrideTsconfig: {
              compilerOptions: {
                target: 'ES2022',
                module: 'NodeNext',
                moduleResolution: 'NodeNext',
                strict: true,
                skipLibCheck: false,
              },
              files: [declarationPath],
            },
          },
          apiReport: {
            enabled: true,
            reportFileName: `${reportName}.api.md`,
            reportFolder,
            reportTempFolder: temporaryRoot,
          },
          docModel: { enabled: false },
          dtsRollup: { enabled: false },
          tsdocMetadata: { enabled: false },
          messages: {
            compilerMessageReporting: { default: { logLevel: 'error' } },
            extractorMessageReporting: {
              default: { logLevel: 'warning' },
              'ae-missing-release-tag': { logLevel: 'none' },
              'ae-forgotten-export': { logLevel: 'none' },
              'ae-undocumented': { logLevel: 'none' },
            },
            tsdocMessageReporting: { default: { logLevel: 'none' } },
          },
        },
        configObjectFullPath: path.join(projectRoot, 'config/sdk-api/api-extractor.json'),
        packageJsonFullPath: packageJsonPath,
      });
      const result = Extractor.invoke(config, {
        localBuild: update,
        typescriptCompilerFolder: path.join(repositoryRoot, 'node_modules/typescript'),
        showVerboseMessages: false,
      });
      succeeded &&= result.succeeded;
      console.log(
        `SDK ${entrypoint}：${result.succeeded ? (update ? '报告已更新' : '与已接受的报告一致') : '报告检查失败'}`,
      );
    }
    if (!succeeded) process.exitCode = 1;
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
