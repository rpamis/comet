import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { compileBundleIr } from './compiler.js';
import { hashBundle } from './hash.js';
import { loadBundle } from './load.js';
import { compileBundleForPlatform } from './platform.js';
import { reconcileBundleAuthoringState, writeBundleAuthoringState } from './state.js';
import type { BundleAuthoringState } from './types.js';
import { assertValidBundle } from './validate.js';
import { listBundlePlatformTargets } from './bundle-platform.js';

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function assertReviewer(reviewer: string): string {
  const normalized = reviewer.trim();
  if (!normalized) throw new Error('Bundle reviewer must be a non-empty string');
  return normalized;
}

export async function reviewBundle(options: {
  projectRoot: string;
  name: string;
  decision: 'approved' | 'rejected';
  reviewer: string;
}): Promise<BundleAuthoringState> {
  const state = await reconcileBundleAuthoringState(options.projectRoot, options.name);
  if (
    state.status !== 'eval-passed' ||
    !state.eval?.passed ||
    state.eval.hash !== state.currentHash ||
    !state.currentHash
  ) {
    throw new Error('Bundle review requires eval-passed evidence for the current hash');
  }

  const reviewed: BundleAuthoringState = {
    ...state,
    status: options.decision === 'approved' ? 'review-approved' : 'draft',
    review: {
      hash: state.currentHash,
      decision: options.decision,
      reviewer: assertReviewer(options.reviewer),
      at: new Date().toISOString(),
    },
  };
  delete reviewed.ready;
  delete reviewed.conflict;
  await writeBundleAuthoringState(options.projectRoot, reviewed);
  return reviewed;
}

export async function publishBundle(options: {
  projectRoot: string;
  name: string;
  overwrite?: boolean;
  referencePlatform: string;
}): Promise<BundleAuthoringState> {
  const state = await reconcileBundleAuthoringState(options.projectRoot, options.name);
  const bundle = await loadBundle(state.draftPath);
  await assertValidBundle(bundle);
  const currentHash = await hashBundle(bundle);
  if (currentHash !== state.currentHash) {
    throw new Error(
      'Bundle draft changed during final validation; reconcile and evaluate it again',
    );
  }
  if (bundle.manifest.metadata.name !== state.name) {
    throw new Error(
      `Bundle manifest name ${bundle.manifest.metadata.name} does not match authoring state ${state.name}`,
    );
  }
  if (
    state.status !== 'review-approved' ||
    state.eval?.hash !== currentHash ||
    !state.eval.passed ||
    state.review?.hash !== currentHash ||
    state.review.decision !== 'approved'
  ) {
    throw new Error('Bundle publish requires eval and review approval for the current hash');
  }

  const ir = await compileBundleIr(bundle, { locale: state.defaultLocale });
  if (ir.bundle.hash !== currentHash) {
    throw new Error('Bundle hash changed during final compilation');
  }
  const target = listBundlePlatformTargets({
    projectRoot: options.projectRoot,
    homeDir: os.homedir(),
    scope: 'project',
  }).find((candidate) => candidate.id === options.referencePlatform);
  if (!target) {
    throw new Error(`Unknown reference platform: ${options.referencePlatform}`);
  }
  const report = await compileBundleForPlatform(ir, target, {
    projectRoot: options.projectRoot,
    scope: 'project',
    locale: state.defaultLocale,
  });
  const unsupportedRequired = report.unsupported.filter((item) => item.required);
  if (unsupportedRequired.length > 0) {
    throw new Error(
      `Reference platform ${target.id} cannot satisfy required capabilities: ${unsupportedRequired
        .map((item) => item.capability)
        .join(', ')}`,
    );
  }

  const bundlesRoot = path.resolve(options.projectRoot, '.comet', 'bundles');
  const destination = path.join(bundlesRoot, options.name);
  const exists = await pathExists(destination);
  if (exists && !options.overwrite) {
    throw new Error(
      `Published Bundle already exists at ${destination}; use overwrite to replace it`,
    );
  }

  await fs.mkdir(bundlesRoot, { recursive: true });
  const temporary = path.join(bundlesRoot, `.${options.name}.${randomUUID()}.tmp`);
  const backup = path.join(bundlesRoot, `.${options.name}.backup-${randomUUID()}`);
  let movedExisting = false;
  let installed = false;
  try {
    await fs.cp(state.draftPath, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    if (exists) {
      await fs.rename(destination, backup);
      movedExisting = true;
    }
    await fs.rename(temporary, destination);
    installed = true;

    const publishedHash = await hashBundle(await loadBundle(destination));
    if (publishedHash !== currentHash) {
      throw new Error('Published Bundle hash does not match the approved draft');
    }
    const ready: BundleAuthoringState = {
      ...state,
      status: 'ready',
      currentHash,
      ready: {
        hash: currentHash,
        path: destination,
        publishedAt: new Date().toISOString(),
      },
    };
    delete ready.conflict;
    await writeBundleAuthoringState(options.projectRoot, ready);
    if (movedExisting) {
      await fs.rm(backup, { recursive: true, force: true }).catch(() => undefined);
    }
    return ready;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    if (installed && (await pathExists(destination))) {
      await fs.rm(destination, { recursive: true, force: true });
    }
    if (movedExisting && (await pathExists(backup))) {
      await fs.rename(backup, destination);
    }
    throw error;
  }
}
