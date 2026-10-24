import { createHash } from 'node:crypto';
import path from 'node:path';
import { portableClaimToken, type RuntimeAction, type WorkflowRun } from '../engine/runtime.js';
import { normalizeWorkflowRelativePath } from '../workflow-contract/project-config.js';
import {
  inspectProtectedProjectPath,
  readProtectedProjectFile,
} from '../workflow-contract/protected-project-path.js';
import { isWorkspaceRuntimeMigrationFence } from '../workflow-contract/workspace-runtime.js';
import { annotatedMarkdown, archivedClassicDocumentRef } from './classic-archive-annotation.js';
import { checkManifestHash, parseCheckManifest } from './classic-check-manifest.js';
import { hashGitPaths } from './classic-check-snapshot.js';
import { handoffSourceHash } from './classic-handoff-source.js';
import {
  renderClassicHandoffMarkdown,
  renderClassicSpecHandoffMarkdown,
} from './classic-handoff.js';
import { hashClassicProjectFile, readClassicProjectFile } from './classic-protected-path.js';
import { classicArchiveDocumentOutputs } from './classic-sdk-archive-documents.js';
import { classicSdkCheckDirectoryRef } from './classic-sdk-check-record.js';
import { resolveClassicStateFile } from './classic-state-file.js';
import { classicTaskRequirements, classicTaskRevision } from './classic-tasks.js';

const digest = (source: string) => createHash('sha256').update(source).digest('hex');
const label = 'Classic 旧版 Archive 原始证据';

