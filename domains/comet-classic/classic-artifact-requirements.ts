import path from 'node:path';
import { parseDocument } from 'yaml';
import { executeClassicOpenSpec } from './classic-openspec-command.js';
import { collectClassicSpecFiles } from './classic-paths.js';
import {
  classicProjectFileNonempty,
  classicProjectTargetExists,
  readClassicProjectFile,
  writeClassicProjectText,
} from './classic-protected-path.js';

interface Artifact {
  id: string;
  outputPath: string;
  status: 'done' | 'skipped' | 'ready' | 'blocked';
  requires: string[];
}

const ARCHIVE_REQUIREMENTS = '.comet/archive-requirements.json';

export async function recordClassicArchiveRequirements(
  root: string,
  changeDir: string,
): Promise<void> {
  const requirements = await readClassicArtifactRequirements(root, changeDir);
  if (requirements.problems.length) throw new Error(requirements.problems.join('\n'));
  if (requirements.source === 'legacy') return;
  await writeClassicProjectText(
    root,
    path.join(changeDir, ARCHIVE_REQUIREMENTS),
    JSON.stringify({
      schema: 'comet.classic.archive-requirements.v1',
      files: requirements.files.map((file) => path.relative(changeDir, file).replaceAll('\\', '/')),
    }) + '\n',
    { label: 'Classic archive requirements' },
  );
}

export async function classicArchivedRequirementsProblems(
  root: string,
  changeDir: string,
): Promise<string[]> {
  const receipt = path.join(changeDir, ARCHIVE_REQUIREMENTS);
  let files: unknown = ['proposal.md', 'design.md', 'tasks.md'];
  if (
    await classicProjectTargetExists(root, receipt, {
      label: 'Classic archive requirements',
      expected: 'file',
    })
  ) {
    const data = JSON.parse(
      await readClassicProjectFile(root, receipt, { label: 'Classic archive requirements' }),
    );
    if (data?.schema !== 'comet.classic.archive-requirements.v1')
      throw new Error('Unsupported Classic archive requirements');
    files = data.files;
  }
  if (
    !Array.isArray(files) ||
    !files.includes('proposal.md') ||
    !files.includes('tasks.md') ||
    files.some(
      (file) =>
        typeof file !== 'string' ||
        !(
          ['proposal.md', 'design.md', 'tasks.md'].includes(file) ||
          /^specs\/(?:[^/\\:]+\/)+spec\.md$/u.test(file)
        ) ||
        file.split('/').some((segment: string) => segment === '.' || segment === '..'),
    )
  ) {
    throw new Error('Invalid Classic archive required files');
  }
  const problems: string[] = [];
  for (const file of files) {
    if (
      !(await classicProjectFileNonempty(
        root,
        path.join(changeDir, file),
        'Classic archived required file',
      ))
    ) {
      problems.push(`Required archived artifact is missing or empty: ${file}`);
    }
  }
  return problems;
}

export interface ClassicArtifactRequirements {
  source: 'legacy' | 'openspec';
  required: string[];
  skipped: string[];
  designRequired: boolean;
  files: string[];
  problems: string[];
}

