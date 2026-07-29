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
  return `./${relative.split(path.sep).join('/')}`;
}

function hydrateProjectPath(projectRoot: string, value: string): string {
  if (!value.startsWith('./')) return value;
  return path.resolve(projectRoot, ...value.slice(2).split(/[\\/]/u));
}

function mapNullableProjectPath(
  value: string | null,
  transform: (value: string) => string,
): string | null {
  return value === null ? null : transform(value);
}

function mapFactoryProjectPaths(
  state: BundleAuthoringState['factory'],
  transform: (value: string) => string,
): BundleAuthoringState['factory'] {
  if (!state) return state;
  const generated = state.generatedSkillPackage;
  return {
    ...state,
    ...(state.resolvedSkills === undefined
      ? {}
      : {
          resolvedSkills: state.resolvedSkills.map((skill) => ({
            ...skill,
            sources: skill.sources.map((source) => ({
              ...source,
              root: transform(source.root),
            })),
          })),
        }),
    ...(state.preferencePath === undefined
      ? {}
      : { preferencePath: transform(state.preferencePath) }),
    ...(state.planPath === undefined ? {} : { planPath: transform(state.planPath) }),
    ...(generated === undefined
      ? {}
      : {
          generatedSkillPackage: {
            ...generated,
            packageRoot: transform(generated.packageRoot),
            enginePath: mapNullableProjectPath(generated.enginePath, transform),
            evalManifestPath: mapNullableProjectPath(generated.evalManifestPath, transform),
            ...(generated.controlPlane === undefined
              ? {}
              : {
                  controlPlane: {
                    ...generated.controlPlane,
                    checksPath: mapNullableProjectPath(
                      generated.controlPlane.checksPath,
                      transform,
                    ),
                    evalManifestPath: mapNullableProjectPath(
                      generated.controlPlane.evalManifestPath,
                      transform,
                    ),
                    compositionReportPath: transform(generated.controlPlane.compositionReportPath),
                    scripts: generated.controlPlane.scripts.map(transform),
                  },
                }),
            ...(generated.platformAgents === undefined
              ? {}
              : {
                  platformAgents: generated.platformAgents.map((agent) => ({
                    ...agent,
                    path: transform(agent.path),
                  })),
                }),
          },
        }),
  };
}

function mapProjectPaths(
  state: BundleAuthoringState,
  transform: (value: string) => string,
): BundleAuthoringState {
  return {
    ...state,
    draftPath: transform(state.draftPath),
    ...(state.base === undefined
      ? {}
      : {
          base: {
            ...state.base,
            root: transform(state.base.root),
          },
        }),
    candidates: state.candidates.map((candidate) => ({
      ...candidate,
      root: transform(candidate.root),
    })),
    ...(state.eval === undefined
      ? {}
      : {
          eval: {
            ...state.eval,
            resultPath: transform(state.eval.resultPath),
          },
        }),
    ...(state.ready === undefined
      ? {}
      : {
          ready: {
            ...state.ready,
            path: transform(state.ready.path),
          },
        }),
    ...(state.factory === undefined
      ? {}
      : { factory: mapFactoryProjectPaths(state.factory, transform) }),
  };
}

function serializeProjectPaths(
  projectRoot: string,
  state: BundleAuthoringState,
): BundleAuthoringState {
  return mapProjectPaths(state, (value) => portableProjectPath(projectRoot, value) ?? value);
}

function hydrateProjectPaths(
  projectRoot: string,
  state: BundleAuthoringState,
): BundleAuthoringState {
  return mapProjectPaths(state, (value) => hydrateProjectPath(projectRoot, value));
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
