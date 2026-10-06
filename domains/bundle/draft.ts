import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import type { BundleCandidateSource } from './candidates.js';
import { hashBundle } from './hash.js';
import { loadBundle } from './load.js';
import { writeBundleAuthoringState } from './state.js';
import type { BundleAuthoringState } from './types.js';

interface BundleDraftChoices {
  projectRoot: string;
  name: string;
  candidates: BundleCandidateSource[];
  defaultLocale: string;
  locales: string[];
  engineEnabled: boolean;
}

export type CreateBundleDraftOptions = BundleDraftChoices;

export interface OptimizeBundleDraftOptions extends BundleDraftChoices {
  sourceRoot: string;
}

function validateName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
    throw new Error(`Invalid Bundle name: ${name}`);
  }
}

function draftPath(projectRoot: string, name: string): string {
  validateName(name);
  return path.resolve(projectRoot, '.comet', 'bundle-drafts', name);
}

async function assertMissing(target: string): Promise<void> {
  try {
    await fs.access(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Bundle draft already exists: ${target}`);
}

function baseState(
  options: BundleDraftChoices,
  mode: BundleAuthoringState['mode'],
  destination: string,
): BundleAuthoringState {
  return {
    schemaVersion: 1,
    name: options.name,
    mode,
    status: 'draft',
    draftPath: destination,
    currentHash: null,
    candidates: structuredClone(options.candidates),
    defaultLocale: options.defaultLocale,
    locales: [...options.locales],
    engineEnabled: options.engineEnabled,
  };
}

export async function createBundleDraft(
  options: CreateBundleDraftOptions,
): Promise<BundleAuthoringState> {
  const destination = draftPath(options.projectRoot, options.name);
  await assertMissing(destination);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.mkdir(destination);
  const state = baseState(options, 'create', destination);
  await writeBundleAuthoringState(options.projectRoot, state);
  return state;
}

export async function optimizeBundleDraft(
  options: OptimizeBundleDraftOptions,
): Promise<BundleAuthoringState> {
  const destination = draftPath(options.projectRoot, options.name);
  await assertMissing(destination);
  const sourceRoot = await fs.realpath(options.sourceRoot);
  const source = await loadBundle(sourceRoot);
  const sourceHash = await hashBundle(source);
  const temporary = path.join(path.dirname(destination), `.${options.name}.${randomUUID()}.tmp`);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fs.cp(sourceRoot, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }

  const state: BundleAuthoringState = {
    ...baseState(options, 'optimize', destination),
    currentHash: sourceHash,
    base: {
      root: sourceRoot,
      version: source.manifest.metadata.version,
      hash: sourceHash,
    },
  };
  await writeBundleAuthoringState(options.projectRoot, state);
  return state;
}
