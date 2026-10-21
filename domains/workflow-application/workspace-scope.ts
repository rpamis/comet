import { promises as fs } from 'node:fs';
import path from 'node:path';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import { hashRuntimeValue, RuntimeProtocolError } from '../engine/runtime.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import {
  ensureProtectedProjectDirectory,
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';

const inventoryRef = 'application-scope-locks/workspace-applications.json';
const schema = 'comet.workspace-applications.v1';
const validId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(id);
export interface WorkspaceApplicationClaim {
  runId: string;
  applicationContentHash: string;
  actionId: string;
  attempt: number;
  inputHash: string;
  /** 使用 portableClaimToken 规范化，复制 checkpoint 不会丢失原领取身份。 */
  claimToken: string | null;
}
interface Inventory {
  schema: typeof schema;
  applications: string[];
  identities: Record<string, string>;
  claims: Record<string, WorkspaceApplicationClaim[]>;
}
type ReadClaims = (id: string) => Promise<WorkspaceApplicationClaim[]>;
function fail(message: string): never {
  throw new RuntimeProtocolError('STORE_INDEX_CORRUPT', message);
}
const sameClaim = (left: WorkspaceApplicationClaim, right: WorkspaceApplicationClaim) =>
  left.applicationContentHash === right.applicationContentHash &&
  left.runId === right.runId &&
  left.actionId === right.actionId &&
  left.attempt === right.attempt &&
  left.inputHash === right.inputHash &&
  left.claimToken === right.claimToken;
