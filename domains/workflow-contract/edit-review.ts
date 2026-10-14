import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { withRecoverableFileLock } from '../../platform/fs/recoverable-file-lock.js';
import {
  proposedCometHookFileContent,
  type CometHookRequest,
} from '../../platform/process/hook-adapter.js';
import { atomicWriteContainedText } from './contained-atomic-write.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
  ensureProtectedProjectDirectory,
} from './protected-project-path.js';
import { classifyEditImpact, editContentHash, editSemanticFingerprint } from './edit-impact.js';

export interface EditReviewScope {
  projectRoot: string;
  runtimeRoot: string;
  workflow: 'native' | 'classic';
  change: string;
  candidateKey: string;
  formalPrefixes: readonly string[];
}
export type EditReviewDecision =
  'non-behavioral' | 'implementation-changed' | 'requirements-changed' | 'discard';
export interface EditReviewInput {
  proposalHash: string;
  decision: EditReviewDecision;
  summary: string;
}
export interface EditReviewAuthority {
  kind: 'runtime-verifier' | 'user-confirmed';
  executionRef: string;
}
export interface EditReviewClaim {
  actionId: string;
  attempt: number;
  inputHash: string;
  claimToken: string;
  sessionId: string;
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
}
export interface EditReviewProposal {
  schema: 'comet.edit-review.request.v1';
  binding: { workflow: string; change: string; candidateKey: string; projectRootId: string };
  edits: ReviewedEdit[];
  generation: number;
  proposalHash: string;
}
export interface ReviewReceipt {
  schema: 'comet.edit-review.receipt.v1';
  proposalHash: string;
  decision: EditReviewDecision;
  summary: string;
  authority: EditReviewAuthority;
}
export interface EditReviewObservation extends EditReviewProposal {
  receipt: ReviewReceipt | null;
}
const HASH = /^[a-f0-9]{64}$/u;
const MAX_BYTES = 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const inputHash = (text: string) =>
  createHash('sha256').update(Buffer.from(text).toString('base64')).digest('hex');
