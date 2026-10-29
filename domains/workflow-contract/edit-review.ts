import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import {
  proposedCometHookFileContent,
  type CometHookRequest,
} from '../../platform/process/hook-adapter.js';
import type { CliActionContinuation } from './output-envelope.js';
import { atomicWriteContainedText } from './contained-atomic-write.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
  hashProtectedProjectFile,
  ensureProtectedProjectDirectory,
} from './protected-project-path.js';

export interface EditReviewScope {
  projectRoot: string;
  runtimeRoot: string;
  workflow: 'native' | 'classic';
  change: string;
  candidateKey: string;
  formalPrefixes: readonly string[];
  /** 当前 Agent 判断只绑定原始内容；缺省保留旧提案的解析兼容。 */
  judgment?: 'agent';
  allowedFormalPaths?: readonly string[];
  /** 已接受正式来源的身份；独立于普通保存和 Run revision。 */
  approvedSources?: Readonly<Record<string, string>>;
}
export type EditReviewDecision =
  'non-behavioral' | 'implementation-changed' | 'requirements-changed' | 'discard';
export interface EditReviewInput {
  proposalHash: string;
  decision: EditReviewDecision;
  summary: string;
  reviewer?: { sessionId: string; claimToken: string };
  retainedCheckActionIds?: string[];
  retainedChecks?: Array<{ actionId: string; checkId: string }>;
}
export interface EditReviewCommandOptions {
  projectRoot: string;
  name: string;
  operation: string;
  file?: string;
  confirmed?: boolean;
  sessionId?: string;
  proposalHash?: string;
}
export interface EditReviewAuthority {
  kind: 'runtime-agent' | 'runtime-verifier' | 'user-confirmed' | 'runtime-superseded';
  executionRef: string;
}
export interface EditReviewClaim {
  actionId: string;
  attempt: number;
  inputHash: string;
  claimToken: string;
  sessionId: string;
}

export function agentEditReviewRecordTemplate(proposalHash: string, claim: EditReviewClaim) {
  return {
    proposalHash,
    decision: '<non-behavioral|implementation-changed|requirements-changed>',
    summary: '<说明实际变化、影响范围及需要补充的工作>',
    claim: { ...claim },
    retainedCheckActionIds: [] as string[],
    retainedChecks: [] as Array<{ actionId: string; checkId: string }>,
  };
}

/** 复用当前 Action 的领取，不为内容判断创建第二个会话。 */
export function claimedAgentEditReviewAuthority(
  actions: readonly {
    id: string;
    stepId: string;
    attempt: number;
    inputHash: string;
    status: string;
    claim?: { token: string; sessionId?: string };
  }[],
  allowedSteps: readonly string[],
  claim: EditReviewClaim,
): EditReviewAuthority {
  const action = claim && actions.find((entry) => entry.id === claim.actionId);
  if (
    !claim?.sessionId?.trim() ||
    !claim.claimToken ||
    !action ||
    !allowedSteps.includes(action.stepId) ||
    action.status !== 'running' ||
    action.attempt !== claim.attempt ||
    action.inputHash !== claim.inputHash ||
    action.claim?.token !== claim.claimToken ||
    action.claim.sessionId !== claim.sessionId
  )
    throw new Error('内容判断需要当前 Agent 的有效 Action 领取');
  return {
    kind: 'runtime-agent',
    executionRef: `${action.id}/${action.attempt}/${claim.sessionId}`,
  };
}

/** 沿用 SDK 当前领取身份；这是会话隔离检查，不新增宿主身份认证。 */
export function claimedEditReviewAuthority(
  actions: readonly {
    id: string;
    stepId: string;
    attempt: number;
    inputHash: string;
    status: string;
    claim?: { token: string; sessionId?: string };
  }[],
  stepId: string,
  builderSession: string | undefined,
  claim: EditReviewClaim,
): EditReviewAuthority {
  if (!claim) throw new Error('编辑复核缺少当前 Verifier claim');
  const action = actions.find((entry) => entry.id === claim.actionId);
  if (
    !builderSession ||
    !claim.sessionId ||
    claim.sessionId === builderSession ||
    action?.stepId !== stepId ||
    action.status !== 'running' ||
    action.attempt !== claim.attempt ||
    action.inputHash !== claim.inputHash ||
    action.claim?.token !== claim.claimToken ||
    action.claim.sessionId !== claim.sessionId
  )
    throw new Error('编辑复核必须由当前独立 Verifier 的已领取 Action 提交');
  return {
    kind: 'runtime-verifier',
    executionRef: `${action.id}/${action.attempt}/${claim.sessionId}`,
  };
}
export interface ReviewedEdit {
  path: string;
  beforeHash: string | null;
  afterHash: string;
  beforeInputHash: string | null;
  beforeFingerprint: string | null;
  executable: boolean;
  beforeGitHashes?: string[];
  afterGitHashes?: string[];
  beforeMode?: string;
  afterMode?: string;
  sourceEvidence?: string;
}
export interface EditReviewProposal {
  schema: 'comet.edit-review.request.v1';
  binding: { workflow: string; change: string; candidateKey: string; projectRootId: string };
  edits: ReviewedEdit[];
  generation: number;
  proposalHash: string;
  applied?: true;
  judgment?: 'agent';
  observed?: true;
}
export interface ReviewReceipt {
  schema: 'comet.edit-review.receipt.v1';
  proposalHash: string;
  decision: EditReviewDecision;
  summary: string;
  authority: EditReviewAuthority;
  retainedCheckActionIds?: string[];
  retainedChecks?: Array<{ actionId: string; checkId: string }>;
}
function validRetainedChecks(
  value: unknown,
): value is NonNullable<ReviewReceipt['retainedChecks']> {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry &&
        typeof entry.actionId === 'string' &&
        entry.actionId.trim() &&
        typeof entry.checkId === 'string' &&
        entry.checkId.trim(),
    ) &&
    new Set(value.map((entry) => JSON.stringify([entry.actionId, entry.checkId]))).size ===
      value.length
  );
}
export interface EditReviewObservation extends EditReviewProposal {
  receipt: ReviewReceipt | null;
}
function currentEdits(scope: EditReviewScope, review: EditReviewProposal) {
  return review.edits.filter(
    (edit) => !edit.sourceEvidence || scope.approvedSources?.[edit.path] === edit.sourceEvidence,
  );
}

function sourceEvidenceFor(scope: EditReviewScope, ref: string) {
  if (!scope.approvedSources) return {};
  const sourceEvidence = scope.approvedSources[ref];
  if (!sourceEvidence || !HASH.test(sourceEvidence))
    throw new Error('正式材料没有当前适用的批准来源；沿原工作流取得该来源的批准或诊断缺失证据');
  return { sourceEvidence };
}
const HASH = /^[a-f0-9]{64}$/u;
const MAX_BYTES = 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const editContentHash = (source: string) => createHash('sha256').update(source).digest('hex');
const gitContentHashes = (source: string) =>
  ['sha1', 'sha256'].map(
    (algorithm) =>
      `git:${createHash(algorithm)
        .update(`blob ${Buffer.byteLength(source)}\0`)
        .update(source)
        .digest('hex')}`,
  );
