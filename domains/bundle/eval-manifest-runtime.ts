import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { parse, stringify } from 'yaml';
import { hashBundle } from './hash.js';
import { loadBundle } from './load.js';

const CURRENT_BUNDLE_HASH = '<current-bundle-hash>';

export interface PreparedEvalManifest {
  path: string;
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

export async function prepareEvalManifest(manifestPath: string): Promise<PreparedEvalManifest> {
  const absoluteManifestPath = path.resolve(manifestPath);
  const source = await fs.readFile(absoluteManifestPath, 'utf8');
  const manifest = parse(source) as {
    metadata?: { draftHash?: string };
    skill?: { source?: string };
  };
  if (manifest.metadata?.draftHash !== CURRENT_BUNDLE_HASH) {
    return { path: absoluteManifestPath, cleanup: async () => undefined };
  }

  const bundleRoot = await findBundleRoot(absoluteManifestPath);
  try {
    manifest.metadata.draftHash = await hashBundle(await loadBundle(bundleRoot));
  } catch (error) {
    throw resolutionFailure(
      absoluteManifestPath,
      `the enclosing Bundle draft at ${bundleRoot} could not be loaded or hashed`,
      error,
    );
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
    cleanup: async () => fs.rm(temporaryRoot, { recursive: true, force: true }),
  };
}
