import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  createRuntimeExecutor,
  defineRuntimeHandler,
  hashRuntimeValue,
  RuntimeProtocolError,
  type RuntimeStepInput,
  type RuntimeValue,
  type WorkflowRun,
} from '../engine/runtime.js';
import { atomicWriteContainedText } from '../workflow-contract/contained-atomic-write.js';
import { readProtectedProjectFile } from '../workflow-contract/protected-project-path.js';
import type {
  WorkflowApplicationFactoryContext,
  WorkflowApplicationImplementation,
} from './types.js';

type ReportArtifact = {
  ref: string;
  contentHash: string;
  markdown: string;
};

const MAX_BYTES = 1024 * 1024;
const MAX_REVISIONS = 2;
const reportSchema = {
  type: 'object',
  required: ['ref', 'contentHash', 'markdown'],
  additionalProperties: false,
  properties: {
    ref: { type: 'string', minLength: 1 },
    contentHash: { type: 'string', pattern: '^[a-f0-9]{64}$' },
    markdown: { type: 'string', minLength: 1 },
  },
};

function object(value: unknown): Record<string, RuntimeValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('报告输入必须是 JSON 对象');
  return value as Record<string, RuntimeValue>;
}

function nonempty(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    throw new Error(`${label}必须是非空文本`);
  return value.trim();
}

