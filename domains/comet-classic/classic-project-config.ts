import os from 'os';
import path from 'path';
import { readWorkflowProjectConfigDocument } from '../workflow-contract/project-config-reader.js';

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
    // 合法文档中的缺字段继续回退默认值或下一个候选；语法损坏、重复键和
    // 已出现的托管字段非法则由共享 project-config seam 统一失败关闭。
    const document = await readWorkflowProjectConfigDocument(
      path.dirname(path.dirname(candidate.file)),
      {
        allowPartialProject: true,
      },
    );
    if (!document) continue;
    const classic = document.value.classic;
    if (!classic || typeof classic !== 'object' || Array.isArray(classic)) continue;
    const value = (classic as Record<string, unknown>)[field];
    if (value === null || value === undefined) continue;
    return { value: String(value), source: candidate.source };
  }
  return null;
}

export { configCandidates, readClassicConfigValue };
export type { ClassicConfigOptions, ClassicConfigValue };
