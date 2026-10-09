import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { hashRuntimeValue } from '../../../domains/engine/runtime.js';
import {
  compileWorkflowApplication,
  prepareWorkflowApplicationPlan,
  hashWorkflowApplicationPlanContent,
  type WorkflowApplicationProposal,
} from '../../../domains/workflow-generation/index.js';
import {
  exportWorkflowApplication,
  previewWorkflowApplicationInstall,
  installWorkflowApplication,
} from '../../../domains/workflow-application/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-authored-documents-'));
  await fs.mkdir(path.join(root, 'node_modules/@rpamis'), { recursive: true });
  await fs.symlink(process.cwd(), path.join(root, 'node_modules/@rpamis/comet'), 'junction');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const skill =
  '---\r\nname: authored-report\r\ndescription: 根据确认的访谈生成业务报告。\r\n---\r\n\r\n# 访谈报告\r\n\r\n先问完整可回答问题，再按用户实际答案记录；有疑义时保留原结果。\r\n读取[业务约定](references/policy.md#limits)。\r\n';
const rule = '# 访谈业务规则\n\n未解决问题不得省略。只有用户明确同意发布时才发布。\n';
function proposal(
  documents: Record<string, string> | undefined = {
    'SKILL.md': skill,
    'rules/workflow-guard.md': rule,
    'references/policy.md': '# 业务约定\n\n## Limits\n\n保留原有术语。\n',
  },
): WorkflowApplicationProposal {
  return {
    schema: 'comet.workflow.application.plan.v1',
    manifest: {
      schema: 'comet.workflow.application.v1',
      id: 'authored-report',
      version: '1',
      base: 'standalone',
      runtimeVersion: '0.4.5',
      entrySkill: 'SKILL.md',
      module: 'application.mjs',
      skills: [],
      bindings: [],
    },
    composition: { kind: 'report' },
    modules: {},
    ...(documents ? { documents } : {}),
  };
}
const prepare = (value: WorkflowApplicationProposal) =>
  prepareWorkflowApplicationPlan({
    proposal: value,
    packageRoot: path.join(root, 'preview'),
    projectRoot: root,
  });
const compile = (plan: unknown, confirmationHash = hashRuntimeValue(plan), name = 'compiled') =>
  compileWorkflowApplication({
    plan,
    confirmationHash,
    packageRoot: path.join(root, name),
    projectRoot: root,
  });

it('preserves Agent-authored Skill/Rule text and appends SDK protocol and the actual workflow table', async () => {
  const plan = await prepare(proposal());
  expect(plan.documents).toEqual(proposal().documents);
  await compile(plan);
  const entry = await fs.readFile(path.join(root, 'compiled/SKILL.md'), 'utf8');
  const compiledRule = await fs.readFile(
    path.join(root, 'compiled/rules/workflow-guard.md'),
    'utf8',
  );
  expect(entry.startsWith(skill)).toBe(true);
  expect(entry).toContain('## SDK 执行协议');
  expect(entry).toContain('comet runtime dispatch');
  expect(entry.match(/\nname: authored-report/g)).toHaveLength(1);
  expect(compiledRule.startsWith(rule)).toBe(true);
  expect(compiledRule).toContain('## SDK 通用规则');
  expect(compiledRule).toContain('| report-publishing/');
  expect(await fs.readFile(path.join(root, 'compiled/references/policy.md'), 'utf8')).toBe(
    proposal().documents!['references/policy.md'],
  );
});

it('does not add references when the Agent supplies only the required entry and Rule', async () => {
  const plan = await prepare(
    proposal({
      'SKILL.md': skill.replace('读取[业务约定](references/policy.md#limits)。\r\n', ''),
      'rules/workflow-guard.md': rule,
    }),
  );
  await compile(plan);
  await expect(fs.access(path.join(root, 'compiled/references'))).rejects.toThrow();
});

it('keeps the SDK-only generic sample available when documents are omitted', async () => {
  const sample = proposal();
  delete sample.documents;
  await compile(await prepare(sample));
  expect(await fs.readFile(path.join(root, 'compiled/SKILL.md'), 'utf8')).toContain(
    '启动或恢复已确认的 authored-report 工作流应用',
  );
});

