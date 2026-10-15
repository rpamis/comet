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
  reviewer?: { sessionId: string; claimToken: string };
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
    options.sessionId === options.builderExecutionRef ||
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
        '独立复核具体差异及其使用方',
        ...(input
          ? [`读取原始编辑请求：${input.file}；摘要：${input.hash}`]
          : ['与提案摘要匹配的原始编辑请求；缺失时不得批准']),
      ],
      instruction:
        '只读核对差异、使用方和当前验收条件，再填写 recordTemplate；通过后重试原编辑并刷新失效检查。会话标识仅关联执行，不表示宿主身份已认证。',
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
    reviewer.sessionId === builderExecutionRef
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
    kind: 'runtime-verifier',
    executionRef: `edit-review/${input.proposalHash}/${reviewer.sessionId}`,
  };
}

export async function editReviewContinuation(
  scope: EditReviewScope,
  reviews: readonly EditReviewObservation[],
  sdk: boolean,
): Promise<CliActionContinuation | null> {
  for (const review of reviews) {
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
      return {
        mode: sdk ? 'execute' : 'ask',
        commandArgs: sdk
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
        requiredInputs: sdk
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
      for (const edit of review.edits) {
        const current = await currentContent(scope, edit.path);
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
        if (!reaches(approvedEdges(reviews, edit.path), edit.afterHash, current?.hash ?? null))
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
  const receipt: ReviewReceipt = {
    schema: 'comet.edit-review.receipt.v1',
    proposalHash: input.proposalHash,
    decision: input.decision,
    summary: input.summary,
    authority,
  };
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
  reviews?: readonly EditReviewObservation[],
): Promise<{ fingerprint: string | null; semantic: boolean; beforeHash: string | null } | null> {
  const edges = approvedEdges(reviews ?? (await inspectEditReviews(scope)), file);
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