const objectHash = (value: unknown) => editContentHash(JSON.stringify(value));

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
async function currentContent(
  scope: EditReviewScope,
  ref: string,
): Promise<{ text: string; hash: string; executable: boolean } | null> {
  const target = await inspectProtectedProjectPath(scope.projectRoot, ref, {
    label: '编辑复核目标',
    expected: 'file',
  });
  if (!target.exists) return null;
  const source = await readProtectedProjectFile(scope.projectRoot, ref, MAX_BYTES, {
    label: '编辑复核目标',
  });
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
        await readProtectedProjectFile(root, file, MAX_BYTES, { label: '编辑复核记录' })
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
    proposal.edits.length > 32 ||
    !HASH.test(proposal.proposalHash)
  )
    throw new Error('编辑复核请求无效');
  if (!Number.isSafeInteger(proposal.generation) || proposal.generation < 0)
    throw new Error('编辑复核请求序号无效');
  const body = {
    schema: proposal.schema,
    binding: proposal.binding,
    edits: proposal.edits,
    generation: proposal.generation,
  };
  if (objectHash(body) !== proposal.proposalHash) throw new Error('编辑复核请求 hash 不匹配');
  for (const edit of proposal.edits) {
    if (
      typeof edit.path !== 'string' ||
      edit.path !== path.posix.normalize(edit.path) ||
      path.posix.isAbsolute(edit.path) ||
      edit.path.split('/').includes('..') ||
      !HASH.test(edit.afterHash) ||
      (edit.beforeHash !== null && !HASH.test(edit.beforeHash)) ||
      (edit.beforeInputHash !== null && !HASH.test(edit.beforeInputHash)) ||
      (edit.beforeFingerprint !== null && !HASH.test(edit.beforeFingerprint)) ||
      typeof edit.executable !== 'boolean'
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
    !['runtime-verifier', 'user-confirmed'].includes(receipt.authority?.kind) ||
    !receipt.authority.executionRef
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

/** 只保存内容 hash，不把源文件、工具参数或凭据复制进 Runtime。 */
export async function prepareEditReview(
  scope: EditReviewScope,
  request: CometHookRequest,
): Promise<EditReviewProposal> {
  if (
    request.intent !== 'write' ||
    !request.targets.length ||
    request.targets.length > 32 ||
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
    const before = await currentContent(scope, ref);
    if (!before) throw new Error('新增、删除或重命名文件需要原工作流修订');
    const after = proposedCometHookFileContent(proposals[0], before?.text ?? '');
    if (after === null || Buffer.byteLength(after) > MAX_BYTES || after.includes('\0'))
      throw new Error('编辑复核无法完整重建写入内容');
    const impact = classifyEditImpact(ref, before?.text ?? '', after);
    if (impact.kind === 'implementation-changed' || impact.kind === 'requirements-changed')
      throw new Error(`本地判定已确认实现或需求变化：${impact.reason}`);
    edits.push({
      path: ref,
      beforeHash: before?.hash ?? null,
      afterHash: editContentHash(after),
      beforeInputHash: before ? inputHash(before.text) : null,
      beforeFingerprint: before ? editSemanticFingerprint(ref, before.text) : null,
      executable: before?.executable ?? false,
    });
  }
  const body = {
    schema: 'comet.edit-review.request.v1' as const,
    binding: await binding(scope),
    edits,
  };
  const root = await directory(scope, true);
  return withRecoverableFileLock(path.join(root, '.lock'), async () => {
    const previous = (await inspectEditReviews(scope)).filter(
      (review) => objectHash(review.edits) === objectHash(edits),
    );
    const current = previous.find((review) => review.receipt?.decision !== 'discard');
    if (current) {
      return {
        schema: current.schema,
        binding: current.binding,
        edits: current.edits,
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
  if (files.length > 128) throw new Error('当前候选的编辑复核记录过多，需要先整理复核');
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
    !['runtime-verifier', 'user-confirmed'].includes(authority.kind) ||
    !authority.executionRef
  )
    throw new Error('编辑复核结果缺少明确决定、说明或执行身份');
  const proposal = (await inspectEditReviews(scope)).find(
    (entry) => entry.proposalHash === input.proposalHash,
  );
  if (!proposal) throw new Error('编辑复核请求不属于当前候选或已失效');
  for (const edit of proposal.edits) {
    const current = await currentContent(scope, edit.path);
    if ((current?.hash ?? null) !== edit.beforeHash && current?.hash !== edit.afterHash)
      throw new Error('当前文件与待复核差异不匹配');
    if (input.decision === 'discard' && (current?.hash ?? null) !== edit.beforeHash)
      throw new Error('编辑已经应用，不能丢弃复核来接受新内容');
  }
  const receipt: ReviewReceipt = { schema: 'comet.edit-review.receipt.v1', ...input, authority };
  const root = await directory(scope, true);
  await withRecoverableFileLock(path.join(root, '.lock'), () =>
    writeOnce(
      root,
      `${input.proposalHash}.${input.decision === 'discard' ? 'discard' : 'review'}.json`,
      receipt,
    ),
  );
  return receipt;
}

function approvedEdges(reviews: readonly EditReviewObservation[], file: string): ReviewedEdit[] {
  return reviews
    .filter((review) => review.receipt?.decision === 'non-behavioral')
    .flatMap((review) => review.edits.filter((edit) => edit.path === file));
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
export async function assertEditReviewsComplete(scope: EditReviewScope): Promise<void> {
  const reviews = await inspectEditReviews(scope);
  for (const review of reviews) {
    if (!review.receipt)
      throw new Error(`编辑 ${review.proposalHash} 待复核；保留当前阶段，复核前不得通过或归档`);
    if (['implementation-changed', 'requirements-changed'].includes(review.receipt.decision))
      throw new Error(
        `编辑复核确认 ${review.receipt.decision}；请通过原工作流修订，或丢弃尚未应用的编辑`,
      );
    for (const edit of review.edits) {
      const current = await currentContent(scope, edit.path);
      if (current && current.executable !== edit.executable)
        throw new Error('编辑复核目标的执行权限不匹配');
      if (review.receipt.decision === 'discard') {
        if (!reaches(approvedEdges(reviews, edit.path), edit.beforeHash, current?.hash ?? null))
          throw new Error('丢弃的编辑与当前文件不匹配');
        continue;
      }
      if ((current?.hash ?? null) === edit.beforeHash && edit.beforeHash !== edit.afterHash)
        throw new Error('复核通过的编辑尚未应用；应用该编辑或明确丢弃提案后再验收');
      if (!reaches(approvedEdges(reviews, edit.path), edit.afterHash, current?.hash ?? null))
        throw new Error('当前文件与已复核内容不匹配，需要新的复核');
    }
  }
}

export async function approvedEditFingerprint(
  scope: EditReviewScope,
  file: string,
  source: string,
): Promise<{ fingerprint: string | null; semantic: boolean; beforeHash: string | null } | null> {
  const edges = approvedEdges(await inspectEditReviews(scope), file);
  const currentHash = editContentHash(source);
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
