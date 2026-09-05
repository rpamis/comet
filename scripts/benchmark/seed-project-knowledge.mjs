import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  LocalProjectKnowledgeProvider,
  createUserProjectKnowledgeRecord,
} from '../../dist/domains/project-knowledge/index.js';
import { resolveStableProjectId } from '../../dist/platform/paths/project-identity.js';

/** Explicit opt-in Comet examples, never an automatic seed for other projects. */
export async function seedCometReferences(projectRoot, cacheRoot) {
  const packageInfo = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8'));
  if (packageInfo.name !== '@rpamis/comet')
    throw new Error('These references apply only to the Comet repository');
  const seeds = JSON.parse(
    await readFile(
      new URL('../../eval/project-knowledge/comet-reference-seeds.json', import.meta.url),
      'utf8',
    ),
  );
  const projectId = resolveStableProjectId(projectRoot);
  const provider = new LocalProjectKnowledgeProvider({ projectRoot, cacheRoot, corpus: [] });
  const records = [];
  try {
    for (const seed of seeds) {
      const record = createUserProjectKnowledgeRecord(
        {
          ...seed,
          sources: seed.sources.map((source) => ({ source })),
          verification: seed.verification.map((command) => ({ command, expected: 'pass' })),
        },
        projectId,
        new Date().toISOString(),
        seed.id,
      );
      const sourceVersions = await Promise.all(
        seed.sources.map(async (source) => {
          const absolute = path.resolve(projectRoot, source);
          const relative = path.relative(projectRoot, absolute);
          if (relative.startsWith('..') || path.isAbsolute(relative))
            throw new Error('Source escapes project');
          const [bytes, metadata] = await Promise.all([readFile(absolute), stat(absolute)]);
          return {
            source,
            size: metadata.size,
            modifiedAt: Math.trunc(metadata.mtimeMs),
            digest: createHash('sha256').update(bytes).digest('hex'),
          };
        }),
      );
      const result = await provider.apply({
        kind: 'upsert',
        record: {
          ...record,
          state: 'trial',
          authority: 'automatic',
          sourceVersions,
        },
      });
      records.push({ id: seed.id, changed: result.changed, state: result.record?.state });
    }
    return { projectId, records };
  } finally {
    provider.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const project = process.argv.find((arg) => arg.startsWith('--project='))?.slice(10);
  const cacheRoot = process.argv.find((arg) => arg.startsWith('--cache-root='))?.slice(13);
  if (!project)
    throw new Error(
      'Usage: node seed-project-knowledge.mjs --project=<Comet checkout> [--cache-root=<cache>]',
    );
  console.log(
    JSON.stringify(
      await seedCometReferences(path.resolve(project), cacheRoot && path.resolve(cacheRoot)),
      null,
      2,
    ),
  );
}
