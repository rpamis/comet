import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe.each(['skills-zh', 'skills'])('%s SDK flow handoffs', (root) => {
  const read = (ref: string) => fs.readFile(path.resolve('assets', root, ref), 'utf8');
  it('routes preset scope checks to the matching Runtime reference without repeating file-count authorization', async () => {
    const entry = await read('comet-classic/SKILL.md');
    const section = root === 'skills-zh' ? '预设范围复核' : 'Preset scope';
    expect(entry).toContain(
      `reference/sdk-methods.md#${section.toLowerCase().replaceAll(' ', '-')}`,
    );
    expect(await read('comet-classic/reference/sdk-methods.md')).toContain(`## ${section}`);
    expect(entry).toContain('rulings.md');
    expect(entry).toContain('reference/compat.md');
    expect(entry).not.toContain('文件数超过提示阈值时，展示');
    expect(entry).not.toContain('changed-file count exceeds the advisory threshold, present');
  });
  it('discloses Compat commands separately and retains SDK methods and approvals', async () => {
    for (const name of [
      'comet-design',
      'comet-build',
      'comet-verify',
      'comet-archive',
      'comet-hotfix',
      'comet-tweak',
    ]) {
      const main = await read(`${name}/SKILL.md`);
      expect(main).toContain('](reference/compat.md)');
      expect(main).toContain('../comet-classic/reference/sdk-methods.md');
      expect(main).not.toContain('comet state set <name>');
      const compat = await read(`${name}/reference/compat.md`);
      expect(compat).toContain('comet state select');
    }
    const methods = await read('comet-classic/reference/sdk-methods.md');
    for (const contract of [
      'configuration.language',
      'comet-task-authority',
      'base-ref',
      'CRITICAL/IMPORTANT',
      '--local',
      'rulings.md',
      'complete-delivery',
    ])
      expect(methods).toContain(contract);
    for (const name of ['comet-hotfix', 'comet-tweak']) {
      const main = await read(`${name}/SKILL.md`);
      expect(main).toContain('open --json');
      expect(main).toContain('open --apply --approval-hash');
    }
  });
  it('submits checked Design, Verify, and Archive directly and supports explicit configuration approval', async () => {
    expect(await read('comet-design/SKILL.md')).not.toContain(
      '`comet guard <change-name> design --design-doc <design-doc-ref>`',
    );
    expect(await read('comet-verify/SKILL.md')).not.toContain(
      '`comet guard <change-name> verify --report <report-ref>`',
    );
    expect(await read('comet-archive/SKILL.md')).not.toContain(
      '`comet guard <change-name> archive`',
    );
    expect(await read('comet-build/SKILL.md')).toContain(
      'propose-build <change-name> --file <configuration-json> --confirmed',
    );
  });
  it('ships the complete edit-review protocol and distinguishes SDK Archive from Git delivery', async () => {
    const review = await read('comet/reference/edit-review.md');
    for (const command of [
      'claim',
      'recordTemplate',
      'non-behavioral',
      'implementation-changed',
      'requirements-changed',
      'discard',
      '--confirmed',
    ])
      expect(review).toContain(command);
    const native = await read('comet-native/SKILL.md');
    expect(native).toContain('reference/edit-review.md');
    expect(await read('comet-native/reference/edit-review.md')).toBe(review);
    expect(native).toContain('SDK');
    expect(native).toContain('Compat');
    const workspace = await read('comet-native/reference/workspace.md');
    expect(workspace).toContain('SDK');
    expect(workspace).toContain('SHA');
    expect(workspace).toContain('Compat');
  });
  it('distinguishes refreshed check evidence from product implementation changes', async () => {
    const review = await read('comet/reference/edit-review.md');
    const boundaries =
      root === 'skills-zh'
        ? [
            '产品行为与验收含义不变',
            '检查证据需要更新',
            '产品实现变化',
            '说明文字参与实际产品行为时',
            '保留原报告、批准和候选',
          ]
        : [
            'product behavior and acceptance meaning stay unchanged',
            'check evidence needs updating',
            'product implementation change',
            'explanatory text participates in actual product behavior',
            'keep the original report, approvals, and candidate',
          ];
    for (const boundary of boundaries) expect(review).toContain(boundary);
    for (const decision of ['non-behavioral', 'implementation-changed', 'requirements-changed'])
      expect(review).toContain(decision);
    expect(review).toContain('refreshInputTemplate');
    expect(review).toContain('retainedChecks');
    expect(await read('comet-native/reference/edit-review.md')).toBe(review);
  });
  it('routes actual edits through review before phase or revision commands', async () => {
    const classic = await read('comet-classic/SKILL.md');
    const native = await read('comet-native/SKILL.md');
    expect(classic).toContain('../comet/reference/edit-review.md');
    expect(native).toContain('reference/edit-review.md');
    for (const entry of [classic, native]) {
      expect(entry).toContain(root === 'skills-zh' ? '实际文件变化' : 'actual file changes');
      expect(entry).toContain(
        root === 'skills-zh'
          ? '修订命令不构成用户授权'
          : 'revision commands do not grant user authorization',
      );
    }
  });

  it('retains checks for every formal edit and supplements only the original Agent judgment', async () => {
    const review = await read('comet/reference/edit-review.md');
    const boundaries =
      root === 'skills-zh'
        ? ['每份正式材料', '全部实际差异', '同一提案', '原 Agent', '追加保留检查', '未选检查']
        : [
            'each formal material',
            'all actual changes',
            'same proposal',
            'original Agent',
            'add retained checks',
            'unselected check',
          ];
    for (const boundary of boundaries) expect(review).toContain(boundary);
    expect(await read('comet-native/reference/edit-review.md')).toBe(review);
  });

  it('keeps an unapproved requirement revision from changing the original phase or results', async () => {
    const review = await read('comet/reference/edit-review.md');
    const boundaries =
      root === 'skills-zh'
        ? ['不构成用户授权', '保留原阶段、已接受结果和待办', '未覆盖的目标']
        : [
            'does not grant user authorization',
            'preserve the original phase, accepted results, and pending work',
            'targets not yet covered',
          ];
    for (const boundary of boundaries) expect(review).toContain(boundary);
    expect(review).toContain('prepare-applied');
    expect(review).toContain('--file');
    expect(review).toContain('requirements-changed');
    expect(await read('comet-native/reference/edit-review.md')).toBe(review);
  });
});
