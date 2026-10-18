import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Ajv } from 'ajv';
import { adaptApplicationSkill } from '../../../domains/workflow-application/skill-adapter.js';
import { createDiskApplication } from '../../helpers/workflow-application.js';
import { inspectApplicationSkill } from '../../../domains/workflow-application/index.js';

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-skill-references-'));
  await fs.writeFile(path.join(root, 'SKILL.md'), '# Skill\nRead [format](FORMAT.md).\n');
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

it.each(['```md', '~~~md', '````md'])(
  'reads real resources while retaining %s template examples in the fixed content',
  async (opening) => {
    const marker = opening.replace('md', '');
    const template = `# Format\n\n${opening}\n[Ordering](./src/ordering/CONTEXT.md)\n${marker}\n\nUse [real data](data.json).\n`;
    await fs.writeFile(path.join(root, 'FORMAT.md'), template);
    await fs.writeFile(path.join(root, 'data.json'), '{}');
    const inspected = await inspectApplicationSkill(root);
    expect(inspected.files['FORMAT.md']).toBe(template);
    expect(Object.keys(inspected.files).sort()).toEqual(['FORMAT.md', 'SKILL.md', 'data.json']);
    await fs.writeFile(path.join(root, 'FORMAT.md'), template.replace('Ordering', 'Billing'));
    expect((await inspectApplicationSkill(root)).contentHash).not.toBe(inspected.contentHash);
    await fs.rm(path.join(root, 'data.json'));
    await expect(inspectApplicationSkill(root)).rejects.toThrow('资源缺失');
  },
);

it('does not close a template with a different marker, shorter fence, or trailing text', async () => {
  await fs.writeFile(
    path.join(root, 'FORMAT.md'),
    [
      '# Format',
      '````md',
      '~~~',
      '[example](missing-one.md)',
      '```',
      '[example](missing-two.md)',
      '```` trailing text',
      '[example](missing-three.md)',
      '````',
      'Read [required](missing-real.md).',
    ].join('\n'),
  );
  await expect(inspectApplicationSkill(root)).rejects.toThrow('missing-real.md');
});

it.each([
  '[guide](<reference/suffix.txt>)',
  '[guide](<reference/my guide.txt>)',
  '[guide](<reference/my guide.txt> "A guide title")',
  "[guide](reference/suffix.txt 'A guide title')",
  '[guide](reference/suffix.txt?mode=full#intro)',
  '[guide](reference/my%20guide.txt)',
  '[guide](reference/guide(one).txt)',
  '[guide][source]\n\n[source]: <reference/my guide.txt> "Title"',
  '![guide](<reference/my guide.txt>)',
])('accepts valid Markdown resource syntax: %s', async (link) => {
  await fs.mkdir(path.join(root, 'reference'));
  for (const name of ['suffix.txt', 'my guide.txt', 'guide(one).txt'])
    await fs.writeFile(path.join(root, 'reference', name), 'Actual resource');
  await fs.writeFile(path.join(root, 'SKILL.md'), `# Skill\n${link}\n`);
  await expect(inspectApplicationSkill(root)).resolves.toMatchObject({ root });
  await fs.rm(path.join(root, 'reference'), { recursive: true });
  await expect(inspectApplicationSkill(root)).rejects.toThrow('资源缺失');
});

it('ignores remote links and code examples without changing the fixed content', async () => {
  const content = [
    '# Skill',
    '[web](<https://example.com/a?q=b#c> "Title")',
    '[mail](mailto:reader@example.com)',
    '[custom](custom+scheme:resource)',
    '[cdn](//example.com/guide)',
    '[anchor](#section)',
    '[query](?view=full)',
    '`[inline example](missing-inline.txt)`',
    '',
    '    [indented example](missing-indented.txt)',
    '',
    '> ```md',
    '> [quoted example](missing-quoted.txt)',
    '> ```',
  ].join('\n');
  await fs.writeFile(path.join(root, 'SKILL.md'), content);
  expect((await inspectApplicationSkill(root)).files['SKILL.md']).toBe(content);
});

it.each(['../outside.txt', '%2e%2e/outside.txt', '/absolute.txt', '..'])(
  'still rejects paths outside the Skill: %s',
  async (target) => {
    await fs.writeFile(path.join(root, 'SKILL.md'), `[guide](<${target}> "Title")`);
    await expect(inspectApplicationSkill(root)).rejects.toThrow('越过依赖目录');
  },
);

