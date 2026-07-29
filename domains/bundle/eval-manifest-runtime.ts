import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { parse, stringify } from 'yaml';
import type { RepositoryEvalContext } from './eval-run-result.js';
import { hashBundle } from './hash.js';
import { loadBundle } from './load.js';
import { readBundleAuthoringState } from './state.js';

const CURRENT_BUNDLE_HASH = '<current-bundle-hash>';

export interface PreparedEvalManifest {
  path: string;
  context?: RepositoryEvalContext;
  cleanup: () => Promise<void>;
}

function resolutionFailure(manifestPath: string, detail: string, cause?: unknown): Error {
  return new Error(
    `Cannot resolve ${CURRENT_BUNDLE_HASH} for ${manifestPath}: ${detail}. ` +
      'Fix the enclosing Bundle draft or replace the placeholder with a concrete draft hash',
    cause === undefined ? undefined : { cause },
  );
}

async function findBundleRoot(manifestPath: string): Promise<string> {
  let directory = path.dirname(manifestPath);
  while (true) {
    try {
      await fs.access(path.join(directory, 'bundle.yaml'));
      return directory;
    } catch {
      const parent = path.dirname(directory);
      if (parent === directory) {
        throw resolutionFailure(
          manifestPath,
          'no enclosing bundle.yaml was found. The placeholder only applies to a generated manifest still inside its Bundle draft',
        );
      }
      directory = parent;
    }
  }
}

async function findRepositoryEvalContext(
  manifestPath: string,
  bundleRoot: string,
  name: string | undefined,
  draftHash: string,
  manifestSource: string,
): Promise<RepositoryEvalContext | undefined> {
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) return undefined;
  let directory = bundleRoot;
  while (true) {
    const stateFile = path.join(directory, '.comet', 'bundle-authoring', `${name}.json`);
    try {
      await fs.access(stateFile);
      const state = await readBundleAuthoringState(directory, name);
      const generated = state.factory?.generatedSkillPackage;
      const generatedManifest =
        generated?.evalManifestPath ?? generated?.controlPlane?.evalManifestPath;
      if (
        state.currentHash === draftHash &&
        path.resolve(state.draftPath) === path.resolve(bundleRoot) &&
        generatedManifest !== null &&
        generatedManifest !== undefined &&
        path.resolve(generatedManifest) === manifestPath
      ) {
        return {
          projectRoot: directory,
          name,
          draftHash,
          evalManifestHash: createHash('sha256').update(manifestSource).digest('hex'),
          sourceManifestPath: manifestPath,
        };
      }
      return undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export async function prepareEvalManifest(manifestPath: string): Promise<PreparedEvalManifest> {
  const absoluteManifestPath = path.resolve(manifestPath);
  const source = await fs.readFile(absoluteManifestPath, 'utf8');
  const manifest = parse(source) as {
    metadata?: { name?: string; draftHash?: string };
    skill?: { source?: string };
  };
  const usesCurrentHash = manifest.metadata?.draftHash === CURRENT_BUNDLE_HASH;
  let bundleRoot: string | undefined;
  let draftHash = manifest.metadata?.draftHash;
  if (usesCurrentHash) {
    bundleRoot = await findBundleRoot(absoluteManifestPath);
    try {
      draftHash = await hashBundle(await loadBundle(bundleRoot));
      manifest.metadata!.draftHash = draftHash;
    } catch (error) {
      throw resolutionFailure(
        absoluteManifestPath,
        `the enclosing Bundle draft at ${bundleRoot} could not be loaded or hashed`,
        error,
      );
    }
  }

  let context: RepositoryEvalContext | undefined;
  if (draftHash && /^[a-f0-9]{64}$/u.test(draftHash)) {
    try {
      bundleRoot ??= await findBundleRoot(absoluteManifestPath);
      context = await findRepositoryEvalContext(
        absoluteManifestPath,
        bundleRoot,
        manifest.metadata?.name,
        draftHash,
        source,
      );
    } catch (error) {
      if (usesCurrentHash) throw error;
    }
  }

  if (!usesCurrentHash) {
    return {
      path: absoluteManifestPath,
      ...(context === undefined ? {} : { context }),
      cleanup: async () => undefined,
    };
  }

  manifest.skill ??= {};
  manifest.skill.source = path.resolve(
    path.dirname(absoluteManifestPath),
    manifest.skill.source ?? '..',
  );

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-eval-manifest-'));
  const temporaryManifestPath = path.join(temporaryRoot, 'eval.yaml');
  try {
    await fs.writeFile(temporaryManifestPath, stringify(manifest));
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
  return {
    path: temporaryManifestPath,
    ...(context === undefined ? {} : { context }),
    cleanup: async () => fs.rm(temporaryRoot, { recursive: true, force: true }),
  };
}
