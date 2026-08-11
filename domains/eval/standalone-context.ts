import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'yaml';

export interface EvalTargetOptions {
  project?: string;
  manifest?: string;
  skillPath?: string;
}

export type EvalManifestSource = 'explicit' | 'auto-detected' | 'synthesized';

export interface ResolvedEvalContext {
  schema: 'comet.eval.context.v1';
  skillRoot: string;
  manifestSource: EvalManifestSource;
  manifestPath?: string;
  artifactOwnerRoot: string;
  artifactRoot: string;
  baseManifest?: Record<string, unknown>;
}

export function isPathWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

export async function canonicalPath(target: string): Promise<string> {
  const resolved = path.resolve(target);
  try {
    return await fs.realpath(resolved);
  } catch {
    return resolved;
  }
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

function assertTarget(options: EvalTargetOptions): void {
  if (!options.manifest && !options.skillPath)
    throw new Error('Pass one of --manifest or --skill-path');
  if (options.manifest && options.skillPath)
    throw new Error('Pass exactly one of --manifest or --skill-path');
}

async function resolveManifestSkillRoot(manifestPath: string): Promise<string> {
  try {
    const data = parse(await fs.readFile(manifestPath, 'utf8')) as { skill?: { source?: unknown } };
    if (typeof data?.skill?.source === 'string' && data.skill.source.trim()) {
      return canonicalPath(
        path.isAbsolute(data.skill.source)
          ? data.skill.source
          : path.join(path.dirname(manifestPath), data.skill.source),
      );
    }
  } catch {
    // Static collection owns schema diagnostics after target resolution.
  }
  return canonicalPath(path.join(path.dirname(manifestPath), '..'));
}

export async function resolveEvalContext(options: EvalTargetOptions): Promise<ResolvedEvalContext> {
  assertTarget(options);
  let skillRoot: string;
  let manifestPath: string | undefined;
  let manifestSource: EvalManifestSource;
  let baseManifest: Record<string, unknown> | undefined;
  if (options.manifest) {
    manifestPath = await canonicalPath(options.manifest);
    skillRoot = await resolveManifestSkillRoot(manifestPath);
    manifestSource = 'explicit';
  } else {
    const target = await canonicalPath(options.skillPath!);
    skillRoot = path.basename(target) === 'SKILL.md' ? path.dirname(target) : target;
    const yamlManifest = path.join(skillRoot, 'comet', 'eval.yaml');
    const ymlManifest = path.join(skillRoot, 'comet', 'eval.yml');
    if (await isFile(yamlManifest)) {
      manifestPath = await canonicalPath(yamlManifest);
      manifestSource = 'auto-detected';
    } else if (await isFile(ymlManifest)) {
      manifestPath = await canonicalPath(ymlManifest);
      manifestSource = 'auto-detected';
    } else {
      manifestSource = 'synthesized';
      baseManifest = {
        apiVersion: 'comet.eval/v1alpha1',
        kind: 'SkillEvalManifest',
        metadata: { name: path.basename(skillRoot) },
        skill: { name: path.basename(skillRoot), source: skillRoot },
        evaluation: {},
      };
    }
  }
  if (!(await isFile(path.join(skillRoot, 'SKILL.md')))) {
    throw new Error(`Skill package must contain SKILL.md: ${skillRoot}`);
  }
  const artifactOwnerRoot = options.project ? await canonicalPath(options.project) : skillRoot;
  try {
    if (!(await fs.stat(artifactOwnerRoot)).isDirectory()) {
      throw new Error(`Artifact owner root must be an existing directory: ${artifactOwnerRoot}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Artifact owner root')) throw error;
    throw new Error(`Artifact owner root must be an existing directory: ${artifactOwnerRoot}`, {
      cause: error,
    });
  }
  return {
    schema: 'comet.eval.context.v1',
    skillRoot,
    manifestSource,
    ...(manifestPath ? { manifestPath } : {}),
    artifactOwnerRoot,
    artifactRoot: path.join(artifactOwnerRoot, '.comet', 'eval'),
    ...(baseManifest ? { baseManifest } : {}),
  };
}
