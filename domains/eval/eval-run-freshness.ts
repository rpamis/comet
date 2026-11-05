import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  applicationFilesHash,
  readApplicationFiles,
  inspectApplicationSkill,
} from '../workflow-application/skill-adapter.js';
import { resolveEvalContext } from './standalone-context.js';
import { hashEvalDataset, hashEvalSkill } from './eval-run-preview.js';
import type { EvalRunConfig } from './eval-run-types.js';
import { requireDatasetCache } from './dataset-downloads.js';
import { inspectBuiltinDataset } from './builtin-datasets.js';

export async function inspectEvalContentFreshness(
  project: string,
  config: EvalRunConfig,
  contentHash: string,
  legacyDatasetContentHash?: string,
): Promise<{ stale: boolean | null; diagnostic?: string }> {
  try {
    if (config.dataset) {
      const dataset = await inspectBuiltinDataset({
        dataset: config.dataset,
        datasetRoot: config.datasetRoot ?? (await requireDatasetCache(project, config.dataset)),
        task: config.task,
        count: config.count,
        datasetTreatment: config.datasetTreatment,
      });
      return {
        stale: legacyDatasetContentHash
          ? dataset.contentHash !== legacyDatasetContentHash ||
            (config.datasetTreatment !== 'goal' &&
              (await hashEvalSkill(config.target)) !== contentHash)
          : (await hashEvalDataset(dataset, config.target)) !== contentHash,
      };
    }
    if (config.targetType === 'application') {
      const root = path.dirname(config.target);
      if (applicationFilesHash(await readApplicationFiles(root)) !== contentHash)
        return { stale: true };
      const manifest = JSON.parse(await fs.readFile(config.target, 'utf8'));
      for (const skill of manifest.skills ?? []) {
        const inspected = await inspectApplicationSkill(path.resolve(root, skill.root));
        if (inspected.contentHash !== skill.contentHash) return { stale: true };
      }
      return { stale: false };
    }
    const context = await resolveEvalContext({
      project,
      ...(/eval\.ya?ml$/iu.test(config.target)
        ? { manifest: config.target }
        : { skillPath: config.target }),
    });
    return {
      stale: (await hashEvalSkill(context.skillRoot, context.manifestPath)) !== contentHash,
    };
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      (error as Error).message.startsWith('Skill package must contain')
    )
      return { stale: true };
    return { stale: null, diagnostic: `当前目标内容未能核对：${(error as Error).message}` };
  }
}
