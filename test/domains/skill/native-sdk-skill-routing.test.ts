import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const nativeSkill = path.resolve('assets/skills-zh/comet-native/SKILL.md');
const nativeCommands = path.resolve('assets/skills-zh/comet-native/reference/commands.md');
const nativeRecovery = path.resolve('assets/skills-zh/comet-native/reference/recovery.md');
const englishNativeSkill = path.resolve('assets/skills/comet-native/SKILL.md');
const englishNativeCommands = path.resolve('assets/skills/comet-native/reference/commands.md');
const englishNativeRecovery = path.resolve('assets/skills/comet-native/reference/recovery.md');

describe('Workflow Rule and Native task agreement', () => {
  it.each(['md', 'en.md'])(
    'aligns review, delivered context and optional learning in %s',
    async (suffix) => {
      const rule = await fs.readFile(
        path.resolve('assets/skills/comet/rules/comet-workflow-guard.' + suffix),
        'utf8',
      );
      expect(rule).toContain('requireIndependentReview');
      expect(rule).toContain('native.document_writes');
      expect(rule).toContain('contextDelivery');
      expect(rule).toContain('--session');
      expect(rule).not.toMatch(
        /新的 Verifier execution 独立验收|new Verifier execution independently|每次任务结束前必须记录学习检查|Record a learning check before every task completion/,
      );
      expect(rule).not.toMatch(
        /再重试 `comet native archive <change> --confirmed`|then retry `comet native archive <change> --confirmed`/,
      );
    },
  );
});

