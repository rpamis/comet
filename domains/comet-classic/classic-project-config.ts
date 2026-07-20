import os from 'os';
import { promises as fs } from 'fs';
import path from 'path';
import { parseDocument } from 'yaml';
import { fileExists } from '../../platform/fs/file-system.js';

type ClassicConfigValue = {
  value: string;
  source: string;
};

type ClassicConfigOptions = {
  cwd?: string;
  homeDir?: string;
};

function configCandidates(options: ClassicConfigOptions = {}): Array<{
  file: string;
  source: string;
}> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const candidates = [
    { file: path.resolve(cwd, '.comet', 'config.yaml'), source: '.comet/config.yaml' },
    {
      file: path.resolve(homeDir, '.comet', 'config.yaml'),
      source: '~/.comet/config.yaml',
    },
  ];

  return candidates.filter(
    (candidate, index) => candidates.findIndex((entry) => entry.file === candidate.file) === index,
  );
}

async function readClassicConfigValue(
  field: string,
  options: ClassicConfigOptions = {},
): Promise<ClassicConfigValue | null> {
  for (const candidate of configCandidates(options)) {
    if (!(await fileExists(candidate.file))) continue;
    // Classic 配置收纳在 `classic:` 嵌套块下（comet.project.v1）。这里只从该块读取，
    // 不回退旧的顶层平铺格式——旧 config.yaml 由 `comet init`/`update` 迁移。
    // parseDocument 对文件他处的语法错误容错（仍能构建可用树），因此别处损坏字段
    // 不会阻断本次读取；被读字段本身的类型/枚举校验由下游各自的处理函数
    // （validateLanguage、contextCompression 等）以规范错误报出，而非在此抛原始异常。
    const document = parseDocument(await fs.readFile(candidate.file, 'utf8'), {
      uniqueKeys: false,
    });
    const root = document.toJS();
    if (!root || typeof root !== 'object' || Array.isArray(root)) continue;
    const classic = (root as Record<string, unknown>).classic;
    if (!classic || typeof classic !== 'object' || Array.isArray(classic)) continue;
    const value = (classic as Record<string, unknown>)[field];
    if (value === null || value === undefined) continue;
    return { value: String(value), source: candidate.source };
  }
  return null;
}

export { configCandidates, readClassicConfigValue };
export type { ClassicConfigOptions, ClassicConfigValue };