/** File-existence completion never substitutes for the required dependency closure. */
export function requiredArtifactClosure(status: unknown): Artifact[] {
  if (!status || typeof status !== 'object')
    throw new Error('Unsupported OpenSpec status: expected an object');
  const record = status as Record<string, unknown>;
  if (!Array.isArray(record.artifacts) || !Array.isArray(record.applyRequires))
    throw new Error(
      'OpenSpec must expose artifacts and applyRequires; upgrade to a supported version',
    );
  const artifacts = new Map<string, Artifact>();
  for (const raw of record.artifacts) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      typeof raw.id !== 'string' ||
      typeof raw.outputPath !== 'string' ||
      !['done', 'skipped', 'ready', 'blocked'].includes(raw.status) ||
      !Array.isArray(raw.requires) ||
      raw.requires.some((id: unknown) => typeof id !== 'string')
    ) {
      throw new Error(
        'OpenSpec must expose dependency edges for every artifact; upgrade to a supported version',
      );
    }
    if (artifacts.has(raw.id)) throw new Error(`Duplicate OpenSpec artifact: ${raw.id}`);
    artifacts.set(raw.id, raw as Artifact);
  }
  const result: Artifact[] = [];
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: unknown) => {
    if (typeof id !== 'string' || !artifacts.has(id))
      throw new Error(`Missing OpenSpec dependency: ${String(id)}`);
    if (active.has(id)) throw new Error(`Cyclic OpenSpec dependency: ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    const artifact = artifacts.get(id)!;
    for (const dependency of artifact.requires) visit(dependency);
    active.delete(id);
    visited.add(id);
    result.push(artifact);
  };
  for (const id of [...record.applyRequires, 'proposal', 'tasks']) visit(id);
  return result;
}

export async function readClassicArtifactRequirements(
  root: string,
  changeDir: string,
): Promise<ClassicArtifactRequirements> {
  const metadataFile = path.join(changeDir, '.openspec.yaml');
  if (
    !(await classicProjectTargetExists(root, metadataFile, {
      label: 'OpenSpec change metadata',
      expected: 'file',
    }))
  ) {
    return {
      source: 'legacy',
      required: ['proposal', 'design', 'tasks'],
      skipped: [],
      designRequired: true,
      files: ['proposal.md', 'design.md', 'tasks.md'].map((file) => path.join(changeDir, file)),
      problems: [],
    };
  }
  const metadata = parseDocument(
    await readClassicProjectFile(root, metadataFile, { label: 'OpenSpec change metadata' }),
  );
  if (metadata.errors.length)
    throw new Error(`Invalid OpenSpec metadata: ${metadata.errors[0].message}`);
  const response = await executeClassicOpenSpec(
    ['status', '--change', path.basename(changeDir), '--json'],
    root,
  );
  if (response.exitCode !== 0)
    throw new Error(
      `Cannot inspect OpenSpec artifact requirements: ${response.stderr ?? response.exitCode}`,
    );
  let status: Record<string, unknown>;
  try {
    status = JSON.parse(response.stdout ?? '');
  } catch {
    throw new Error('Unsupported OpenSpec status: expected JSON');
  }
  if (
    !status ||
    typeof status.changeRoot !== 'string' ||
    path.resolve(status.changeRoot) !== path.resolve(changeDir)
  )
    throw new Error('OpenSpec status resolves outside the selected Classic change');
  const artifacts = requiredArtifactClosure(status);
  const specs = await collectClassicSpecFiles(root, path.join(changeDir, 'specs'));
  const result: ClassicArtifactRequirements = {
    source: 'openspec',
    required: artifacts.map((artifact) => artifact.id),
    skipped: [],
    designRequired: artifacts.some((artifact) => artifact.id === 'design'),
    files: [],
    problems: [],
  };
  for (const artifact of artifacts) {
    if (!['proposal', 'specs', 'design', 'tasks'].includes(artifact.id))
      throw new Error(
        `Unsupported Classic artifact: ${artifact.id}; use a schema with supported artifact roles`,
      );
    if (artifact.id !== 'specs' && artifact.outputPath !== `${artifact.id}.md`)
      throw new Error(`Unsupported Classic artifact output: ${artifact.outputPath}`);
    if (artifact.status === 'skipped') {
      if (artifact.id !== 'specs' || metadata.get('skip_specs') !== true || specs.length)
        throw new Error(
          'OpenSpec skipped specs require explicit skip_specs: true and no conflicting spec files',
        );
      result.skipped.push(artifact.id);
      continue;
    }
    const output = artifact.outputPath.replaceAll('\\', '/');
    if (
      path.posix.isAbsolute(output) ||
      /^[A-Za-z]:/u.test(output) ||
      output.split('/').includes('..')
    )
      throw new Error(`Unsafe OpenSpec artifact path: ${output}`);
    let files: string[];
    if (
      artifact.id === 'specs' &&
      ['specs/**/*.md', 'specs/**/spec.md', 'specs/*/spec.md'].includes(output)
    )
      files = specs;
    else if (['?', '*', '[', ']', '{', '}'].some((token) => output.includes(token)))
      throw new Error(`Unsupported OpenSpec artifact pattern: ${output}`);
    else files = [path.join(changeDir, output)];
    if (artifact.status !== 'done' || !files.length)
      result.problems.push(`Required OpenSpec artifact is not complete: ${artifact.id}`);
    for (const file of files) {
      if (
        !(await classicProjectFileNonempty(root, file, `OpenSpec required artifact ${artifact.id}`))
      )
        result.problems.push(`Required OpenSpec file is missing or empty: ${file}`);
      result.files.push(file);
    }
  }
  return result;
}