function object(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function matchesOriginal(source: string, expected: string): boolean {
  if (!expected.startsWith('git:')) return digest(source) === expected;
  return (
    `git:${createHash(expected.length === 44 ? 'sha1' : 'sha256')
      .update(`blob ${Buffer.byteLength(source)}\0`)
      .update(source)
      .digest('hex')}` === expected
  );
}

/** 仅规范化 tasks 来源代码块的完成勾选，不改变其他来源、头部或附加正文。 */
function normalizeHandoffTaskExcerpt(
  markdown: string,
  task: { reference: string; content: string; sha256: string } | undefined,
): string {
  if (!task) return markdown;
  const total = (task.content.match(/\n/gu) ?? []).length;
  const excerpt = total <= 80 ? task.content : task.content.match(/^(?:[^\n]*\n){80}/u)![0];
  const prefix = `## ${task.reference}\n\n- Source: ${task.reference}\n- Lines: 1-${total}\n- SHA256: ${task.sha256}\n\n${total <= 80 ? '' : '[TRUNCATED]\n\n'}\`\`\`md\n`;
  const start = markdown.indexOf(prefix);
  if (start < 0 || start !== markdown.lastIndexOf(prefix))
    throw new Error('旧 Handoff tasks 来源范围不明确');
  const offset = start + prefix.length;
  return (
    markdown.slice(0, offset) +
    classicTaskRequirements(markdown.slice(offset, offset + excerpt.length)) +
    markdown.slice(offset + excerpt.length)
  );
}

async function legacyHandoffFiles(
  root: string,
  run: Readonly<WorkflowRun>,
  action: Readonly<RuntimeAction>,
  activeRef: string,
  archiveRef: string,
  originalDocuments: ReadonlyMap<string, string>,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const sequence = run.actionContexts[action.id]?.sequence;
  const approval = run.waits
    ?.slice()
    .reverse()
    .find(
      (wait) =>
        wait.stepId === 'full.design.confirm' &&
        wait.status === 'resolved' &&
        wait.decision?.choice === 'approved' &&
        sequence !== undefined &&
        wait.sequence < sequence,
    );
  const bound = (approval?.proposal as { outputs?: Record<string, unknown> } | undefined)
    ?.outputs?.['full.design.handoff'] as
    { handoffContext?: unknown; handoffHash?: unknown } | undefined;
  for (const basename of ['design-context', 'spec-context']) {
    const sourceRef = `${activeRef}/.comet/handoff/${basename}.json`;
    const jsonRef = `${archiveRef}/.comet/handoff/${basename}.json`;
    const markdownRef = jsonRef.replace(/\.json$/u, '.md');
    const exists = await Promise.all(
      [jsonRef, markdownRef].map(
        async (ref) =>
          (await inspectProtectedProjectPath(root, ref, { label, expected: 'file' })).exists,
      ),
    );
    if (!exists.some(Boolean)) continue;
    if (
      !exists.every(Boolean) ||
      bound?.handoffContext !== sourceRef ||
      typeof bound.handoffHash !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(bound.handoffHash)
    )
      throw new Error('旧 Handoff 缺少原 Design 审批绑定');
    const json = await readClassicProjectFile(root, jsonRef, { label });
    const value: unknown = JSON.parse(json);
    const beta = basename === 'spec-context';
    const change = path.posix.basename(activeRef);
    if (
      !object(value, [
        'change',
        'phase',
        'mode',
        'canonical_spec',
        'task_hash_policy',
        'generated_by',
        'context_hash',
        'files',
      ]) ||
      value.change !== change ||
      value.phase !== 'design' ||
      value.mode !== (beta ? 'beta' : 'compact') ||
      value.canonical_spec !== 'openspec' ||
      value.task_hash_policy !== 'task-content-v1' ||
      value.generated_by !== 'comet-handoff.sh' ||
      value.context_hash !== bound.handoffHash ||
      !Array.isArray(value.files)
    )
      throw new Error('旧 Handoff JSON 字段与原 Design 审批不符');
    const sources: Array<{ reference: string; content: string; sha256: string }> = [];
    const names = new Set<string>();
    for (const entry of value.files) {
      if (
        !object(entry, beta ? ['path', 'sha256', 'role'] : ['path', 'sha256']) ||
        typeof entry.path !== 'string' ||
        !entry.path.startsWith(`${activeRef}/`) ||
        normalizeWorkflowRelativePath(entry.path, label) !== entry.path ||
        names.has(entry.path) ||
        typeof entry.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(entry.sha256) ||
        (beta &&
          entry.role !== (/\/specs\/.+\/spec\.md$/u.test(entry.path) ? 'spec' : 'supporting'))
      )
        throw new Error('旧 Handoff 来源清单无效');
      names.add(entry.path);
      const content =
        originalDocuments.get(entry.path) ??
        (await readClassicProjectFile(
          root,
          archivedClassicDocumentRef(entry.path, activeRef, archiveRef)!,
          { label },
        ));
      if (handoffSourceHash(entry.path, content) !== entry.sha256)
        throw new Error(`旧 Handoff 原始来源无法从归档复原：${entry.path}`);
      sources.push({ reference: entry.path, content, sha256: entry.sha256 });
    }
    if (
      digest(
        sources
          .flatMap(({ reference, sha256 }) => [`path:${reference}`, `sha256:${sha256}`])
          .join('\n'),
      ) !== bound.handoffHash
    )
      throw new Error('旧 Handoff 来源摘要与原 Design 审批不符');
    const expectedMarkdown = beta
      ? renderClassicSpecHandoffMarkdown(activeRef, change, bound.handoffHash, sources)
      : renderClassicHandoffMarkdown(change, 'compact', bound.handoffHash, sources);
    const markdown = await readClassicProjectFile(root, markdownRef, { label });
    const tasks = beta
      ? undefined
      : sources.find(({ reference }) => reference === `${activeRef}/tasks.md`);
    if (
      normalizeHandoffTaskExcerpt(markdown, tasks) !==
      normalizeHandoffTaskExcerpt(expectedMarkdown, tasks)
    )
      throw new Error('旧 Handoff Markdown 与已绑定来源的确定性渲染不符');
    result[jsonRef] = digest(json);
    result[markdownRef] = digest(markdown);
  }
  return result;
}

/** 旧 Run 只恢复原 Verify 可证明的搬迁和注记，不从当前规格推测 OpenSpec 的输出。 */
export async function readLegacyClassicArchiveInputs(
  root: string,
  run: Readonly<WorkflowRun>,
  archiveAction: Readonly<RuntimeAction>,
  archiveRef: string,
): Promise<{
  inputs: Record<string, string>;
  sources: Record<string, string>;
  stateFiles: string[];
  optionalFiles: Record<string, string>;
}> {
  try {
    const activeRef = (run.input as { changeDir?: unknown } | null)?.changeDir;
    const profile = (run.state as { workflow?: string }).workflow;
    if (
      typeof activeRef !== 'string' ||
      normalizeWorkflowRelativePath(activeRef, label) !== activeRef ||
      normalizeWorkflowRelativePath(archiveRef, label) !== archiveRef ||
      archiveAction.runId !== run.runId ||
      archiveAction.stepId !== `${profile}.archive.execute` ||
      archiveAction.status !== 'succeeded' ||
      archiveAction.outcome?.status !== 'succeeded' ||
      (archiveAction.outcome.output as { archiveDirectory?: unknown })?.archiveDirectory !==
        archiveRef ||
      !archiveAction.claim
    )
      throw new Error('原 Archive Action 身份或归档路径不符');
    const check = run.actions
      .slice()
      .reverse()
      .find(
        (action) => action.stepId === `${profile}.verify.check` && action.status === 'succeeded',
      );
    const output = check?.outcome?.output as Record<string, unknown> | undefined;
    const manifestRef = output?.manifestRef;
    if (
      check?.outcome?.status !== 'succeeded' ||
      typeof manifestRef !== 'string' ||
      normalizeWorkflowRelativePath(manifestRef, label) !== manifestRef ||
      !manifestRef.startsWith(`${classicSdkCheckDirectoryRef(run)}/`) ||
      typeof output?.manifestHash !== 'string'
    )
      throw new Error('缺少原 Verify 的固定输入清单');
    const manifest = await readClassicProjectFile(root, manifestRef, {
      label,
      maxBytes: Number.MAX_SAFE_INTEGER,
    });
    if (checkManifestHash(manifest) !== output.manifestHash)
      throw new Error('原 Verify 输入清单摘要不符');
    const accepted = new Map<string, string>();
    for (const { p, h } of parseCheckManifest(manifest)) {
      if (p.startsWith('\0git:')) continue;
      if (
        normalizeWorkflowRelativePath(p, label) !== p ||
        !/^(?:missing|git:[a-f0-9]{40}(?:[a-f0-9]{24})?|[a-f0-9]{64})$/u.test(h) ||
        accepted.has(p)
      )
        throw new Error('原 Verify 输入清单路径或内容身份无效');
      accepted.set(p, h);
    }
    const { outputs } = classicArchiveDocumentOutputs(run, archiveAction);
    const plan = outputs['full.build.plan'] as
      { plan?: string; designEvidence?: { ref?: string } } | undefined;
    const design =
      (outputs['full.design.document'] as { designDoc?: string } | undefined)?.designDoc ??
      plan?.designEvidence?.ref;
    const documentKinds = new Map<string, string>();
    if (design) documentKinds.set(design, 'status: final');
    if (plan?.plan) documentKinds.set(plan.plan, '');
    if (profile === 'full' && (!design || !plan?.plan || design === plan.plan))
      throw new Error('缺少原 Archive 固定的 Design/Plan 路径');
    const receiptRef = `${archiveRef}/.comet/archive-documents.json`;
    const receiptSource = await readClassicProjectFile(root, receiptRef, { label });
    const receipt: unknown = JSON.parse(receiptSource);
    if (
      !object(receipt, ['runId', 'actionId', 'attempt', 'inputHash', 'claimToken', 'documents']) ||
      receipt.runId !== run.runId ||
      receipt.actionId !== archiveAction.id ||
      receipt.attempt !== archiveAction.attempt ||
      receipt.inputHash !== archiveAction.inputHash ||
      receipt.claimToken !== portableClaimToken(archiveAction.claim.token) ||
      !object(receipt.documents, [...documentKinds.keys()])
    )
      throw new Error('原 Archive 文档收据身份或字段不符');
    const documents = receipt.documents;
    const inputs: Record<string, string> = {};
    const sources: Record<string, string> = {};
    const originalDocuments = new Map<string, string>();
    for (const [ref, expected] of accepted) {
      if (!ref.startsWith(`${activeRef}/`) && !documentKinds.has(ref)) continue;
      const mapped = archivedClassicDocumentRef(ref, activeRef, archiveRef)!;
      if (documentKinds.has(ref)) {
        const document = documents[ref];
        if (
          !object(document, ['original', 'extraFields']) ||
          typeof document.original !== 'string' ||
          document.extraFields !== documentKinds.get(ref) ||
          !matchesOriginal(document.original, expected)
        )
          throw new Error(`原 Archive 文档收据与已验收原文不符：${ref}`);
        const annotated = annotatedMarkdown(
          document.original,
          path.posix.basename(archiveRef),
          documentKinds.get(ref)!,
        );
        if ((await readClassicProjectFile(root, mapped, { label })) !== annotated)
          throw new Error(`Archive 文档不是原验收内容的确定性注记：${ref}`);
        originalDocuments.set(ref, document.original);
        sources[ref] = digest(document.original);
        inputs[mapped] = digest(annotated);
      } else if (ref === `${activeRef}/tasks.md` && expected !== 'missing') {
        const tasks = await readClassicProjectFile(root, mapped, { label });
        if (!matchesOriginal(tasks, expected) && classicTaskRevision(tasks) !== expected)
          throw new Error('Archive 任务要求与原 Verify 不符');
        inputs[mapped] = digest(tasks);
        sources[ref] = digest(tasks);
      } else {
        const file = await inspectProtectedProjectPath(root, mapped, { label, expected: 'file' });
        const actual = !file.exists
          ? 'missing'
          : expected.startsWith('git:')
            ? `git:${hashGitPaths(root, [mapped]).get(mapped)}`
            : (await hashClassicProjectFile(root, mapped, { label })).digest;
        if (actual !== expected) throw new Error(`Archive 搬迁文件与原 Verify 不符：${ref}`);
        inputs[mapped] = expected;
        sources[ref] = expected;
      }
      if (mapped !== ref) inputs[ref] = 'missing';
    }
    for (const ref of [
      `${activeRef}/proposal.md`,
      `${activeRef}/tasks.md`,
      ...documentKinds.keys(),
    ])
      if (!accepted.has(ref) || accepted.get(ref) === 'missing')
        throw new Error(`原 Verify 没有绑定归档所需文件：${ref}`);
    inputs[receiptRef] = digest(receiptSource);
    const requirementsRef = `${archiveRef}/.comet/archive-requirements.json`;
    if (
      (await inspectProtectedProjectPath(root, requirementsRef, { label, expected: 'file' })).exists
    ) {
      const source = await readClassicProjectFile(root, requirementsRef, { label });
      const requirements: unknown = JSON.parse(source);
      if (
        !object(requirements, ['schema', 'files']) ||
        requirements.schema !== 'comet.classic.archive-requirements.v1' ||
        !Array.isArray(requirements.files) ||
        new Set(requirements.files).size !== requirements.files.length ||
        !requirements.files.includes('proposal.md') ||
        !requirements.files.includes('tasks.md') ||
        !accepted.has(`${activeRef}/.openspec.yaml`) ||
        accepted.get(`${activeRef}/.openspec.yaml`) === 'missing' ||
        requirements.files.some(
          (ref) =>
            typeof ref !== 'string' ||
            !(
              ['proposal.md', 'design.md', 'tasks.md'].includes(ref) ||
              /^specs\/(?:[^/\\:]+\/)+spec\.md$/u.test(ref)
            ) ||
            normalizeWorkflowRelativePath(ref, label) !== ref ||
            !inputs[`${archiveRef}/${ref}`] ||
            inputs[`${archiveRef}/${ref}`] === 'missing',
        )
      )
        throw new Error('原 Archive 必需工件收据没有对应的已验证文件');
      inputs[requirementsRef] = digest(source);
    }
    const stateRef = path
      .relative(root, await resolveClassicStateFile(path.join(root, archiveRef)))
      .replaceAll('\\', '/');
    const activeState = `${activeRef}/${path.posix.basename(stateRef)}`;
    inputs[activeState] = 'missing';
    const optionalFiles = await legacyHandoffFiles(
      root,
      run,
      archiveAction,
      activeRef,
      archiveRef,
      originalDocuments,
    );
    for (const name of ['.comet-state.lock', '.comet-state-transaction.json']) {
      const ref = `${archiveRef}/${name}/.comet-runtime-migration.json`;
      if (!(await inspectProtectedProjectPath(root, ref, { label, expected: 'file' })).exists)
        continue;
      const source = (await readProtectedProjectFile(root, ref, 1024 * 1024, { label })).bytes;
      if (
        !object(JSON.parse(source.toString('utf8')), [
          'schema',
          'workspaceId',
          'source',
          'target',
          'kind',
        ]) ||
        !(await isWorkspaceRuntimeMigrationFence(path.join(root, archiveRef, name)))
      )
        throw new Error(`Archive 系统迁移标记无效：${ref}`);
      optionalFiles[ref] = createHash('sha256').update(source).digest('hex');
    }
    return { inputs, sources, stateFiles: [stateRef, activeState], optionalFiles };
  } catch (error) {
    throw new Error(
      `Classic 旧版 Archive 无法从原验收证据安全恢复：${error instanceof Error ? error.message : String(error)}。保留同一 Run 和历史审批，从原设备或备份恢复原 Verify 清单及 Archive 文档收据，或将文件恢复到原验收内容后重试交付；不能补造旧执行清单、重放 Archive 或批准未知的主规格变换。`,
      { cause: error },
    );
  }
}