it.each([
  ['missing Rule', { 'SKILL.md': skill }, /Rule|文档/],
  ['missing entry', { 'rules/workflow-guard.md': rule }, /SKILL|文档/],
  [
    'missing frontmatter',
    { 'SKILL.md': '# title\nbody', 'rules/workflow-guard.md': rule },
    /frontmatter|元数据/,
  ],
  [
    'wrong name',
    {
      'SKILL.md': skill.replace('name: authored-report', 'name: another-name'),
      'rules/workflow-guard.md': rule,
    },
    /name|名称/,
  ],
  [
    'empty description',
    {
      'SKILL.md': skill.replace('description: 根据确认的访谈生成业务报告。', "description: ''"),
      'rules/workflow-guard.md': rule,
    },
    /description|描述/,
  ],
  [
    'empty body',
    {
      'SKILL.md': '---\nname: authored-report\ndescription: Report\n---\n ',
      'rules/workflow-guard.md': rule,
    },
    /正文/,
  ],
  [
    'invalid YAML',
    { 'SKILL.md': '---\nname: [invalid\n---\nbody', 'rules/workflow-guard.md': rule },
    /frontmatter|元数据/,
  ],
  [
    'duplicate metadata',
    {
      'SKILL.md':
        '---\nname: authored-report\nname: authored-report\ndescription: valid\n---\nbody',
      'rules/workflow-guard.md': rule,
    },
    /frontmatter|元数据/,
  ],
  ['NUL', { 'SKILL.md': skill + '\0', 'rules/workflow-guard.md': rule }, /NUL|空字符/],
  [
    'traversal',
    { 'SKILL.md': skill, 'rules/workflow-guard.md': rule, '../escape.md': 'invalid' },
    /路径/,
  ],
  [
    'reserved dependency',
    { 'SKILL.md': skill, 'rules/workflow-guard.md': rule, 'skills/worker/notes.md': 'invalid' },
    /冲突|路径/,
  ],
  [
    'case collision',
    { 'SKILL.md': skill, 'rules/workflow-guard.md': rule, 'skill.md': 'invalid' },
    /冲突/,
  ],
  [
    'file ancestor collision',
    { 'SKILL.md': skill, 'rules/workflow-guard.md': rule, 'application.mjs/notes.md': 'invalid' },
    /冲突/,
  ],
] as const)(
  'rejects authored document %s before producing a package',
  async (_, documents, error) => {
    await expect(prepare(proposal({ ...documents }))).rejects.toThrow(error);
    await expect(fs.access(path.join(root, 'preview'))).rejects.toThrow();
  },
);

it('validates real Markdown links while retaining titles, angle targets, references and code examples', async () => {
  const docs = {
    ...proposal().documents!,
    'SKILL.md':
      skill +
      '\n[angle](<references/policy.md#limits> "业务标题")\n[reference][policy]\n\n[policy]: references/policy.md "说明"\n\n[version](references/version(1).md)\n\n    [example](references/not-a-file.md)\n\n`[literal][undefined]`\n',
    'references/version(1).md': '# Version\n实际业务内容。\n',
  };
  await compile(await prepare(proposal(docs)));
  expect(
    (await fs.readFile(path.join(root, 'compiled/SKILL.md'), 'utf8')).startsWith(docs['SKILL.md']),
  ).toBe(true);
});

it('allows a reference directory only when that directory is actually materialized in the fixed package', async () => {
  const docs = { ...proposal().documents!, 'SKILL.md': skill + '\n[参考目录](references/)\n' };
  await compile(await prepare(proposal(docs)));
  expect(await fs.readFile(path.join(root, 'compiled/references/policy.md'), 'utf8')).toBe(
    docs['references/policy.md'],
  );
});

it.each([
  ['inline', '[missing](references/missing.md)'],
  ['reference', '[missing][ref]\n\n[ref]: references/missing.md'],
  ['escape', '[outside](../private.md)'],
  ['encoded escape', '[outside](%2e%2e/private.md)'],
  ['undefined reference', '[missing][absent]'],
] as const)('rejects an invalid %s resource link', async (_, markdown) => {
  const docs = { ...proposal().documents!, 'SKILL.md': skill + markdown };
  await expect(prepare(proposal(docs))).rejects.toThrow(/引用|链接|资源/);
});

it('includes complete documents in confirmation and package hashes without a character cap', async () => {
  const first = await prepare(proposal());
  const changed = structuredClone(first);
  changed.documents = {
    ...changed.documents!,
    'SKILL.md': skill + '完整业务说明。\n'.repeat(20000),
  };
  expect(await hashWorkflowApplicationPlanContent(first)).not.toBe(
    await hashWorkflowApplicationPlanContent(changed),
  );
  await expect(compile(changed, hashRuntimeValue(first))).rejects.toThrow(/重新确认/);
  const built = await compile(changed);
  expect(
    (await fs.readFile(path.join(root, 'compiled/SKILL.md'), 'utf8')).startsWith(
      changed.documents['SKILL.md'],
    ),
  ).toBe(true);
  expect(built.compositionHash).toBe(hashRuntimeValue(changed));
});

it('retains business content in an exported package and its installed immutable version and host entry', async () => {
  const built = await compile(await prepare(proposal()));
  const exported = await exportWorkflowApplication({
    file: built.file,
    projectRoot: root,
    destination: path.join(root, 'exported'),
  });
  expect((await fs.readFile(path.join(root, 'exported/SKILL.md'), 'utf8')).startsWith(skill)).toBe(
    true,
  );
  const options = {
    file: exported.file,
    projectRoot: root,
    scope: 'project' as const,
    platforms: ['codex'],
  };
  const preview = await previewWorkflowApplicationInstall(options);
  const installed = await installWorkflowApplication({
    ...options,
    confirmationHash: preview.confirmationHash,
  });
  expect(
    (await fs.readFile(path.join(path.dirname(installed.file), 'SKILL.md'), 'utf8')).startsWith(
      skill,
    ),
  ).toBe(true);
  expect(
    (
      await fs.readFile(path.join(path.dirname(installed.file), 'rules/workflow-guard.md'), 'utf8')
    ).startsWith(rule),
  ).toBe(true);
  const host = await fs.readFile(
    path.join(root, '.agents/skills/authored-report/SKILL.md'),
    'utf8',
  );
  expect(host).toContain('先问完整可回答问题，再按用户实际答案记录');
  expect(host).toContain('comet runtime dispatch');
  expect(host).toContain(
    path.join(path.dirname(installed.file), 'references/policy.md').replaceAll('\\', '/'),
  );
});