const inputHash = (text: string) =>
  createHash('sha256').update(Buffer.from(text).toString('base64')).digest('hex');
const objectHash = (value: unknown) => editContentHash(JSON.stringify(value));

async function observedContent(scope: EditReviewScope, file: string) {
  const inspection = await inspectProtectedProjectPath(scope.projectRoot, file, {
    label: '原始变化目标',
    expected: 'file',
  });
  if (!inspection.exists) return { hash: 'missing', executable: false };
  const source = await hashProtectedProjectFile(scope.projectRoot, file, { label: '原始变化目标' });
  return {
    hash: source.digest,
    executable: process.platform !== 'win32' && Boolean(Number(source.stat.mode) & 0o111),
  };
}

async function reviewContent(
  scope: EditReviewScope,
  review: EditReviewProposal,
  edit: ReviewedEdit,
) {
  return review.observed
    ? observedContent(scope, edit.path)
    : currentContent(scope, edit.path, review.applied);
}

async function binding(scope: EditReviewScope): Promise<EditReviewProposal['binding']> {
  if (!scope.candidateKey || !scope.change || !['native', 'classic'].includes(scope.workflow))
    throw new Error('编辑复核缺少候选或工作流绑定');
  return {
    workflow: scope.workflow,
    change: scope.change,
    candidateKey: scope.candidateKey,
    projectRootId: editContentHash(await fs.realpath(scope.projectRoot)),
  };
}
async function directory(scope: EditReviewScope, write = false): Promise<string> {
  const ref = `edit-reviews/${objectHash(await binding(scope))}`;
  if (write)
    return ensureProtectedProjectDirectory(scope.runtimeRoot, ref, { label: '编辑复核记录' });
  return (
    await inspectProtectedProjectPath(scope.runtimeRoot, ref, {
      label: '编辑复核记录',
      expected: 'directory',
    })
  ).target;
}
async function checkJudgmentIndex(scope: EditReviewScope, write = false) {
  const bound = await binding(scope);
  const identity = {
    workflow: bound.workflow,
    change: bound.change,
    projectRootId: bound.projectRootId,
  };
  const ref = 'edit-check-judgments';
  const root = write
    ? await ensureProtectedProjectDirectory(scope.runtimeRoot, ref, { label: '检查判断索引' })
    : (
        await inspectProtectedProjectPath(scope.runtimeRoot, ref, {
          label: '检查判断索引',
          expected: 'directory',
        })
      ).target;
  return { root, file: `${objectHash(identity)}.json`, identity };
}

async function indexCheckJudgment(scope: EditReviewScope, proposalHash: string) {
  const { root, file, identity } = await checkJudgmentIndex(scope, true);
  await withRecoverableFileLock(path.join(root, `${file}.lock`), async () => {
    const saved = (await readJson(root, file)) as {
      identity?: unknown;
      reviews?: Array<{ candidateKey: string; proposalHash: string }>;
    } | null;
    if (
      saved &&
      (objectHash(saved.identity) !== objectHash(identity) || !Array.isArray(saved.reviews))
    )
      throw new Error('检查判断索引身份不匹配');
    const reviews = saved?.reviews ?? [];
    if (
      reviews.some(
        (entry) => entry.candidateKey === scope.candidateKey && entry.proposalHash === proposalHash,
      )
    )
      return;
    await atomicWriteContainedText(
      path.join(root, file),
      JSON.stringify({
        identity,
        reviews: [...reviews, { candidateKey: scope.candidateKey, proposalHash }],
      }),
      { containedRoot: root },
    );
  });
}

