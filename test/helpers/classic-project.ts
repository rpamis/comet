import { promises as fs } from 'fs';
import path from 'path';

/** Create the smallest healthy configured Classic workspace using legacy paths. */
export async function prepareClassicLegacyProject(projectRoot: string): Promise<void> {
  const openSpecRoot = path.join(projectRoot, 'openspec');
  await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
  await fs.mkdir(path.join(openSpecRoot, 'changes', 'archive'), { recursive: true });
  await fs.mkdir(path.join(openSpecRoot, 'specs'), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, '.comet', 'config.yaml'),
    [
      'schema: comet.project.v1',
      'default_workflow: classic',
      'workflows:',
      '  - classic',
      'classic:',
      '  artifact_layout: legacy',
      '  language: en',
      '  context_compression: off',
      '  review_mode: standard',
      '  auto_transition: true',
      '',
    ].join('\n'),
  );
  await fs.writeFile(path.join(openSpecRoot, 'config.yaml'), 'schema: spec-driven\n');
}
