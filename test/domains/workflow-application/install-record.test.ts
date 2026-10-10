import { getCurrentVersion } from '../../../platform/version/version.js';
import path from 'node:path';
import { expect, it } from 'vitest';
import { applicationInstallSkills } from '../../../domains/workflow-application/install-record.js';
import type { WorkflowApplicationManifest } from '../../../domains/workflow-application/types.js';

it('keeps authored instructions and resolves their resource links from the installed entry', () => {
  const root = path.resolve('fixed application');
  const body = [
    '---',
    'name: authored-suite',
    'description: Interview and implement the approved inventory rules.',
    '---',
    '',
    '先访谈并确认库存规则，再实施和验收。',
    '[业务指南][guide]',
    '[SDK 规则](<rules/workflow-guard.md#approval> "审批与恢复")',
    '[external](https://example.test/guide#entry)',
    '[comparison](references/business.md?compare=../../sample#view)',
    '',
    '[guide]: references/business.md#frontier "访谈顺序"',
    '',
    '`[示例](references/missing.md)`',
    '```md',
    '[示例][sample]',
    '[sample]: references/not-a-resource.md',
    '```',
    '',
  ].join('\n');
  const manifest = {
    schema: 'comet.workflow.application.v1',
    id: 'authored-suite',
    version: '1',
    base: 'standalone',
    runtimeVersion: getCurrentVersion(),
    entrySkill: 'SKILL.md',
    module: 'application.mjs',
    skills: [],
    bindings: [],
  } satisfies WorkflowApplicationManifest;
  const entries = applicationInstallSkills(
    manifest,
    { 'SKILL.md': Buffer.from(body).toString('base64') },
    root,
  );
  const entry = Buffer.from(entries[0].files['SKILL.md'], 'base64').toString('utf8');
  const absolute = (ref: string) => path.resolve(root, ref).replaceAll('\\', '/');
  expect(entry).toContain('先访谈并确认库存规则，再实施和验收。');
  expect(entry).toContain(`${absolute('references/business.md')}#frontier`);
  expect(entry).toContain(`${absolute('rules/workflow-guard.md')}#approval`);
  expect(entry).toContain(`${absolute('references/business.md')}?compare=../../sample#view`);
  expect(entry).toContain('"访谈顺序"');
  expect(entry).toContain('"审批与恢复"');
  expect(entry).toContain('[external](https://example.test/guide#entry)');
  expect(entry).toContain('`[示例](references/missing.md)`');
  expect(entry).toContain('[sample]: references/not-a-resource.md');
});
