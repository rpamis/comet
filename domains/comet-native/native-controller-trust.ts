import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readFileRaceSafe } from '../../platform/fs/race-safe-read.js';
import { assertTrustedReadonlyFile } from '../../platform/fs/trusted-readonly-file.js';

import { canonicalHash } from './native-canonical-hash.js';
import { parseNativeReviewIdentity, type NativeReviewIdentity } from './native-review-identity.js';

export const NATIVE_CONTROLLER_TRUST_STORE_SCHEMA =
  'comet.native.controller-trust-store.v1' as const;
export const NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV =
  'COMET_NATIVE_CONTROLLER_TRUST_STORE_TEST_PATH' as const;
const PROJECT_ROOT_HASH_TAG = 'comet.native.controller-project-root.v1';
const MAX_STORE_BYTES = 256 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

export interface NativeControllerTrustProject {
  projectRootHash: string;
  controllerIdentity: NativeReviewIdentity;
}

export interface NativeControllerTrustStore {
  schema: typeof NATIVE_CONTROLLER_TRUST_STORE_SCHEMA;
  projects: NativeControllerTrustProject[];
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields are invalid`);
  }
}

function isInside(parent: string, target: string): boolean {
  const relative = path.relative(parent, target);
  return (
    relative === '' ||
    (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
  );
}

function normalizedPhysicalRoot(root: string): string {
  const normalized = path.normalize(root).replaceAll('\\', '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export async function nativeControllerProjectRootHash(projectRoot: string): Promise<string> {
  return canonicalHash(
    PROJECT_ROOT_HASH_TAG,
    normalizedPhysicalRoot(await fs.realpath(projectRoot)),
  );
}

export function buildNativeControllerTrustStore(
  projects: readonly NativeControllerTrustProject[],
): NativeControllerTrustStore {
  return parseNativeControllerTrustStore({
    schema: NATIVE_CONTROLLER_TRUST_STORE_SCHEMA,
    projects: [...projects].sort((left, right) =>
      left.projectRootHash.localeCompare(right.projectRootHash, 'en'),
    ),
  });
}

export function parseNativeControllerTrustStore(value: unknown): NativeControllerTrustStore {
  const root = record(value, 'Native controller trust store');
  exactKeys(root, ['schema', 'projects'], 'Native controller trust store');
  if (
    root.schema !== NATIVE_CONTROLLER_TRUST_STORE_SCHEMA ||
    !Array.isArray(root.projects) ||
    root.projects.length === 0 ||
    root.projects.length > 1_024
  ) {
    throw new Error('Native controller trust store is invalid');
  }
  const projects = root.projects.map((value, index): NativeControllerTrustProject => {
    const project = record(value, `Native controller trust project ${index}`);
    exactKeys(
      project,
      ['projectRootHash', 'controllerIdentity'],
      `Native controller trust project ${index}`,
    );
    if (
      typeof project.projectRootHash !== 'string' ||
      !HASH_PATTERN.test(project.projectRootHash)
    ) {
      throw new Error(`Native controller trust project ${index} is invalid`);
    }
    return {
      projectRootHash: project.projectRootHash,
      controllerIdentity: parseNativeReviewIdentity(project.controllerIdentity),
    };
  });
  if (
    JSON.stringify(projects.map((project) => project.projectRootHash)) !==
    JSON.stringify(
      [...new Set(projects.map((project) => project.projectRootHash))].sort((left, right) =>
        left.localeCompare(right, 'en'),
      ),
    )
  ) {
    throw new Error('Native controller trust projects must be sorted and unique');
  }
  return { schema: NATIVE_CONTROLLER_TRUST_STORE_SCHEMA, projects };
}

export function nativeControllerTrustStorePath(): string {
  const testPath =
    process.env.NODE_ENV === 'test'
      ? process.env[NATIVE_CONTROLLER_TRUST_STORE_TEST_ENV]
      : undefined;
  return path.resolve(
    testPath ?? path.join(os.homedir(), '.comet', 'native-controller-trust.json'),
  );
}

/**
 * Read the controller-owned trust root outside the project. No Native command creates or mutates
 * this store; the host/controller provisions it before a signed workflow starts.
 */
export async function readNativeControllerTrustProject(
  projectRoot: string,
): Promise<NativeControllerTrustProject | null> {
  const storePath = nativeControllerTrustStorePath();
  let physicalProjectRoot: string;
  try {
    physicalProjectRoot = await fs.realpath(projectRoot);
  } catch (error) {
    throw new Error('Native project root is unavailable for controller trust', { cause: error });
  }
  let trustedIdentity: Awaited<ReturnType<typeof assertTrustedReadonlyFile>>;
  try {
    trustedIdentity = await assertTrustedReadonlyFile({ file: storePath });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error('Native controller trust store is not host-isolated read-only', {
      cause: error,
    });
  }
  let result: Awaited<ReturnType<typeof readFileRaceSafe>>;
  try {
    result = await readFileRaceSafe(storePath, MAX_STORE_BYTES, {
      label: 'Native controller trust store',
      verify: (_checkpoint, context) => {
        if (isInside(physicalProjectRoot, context.realPath)) {
          throw new Error('Native controller trust store must resolve outside the project');
        }
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    await assertTrustedReadonlyFile({
      file: storePath,
      previous: trustedIdentity,
    });
  } catch (error) {
    throw new Error('Native controller trust store isolation changed while reading', {
      cause: error,
    });
  }
  let parsed: NativeControllerTrustStore;
  try {
    parsed = parseNativeControllerTrustStore(JSON.parse(result.bytes.toString('utf8')));
  } catch (error) {
    throw new Error('Native controller trust store is not valid canonical JSON', {
      cause: error,
    });
  }
  const projectRootHash = await nativeControllerProjectRootHash(projectRoot);
  return parsed.projects.find((project) => project.projectRootHash === projectRootHash) ?? null;
}
