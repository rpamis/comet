import { promises as fs } from 'node:fs';
import { memoizedHookRead } from '../../platform/process/hook-read-cache.js';
import path from 'node:path';

import { atomicWriteContainedText } from './contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from './protected-project-path.js';
import type { CometProjectWorkflow } from './types.js';
import { resolveWorkspaceRuntimeRoot, readWorkspaceRuntimeRoots } from './workspace-runtime.js';

export const COMET_CHANGE_OWNER_SCHEMA = 'comet.change-owner.v1' as const;

export const SDK_APPLICATIONS = [
  'native',
  'classic-full',
  'classic-hotfix',
  'classic-tweak',
] as const;
export type SdkApplication = (typeof SDK_APPLICATIONS)[number];

export interface SdkChangeOwner {
  schema: typeof COMET_CHANGE_OWNER_SCHEMA;
  workflow: CometProjectWorkflow;
  change: string;
  format: 'sdk';
  application: string;
  runId: string;
}

export interface CompatChangeOwner {
  schema: typeof COMET_CHANGE_OWNER_SCHEMA;
  workflow: CometProjectWorkflow;
  change: string;
  format: 'compat';
}

export type ChangeRuntimeOwner = SdkChangeOwner | CompatChangeOwner;

// 只读请求共享一次 Runtime/fence 发现；写入路径仍执行原迁移检查，下一请求重新读取。
const readOnlyRuntimeRoots = memoizedHookRead('changeOwnerRuntimeRoots', (projectRoot: string) =>
  readWorkspaceRuntimeRoots(projectRoot),
);

const NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

function ownerRef(workflow: CometProjectWorkflow, change: string): string {
  if (workflow !== 'native' && workflow !== 'classic') {
    throw new Error(`Unsupported change workflow: ${workflow}`);
  }
  if (!NAME_PATTERN.test(change)) throw new Error(`Invalid change name: ${change}`);
  return `change-owners/${workflow}/${change}.json`;
}

function parseOwner(
  value: unknown,
  workflow: CometProjectWorkflow,
  change: string,
): ChangeRuntimeOwner {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Change runtime owner must be a JSON object');
  }
  const owner = value as Record<string, unknown>;
  const validCommon =
    owner.schema === COMET_CHANGE_OWNER_SCHEMA &&
    owner.workflow === workflow &&
    owner.change === change;
  const validCompat = owner.format === 'compat' && Object.keys(owner).length === 4;
  const validSdk =
    owner.format === 'sdk' &&
    Object.keys(owner).length === 6 &&
    owner.runId === change &&
    ((typeof owner.application === 'string' &&
      /^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(owner.application) &&
      !(SDK_APPLICATIONS as readonly string[]).includes(owner.application)) ||
      (workflow === 'native'
        ? owner.application === 'native'
        : owner.application === 'classic-full' ||
          owner.application === 'classic-hotfix' ||
          owner.application === 'classic-tweak'));
  if (!validCommon || (!validCompat && !validSdk)) {
    throw new Error(`Invalid change runtime owner for ${workflow}/${change}`);
  }
  return owner as unknown as ChangeRuntimeOwner;
}

