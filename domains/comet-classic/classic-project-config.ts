import os from 'os';
import path from 'path';
import { readWorkflowProjectConfigDocument } from '../workflow-contract/project-config-reader.js';

type ClassicConfigValue = {
  value: string;
  source: string;
};

type ClassicConfigOptions = {
  invocationCwd?: string;
  projectRoot?: string;
  cwd?: string;
  homeDir?: string;
};

type ClassicRecommendLightweightWorkflowsValue = {
  value: boolean;
  source: string;
};

function configCandidates(options: ClassicConfigOptions = {}): Array<{
  file: string;
  source: string;
}> {
  const cwd = options.projectRoot ?? options.cwd ?? options.invocationCwd ?? process.cwd();
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

function parseClassicBoolean(value: string, field: string, source: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${field} must be true or false, got '${value}' from ${source}`);
}

async function readClassicRecommendLightweightWorkflows(
  options: ClassicConfigOptions = {},
): Promise<ClassicRecommendLightweightWorkflowsValue> {
  const configured = await readClassicConfigValue('recommend_lightweight_workflows', options);
  if (!configured) return { value: true, source: 'default' };
  return {
    value: parseClassicBoolean(
      configured.value,
      'classic.recommend_lightweight_workflows',
      configured.source,
    ),
    source: configured.source,
  };
}

export { configCandidates, readClassicConfigValue, readClassicRecommendLightweightWorkflows };
export type { ClassicConfigOptions, ClassicConfigValue, ClassicRecommendLightweightWorkflowsValue };
