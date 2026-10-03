import { createHash } from 'node:crypto';
import path from 'node:path';
import { runGitCommand } from '../../platform/process/git.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import { atomicWriteJson } from './native-atomic-file.js';
import type { NativeProjectPaths } from './native-types.js';

const REGISTRY_REF = '.comet/runtime/native/runner-input-artifacts.json';
const MAX_ARTIFACTS = 256;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
interface RunnerInputArtifact {
  path: string;
  digest: string;
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitPathKey(relative: string): string {
  return process.platform === 'win32' ? relative.toLowerCase() : relative;
}

function relativeInputPath(projectRoot: string, file: string): string | null {
  const relative = path
    .relative(projectRoot, path.resolve(projectRoot, file))
    .replaceAll('\\', '/');
  return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('../')
    ? relative
    : null;
}

async function readRegistry(projectRoot: string): Promise<RunnerInputArtifact[]> {
  try {
    const read = await readProtectedProjectFile(projectRoot, REGISTRY_REF, 256 * 1024, {
      label: 'Native Runner input registry',
    });
    const value: unknown = JSON.parse(read.bytes.toString('utf8'));
    if (!Array.isArray(value) || value.length > MAX_ARTIFACTS)
      throw new Error('Invalid Native Runner input registry');
    return value.map((entry: unknown) => {
      const row = entry as RunnerInputArtifact;
      if (
        !row ||
        typeof row.path !== 'string' ||
        relativeInputPath(projectRoot, row.path) !== row.path ||
        typeof row.digest !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(row.digest)
      )
        throw new Error('Invalid Native Runner input artifact');
      return { path: row.path, digest: row.digest };
    });
  } catch {
    // Missing or damaged local bookkeeping never removes a candidate input.
    return [];
  }
}

function trackedPaths(projectRoot: string): Set<string> | null {
  try {
    return new Set(
      runGitCommand(projectRoot, ['ls-files', '-z']).split('\0').filter(Boolean).map(gitPathKey),
    );
  } catch {
    // Unknown tracking status is not permission to exclude a file.
    return null;
  }
}

async function matchingArtifacts(projectRoot: string): Promise<RunnerInputArtifact[]> {
  const registry = await readRegistry(projectRoot);
  if (!registry.length) return [];
  const tracked = trackedPaths(projectRoot);
  if (!tracked) return [];
  const matching: RunnerInputArtifact[] = [];
  for (const row of registry) {
    if (tracked.has(gitPathKey(row.path))) continue;
    try {
      const read = await readProtectedProjectFile(projectRoot, row.path, MAX_INPUT_BYTES, {
        label: 'Native Runner input artifact',
      });
      const relative = relativeInputPath(projectRoot, read.realPath);
      if (relative && !tracked.has(gitPathKey(relative)) && digest(read.bytes) === row.digest)
        matching.push({ path: relative, digest: row.digest });
    } catch {
      // Replaced, missing, linked or unstable files remain ordinary inputs.
    }
  }
  return matching;
}

export async function nativeRunnerInputArtifactPaths(projectRoot: string): Promise<Set<string>> {
  return new Set((await matchingArtifacts(projectRoot)).map((row) => row.path));
}

/** Called under the project mutation lock; validateContent must strictly parse the transport. */
export async function registerNativeRunnerInputArtifactLocked(options: {
  paths: NativeProjectPaths;
  file: string;
  validateContent: (content: string) => void;
}): Promise<void> {
  const relative = relativeInputPath(options.paths.projectRoot, options.file);
  if (!relative) return;
  const tracked = trackedPaths(options.paths.projectRoot);
  if (!tracked || tracked.has(gitPathKey(relative))) return;
  const read = await readProtectedProjectFile(
    options.paths.projectRoot,
    relative,
    MAX_INPUT_BYTES,
    { label: 'Native Runner input artifact' },
  );
  options.validateContent(read.bytes.toString('utf8'));
  const physicalRelative = relativeInputPath(options.paths.projectRoot, read.realPath);
  if (!physicalRelative || tracked.has(gitPathKey(physicalRelative))) return;
  const current = (await matchingArtifacts(options.paths.projectRoot)).filter(
    (row) => gitPathKey(row.path) !== gitPathKey(physicalRelative),
  );
  if (current.length >= MAX_ARTIFACTS)
    throw new Error(
      'Too many retained Native Runner input files; remove unused protocol files before continuing',
    );
  await atomicWriteJson(
    path.join(options.paths.projectRoot, ...REGISTRY_REF.split('/')),
    [...current, { path: physicalRelative, digest: digest(read.bytes) }],
    { containedRoot: options.paths.runtimeDir },
  );
}