describe('Chinese Native SDK Skill route', () => {
  it.each(['skills', 'skills-zh'])(
    'prefers receipt result submission consistently through SDK verification in %s',
    async (root) => {
      const skill = (
        await fs.readFile(path.resolve('assets', root, 'comet-native/SKILL.md'), 'utf8')
      ).replaceAll('\r\n', '\n');
      const verify = skill.split('\n## Verify\n')[1].split('\n## Archive\n')[0];
      const commands = await fs.readFile(
        path.resolve('assets', root, 'comet-native/reference/commands.md'),
        'utf8',
      );
      expect(verify).toContain('resultRequest');
      expect(verify).toContain('outcomeRequest');
      expect(verify).not.toMatch(/current outcomeRequest|当前 outcomeRequest/);
      const preferred = commands
        .split(/\r?\n\r?\n/)
        .find((paragraph) => paragraph.includes('`resultRequest`'));
      expect(preferred).toContain('`receipt`');
      expect(preferred).toContain('`result.status`');
    },
  );

  it('preserves user-specified artifact locations through Shape, Build and independent Verify', async () => {
    const skill = (await fs.readFile(nativeSkill, 'utf8')).replaceAll('\r\n', '\n');
    const shape = skill.split('\n## Shape\n')[1].split('\n## Build ↔ Verify Loop\n')[0];
    const build = skill.split('\n## Build\n')[1].split('\n## Verify\n')[0];
    const verify = skill.split('\n## Verify\n')[1].split('\n## Archive\n')[0];
    expect(shape).toContain('用户明确指定的文件位置、必需章节和产物格式');
    expect(shape).toContain('写入 brief 的约束');
    expect(shape).toContain('不能因模板默认位置而改放其他文件');
    expect(build).toContain('按 brief 中登记的原位置');
    expect(build).toContain('补齐遗漏产物');
    expect(build).toContain('Agent 选择适用的自动检查');
    expect(build).toContain('用平台工具检查原文件的实际内容');
    expect(build).toContain('记录检查对象和结果');
    expect(verify).toContain('同时核对 brief 中登记的产物位置、必需章节和格式');
    expect(verify).toContain('不能用另一文件中的同类内容代替');
  });

  it('keeps confirmed artifact-location requirements in the English Native route', async () => {
    const skill = (await fs.readFile(englishNativeSkill, 'utf8')).replaceAll('\r\n', '\n');
    const shape = skill.split('\n## Shape\n')[1].split('\n## Build ↔ Verify Loop\n')[0];
    const build = skill.split('\n## Build\n')[1].split('\n## Verify\n')[0];
    const verify = skill.split('\n## Verify\n')[1].split('\n## Archive\n')[0];
    expect(shape).toContain(
      'explicitly requested file locations, required sections, and artifact formats',
    );
    expect(shape).toContain('brief constraints');
    expect(shape).toContain('default location in a template');
    expect(build).toContain('original locations recorded in the brief');
    expect(build).toContain('The Agent chooses applicable automated checks');
    expect(build).toContain('runs them with platform tools');
    expect(build).toContain('records the check targets and results');
    expect(build).not.toContain('Runtime check plan');
    expect(verify).toContain('another file');
    expect(verify).toContain('do not pass the current candidate');
  });

  it.each(['skills', 'skills-zh'])(
    'separates SDK claims, outcomes, and verification in %s',
    async (root) => {
      const skill = await fs.readFile(
        path.resolve('assets', root, 'comet-native/SKILL.md'),
        'utf8',
      );
      const commands = await fs.readFile(
        path.resolve('assets', root, 'comet-native/reference/commands.md'),
        'utf8',
      );
      expect(skill).toContain('../comet/reference/host-check.md');
      expect(skill).toContain('reference/commands.md#sdk-');
      expect(commands).toContain('claimRequest');
      expect(commands).toContain('outcomeRequest');
      expect(commands).toContain('data.runId');
      const sdk = commands.slice(
        0,
        commands.indexOf('## Memory integration') >= 0
          ? commands.indexOf('## Memory integration')
          : commands.indexOf('## 记忆接入'),
      );
      expect(sdk).not.toContain('matching Run state changes');
      expect(sdk).not.toContain('对应 Run 状态已变化才算提交成功');
    },
  );
  it('routes SDK-owned changes by the persisted Run projection and keeps legacy instructions separate', async () => {
    const skill = await fs.readFile(nativeSkill, 'utf8');
    expect(skill).toContain('comet.native.sdk-status.v1');
    expect(skill).toContain('reference/commands.md#sdk-run');
    expect(skill).not.toContain('--runtime sdk');
    expect(skill).toContain('当前 change 的 `comet-state.yaml`');
    expect(skill).toContain('reference/recovery.md#故障恢复');
    const recovery = await fs.readFile(nativeRecovery, 'utf8');
    expect(recovery).toContain('comet native doctor <change-name> --json');
    expect(recovery).toContain('只读检查，再按返回的明确恢复或导入动作继续');
    expect(recovery).toContain('已保存的阶段、Action、领取和有效批准');
    expect(recovery).toContain('`status` 不写入或恢复记录');
    expect(recovery).toContain('继续外部工作前，通过原平台核对尚未结束或结果未知的任务');
    expect(recovery).toContain('不能重放可能已发生的副作用');
    expect(skill).toContain('旧 Runtime');
  });

  it('uses the public SDK dispatch protocol for host work and binds user decisions', async () => {
    const commands = await fs.readFile(nativeCommands, 'utf8');
    expect(commands).toContain('## SDK Run');
    expect(commands).toContain('comet runtime dispatch --application native');
    expect(commands).toContain('claim');
    expect(commands).toContain('record-outcome');
    expect(commands).toContain('--proposal-hash');
    expect(commands).toContain('结果未知');
    expect(commands).toContain('supervisor.parent.deliver');
    expect(commands).toContain('不重新执行快进');
    expect(commands).toContain('pendingBuilderDecisions');
    expect(commands).toContain('--continue-builder');
  });

  it('keeps the English SDK path aligned with public Native commands', async () => {
    const skill = await fs.readFile(englishNativeSkill, 'utf8');
    const commands = await fs.readFile(englishNativeCommands, 'utf8');
    expect(skill).toContain('comet.native.sdk-status.v1');
    expect(skill).not.toContain('--runtime sdk');
    expect(skill).toContain('reference/recovery.md#fault-recovery');
    const recovery = await fs.readFile(englishNativeRecovery, 'utf8');
    expect(recovery).toContain('run_checkpoint');
    expect(recovery).toContain('saved phase');
    expect(recovery).toContain('comet native doctor <change-name> --json');
    expect(recovery).toContain('first inspect read-only');
    expect(recovery).toContain('then follow its explicit recovery or import action');
    expect(recovery).toContain('saved phases, Actions, claims, and valid approvals');
    expect(recovery).toContain('`status` does not write or restore records');
    expect(recovery).toContain(
      'reconcile unfinished or unknown tasks through their original platform without replaying possible side effects',
    );
    expect(commands).toContain('comet runtime dispatch --application native');
    expect(commands).toContain('native next <change> --revise-requirements');
    expect(commands).toContain('native archive <change> --dry-run --json');
    expect(commands).toContain('supervisor.cleanup');
    expect(commands).toContain('supervisor.parent.deliver');
    expect(commands).toContain('does not repeat the fast-forward');
    expect(commands).toContain('native archive <change> --recover --json');
    expect(commands).toContain('pendingBuilderDecisions');
    expect(commands).toContain('--continue-builder');
  });
});

it.each(['skills', 'skills-zh'])(
  'keeps optional review and learning out of ordinary Native completion in %s',
  async (root) => {
    const skill = await fs.readFile(path.resolve('assets', root, 'comet-native/SKILL.md'), 'utf8');
    const commands = await fs.readFile(
      path.resolve('assets', root, 'comet-native/reference/commands.md'),
      'utf8',
    );
    expect(skill).toContain('sessionRequirements.independent');
    expect(commands).toContain('sessionRequirements.independent');
    expect(skill).toContain(root === 'skills' ? 'only when the user requests' : '仅在用户要求');
    expect(commands).toContain(root === 'skills' ? 'asynchronous maintenance' : '异步维护');
    expect(commands).not.toContain(
      root === 'skills'
        ? 'Before every task ends, complete one learning check'
        : '每次任务结束前必须完成一次学习检查',
    );
    expect(commands).toContain('not-run');
  },
);