async function readOwnerFile(
  root: string,
  reference: string,
  workflow: CometProjectWorkflow,
  change: string,
): Promise<ChangeRuntimeOwner | null> {
  let bytes: Buffer;
  try {
    ({ bytes } = await readProtectedProjectFile(root, reference, 16 * 1024, {
      label: 'change runtime owner',
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new Error(`Invalid change runtime owner JSON for ${workflow}/${change}`);
  }
  return parseOwner(value, workflow, change);
}

export async function readChangeRuntimeOwner(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  change: string,
  options: { readOnly?: boolean } = {},
): Promise<ChangeRuntimeOwner | null> {
  const ref = ownerRef(workflow, change);
  if (!options.readOnly) {
    return readOwnerFile(await resolveWorkspaceRuntimeRoot(projectRoot), ref, workflow, change);
  }
  const [runtimeRoot, legacyRoot] = await readOnlyRuntimeRoots(projectRoot);
  const volume = path.parse(runtimeRoot).root;
  const home = await inspectProtectedProjectPath(
    volume,
    path.relative(volume, runtimeRoot).replaceAll('\\', '/'),
    {
      label: 'read-only workspace Runtime',
      expected: 'directory',
    },
  );
  const current = home.exists ? await readOwnerFile(runtimeRoot, ref, workflow, change) : null;
  const legacy = legacyRoot ? await readOwnerFile(legacyRoot, ref, workflow, change) : null;
  // fence 只用于阻断旧路径；绝不跟随其中记录的外部工作区或目标目录。
  if (
    current &&
    legacy &&
    JSON.stringify(Object.entries(current).sort()) !== JSON.stringify(Object.entries(legacy).sort())
  ) {
    throw new Error(`Conflicting current and legacy Runtime owners for ${workflow}/${change}`);
  }
  return current ?? legacy;
}

const cachedReadSdkChangeOwner = memoizedHookRead(
  'sdkChangeOwner',
  (
    projectRoot: string,
    workflow: CometProjectWorkflow,
    change: string,
    options: { readOnly?: boolean },
  ) => readSdkChangeOwnerUncached(projectRoot, workflow, change, options),
);

async function readSdkChangeOwnerUncached(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  change: string,
  options: { readOnly?: boolean } = {},
): Promise<SdkChangeOwner | null> {
  const owner = await readChangeRuntimeOwner(projectRoot, workflow, change, options);
  return owner?.format === 'sdk' ? owner : null;
}

export async function readSdkChangeOwner(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  change: string,
  options: { readOnly?: boolean } = {},
): Promise<SdkChangeOwner | null> {
  return options.readOnly
    ? cachedReadSdkChangeOwner(projectRoot, workflow, change, options)
    : readSdkChangeOwnerUncached(projectRoot, workflow, change, options);
}

export async function listSdkChangeNames(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  options: { readOnly?: boolean } = {},
): Promise<string[]> {
  const roots = options.readOnly
    ? await readOnlyRuntimeRoots(projectRoot)
    : [await resolveWorkspaceRuntimeRoot(projectRoot)];
  const discovered = new Set<string>();
  for (const runtimeRoot of roots) {
    const volume = path.parse(runtimeRoot).root;
    const directory = await inspectProtectedProjectPath(
      volume,
      path.relative(volume, path.join(runtimeRoot, 'change-owners', workflow)),
      {
        label: `${workflow} change runtime owners`,
        expected: 'directory',
      },
    );
    if (!directory.exists) continue;
    const entries = await fs.readdir(directory.target, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.endsWith('.json')) continue;
      const name = entry.name.slice(0, -'.json'.length);
      if (!entry.isFile() || !NAME_PATTERN.test(name))
        throw new Error(`Invalid ${workflow} change runtime owner entry: ${entry.name}`);
      discovered.add(name);
    }
  }
  const candidates = [...discovered];
  const results = new Array<PromiseSettledResult<string | null>>(candidates.length);
  let next = 0;
  // 每条 owner 仍完整读取并校验；收齐结果后按原枚举顺序抛错。
  await Promise.all(
    Array.from({ length: Math.min(options.readOnly ? 8 : 1, candidates.length) }, async () => {
      for (;;) {
        const index = next++;
        if (index >= candidates.length) return;
        const name = candidates[index];
        try {
          const owner = await readSdkChangeOwner(projectRoot, workflow, name, options);
          if (!owner && !(await readChangeRuntimeOwner(projectRoot, workflow, name, options)))
            throw new Error(`${workflow} change runtime owner disappeared: ${name}`);
          results[index] = { status: 'fulfilled', value: owner ? name : null };
        } catch (reason) {
          results[index] = { status: 'rejected', reason };
        }
      }
    }),
  );
  const names: string[] = [];
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    if (result.value) names.push(result.value);
  }
  return names.sort((left, right) => left.localeCompare(right, 'en'));
}

async function registerChangeRuntimeOwner<T extends ChangeRuntimeOwner>(
  projectRoot: string,
  owner: T,
): Promise<T> {
  const ref = ownerRef(owner.workflow, owner.change);
  const runtimeRoot = await resolveWorkspaceRuntimeRoot(projectRoot);
  const validated = parseOwner(owner, owner.workflow, owner.change) as T;
  await ensureProtectedProjectDirectory(runtimeRoot, path.posix.dirname(ref), {
    label: 'change runtime owner directory',
  });
  try {
    await atomicWriteContainedText(
      path.join(runtimeRoot, ...ref.split('/')),
      `${JSON.stringify(validated)}\n`,
      {
        containedRoot: runtimeRoot,
        exclusive: true,
        requireAtomicPublication: true,
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const current = await readChangeRuntimeOwner(projectRoot, owner.workflow, owner.change);
    if (JSON.stringify(current) !== JSON.stringify(validated)) {
      throw new Error(
        `Change ${owner.workflow}/${owner.change} is already bound to another Runtime`,
        { cause: error },
      );
    }
  }
  return validated;
}

export function registerSdkChangeOwner(
  projectRoot: string,
  owner: SdkChangeOwner,
): Promise<SdkChangeOwner> {
  return registerChangeRuntimeOwner(projectRoot, owner);
}

export function registerCompatChangeOwner(
  projectRoot: string,
  owner: CompatChangeOwner,
): Promise<CompatChangeOwner> {
  return registerChangeRuntimeOwner(projectRoot, owner);
}

export async function assertChangeNotSdkOwned(
  projectRoot: string,
  workflow: CometProjectWorkflow,
  change: string,
): Promise<void> {
  const owner = await readSdkChangeOwner(projectRoot, workflow, change);
  if (owner) {
    throw new Error(
      `Change ${workflow}/${change} belongs to SDK Run ${owner.runId}; use its SDK application`,
    );
  }
}