async function indexedCheckJudgments(scope: EditReviewScope): Promise<EditReviewObservation[]> {
  let index: Awaited<ReturnType<typeof checkJudgmentIndex>>;
  try {
    index = await checkJudgmentIndex(scope);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const saved = (await readJson(index.root, index.file)) as {
    identity?: unknown;
    reviews?: Array<{ candidateKey: string; proposalHash: string }>;
  } | null;
  if (!saved) return [];
  if (objectHash(saved.identity) !== objectHash(index.identity) || !Array.isArray(saved.reviews))
    throw new Error('检查判断索引身份不匹配');
  const result: EditReviewObservation[] = [];
  for (const entry of saved.reviews) {
    if (
      typeof entry.candidateKey !== 'string' ||
      !entry.candidateKey ||
      !HASH.test(entry.proposalHash)
    )
      throw new Error('检查判断索引引用无效');
    const original = { ...scope, candidateKey: entry.candidateKey };
    const root = await directory(original);
    const proposal = parseProposal(await readJson(root, `${entry.proposalHash}.request.json`));
    if (
      proposal.proposalHash !== entry.proposalHash ||
      objectHash(proposal.binding) !== objectHash(await binding(original))
    )
      throw new Error('检查判断不属于原提案');
    result.push({
      ...proposal,
      receipt: parseReceipt(
        (await readJson(root, `${entry.proposalHash}.discard.json`)) ??
          (await readJson(root, `${entry.proposalHash}.review.json`)),
        entry.proposalHash,
      ),
    });
  }
  return result;
}

async function currentContent(
  scope: EditReviewScope,
  ref: string,
  applied = false,
): Promise<{ text: string; hash: string; executable: boolean } | null> {
  const target = await inspectProtectedProjectPath(scope.projectRoot, ref, {
    label: '编辑复核目标',
    expected: 'file',
  });
  if (!target.exists) return null;
  const source = await readProtectedProjectFile(
    scope.projectRoot,
    ref,
    applied ? Number.MAX_SAFE_INTEGER : MAX_BYTES,
    {
      label: '编辑复核目标',
    },
  );
  const text = decoder.decode(source.bytes);
  if (text.includes('\0')) throw new Error('编辑复核只接受完整 UTF-8 文本');
  return {
    text,
    hash: editContentHash(text),
    executable:
      process.platform !== 'win32' && Boolean((await fs.lstat(target.target)).mode & 0o111),
  };
}
async function readJson(root: string, file: string): Promise<unknown | null> {
  try {
    return JSON.parse(
      (
        await readProtectedProjectFile(root, file, Number.MAX_SAFE_INTEGER, {
          label: '编辑复核记录',
        })
      ).bytes.toString('utf8'),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
function parseProposal(value: unknown): EditReviewProposal {
  const proposal = value as EditReviewProposal;
  if (
    !proposal ||
    proposal.schema !== 'comet.edit-review.request.v1' ||
    !proposal.binding ||
    !Array.isArray(proposal.edits) ||
    !proposal.edits.length ||
    (proposal.judgment !== 'agent' && proposal.edits.length > 32) ||
    !HASH.test(proposal.proposalHash)
  )
    throw new Error('编辑复核请求无效');
  if (!Number.isSafeInteger(proposal.generation) || proposal.generation < 0)
    throw new Error('编辑复核请求序号无效');
  const body = {
    schema: proposal.schema,
    binding: proposal.binding,
    edits: proposal.edits,
    ...(proposal.applied === true ? { applied: true as const } : {}),
    ...(proposal.judgment === 'agent' ? { judgment: 'agent' as const } : {}),
    ...(proposal.observed === true ? { observed: true as const } : {}),
    generation: proposal.generation,
  };
  if (proposal.judgment !== undefined && proposal.judgment !== 'agent')
    throw new Error('编辑判断模式无效');
  if (
    proposal.observed !== undefined &&
    (proposal.observed !== true || proposal.judgment !== 'agent' || proposal.applied !== true)
  )
    throw new Error('原始变化观察模式无效');
  if (proposal.applied !== undefined && proposal.applied !== true)
    throw new Error('编辑复核应用状态无效');
  if (objectHash(body) !== proposal.proposalHash) throw new Error('编辑复核请求 hash 不匹配');
  for (const edit of proposal.edits) {
    if (
      typeof edit.path !== 'string' ||
      edit.path !== path.posix.normalize(edit.path) ||
      path.posix.isAbsolute(edit.path) ||
      edit.path.split('/').includes('..') ||
      (!HASH.test(edit.afterHash) && !(proposal.observed && edit.afterHash === 'missing')) ||
      (edit.beforeHash !== null &&
        !HASH.test(edit.beforeHash) &&
        !(proposal.observed && /^git:(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(edit.beforeHash))) ||
      (edit.beforeInputHash !== null && !HASH.test(edit.beforeInputHash)) ||
      (edit.beforeFingerprint !== null && !HASH.test(edit.beforeFingerprint)) ||
      typeof edit.executable !== 'boolean' ||
      (edit.sourceEvidence !== undefined && !HASH.test(edit.sourceEvidence)) ||
      [edit.beforeGitHashes, edit.afterGitHashes].some(
        (hashes) =>
          hashes !== undefined &&
          (!Array.isArray(hashes) ||
            hashes.some(
              (hash) =>
                typeof hash !== 'string' || !/^git:(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(hash),
            )),
      )
    )
      throw new Error('编辑复核文件绑定无效');
  }
  return proposal;
}
function parseReceipt(value: unknown, hash: string): ReviewReceipt | null {
  if (value === null) return null;
  const receipt = value as ReviewReceipt;
  if (
    receipt.schema !== 'comet.edit-review.receipt.v1' ||
    receipt.proposalHash !== hash ||
    !['non-behavioral', 'implementation-changed', 'requirements-changed', 'discard'].includes(
      receipt.decision,
    ) ||
    typeof receipt.summary !== 'string' ||
    !receipt.summary.trim() ||
    !['runtime-agent', 'runtime-verifier', 'user-confirmed', 'runtime-superseded'].includes(
      receipt.authority?.kind,
    ) ||
    (receipt.authority?.kind === 'runtime-superseded' && receipt.decision !== 'discard') ||
    !receipt.authority.executionRef ||
    (receipt.retainedChecks !== undefined && !validRetainedChecks(receipt.retainedChecks)) ||
    (receipt.retainedCheckActionIds !== undefined &&
      (!Array.isArray(receipt.retainedCheckActionIds) ||
        receipt.retainedCheckActionIds.some((id) => typeof id !== 'string' || !id.trim()) ||
        new Set(receipt.retainedCheckActionIds).size !== receipt.retainedCheckActionIds.length))
  )
    throw new Error('编辑复核结果无效');
  return receipt;
}
async function writeOnce(root: string, ref: string, value: unknown): Promise<void> {
  const existing = await readJson(root, ref);
  if (existing !== null) {
    if (objectHash(existing) !== objectHash(value)) throw new Error('编辑复核已有不同记录');
    return;
  }
  await atomicWriteContainedText(path.join(root, ref), JSON.stringify(value) + '\n', {
    containedRoot: root,
  });
}

/** 在批准证据建立时保留原文，供用户直接编辑后的差异读取；内容摘要仍是权威关联。 */
export async function rememberApprovedEditOriginal(
  scope: EditReviewScope,
  file: string,
  source: string,
  expectedHash: string,
  evidenceHash?: string,
): Promise<void> {
  if (!HASH.test(expectedHash) || editContentHash(source) !== expectedHash)
    throw new Error('批准原文与证据摘要不匹配');
  const root = await directory(scope, true);
  const ref = `${objectHash(file)}.${expectedHash}.original`;
  try {
    await atomicWriteContainedText(path.join(root, ref), source, {
      containedRoot: root,
      exclusive: true,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await readApprovedEditOriginal(scope, file, expectedHash);
  }
  if (evidenceHash) {
    if (!HASH.test(evidenceHash)) throw new Error('批准证据摘要无效');
    await withRecoverableFileLock(path.join(root, '.approved-evidence.lock'), () =>
      writeOnce(root, `${objectHash(file)}.${evidenceHash}.binding.json`, {
        file,
        evidenceHash,
        contentHash: expectedHash,
      }),
    );
  }
}

/** 计划等组合证据通过原始内容锚点读取；不会把组合摘要当作文件摘要。 */
export async function listApprovedEditOriginalsForEvidence(
  scope: EditReviewScope,
  evidenceHash: string,
) {
  if (!HASH.test(evidenceHash)) throw new Error('批准证据摘要无效');
  const root = await directory(scope);
  const files = await fs.readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const result: Array<{ file: string; contentHash: string }> = [];
  for (const name of files
    .filter((name) => name.endsWith(`.${evidenceHash}.binding.json`))
    .sort()) {
    const anchor = (await readJson(root, name)) as {
      file?: string;
      evidenceHash?: string;
      contentHash?: string;
    } | null;
    if (
      !anchor?.file ||
      anchor.evidenceHash !== evidenceHash ||
      !anchor.contentHash ||
      !HASH.test(anchor.contentHash) ||
      anchor.file !== path.posix.normalize(anchor.file) ||
      path.posix.isAbsolute(anchor.file) ||
      anchor.file.startsWith('../') ||
      name !== `${objectHash(anchor.file)}.${evidenceHash}.binding.json`
    )
      throw new Error('批准原文清单的证据锚点不匹配');
    result.push({ file: anchor.file, contentHash: anchor.contentHash });
  }
  return result;
}

export function readApprovedEditOriginalForEvidence(
  scope: EditReviewScope,
  file: string,
  evidenceHash: string,
): Promise<{ text: string; contentHash: string }>;
export function readApprovedEditOriginalForEvidence(
  scope: EditReviewScope,
  file: string,
  evidenceHash: string,
  options: { allowMissing: true },
): Promise<{ text: string; contentHash: string } | null>;
export async function readApprovedEditOriginalForEvidence(
  scope: EditReviewScope,
  file: string,
  evidenceHash: string,
  options: { allowMissing?: boolean } = {},
): Promise<{ text: string; contentHash: string } | null> {
  if (!HASH.test(evidenceHash)) throw new Error('批准证据摘要无效');
  const root = await directory(scope);
  const anchor = (await readJson(root, `${objectHash(file)}.${evidenceHash}.binding.json`)) as {
    file?: string;
    evidenceHash?: string;
    contentHash?: string;
  } | null;
  if (anchor === null && options.allowMissing) return null;
  if (
    !anchor ||
    anchor.file !== file ||
    anchor.evidenceHash !== evidenceHash ||
    !anchor.contentHash ||
    !HASH.test(anchor.contentHash)
  )
    throw new Error('批准原文的证据锚点缺失或不匹配');
  return {
    text: await readApprovedEditOriginal(scope, file, anchor.contentHash),
    contentHash: anchor.contentHash,
  };
}

export async function readApprovedEditOriginal(
  scope: EditReviewScope,
  file: string,
  expectedHash: string,
): Promise<string> {
  if (!HASH.test(expectedHash)) throw new Error('批准原文缺少有效摘要');
  const root = await directory(scope);
  const saved = await readProtectedProjectFile(
    root,
    `${objectHash(file)}.${expectedHash}.original`,
    Number.MAX_SAFE_INTEGER,
    { label: '批准的原始内容' },
  );
  if (createHash('sha256').update(saved.bytes).digest('hex') !== expectedHash)
    throw new Error('批准原文与证据摘要不匹配');
  return decoder.decode(saved.bytes);
}

/** 原请求留在调用方的临时文件，只保存路径及摘要，恢复时重新校验内容。 */
export async function rememberEditReviewInput(
  scope: EditReviewScope,
  proposalHash: string,
  file: string,
  expectedSource?: string,
) {
  if (!HASH.test(proposalHash)) throw new Error('编辑复核提案无效');
  const source = await fs.readFile(file, 'utf8');
  if (expectedSource !== undefined && editContentHash(source) !== editContentHash(expectedSource))
    throw new Error('原编辑请求在准备复核期间发生变化，请重新读取');
  const root = await directory(scope, true);
  await atomicWriteContainedText(
    path.join(root, `${proposalHash}.input-ref.json`),
    JSON.stringify({
      file: path.resolve(file),
      hash: editContentHash(source),
    }) + '\n',
    { containedRoot: root },
  );
}

async function editReviewInputReference(scope: EditReviewScope, proposalHash: string) {
  const root = await directory(scope);
  const ref = (await readJson(root, `${proposalHash}.input-ref.json`)) as {
    file?: unknown;
    hash?: unknown;
  } | null;
  if (
    !ref ||
    typeof ref.file !== 'string' ||
    !path.isAbsolute(ref.file) ||
    typeof ref.hash !== 'string' ||
    !HASH.test(ref.hash)
  )
    return null;
  try {
    const source = await fs.readFile(ref.file, 'utf8');
    return editContentHash(source) === ref.hash ? { file: ref.file, hash: ref.hash } : null;
  } catch {
    return null;
  }
}

export async function readEditReviewInput(
  scope: EditReviewScope,
  proposalHash: string,
): Promise<string | null> {
  const reference = await editReviewInputReference(scope, proposalHash);
  if (!reference) return null;
  const source = await fs.readFile(reference.file, 'utf8');
  return editContentHash(source) === reference.hash ? source : null;
}

/** 编辑复核只授权一份具体差异，不领取或完成原工作流的正式 Verify Action。 */
export async function claimEditReview(
  scope: EditReviewScope,
  options: {
    sessionId: string;
    builderExecutionRef: string;
    proposalHash?: string;
  },
) {
  if (
    !options.sessionId?.trim() ||
    !options.builderExecutionRef ||
    (scope.judgment !== 'agent' && options.sessionId === options.builderExecutionRef) ||
    options.sessionId.includes('\0')
  )
    throw new Error('编辑复核必须由独立于 Builder 的会话执行');
  const reviews = await inspectEditReviews(scope);
  const pending = reviews.filter((review) => !review.receipt);
  const proposal = options.proposalHash
    ? reviews.find((review) => review.proposalHash === options.proposalHash)
    : pending.length === 1
      ? pending[0]
      : undefined;
  if (!proposal) throw new Error('请选择当前候选中的具体编辑复核提案');
  if (currentEdits(scope, proposal).length !== proposal.edits.length)
    throw new Error('正式材料的批准来源已变化，请基于当前批准重新观察');
  const root = await directory(scope, true);
  const ref = `${proposal.proposalHash}.${objectHash(options.sessionId)}.claim.json`;
  const claim = await withRecoverableFileLock(path.join(root, '.lock'), async () => {
    const existing = await readJson(root, ref);
    if (existing)
      return existing as {
        proposalHash: string;
        sessionId: string;
        builderExecutionRef: string;
        claimToken: string;
      };
    if (proposal.receipt)
      throw new Error('提案已有复核结论；恢复时使用原复核会话与提案，不重新派发');
    const created = {
      proposalHash: proposal.proposalHash,
      sessionId: options.sessionId,
      builderExecutionRef: options.builderExecutionRef,
      claimToken: randomUUID(),
    };
    await writeOnce(root, ref, created);
    return created;
  });
  if (
    claim.proposalHash !== proposal.proposalHash ||
    claim.sessionId !== options.sessionId ||
    claim.builderExecutionRef !== options.builderExecutionRef ||
    !claim.claimToken
  )
    throw new Error('编辑复核领取记录与当前候选不匹配');
  const input = await editReviewInputReference(scope, proposal.proposalHash);
  return {
    proposal,
    builderExecutionRef: options.builderExecutionRef,
    readPaths: proposal.edits.map((edit) => path.resolve(scope.projectRoot, edit.path)),
    ...(input ? { originalRequestRef: input.file, originalRequestHash: input.hash } : {}),
    recordTemplate: {
      proposalHash: proposal.proposalHash,
      decision: '<non-behavioral|implementation-changed|requirements-changed|discard>',
      summary: '<结合实际使用方和验收条件说明判断依据>',
      reviewer: { sessionId: claim.sessionId, claimToken: claim.claimToken },
      ...(scope.judgment === 'agent'
        ? {
            retainedCheckActionIds: [] as string[],
            retainedChecks: [] as NonNullable<ReviewReceipt['retainedChecks']>,
          }
        : {}),
    },
    continuation: {
      mode: 'execute' as const,
      commandArgs: [
        'comet',
        'edit-review',
        'record',
        scope.workflow,
        scope.change,
        '--project-root',
        scope.projectRoot,
        '--file',
        '<review-result.json>',
        '--json',
      ],
      requiredInputs: [
        scope.judgment === 'agent'
          ? '在当前任务中判断具体差异、使用方和受影响检查'
          : '独立复核具体差异及其使用方',
        ...(input
          ? [`读取原始编辑请求：${input.file}；摘要：${input.hash}`]
          : proposal.observed
            ? [
                '读取本次原始输入观察、当前文件和可取得的旧版本；缺少判断所需原文时说明缺失内容，不凭摘要猜测',
              ]
            : ['与提案摘要匹配的原始编辑请求；缺失时不得批准']),
      ],
      instruction: proposal.applied
        ? '只读核对当前文件、已批准原文、使用方和验收条件，再填写 recordTemplate；编辑已经应用，保留用户文件并刷新失效检查。会话标识仅关联执行，不表示平台身份已认证。'
        : '只读核对差异、使用方和当前验收条件，再填写 recordTemplate；通过后重试原编辑并刷新失效检查。会话标识仅关联执行，不表示平台身份已认证。',
    },
  };
}

export async function claimedEditReviewExecutionAuthority(
  scope: EditReviewScope,
  builderExecutionRef: string,
  input: EditReviewInput,
): Promise<EditReviewAuthority> {
  const reviewer = input.reviewer;
  if (
    !HASH.test(input.proposalHash) ||
    !reviewer?.sessionId ||
    !reviewer.claimToken ||
    (scope.judgment !== 'agent' && reviewer.sessionId === builderExecutionRef)
  )
    throw new Error('编辑复核需要当前独立复核会话的领取回执');
  const root = await directory(scope);
  const saved = (await readJson(
    root,
    `${input.proposalHash}.${objectHash(reviewer.sessionId)}.claim.json`,
  )) as {
    proposalHash?: string;
    sessionId?: string;
    builderExecutionRef?: string;
    claimToken?: string;
  } | null;
  if (
    !saved ||
    saved.proposalHash !== input.proposalHash ||
    saved.sessionId !== reviewer.sessionId ||
    saved.builderExecutionRef !== builderExecutionRef ||
    saved.claimToken !== reviewer.claimToken
  )
    throw new Error('编辑复核领取回执不属于当前候选或已失效');
  return {
    kind: scope.judgment === 'agent' ? 'runtime-agent' : 'runtime-verifier',
    executionRef: `edit-review/${input.proposalHash}/${reviewer.sessionId}`,
  };
}

export async function editReviewContinuation(
  scope: EditReviewScope,
  reviews: readonly EditReviewObservation[],
  sdk: boolean,
): Promise<CliActionContinuation | null> {
  for (const review of reviews) {
    const edits = currentEdits(scope, review);
    if (!edits.length) continue;
    if (review.receipt?.authority.kind === 'runtime-superseded') continue;
    const canClaim = sdk || Boolean(review.applied);
    if (scope.workflow === 'native' && (review.applied || !review.receipt)) {
      for (const edit of edits) {
        const formal = scope.formalPrefixes.some(
          (prefix) =>
            edit.path === prefix || edit.path.startsWith(prefix.replace(/\/$/u, '') + '/'),
        );
        if (!formal) continue;
        const current = await reviewContent(scope, review, edit);
        const expected = review.applied ? edit.afterHash : edit.beforeHash;
        if ((current?.hash ?? null) !== expected) {
          return {
            mode: 'execute',
            commandArgs: [
              'comet',
              'edit-review',
              'prepare-applied',
              'native',
              scope.change,
              '--project-root',
              scope.projectRoot,
              '--json',
            ],
            requiredInputs: [],
            instruction: '文件已再次修改；保留当前内容并准备复核最新修改，旧提案会标记为过期。',
          };
        }
      }
    }
    const command = [
      'comet',
      'edit-review',
      'show',
      scope.workflow,
      scope.change,
      '--project-root',
      scope.projectRoot,
      '--json',
    ];
    if (!review.receipt) {
      const input = await editReviewInputReference(scope, review.proposalHash);
      if (scope.judgment === 'agent' || review.judgment === 'agent') {
        return {
          mode: 'execute',
          commandArgs: [
            'comet',
            'edit-review',
            'record',
            scope.workflow,
            scope.change,
            '--project-root',
            scope.projectRoot,
            '--file',
            '<agent-judgment.json>',
            '--json',
          ],
          requiredInputs: [
            '读取完整原始差异，结合当前需求、使用方与检查结果判断影响',
            sdk
              ? '使用当前 Builder 或 Verifier 已领取 Action 的 claim，或沿用 observe/judge 返回的本会话 token 填写判断，不创建额外审查会话'
              : '沿用 observe/judge 返回的本会话 token 填写判断，不要求用户确认普通编辑，也不创建额外审查会话',
            ...(input
              ? [`原始编辑请求：${input.file}；摘要：${input.hash}`]
              : review.observed
                ? [
                    '读取本次原始输入观察、当前文件和可取得的旧版本；缺少判断所需原文时说明缺失内容，不凭摘要猜测',
                  ]
                : ['缺少完整原始编辑请求时先读取，不推测内容']),
          ],
          instruction: `由当前 Agent 提交 proposalHash=${review.proposalHash}、decision、summary 和已返回的领取凭据；判断对应本次输入，新增编辑需补处理。`,
        };
      }
      return {
        mode: canClaim ? 'execute' : 'ask',
        commandArgs: canClaim
          ? [
              'comet',
              'edit-review',
              'claim',
              scope.workflow,
              scope.change,
              '--project-root',
              scope.projectRoot,
              '--proposal-hash',
              review.proposalHash,
              '--session',
              '<independent-reviewer-session>',
              ...(input ? ['--file', input.file] : []),
              '--json',
            ]
          : command,
        requiredInputs: canClaim
          ? ['独立复核会话标识', ...(!input ? ['原始编辑请求'] : [])]
          : ['用户明确确认具体编辑复核结果'],
        instruction:
          '先处理这份编辑复核，保留候选和 Verify；缺少原请求时从被拒绝的编辑调用恢复，不能凭内容 hash 猜测差异。',
      };
    }
    if (['implementation-changed', 'requirements-changed'].includes(review.receipt.decision))
      return {
        mode: 'reconcile',
        commandArgs: command,
        requiredInputs: ['通过原工作流修订或丢弃尚未应用的编辑'],
        instruction: `复核结论为 ${review.receipt.decision}，不能接受当前候选。`,
      };
    if (review.receipt.decision === 'non-behavioral')
      for (const edit of edits) {
        const current = await reviewContent(scope, review, edit);
        if (current?.hash === edit.beforeHash && edit.beforeHash !== edit.afterHash) {
          const input = await editReviewInputReference(scope, review.proposalHash);
          return {
            mode: 'execute',
            commandArgs: null,
            requiredInputs: [
              '重试已经复核通过的原始编辑调用',
              input
                ? `读取已核对的原始请求：${input.file}`
                : '从原会话恢复完整原始编辑请求；不能凭摘要重建写入',
            ],
            instruction: '原样重试已批准编辑；内容摘要必须匹配。应用后刷新失效检查并继续原工作流。',
          };
        }
        if (
          !reaches(approvedEdges(reviews, edit.path, scope), edit.afterHash, current?.hash ?? null)
        )
          return {
            mode: 'reconcile',
            commandArgs: command,
            requiredInputs: ['为当前具体编辑重新准备复核'],
            instruction: '当前文件与已批准内容不匹配，保留 Verify 并核对差异。',
          };
      }
  }
  return null;
}

/** 只保存内容 hash，不把源文件、工具参数或凭据复制进 Runtime。 */
export async function prepareEditReview(
  scope: EditReviewScope,
  request: CometHookRequest,
  appliedOriginals?: ReadonlyMap<string, string>,
): Promise<EditReviewProposal> {
  if (
    request.intent !== 'write' ||
    !request.targets.length ||
    (scope.judgment !== 'agent' && request.targets.length > 32) ||
    !request.writes?.length
  )
    throw new Error('编辑复核需要完整的具体编辑请求');
  const edits: ReviewedEdit[] = [];
  for (const target of request.targets) {
    const absolute = path.resolve(request.cwd ?? scope.projectRoot, target);
    const ref = path.relative(scope.projectRoot, absolute).replaceAll('\\', '/');
    if (!ref || ref.startsWith('../') || path.isAbsolute(ref))
      throw new Error('编辑复核目标不属于当前工作区');
    if (
      scope.formalPrefixes.some(
        (prefix) => ref === prefix || ref.startsWith(prefix.replace(/\/$/u, '') + '/'),
      ) &&
      !(
        scope.judgment === 'agent' &&
        !ref.startsWith('.comet/') &&
        ref !== '.comet' &&
        scope.allowedFormalPaths?.includes(ref)
      )
    )
      throw new Error('正式需求、计划或 Runtime 材料只能通过原工作流修订');
    if (
      /(?:^|\/)(?:\.env(?:\..*)?|credentials?[^/]*|secrets?[^/]*|[^/]+\.(?:pem|key|p12|pfx))$/iu.test(
        ref,
      )
    )
      throw new Error('敏感文件不进入编辑复核');
    const proposals = request.writes.filter(
      (proposal) => path.resolve(request.cwd ?? scope.projectRoot, proposal.path) === absolute,
    );
    if (proposals.length !== 1) throw new Error('编辑复核不能推测或合并不明确的写入');
    const current = await currentContent(
      scope,
      ref,
      Boolean(appliedOriginals) || scope.judgment === 'agent',
    );
    if (!current) throw new Error('新增、删除或重命名文件需要原工作流修订');
    const original = appliedOriginals?.get(ref);
    if (appliedOriginals && original === undefined) throw new Error('缺少已批准的原始文件');
    const before =
      original === undefined
        ? current
        : {
            text: original,
            hash: editContentHash(original),
            executable: current.executable,
          };
    const after = proposedCometHookFileContent(proposals[0], before.text);
    if (
      after === null ||
      (!appliedOriginals && scope.judgment !== 'agent' && Buffer.byteLength(after) > MAX_BYTES) ||
      after.includes('\0')
    )
      throw new Error('编辑复核无法完整重建写入内容');
    if (appliedOriginals && after !== current.text)
      throw new Error('已应用文件与待复核内容不匹配，请重新读取');
    const legacy = scope.judgment === 'agent' ? null : await import('./edit-impact.js');
    if (legacy) {
      const impact = legacy.classifyEditImpact(ref, before?.text ?? '', after);
      if (impact.kind === 'implementation-changed' || impact.kind === 'requirements-changed')
        throw new Error(`本地判定已确认实现或需求变化：${impact.reason}`);
    }
    edits.push({
      path: ref,
      ...sourceEvidenceFor(scope, ref),
      beforeHash: before?.hash ?? null,
      afterHash: editContentHash(after),
      beforeInputHash: before ? inputHash(before.text) : null,
      beforeFingerprint: legacy && before ? legacy.editSemanticFingerprint(ref, before.text) : null,
      executable: before?.executable ?? false,
      ...(scope.judgment === 'agent'
        ? {
            beforeGitHashes: gitContentHashes(before.text),
            afterGitHashes: gitContentHashes(after),
          }
        : {}),
    });
  }
  const body = {
    schema: 'comet.edit-review.request.v1' as const,
    binding: await binding(scope),
    edits,
    ...(appliedOriginals ? { applied: true as const } : {}),
    ...(scope.judgment === 'agent' ? { judgment: 'agent' as const } : {}),
  };
  const root = await directory(scope, true);
  return withRecoverableFileLock(path.join(root, '.lock'), async () => {
    const previous = (await inspectEditReviews(scope)).filter(
      (review) =>
        Boolean(review.applied) === Boolean(appliedOriginals) &&
        review.judgment === scope.judgment &&
        objectHash(review.edits) === objectHash(edits),
    );
    const current = previous.find((review) => review.receipt?.decision !== 'discard');
    if (current) {
      return {
        schema: current.schema,
        binding: current.binding,
        edits: current.edits,
        ...(current.applied ? { applied: true as const } : {}),
        ...(current.judgment === 'agent' ? { judgment: 'agent' as const } : {}),
        generation: current.generation,
        proposalHash: current.proposalHash,
      };
    }
    const versioned = {
      ...body,
      generation: previous.length
        ? Math.max(...previous.map((review) => review.generation)) + 1
        : 0,
    };
    const proposal = { ...versioned, proposalHash: objectHash(versioned) };
    await writeOnce(root, `${proposal.proposalHash}.request.json`, proposal);
    return proposal;
  });
}

/** 从已绑定的输入清单构造一批实际变化，不解码或保存用户文件内容。 */
export async function prepareObservedEditReview(
  scope: EditReviewScope,
  changes: readonly {
    path: string;
    beforeHash: string;
    afterHash: string;
    beforeMode?: string;
    afterMode?: string;
    afterInputHash?: string;
  }[],
): Promise<EditReviewProposal> {
  if (scope.judgment !== 'agent' || !changes.length)
    throw new Error('原始变化观察需要当前 Agent 和实际变化');
  const edits: ReviewedEdit[] = [];
  for (const change of changes) {
    const ref = change.path;
    if (
      !ref ||
      ref !== path.posix.normalize(ref) ||
      path.isAbsolute(ref) ||
      ref.split('/').includes('..') ||
      ref.includes('\\')
    )
      throw new Error('变化目标不属于当前工作区');
    if (
      scope.formalPrefixes.some((prefix) => ref === prefix || ref.startsWith(`${prefix}/`)) &&
      (ref === '.comet' || ref.startsWith('.comet/') || !scope.allowedFormalPaths?.includes(ref))
    )
      throw new Error('变化目标属于 Runtime 或未登记的正式材料');
    if (
      (!HASH.test(change.beforeHash) &&
        change.beforeHash !== 'missing' &&
        !/^git:(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(change.beforeHash)) ||
      (!HASH.test(change.afterHash) && change.afterHash !== 'missing')
    )
      throw new Error('原始变化摘要无效');
    const current = await observedContent(scope, ref);
    const mode = current.hash === 'missing' ? 'missing' : current.executable ? '100755' : '100644';
    if (current.hash !== change.afterHash || (change.afterMode && mode !== change.afterMode))
      throw new Error('输入在观察后再次变化，请处理当前差异');
    edits.push({
      path: ref,
      ...sourceEvidenceFor(scope, ref),
      beforeHash: change.beforeHash === 'missing' ? null : change.beforeHash,
      afterHash: change.afterHash,
      beforeInputHash: null,
      beforeFingerprint: null,
      executable: current.executable,
      ...(change.afterInputHash?.startsWith('git:')
        ? { afterGitHashes: [change.afterInputHash] }
        : {}),
      ...(change.beforeMode ? { beforeMode: change.beforeMode } : {}),
      ...(change.afterMode ? { afterMode: change.afterMode } : {}),
    });
  }
  const identity = await binding(scope);
  const root = await directory(scope, true);
  return withRecoverableFileLock(path.join(root, '.lock'), async () => {
    const previous = (await inspectEditReviews(scope)).filter(
      (review) => review.observed && objectHash(review.edits) === objectHash(edits),
    );
    const existing = previous.find((review) => review.receipt?.decision !== 'discard');
    if (existing) return parseProposal(existing);
    const body = {
      schema: 'comet.edit-review.request.v1' as const,
      binding: identity,
      edits,
      applied: true as const,
      judgment: 'agent' as const,
      observed: true as const,
      generation: previous.length
        ? Math.max(...previous.map((review) => review.generation)) + 1
        : 0,
    };
    const proposal = { ...body, proposalHash: objectHash(body) };
    await writeOnce(root, `${proposal.proposalHash}.request.json`, proposal);
    return proposal;
  });
}

export async function inspectEditReviews(scope: EditReviewScope): Promise<EditReviewObservation[]> {
  let root: string;
  try {
    root = await directory(scope);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  let files: string[];
  try {
    files = (await fs.readdir(root))
      .filter((file) => /^[a-f0-9]{64}\.request\.json$/u.test(file))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const expected = await binding(scope);
  const reviews: EditReviewObservation[] = [];
  for (const file of files) {
    const proposal = parseProposal(await readJson(root, file));
    if (
      objectHash(proposal.binding) !== objectHash(expected) ||
      file !== `${proposal.proposalHash}.request.json`
    )
      throw new Error('编辑复核不属于当前候选');
    reviews.push({
      ...proposal,
      receipt: parseReceipt(
        (await readJson(root, `${proposal.proposalHash}.discard.json`)) ??
          (await readJson(root, `${proposal.proposalHash}.review.json`)),
        proposal.proposalHash,
      ),
    });
  }
  return reviews;
}

/** 最新文件替换了待审的已应用编辑时，只作废旧提案，不批准当前内容。 */
export async function supersedeStaleAppliedEditReviews(scope: EditReviewScope): Promise<void> {
  const reviews = await inspectEditReviews(scope);
  const root = await directory(scope, true);
  for (const review of reviews) {
    if (review.receipt?.decision === 'discard' || (!review.applied && review.receipt)) continue;
    if (
      !review.applied &&
      !review.edits.every((edit) =>
        scope.formalPrefixes.some(
          (prefix) =>
            edit.path === prefix || edit.path.startsWith(prefix.replace(/\/$/u, '') + '/'),
        ),
      )
    )
      continue;
    let stale = false;
    for (const edit of currentEdits(scope, review)) {
      const current = await reviewContent(scope, review, edit);
      if ((current?.hash ?? null) !== (review.applied ? edit.afterHash : edit.beforeHash))
        stale = true;
    }
    if (!stale) continue;
    const receipt: ReviewReceipt = {
      schema: 'comet.edit-review.receipt.v1',
      proposalHash: review.proposalHash,
      decision: 'discard',
      summary: '文件再次变化，保留当前文件并复核最新内容。',
      authority: { kind: 'runtime-superseded', executionRef: 'current-file-changed' },
    };
    await withRecoverableFileLock(path.join(root, '.lock'), () =>
      writeOnce(root, `${review.proposalHash}.discard.json`, receipt),
    );
  }
}

export async function recordEditReview(
  scope: EditReviewScope,
  input: EditReviewInput,
  authority: EditReviewAuthority,
): Promise<ReviewReceipt> {
  if (
    !HASH.test(input.proposalHash) ||
    !input.summary?.trim() ||
    !['non-behavioral', 'implementation-changed', 'requirements-changed', 'discard'].includes(
      input.decision,
    ) ||
    !['runtime-agent', 'runtime-verifier', 'user-confirmed'].includes(authority.kind) ||
    !authority.executionRef
  )
    throw new Error('编辑复核结果缺少明确决定、说明或执行身份');
  const proposal = (await inspectEditReviews(scope)).find(
    (entry) => entry.proposalHash === input.proposalHash,
  );
  if (!proposal) throw new Error('编辑复核请求不属于当前候选或已失效');
  if (currentEdits(scope, proposal).length !== proposal.edits.length)
    throw new Error('正式来源批准已变化；读取当前变化并记录新判断，不能重用旧提案');
  if (
    input.retainedChecks !== undefined &&
    (authority.kind !== 'runtime-agent' || !validRetainedChecks(input.retainedChecks))
  )
    throw new Error('保留检查需要当前 Agent 明确列出原 Action 和检查 ID');
  if (
    input.retainedCheckActionIds !== undefined &&
    (authority.kind !== 'runtime-agent' ||
      !Array.isArray(input.retainedCheckActionIds) ||
      input.retainedCheckActionIds.some((id) => typeof id !== 'string' || !id.trim()) ||
      new Set(input.retainedCheckActionIds).size !== input.retainedCheckActionIds.length)
  )
    throw new Error('保留检查需要当前 Agent 明确列出原检查 Action');
  for (const edit of proposal.edits) {
    const current = await reviewContent(scope, proposal, edit);
    if (current && current.executable !== edit.executable)
      throw new Error('判断对应的文件模式已变化');
    if (proposal.receipt?.authority.kind === 'runtime-superseded')
      throw new Error('编辑提案已被新内容替代，请复核当前文件');
    if ((current?.hash ?? null) !== edit.beforeHash && current?.hash !== edit.afterHash)
      throw new Error('当前文件与待复核差异不匹配');
    if (proposal.applied && input.decision !== 'discard' && current?.hash !== edit.afterHash)
      throw new Error('已应用文件再次变化，当前判断不能覆盖新内容');
    if (input.decision === 'discard' && (current?.hash ?? null) !== edit.beforeHash)
      throw new Error('编辑已经应用，不能丢弃复核来接受新内容');
  }
  const receipt: ReviewReceipt = {
    schema: 'comet.edit-review.receipt.v1',
    proposalHash: input.proposalHash,
    decision: input.decision,
    summary: input.summary,
    authority,
    ...(input.retainedChecks
      ? { retainedChecks: input.retainedChecks.map((entry) => ({ ...entry })) }
      : {}),
    ...(input.retainedCheckActionIds
      ? { retainedCheckActionIds: [...input.retainedCheckActionIds] }
      : {}),
  };
  const root = await directory(scope, true);
  await withRecoverableFileLock(path.join(root, '.lock'), () =>
    writeOnce(
      root,
      `${input.proposalHash}.${input.decision === 'discard' ? 'discard' : 'review'}.json`,
      receipt,
    ),
  );
  if (receipt.retainedCheckActionIds?.length || receipt.retainedChecks?.length)
    await indexCheckJudgment(scope, receipt.proposalHash);
  return receipt;
}

/** 每个实际变化都必须由 Agent 明确保留同一原检查，且前后内容与观察匹配。 */
export async function isCheckInputRetained(
  scope: EditReviewScope,
  actionId: string,
  changes: readonly {
    path: string;
    beforeHash: string;
    afterHash: string;
    beforeMode?: string;
    afterMode?: string;
  }[],
  additionalScopes: readonly EditReviewScope[] = [],
  checkId?: string,
): Promise<boolean> {
  if (!changes.length) return false;
  const reviews = (
    await Promise.all([
      indexedCheckJudgments(scope).then((reviews) =>
        reviews.map((review) => ({ ...review, edits: currentEdits(scope, review) })),
      ),
      ...[scope, ...additionalScopes].map(async (candidate) =>
        (await inspectEditReviews(candidate)).map((review) => ({
          ...review,
          edits: currentEdits(candidate, review),
        })),
      ),
    ])
  )
    .flat()
    .filter(
      (review) =>
        review.receipt?.authority.kind === 'runtime-agent' &&
        review.receipt.decision !== 'discard' &&
        (review.receipt.retainedCheckActionIds?.includes(actionId) ||
          review.receipt.retainedChecks?.some(
            (check) => check.actionId === actionId && check.checkId === checkId,
          )),
    );
  return reviewedInputChangesCovered(reviews, changes);
}

/** 候选等价关系与检查保留分别记录；补跑检查不等于批准新的实现。 */
export async function areObservedEditsNonBehavioral(
  scopes: readonly EditReviewScope[],
  changes: Parameters<typeof isCheckInputRetained>[2],
) {
  const reviews = (
    await Promise.all(
      scopes.map(async (scope) =>
        (await inspectEditReviews(scope)).map((review) => ({
          ...review,
          edits: currentEdits(scope, review),
        })),
      ),
    )
  )
    .flat()
    .filter((review) => review.receipt?.decision === 'non-behavioral');
  return reviewedInputChangesCovered(reviews, changes);
}

function reviewedInputChangesCovered(
  reviews: readonly EditReviewObservation[],
  changes: Parameters<typeof isCheckInputRetained>[2],
) {
  for (const change of changes) {
    const edges = reviews.flatMap((review) =>
      review.edits.filter(
        (edit) =>
          edit.path === change.path &&
          (!change.beforeMode ||
            !change.afterMode ||
            change.beforeMode === change.afterMode ||
            (edit.beforeMode === change.beforeMode && edit.afterMode === change.afterMode)),
      ),
    );
    const byBefore = new Map<string, ReviewedEdit[]>();
    for (const edge of edges)
      for (const hash of [edge.beforeHash ?? 'missing', ...(edge.beforeGitHashes ?? [])]) {
        if (hash) byBefore.set(hash, [...(byBefore.get(hash) ?? []), edge]);
      }
    const queue = [change.beforeHash],
      visited = new Set<string>();
    let covered = false;
    for (let i = 0; i < queue.length && !covered; i++) {
      const hash = queue[i];
      if (visited.has(hash)) continue;
      visited.add(hash);
      for (const edge of byBefore.get(hash) ?? []) {
        if ([edge.afterHash, ...(edge.afterGitHashes ?? [])].includes(change.afterHash)) {
          covered = true;
          break;
        }
        queue.push(edge.afterHash);
      }
    }
    if (!covered) return false;
  }
  return true;
}

function approvedEdges(
  reviews: readonly EditReviewObservation[],
  file: string,
  scope: EditReviewScope,
): ReviewedEdit[] {
  return reviews
    .filter((review) => review.receipt?.decision === 'non-behavioral')
    .flatMap((review) => currentEdits(scope, review).filter((edit) => edit.path === file));
}
function reaches(
  edges: readonly ReviewedEdit[],
  start: string | null,
  end: string | null,
): boolean {
  const seen = new Set<string | null>([start]);
  const queue = [start];
  for (const hash of queue) {
    if (hash === end) return true;
    for (const edit of edges)
      if (edit.beforeHash === hash && !seen.has(edit.afterHash)) {
        seen.add(edit.afterHash);
        queue.push(edit.afterHash);
      }
  }
  return false;
}
export async function assertEditReviewsComplete(
  scope: EditReviewScope,
  options: { allowImplementationRevision?: boolean } = {},
): Promise<void> {
  const reviews = await inspectEditReviews(scope);
  const revisable = (review: EditReviewObservation) =>
    Boolean(
      options.allowImplementationRevision &&
      review.applied &&
      review.receipt?.authority.kind === 'runtime-agent' &&
      review.receipt.decision === 'implementation-changed',
    );
  const completionEdges = (file: string) =>
    options.allowImplementationRevision
      ? reviews
          .filter((review) => review.receipt?.decision === 'non-behavioral' || revisable(review))
          .flatMap((review) => currentEdits(scope, review).filter((edit) => edit.path === file))
      : approvedEdges(reviews, file, scope);
  for (const review of reviews) {
    const edits = currentEdits(scope, review);
    if (!edits.length) continue;
    if (!review.receipt)
      throw new Error(`编辑 ${review.proposalHash} 待复核；保留当前阶段，复核前不得通过或归档`);
    if (
      review.receipt.decision === 'requirements-changed' ||
      (review.receipt.decision === 'implementation-changed' && !revisable(review))
    )
      throw new Error(
        `编辑复核确认 ${review.receipt.decision}；请通过原工作流修订，或丢弃尚未应用的编辑`,
      );
    for (const edit of edits) {
      const current = await reviewContent(scope, review, edit);
      if (current && current.executable !== edit.executable)
        throw new Error('编辑复核目标的执行权限不匹配');
      if (review.receipt.decision === 'discard') {
        if (review.receipt.authority.kind === 'runtime-superseded') continue;
        if (!reaches(completionEdges(edit.path), edit.beforeHash, current?.hash ?? null))
          throw new Error('丢弃的编辑与当前文件不匹配');
        continue;
      }
      if ((current?.hash ?? null) === edit.beforeHash && edit.beforeHash !== edit.afterHash)
        throw new Error('复核通过的编辑尚未应用；应用该编辑或明确丢弃提案后再验收');
      if (!reaches(completionEdges(edit.path), edit.afterHash, current?.hash ?? null))
        throw new Error('当前文件与已复核内容不匹配，需要新的复核');
    }
  }
}

export async function approvedEditFingerprint(
  scope: EditReviewScope,
  file: string,
  source: string,
  reviews?: readonly EditReviewObservation[],
): Promise<{ fingerprint: string | null; semantic: boolean; beforeHash: string | null } | null> {
  return approvedEditHash(scope, file, editContentHash(source), reviews);
}

/** 原始摘要的等价关系只来自已绑定的 Agent 判断，不读取或解释用户语言。 */
export async function approvedEditHash(
  scope: EditReviewScope,
  file: string,
  currentHash: string,
  reviews?: readonly EditReviewObservation[],
  currentMode?: string,
): Promise<{
  fingerprint: string | null;
  semantic: boolean;
  beforeHash: string | null;
  beforeMode?: string;
} | null> {
  const edges = approvedEdges(reviews ?? (await inspectEditReviews(scope)), file, scope);
  if (
    currentMode &&
    edges.some((edge) => edge.afterMode) &&
    !edges.some((edge) => edge.afterHash === currentHash && edge.afterMode === currentMode)
  )
    return null;
  const first = edges.find(
    (edge) =>
      !edges.some((other) => other.afterHash === edge.beforeHash) &&
      reaches(edges, edge.beforeHash, currentHash),
  );
  return first
    ? {
        fingerprint: first.beforeFingerprint ?? first.beforeInputHash,
        semantic: first.beforeFingerprint !== null,
        beforeHash: first.beforeHash,
        ...(first.beforeMode ? { beforeMode: first.beforeMode } : {}),
      }
    : null;
}

export async function isReviewedEditProposal(
  scope: EditReviewScope,
  file: string,
  before: string | null,
  after: string,
): Promise<boolean> {
  return (await inspectEditReviews(scope)).some(
    (review) =>
      review.receipt?.decision === 'non-behavioral' &&
      review.edits.some(
        (edit) =>
          edit.path === file &&
          edit.beforeHash === (before === null ? null : editContentHash(before)) &&
          edit.afterHash === editContentHash(after),
      ),
  );
}
