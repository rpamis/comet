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

async function findBundleRoot(start: string): Promise<string> {
  let directory = start;
  while (true) {
    try {
      await fs.access(path.join(directory, 'bundle.yaml'));
      return directory;
    } catch {
      const parent = path.dirname(directory);
      if (parent === directory) {
        throw new Error(`Cannot resolve ${CURRENT_BUNDLE_HASH}: no enclosing bundle.yaml`);
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

  const bundleRoot = await findBundleRoot(path.dirname(absoluteManifestPath));
  manifest.metadata.draftHash = await hashBundle(await loadBundle(bundleRoot));
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