function digest(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

function document(markdown: string): string {
  if (
    Buffer.byteLength(markdown) > MAX_BYTES ||
    !/^# [^\r\n]+\r?\n\s*\r?\n\S/u.test(markdown) ||
    markdown.includes('\0')
  )
    throw new Error('报告需要一级标题和非空正文，大小不能超过 1 MiB；保留草稿后修正');
  return markdown;
}

function report(value: unknown): ReportArtifact {
  const fields = object(value);
  nonempty(fields.markdown, '报告正文');
  document(fields.markdown as string);
  if (
    typeof fields.ref !== 'string' ||
    !/^\.comet\/reports\/[a-z][a-z\d]*(?:[.-][a-z\d]+)*\/drafts\/[a-f0-9]{64}\.md$/u.test(
      fields.ref,
    ) ||
    fields.contentHash !== digest(fields.markdown as string)
  )
    throw new Error('报告引用或内容摘要不匹配');
  // 保留实际字节，包括最后一行换行，审批与发布均核对相同内容。
  return fields as unknown as ReportArtifact;
}

function currentReport(run: Readonly<WorkflowRun>): ReportArtifact {
  const generated = run.outputs.generate;
  const revised = run.outputs.revise;
  return report(
    revised && (!generated || revised.sequence > generated.sequence)
      ? revised.value
      : object(generated?.value).compose,
  );
}

function revisionCount(run: Readonly<WorkflowRun>): number {
  return object(run.state).revisions as number;
}

/** 独立业务样板：SDK 拥有全部进度；本地发布不授予其他发送或部署权限。 */
export function createReportApplication(
  context: Pick<WorkflowApplicationFactoryContext, 'projectRoot'> & {
    manifest: Pick<WorkflowApplicationFactoryContext['manifest'], 'id'>;
  },
): WorkflowApplicationImplementation {
  const root = path.resolve(context.projectRoot);
  if (!/^[a-z][a-z\d]*(?:[.-][a-z\d]+)*$/u.test(context.manifest.id))
    throw new Error('报告应用需要有效的独立应用身份');
  const namespace = `.comet/reports/${context.manifest.id}`;
  const draftRef = (run: Readonly<WorkflowRun>) =>
    `${namespace}/drafts/${hashRuntimeValue(run.workflow.id === 'report-drafting' ? (run.lineage.at(-1) ?? run.runId) : run.runId)}.md`;
  const publishedRef = (run: Readonly<WorkflowRun>) =>
    `${namespace}/published/${hashRuntimeValue(run.runId)}.md`;
  const read = async (ref: string) =>
    (await readProtectedProjectFile(root, ref, MAX_BYTES, { label: '报告文件' })).bytes.toString(
      'utf8',
    );
  const actualReport = async (artifact: ReportArtifact) => {
    if (!artifact.ref.startsWith(`${namespace}/drafts/`)) throw new Error('报告工件属于其他应用');
    const markdown = await read(artifact.ref);
    if (markdown !== artifact.markdown || digest(markdown) !== artifact.contentHash)
      throw new Error('报告已变化；选择 revise，重新检查并审批实际草稿');
    return markdown;
  };
  // SDK 转移处理器同步执行。审批时核对原提案和实际文件，拒绝陈旧授权。
  const assertApprovalMaterial = (artifact: ReportArtifact) => {
    let cursor = root;
    for (const segment of artifact.ref.split('/')) {
      cursor = path.join(cursor, segment);
      const stat = lstatSync(cursor);
      if (
        stat.isSymbolicLink() ||
        (cursor !== path.join(root, artifact.ref) && !stat.isDirectory())
      )
        throw new Error('报告路径不能经过符号链接或 junction');
      if (!realpathSync(cursor).startsWith(realpathSync(root) + path.sep))
        throw new Error('报告路径必须在当前项目内');
    }
    const before = lstatSync(cursor);
    if (!before.isFile() || before.size > MAX_BYTES) throw new Error('报告文件无效');
    const bytes = readFileSync(cursor);
    const after = lstatSync(cursor);
    if (
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      digest(bytes.toString('utf8')) !== artifact.contentHash ||
      bytes.toString('utf8') !== artifact.markdown
    )
      throw new Error('报告已变化；选择 revise 后重新审批');
  };
  const approvedReport = (run: Readonly<WorkflowRun>) => {
    const artifact = currentReport(run);
    if (artifact.ref !== draftRef(run)) throw new Error('报告工件未绑定当前 Run');
    const wait = [...run.waits]
      .reverse()
      .find((wait) => ['approve', 'approve-revision'].includes(wait.stepId));
    if (
      !wait ||
      wait.decision?.choice !== 'approved' ||
      wait.decision.proposalHash !== wait.proposalHash
    )
      throw new Error('发布需要本 Run 最新报告的明确审批');
    const source = wait.stepId === 'approve' ? 'generate' : 'revise';
    const expected = { input: run.input, outputs: { [source]: wait.results[source].value } };
    if (hashRuntimeValue(expected) !== wait.proposalHash)
      throw new Error('审批提案已改变；不能用改写的提案发布');
    const approved =
      source === 'generate'
        ? report(object(wait.results[source].value).compose)
        : report(wait.results[source].value);
    if (hashRuntimeValue(approved) !== hashRuntimeValue(artifact))
      throw new Error('审批未绑定当前报告');
    return artifact;
  };
  const handler = (
    execute: (
      input: RuntimeStepInput,
      run: Readonly<WorkflowRun>,
    ) => Promise<RuntimeValue> | RuntimeValue,
  ) =>
    defineRuntimeHandler({
      type: 'call_tool',
      parseInput: (input) => input,
      async execute(input, { run }) {
        if (!run) throw new Error('报告工具需要当前 SDK Run');
        return { status: 'succeeded', output: await execute(input, run) };
      },
    });
  const toolExecutor = createRuntimeExecutor({
    id: 'report-local',
    handlers: {
      'report.draft': handler(({ input }) => {
        const request = object(object(input).input);
        const title = nonempty(request.title, '标题');
        if (/[\r\n]/u.test(title)) throw new Error('标题不能换行');
        return { markdown: document(`# ${title}\n\n${nonempty(request.body, '正文')}\n`) };
      }),
      'report.sources': handler(({ input }) => {
        const request = object(object(input).input);
        if (!Array.isArray(request.sources) || !request.sources.length)
          throw new Error('报告需要至少一个来源说明；该检查不证明来源事实正确');
        return { sources: request.sources.map((source) => nonempty(source, '来源')) };
      }),
      'report.compose': handler(async ({ outputs }, run) => {
        const draft = object(outputs.draft);
        const sources = object(outputs.sources).sources as string[];
        const markdown = document(
          `${draft.markdown}\n## 来源\n\n${sources.map((source) => `- ${source}`).join('\n')}\n`,
        );
        const ref = draftRef(run);
        await atomicWriteContainedText(path.join(root, ref), markdown, {
          containedRoot: root,
          exclusive: true,
        });
        return { ref, contentHash: digest(markdown), markdown };
      }),
      'report.revise': handler(async (_input, run) => {
        const previous = currentReport(run);
        if (previous.ref !== draftRef(run)) throw new Error('修订报告未绑定当前 Run');
        const markdown = document(await read(previous.ref));
        return { ref: previous.ref, contentHash: digest(markdown), markdown };
      }),
      'report.reject': handler(() => ({ status: 'rejected' })),
      'report.limit': handler(() => ({ status: 'revision-limit', maxRevisions: MAX_REVISIONS })),
      'report.publish': handler(async (_input, run) => {
        const artifact = approvedReport(run);
        const markdown = await actualReport(artifact);
        const ref = publishedRef(run);
        await atomicWriteContainedText(path.join(root, ref), markdown, {
          containedRoot: root,
          exclusive: true,
          requireAtomicPublication: true,
          beforeCommit: async () => {
            await actualReport(artifact);
          },
        });
        return { ref, contentHash: artifact.contentHash, report: artifact };
      }),
    },
  });
  return {
    workflows: [
      {
        id: 'report-publishing',
        version: '1',
        entry: 'generate',
        maxTransitions: 16,
        commands: {
          revise: { stepId: 'revise', validator: { id: 'report-revision-command', version: '1' } },
        },
        initialState: { revisions: 0 },
        stateSchema: {
          type: 'object',
          required: ['revisions'],
          additionalProperties: false,
          properties: { revisions: { type: 'integer', minimum: 0, maximum: MAX_REVISIONS } },
        },
        transitionHandler: { id: 'report-publishing-transition', version: '1' },
        steps: {
          generate: { type: 'child_workflow', workflow: { id: 'report-drafting', version: '1' } },
          approve: {
            type: 'ask_user',
            proposalFrom: 'generate',
            choices: ['approved', 'rejected', 'revise'],
          },
          'approve-revision': {
            type: 'ask_user',
            proposalFrom: 'revise',
            choices: ['approved', 'rejected', 'revise'],
          },
          revise: { type: 'call_tool', ref: 'report.revise', outputSchema: reportSchema },
          rejected: { type: 'call_tool', ref: 'report.reject' },
          limit: { type: 'call_tool', ref: 'report.limit' },
          publish: { type: 'call_tool', ref: 'report.publish', retry: 'reconcile' },
        },
        transitions: [
          { from: 'generate', to: 'approve' },
          { from: 'revise', to: 'approve-revision' },
          ...['approve', 'approve-revision'].flatMap((from) => [
            { from, to: 'publish', on: 'approved' },
            { from, to: 'rejected', on: 'rejected' },
            { from, to: 'revise', on: 'revise' },
            { from, to: 'limit', on: 'revise' },
          ]),
        ],
      },
      {
        id: 'report-drafting',
        version: '1',
        entry: ['draft', 'sources'],
        maxTransitions: 3,
        steps: {
          draft: { type: 'call_tool', ref: 'report.draft' },
          sources: { type: 'call_tool', ref: 'report.sources' },
          compose: {
            type: 'call_tool',
            ref: 'report.compose',
            join: ['draft', 'sources'],
            outputSchema: reportSchema,
          },
        },
        transitions: [
          { from: 'draft', to: 'compose' },
          { from: 'sources', to: 'compose' },
        ],
      },
    ],
    executors: [
      {
        ...toolExecutor,
        async preflight(action, _context, run) {
          if (!run) throw new Error('报告工具需要当前 Run');
          if (action.stepId === 'publish') await actualReport(approvedReport(run));
          if (action.stepId === 'revise' && revisionCount(run) >= MAX_REVISIONS)
            throw new Error('报告已达到修订上限；保留草稿，启动新的 Run');
        },
      },
    ],
    transitionHandlers: [
      {
        id: 'report-publishing-transition',
        version: '1',
        apply({ run, event }) {
          const revisions = revisionCount(run);
          if (event.kind === 'action-outcome') {
            if (event.outcome.status === 'failed') return { state: run.state!, next: [] };
            if (event.stepId === 'revise') {
              if (revisions >= MAX_REVISIONS) throw new Error('报告已达到修订上限');
              return { state: { revisions: revisions + 1 }, next: ['approve-revision'] };
            }
            return { state: run.state!, next: event.stepId === 'generate' ? ['approve'] : [] };
          }
          if (event.kind !== 'wait-resolved') throw new Error('报告流程不接受此事件');
          const wait = run.waits.find((wait) => wait.decision?.id === event.decisionId)!;
          const source = event.stepId === 'approve' ? 'generate' : 'revise';
          const canonical = { input: run.input, outputs: { [source]: wait.results[source].value } };
          if (event.choice === 'approved') {
            if (hashRuntimeValue(canonical) !== event.proposalHash)
              throw new RuntimeProtocolError(
                'STALE_PROPOSAL',
                '提案已改变；选择 revise 后审批实际报告',
              );
            assertApprovalMaterial(currentReport(run));
            return { state: run.state!, next: ['publish'] };
          }
          if (event.choice === 'rejected') return { state: run.state!, next: ['rejected'] };
          return revisions < MAX_REVISIONS
            ? { state: run.state!, next: ['revise'] }
            : { state: run.state!, next: ['limit'] };
        },
      },
    ],
    commandValidators: [
      {
        id: 'report-revision-command',
        version: '1',
        validate({ run, input }) {
          try {
            currentReport(run);
            if (
              input !== null ||
              revisionCount(run) >= MAX_REVISIONS ||
              run.actions.some(
                (action) =>
                  ['publish', 'rejected', 'limit'].includes(action.stepId) &&
                  action.status === 'succeeded',
              )
            )
              throw new Error('修订需要未发布报告、null 输入和剩余修订次数');
            return { accepted: true };
          } catch (error) {
            return {
              accepted: false,
              reason: error instanceof Error ? error.message : String(error),
            };
          }
        },
      },
    ],
    async validateOutcome({ run, action, outcome }) {
      if (outcome.status === 'failed') return { accepted: true };
      try {
        if (['compose', 'revise', 'generate'].includes(action.stepId)) {
          const artifact = report(
            action.stepId === 'generate' ? object(outcome.output).compose : outcome.output,
          );
          if (artifact.ref !== draftRef(run)) throw new Error('报告结果需要当前 Run 的实际工件');
          await actualReport(artifact);
        }
        if (action.stepId === 'publish') {
          const artifact = approvedReport(run);
          await actualReport(artifact);
          const output = object(outcome.output);
          if (
            output.ref !== publishedRef(run) ||
            output.contentHash !== artifact.contentHash ||
            hashRuntimeValue(output.report) !== hashRuntimeValue(artifact) ||
            (await read(publishedRef(run))) !== artifact.markdown
          )
            throw new Error('发布结果需要实际审批报告及已发布文件，完成字符串不能通过检查');
        }
        return { accepted: true };
      } catch (error) {
        return { accepted: false, reason: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