async function directoryIdentity(root: string, id: string) {
  const inspected = await inspectProtectedProjectPath(root, `applications/${id}`, {
    expected: 'directory',
    label: '应用 Store 身份',
  });
  if (!inspected.exists) return null;
  const stat = await fs.lstat(inspected.target, { bigint: true });
  return `${stat.dev}:${stat.ino}:${stat.birthtimeNs}`;
}
async function readInventory(root: string): Promise<Inventory | null> {
  if (
    !(
      await inspectProtectedProjectPath(root, inventoryRef, {
        expected: 'file',
        label: '工作区应用成员清单',
      })
    ).exists
  )
    return null;
  try {
    const { checksum, ...body } = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        (
          await readProtectedProjectFile(root, inventoryRef, Number.MAX_SAFE_INTEGER, {
            label: '工作区应用成员清单',
          })
        ).bytes,
      ),
    );
    if (
      body.schema !== schema ||
      !Array.isArray(body.applications) ||
      !body.applications.every(validId) ||
      new Set(body.applications).size !== body.applications.length ||
      !body.identities ||
      typeof body.identities !== 'object' ||
      Array.isArray(body.identities) ||
      !body.claims ||
      typeof body.claims !== 'object' ||
      Array.isArray(body.claims) ||
      Object.keys(body.identities).length !== body.applications.length ||
      Object.keys(body.claims).length !== body.applications.length ||
      body.applications.some(
        (id: string) =>
          typeof body.identities[id] !== 'string' ||
          !Array.isArray(body.claims[id]) ||
          body.claims[id].some(
            (claim: WorkspaceApplicationClaim) =>
              !claim ||
              typeof claim.runId !== 'string' ||
              typeof claim.applicationContentHash !== 'string' ||
              typeof claim.actionId !== 'string' ||
              !Number.isSafeInteger(claim.attempt) ||
              typeof claim.inputHash !== 'string' ||
              (claim.claimToken !== null && typeof claim.claimToken !== 'string'),
          ),
      ) ||
      hashRuntimeValue(body) !== checksum
    )
      fail('工作区应用成员清单损坏');
    return body as Inventory;
  } catch (error) {
    return fail(
      `工作区应用成员清单无法读取：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
async function writeInventory(root: string, body: Inventory) {
  await atomicWriteContainedText(
    path.join(root, inventoryRef),
    JSON.stringify({ ...body, checksum: hashRuntimeValue(body) }) + '\n',
    { containedRoot: root, requireAtomicPublication: true },
  );
}

/** 锁顺序固定为工作区、应用、Run；只协调受控写入者，不替代 Run 的执行权威。 */
export async function withWorkspaceApplicationScopeLock<T>(
  root: string,
  applicationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const directory = await ensureProtectedProjectDirectory(root, 'application-scope-locks', {
    label: '工作区应用写入范围锁',
  });
  return withRecoverableFileLock(path.join(directory, '_workspace.lock'), () =>
    withRecoverableFileLock(path.join(directory, `${applicationId}.lock`), operation),
  );
}

/** 调用者持有工作区锁。恢复只放行当前应用的目录，不放行任何普通领取。 */
export async function workspaceApplicationIds(
  root: string,
  currentId: string,
  readClaims: ReadClaims,
  recovering = false,
): Promise<string[]> {
  const directory = await ensureProtectedProjectDirectory(root, 'applications', {
    label: '工作区应用 Store',
  });
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (!recovering && entries.some((entry) => !validId(entry.name) || !entry.isDirectory()))
    fail('工作区应用分区无法确认；请保留现场并检查，不能忽略可能仍占用资源的应用');
  const ids = entries
    .filter((entry) => validId(entry.name) && entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const known = await readInventory(root);
  const inventory: Inventory = known ?? { schema, applications: [], identities: {}, claims: {} };
  for (const id of inventory.applications) {
    if (recovering) continue;
    if ((await directoryIdentity(root, id)) !== inventory.identities[id])
      fail(
        `已登记应用 ${id} 的 Store 目录缺失或身份改变；请恢复原目录或完整的 portable checkpoint`,
      );
  }
  if (!ids.includes(currentId)) {
    await ensureProtectedProjectDirectory(root, `applications/${currentId}`, {
      label: '当前应用 Store',
    });
    ids.push(currentId);
    ids.sort();
  }
  let changed = !known;
  for (const id of ids) {
    if (inventory.applications.includes(id)) continue;
    // 在记录目录身份前建立/恢复原 holder 索引，保留升级前已有的未知执行。
    inventory.claims[id] = await readClaims(id);
    inventory.identities[id] = (await directoryIdentity(root, id))!;
    inventory.applications.push(id);
    changed = true;
  }
  if (changed) {
    inventory.applications.sort();
    await writeInventory(root, inventory);
  }
  return inventory.applications;
}

/** 在权威 CAS 之前保存即将占用的身份；进程崩溃最多留下保守的占用，不能遗漏已开始执行。 */
export async function reserveWorkspaceApplicationClaims(
  root: string,
  id: string,
  claims: WorkspaceApplicationClaim[],
  recovering = false,
) {
  if (!claims.length) return;
  const inventory = await readInventory(root);
  if (
    !inventory ||
    (!recovering && (await directoryIdentity(root, id)) !== inventory.identities[id])
  )
    fail('领取前必须确认工作区应用成员身份');
  for (const claim of claims)
    if (!inventory.claims[id].some((known) => sameClaim(known, claim)))
      inventory.claims[id].push(claim);
  await writeInventory(root, inventory);
}

/** 原应用丢失时，旧执行不能由更早的无 claim checkpoint 冒充已停止。 */
export async function validateWorkspaceApplicationRecovery(
  root: string,
  id: string,
  runId: string,
  restored: WorkspaceApplicationClaim[],
) {
  const inventory = await readInventory(root);
  if (!inventory || (await directoryIdentity(root, id)) === inventory.identities[id]) return;
  for (const known of inventory.claims[id] ?? [])
    if (known.runId === runId && !restored.some((claim) => sameClaim(known, claim)))
      fail(
        `portable checkpoint 缺少原执行身份：${runId} / ${known.actionId}；必须保留未知执行并核对停止事实`,
      );
}

/** CAS 完成后以 holder 索引的实际记录收敛；丢失恢复必须先补齐所有已知占用，才可绑定新目录。 */
export async function settleWorkspaceApplicationClaims(
  root: string,
  id: string,
  readClaims: ReadClaims,
  recovering = false,
) {
  const inventory = await readInventory(root);
  if (!inventory || !inventory.applications.includes(id)) return;
  const identity = await directoryIdentity(root, id);
  const actual = await readClaims(id);
  if (identity !== inventory.identities[id]) {
    if (!recovering || !identity) fail('工作区应用 Store 身份已改变');
    if (inventory.claims[id].some((known) => !actual.some((claim) => sameClaim(known, claim))))
      return;
    inventory.identities[id] = identity;
  }
  inventory.claims[id] = actual;
  await writeInventory(root, inventory);
}

/** 恢复事实记录不代表重新执行；其他待恢复分区继续保留原目录围栏。 */
export async function workspaceApplicationIdentityCurrent(
  root: string,
  id: string,
): Promise<boolean> {
  const inventory = await readInventory(root);
  if (!inventory?.applications.includes(id)) return false;
  try {
    return (await directoryIdentity(root, id)) === inventory.identities[id];
  } catch {
    return false;
  }
}
