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
});
