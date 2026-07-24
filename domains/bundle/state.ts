import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { hashBundle } from './hash.js';
import { loadBundle } from './load.js';
import type { BundleAuthoringState } from './types.js';

function validateName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) {
    throw new Error(`Invalid Bundle name: ${name}`);
  }
}

function statePath(projectRoot: string, name: string): string {
  validateName(name);
  return path.resolve(projectRoot, '.comet', 'bundle-authoring', `${name}.json`);
}

function portableProjectPath(projectRoot: string, value: string): string | null {
  if (!path.isAbsolute(value)) return null;
  const relative = path.relative(path.resolve(projectRoot), path.resolve(value));
  if (
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return null;
  }
  return `./${relative}`;
}

function serializeProjectPaths(projectRoot: string, value: unknown): unknown {
  if (typeof value === 'string') return portableProjectPath(projectRoot, value) ?? value;
  if (Array.isArray(value)) return value.map((item) => serializeProjectPaths(projectRoot, item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, serializeProjectPaths(projectRoot, item)]),
  );
}

function hydrateProjectPaths(projectRoot: string, value: unknown): unknown {
  if (typeof value === 'string') {
    return value.startsWith('./') ? path.resolve(projectRoot, value) : value;
  }
  if (Array.isArray(value)) return value.map((item) => hydrateProjectPaths(projectRoot, item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, hydrateProjectPaths(projectRoot, item)]),
  );
}

function assertState(value: unknown, file: string): asserts value is BundleAuthoringState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Bundle authoring state at ${file}: document must be an object`);
  }
  const state = value as Partial<BundleAuthoringState>;
  if (state.schemaVersion !== 1 || typeof state.name !== 'string') {
    throw new Error(`Invalid Bundle authoring state at ${file}: unsupported schema`);
  }
  if (typeof state.draftPath !== 'string' || !Array.isArray(state.candidates)) {
    throw new Error(`Invalid Bundle authoring state at ${file}: required fields are missing`);
  }
}

async function currentBundleHash(root: string): Promise<string | null> {
  try {
    return await hashBundle(await loadBundle(root));
  } catch {
    return null;
  }
}

function invalidatedState(
  state: BundleAuthoringState,
  currentHash: string | null,
): BundleAuthoringState {
  const invalidated = { ...state, status: 'draft' as const, currentHash };
  delete invalidated.eval;
  delete invalidated.review;
  delete invalidated.ready;
  delete invalidated.conflict;
  return invalidated;
}

export async function readBundleAuthoringState(
  projectRoot: string,
  name: string,
): Promise<BundleAuthoringState> {
  const file = statePath(projectRoot, name);
  const value = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
  assertState(value, file);
  if (value.name !== name) {
    throw new Error(`Invalid Bundle authoring state at ${file}: name must be ${name}`);
  }
  return hydrateProjectPaths(projectRoot, value) as BundleAuthoringState;
}

export async function listBundleAuthoringStates(
  projectRoot: string,
): Promise<BundleAuthoringState[]> {
  const names = await listBundleAuthoringStateNames(projectRoot);

  const states: BundleAuthoringState[] = [];
  for (const name of names) {
    states.push(await reconcileBundleAuthoringState(projectRoot, name));
  }
  return states;
}

async function listBundleAuthoringStateNames(projectRoot: string): Promise<string[]> {
  const root = path.resolve(projectRoot, '.comet', 'bundle-authoring');
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .sort((left, right) => left.localeCompare(right));
}

export async function listBundleAuthoringStatesReadOnly(
  projectRoot: string,
): Promise<BundleAuthoringState[]> {
  const names = await listBundleAuthoringStateNames(projectRoot);
  const states: BundleAuthoringState[] = [];
  for (const name of names) {
    states.push(await readBundleAuthoringState(projectRoot, name));
  }
  return states;
}

export async function writeBundleAuthoringState(
  projectRoot: string,
  state: BundleAuthoringState,
): Promise<void> {
  const file = statePath(projectRoot, state.name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${state.name}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(
      temporary,
      JSON.stringify(serializeProjectPaths(projectRoot, state), null, 2) + '\n',
      {
        encoding: 'utf8',
        flag: 'wx',
      },
    );
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export async function reconcileBundleAuthoringState(
  projectRoot: string,
  name: string,
): Promise<BundleAuthoringState> {
  const state = await readBundleAuthoringState(projectRoot, name);
  const draftHash = await currentBundleHash(state.draftPath);

  if (state.ready) {
    const readyHash = await currentBundleHash(state.ready.path);
    const draftChanged = draftHash !== state.ready.hash;
    const readyChanged = readyHash !== state.ready.hash;
    if (draftChanged && readyChanged) {
      const conflicted: BundleAuthoringState = {
        ...state,
        status: 'drift-conflict',
        currentHash: draftHash,
        conflict: {
          draftHash: draftHash ?? 'invalid',
          readyHash: readyHash ?? 'invalid',
        },
      };
      await writeBundleAuthoringState(projectRoot, conflicted);
      return conflicted;
    }
    if (draftChanged || readyChanged) {
      const invalidated = invalidatedState(state, draftHash);
      await writeBundleAuthoringState(projectRoot, invalidated);
      return invalidated;
    }
  } else if (draftHash !== state.currentHash) {
    const invalidated = invalidatedState(state, draftHash);
    await writeBundleAuthoringState(projectRoot, invalidated);
    return invalidated;
  }

  return state;
}