it('reports invalid local URL encoding as a workflow error', async () => {
  await fs.writeFile(path.join(root, 'SKILL.md'), '[guide](bad%ZZ.txt)');
  await expect(inspectApplicationSkill(root)).rejects.toThrow('引用路径编码无效');
});

it('reuses Schema values while invalidating changed boundaries and checking file drift', async () => {
  await fs.mkdir(path.join(root, 'fixture'));
  const fixture = await createDiskApplication(path.join(root, 'fixture'));
  const dependency = fixture.manifest.skills[0];
  dependency.adapter.outputSchema = { type: 'string', minLength: 7, maxLength: 17 };
  const compile = vi.spyOn(Ajv.prototype, 'compile');
  try {
    const original = await adaptApplicationSkill(dependency, fixture.packageRoot);
    expect(compile).toHaveBeenCalledTimes(2);
    const repeated = await adaptApplicationSkill(structuredClone(dependency), fixture.packageRoot);
    expect(compile).toHaveBeenCalledTimes(2);
    expect(() => repeated.validateOutput('1234567')).not.toThrow();
    expect(() => repeated.validateOutput('short')).toThrow('输出 不匹配');

    dependency.adapter.outputSchema = { type: 'string', minLength: 9, maxLength: 17 };
    const changed = await adaptApplicationSkill(dependency, fixture.packageRoot);
    expect(compile).toHaveBeenCalledTimes(4);
    expect(() => changed.validateOutput('1234567')).toThrow('输出 不匹配');
    expect(() => original.validateOutput('1234567')).not.toThrow();
    dependency.adapter.outputSchema.minLength = 10;
    const mutated = await adaptApplicationSkill(dependency, fixture.packageRoot);
    expect(compile).toHaveBeenCalledTimes(6);
    expect(() => mutated.validateOutput('123456789')).toThrow('输出 不匹配');
    expect(() => changed.validateOutput('123456789')).not.toThrow();

    const renamed = structuredClone(dependency);
    renamed.id = 'renamed-writer';
    const another = await adaptApplicationSkill(renamed, fixture.packageRoot);
    expect(compile).toHaveBeenCalledTimes(6);
    expect(() => another.validateOutput('short')).toThrow('renamed-writer 输出');
    renamed.adapter.review.capabilities[0].excerpt = 'missing review evidence';
    await expect(adaptApplicationSkill(renamed, fixture.packageRoot)).rejects.toThrow('审查证据');
    await fs.appendFile(path.join(fixture.skillRoot, 'SKILL.md'), '\nChanged content');
    await expect(adaptApplicationSkill(dependency, fixture.packageRoot)).rejects.toThrow(
      '内容发生漂移',
    );
  } finally {
    compile.mockRestore();
  }
});

it('accepts a shared named Schema and preserves references between input and output', async () => {
  await fs.mkdir(path.join(root, 'fixture'));
  const fixture = await createDiskApplication(path.join(root, 'fixture'));
  const dependency = fixture.manifest.skills[0];
  const schema = { $id: 'urn:comet:test:shared-string', type: 'string', minLength: 3 };
  dependency.adapter.inputSchema = schema;
  dependency.adapter.outputSchema = schema;
  const shared = await adaptApplicationSkill(dependency, fixture.packageRoot);
  expect(() => shared.validateInput('yes')).not.toThrow();
  expect(() => shared.validateOutput('no')).toThrow('输出 不匹配');
  dependency.adapter.outputSchema = { $ref: schema.$id };
  const referenced = await adaptApplicationSkill(dependency, fixture.packageRoot);
  expect(() => referenced.validateOutput('yes')).not.toThrow();
  expect(() => referenced.validateOutput('no')).toThrow('输出 不匹配');
  schema.minLength = 4;
  const changed = await adaptApplicationSkill(dependency, fixture.packageRoot);
  expect(() => changed.validateInput('yes')).toThrow('输入 不匹配');
  expect(() => changed.validateOutput('yes')).toThrow('输出 不匹配');
  expect(() => referenced.validateOutput('yes')).not.toThrow();
});
