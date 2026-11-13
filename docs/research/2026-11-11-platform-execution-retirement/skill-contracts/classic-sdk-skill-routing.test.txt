import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

async function chineseSkill(name: string): Promise<string> {
  return readFile(path.resolve('assets', 'skills-zh', name, 'SKILL.md'), 'utf8');
}

async function englishSkill(name: string): Promise<string> {
  return readFile(path.resolve('assets', 'skills', name, 'SKILL.md'), 'utf8');
}

describe('Classic Chinese Skill SDK routing', () => {
  // 旧案例名称保留；确认只约束需要新决定的分支，已有授权可以直接沿用。
  it.each(['comet-classic', 'comet-open', 'comet-design'])(
    'ends the response before newly presented %s content can be approved in Chinese',
    async (name) => {
      const skill = await chineseSkill(name);
      const protocol = await readFile(
        path.resolve('assets/skills-zh/comet-classic/reference/decision-point.md'),
        'utf8',
      );
      expect(skill).toContain('decision-point.md');
      expect(protocol).toContain('需要用户作出新决定时');
      expect(protocol).toContain('结束当前回复');
      expect(protocol).toContain('授权可以来自当前请求或已有记录');
      expect(protocol).toContain('不要求发生在产物生成之后');
      expect(protocol).toContain('不把 Agent 自行选择写成');
    },
  );
  it.each(['comet-classic', 'comet-open', 'comet-design'])(
    'ends the response before newly presented %s content can be approved in English',
    async (name) => {
      const skill = await englishSkill(name);
      const protocol = await readFile(
        path.resolve('assets/skills/comet-classic/reference/decision-point.md'),
        'utf8',
      );
      expect(skill).toContain('decision-point.md');
      expect(protocol).toContain('When a new user decision is needed');
      expect(protocol).toContain('end the current response');
      expect(protocol).toContain('current request or an existing record');
      expect(protocol).toContain('it need not follow artifact creation');
      expect(protocol).toContain("do not describe an Agent's own choice as user confirmation");
    },
  );
  it('loads Open and Design Skills and enforces the confirmed reply rule at the Chinese entry', async () => {
    const skill = await chineseSkill('comet-classic');
    expect(skill).toContain('**立即执行：** 使用 Skill 工具加载 comet-open 技能。禁止跳过此步骤。');
    expect(skill).toContain(
      '**立即执行：** 使用 Skill 工具加载 comet-design 技能。禁止跳过此步骤。',
    );
    expect(skill).toContain('编写产物、调用 OpenSpec 或推进前先加载它');
    expect(skill).toContain('/comet-open');
    expect(skill).toContain('/comet-design');
    expect(skill).toContain('SDK 的 `action` 才能加载返回的 Skill');
    expect(skill).toContain('只加载它指定的下一 Skill');
    expect(skill).toContain('先核对已有批准、委托授权');
    expect(skill).toContain('需要新决定时');
  });
  it('loads Open and Design Skills and enforces the confirmed reply rule at the English entry', async () => {
    const skill = await englishSkill('comet-classic');
    expect(skill).toContain(
      '**Immediately execute:** Use the Skill tool to load the comet-open skill. Skipping this step is prohibited.',
    );
    expect(skill).toContain(
      '**Immediately execute:** Use the Skill tool to load the comet-design skill. Skipping this step is prohibited.',
    );
    expect(skill).toContain('load it before authoring artifacts, calling OpenSpec, or advancing');
    expect(skill).toContain('/comet-open');
    expect(skill).toContain('/comet-design');
    expect(skill).toContain('Only an SDK `action` loads');
    expect(skill).toContain('load only its next Skill');
    expect(skill).toContain('First check existing approval, delegated authority');
    expect(skill).toContain('when a new decision is needed');
  });
  it.each([
    ['skills-zh', '结束当前回复', '实际答复', '委托授权'],
    ['skills', 'end the current response', 'actual answer', 'delegated authority'],
  ])(
    'keeps text-only approval pauses explicit in the shared decision protocol in %s',
    async (root, stop, reply, authority) => {
      const reference = await readFile(
        path.resolve('assets', root, 'comet-classic/reference/decision-point.md'),
        'utf8',
      );
      expect(reference).toContain(stop);
      expect(reference).toContain(reply);
      expect(reference).toContain(authority);
    },
  );
  it.each(['comet-open', 'comet-design'])(
    'requires the actual reply to the presented content before approving %s',
    async (name) => {
      const skill = await chineseSkill(name);
      expect(skill).toContain('decision-point.md');
      expect(skill).toContain('已有授权');
      expect(skill).toContain('需要新决定时');
      expect(skill).toContain('等待答复');
    },
  );
  it.each(['comet-open', 'comet-design'])(
    'requires the actual reply to the presented English content before approving %s',
    async (name) => {
      const skill = await englishSkill(name);
      expect(skill).toContain('decision-point.md');
      expect(skill).toContain('existing author');
      expect(skill).toContain('a new decision is needed');
      expect(skill).toContain('wait');
    },
  );
  it.each(['skills', 'skills-zh'])(
    'shares creation order and early host checks in %s',
    async (root) => {
      const reference = await readFile(
        path.resolve('assets', root, 'comet-classic/reference/sdk-methods.md'),
        'utf8',
      );
      const host = await readFile(
        path.resolve('assets', root, 'comet/reference/host-check.md'),
        'utf8',
      );
      expect(reference).toContain('../../comet/reference/host-check.md');
      expect(reference).toContain('OpenSpec `new change`');
      expect(reference).toContain('comet state init <name> <full|hotfix|tweak>');
      expect(host).toContain('Runtime');
      expect(host).toContain('Native');
      expect(host).toContain('Classic');
      for (const name of ['comet-open', 'comet-hotfix', 'comet-tweak']) {
        const source = await readFile(path.resolve('assets', root, name, 'SKILL.md'), 'utf8');
        expect(source, name).toContain('../comet-classic/reference/sdk-methods.md#');
      }
    },
  );
  it.each(['skills', 'skills-zh'])(
    'provides stage context at every Classic entry in %s',
    async (root) => {
      for (const name of [
        'comet-classic',
        'comet-open',
        'comet-design',
        'comet-build',
        'comet-verify',
        'comet-archive',
        'comet-hotfix',
        'comet-tweak',
      ]) {
        const skill = await readFile(path.resolve('assets', root, name, 'SKILL.md'), 'utf8');
        expect(skill, name).toContain('contextRequest');
        expect(skill, name).toContain('reference/scripts.md#');
      }
      const scripts = await readFile(
        path.resolve('assets', root, 'comet-classic/reference/scripts.md'),
        'utf8',
      );
      for (const marker of [
        '--context-mode snapshot',
        '--context-mode incremental',
        'context[].text',
        '--phase build --phase verify',
        'handoff_hash',
      ]) {
        expect(scripts).toContain(marker);
      }
      for (const name of ['comet-hotfix', 'comet-tweak']) {
        const compat = await readFile(
          path.resolve('assets', root, name, 'reference/compat.md'),
          'utf8',
        );
        expect(compat).toContain('--context-mode snapshot');
        expect(compat).toContain('--context-mode incremental');
      }
    },
  );

  it('describes checkpoint-backed recovery in both English Classic entries', async () => {
    const entry = await englishSkill('comet-classic');
    const open = await englishSkill('comet-open');
    expect(entry).toContain('run_checkpoint');
    expect(entry).toContain('saved phase');
    expect(entry).toContain('comet state restore <change-name> --confirmed');
    expect(open).toContain('run_checkpoint');
    expect(open).toContain('return to Open');
  });

  it.each([
    'comet-classic',
    'comet-open',
    'comet-design',
    'comet-build',
    'comet-verify',
    'comet-archive',
    'comet-hotfix',
    'comet-tweak',
  ])('keeps the English %s SDK path and compat boundary', async (name) => {
    const english = await englishSkill(name);
    expect(english).toContain('SDK Run');
    expect(english).toContain('runtimeFormat');
    if (name !== 'comet-classic' && name !== 'comet-open') {
      expect(english).toContain('runtimeFormat: compat');
    }
  });
  it('routes an initialized change by the authoritative runtime format', async () => {
    const entry = await chineseSkill('comet-classic');
    expect(entry).toContain('comet state next <change-name> --json');
    expect(entry).toContain('runtimeFormat');
    expect(entry).toContain('`sdk` 与 `compat`');
    expect(entry).toContain('SDK 新 change 使用 `comet-state.yaml`，历史 `.comet.yaml` 原地读写');
    expect(entry).not.toContain('`sdk` 与 `legacy`');
    expect(entry).toContain('nextAction.kind');
    expect(entry).toContain('comet state restore <change-name> --confirmed');
    expect(entry).not.toContain('已初始化（`.comet.yaml` 已存在）');
  });

  it('creates new full changes as SDK Runs and binds Open approval to its preview', async () => {
    const open = await chineseSkill('comet-open');
    expect(open).toContain('comet state init <name> full --isolation <selected-isolation>');
    expect(open).toContain('comet state next <name> --json');
    expect(open).toContain('comet guard <change-name> open --json');
    expect(open).toContain('comet guard <change-name> open --apply --approval-hash <approvalHash>');
    expect(open).toContain('runtimeFormat: compat');
    expect(open).toContain('新 change 保存 `comet-state.yaml`，历史 `.comet.yaml` 原地保留');
  });

  it('uses the Design proposal Wait for SDK approval and preserves the legacy recipe', async () => {
    const design = await chineseSkill('comet-design');
    expect(design).toContain('## SDK Run 路径');
    expect(design).toContain('comet state propose-design <change-name> --proposal');
    expect(design).toContain(
      'comet state decide-design <change-name> --proposal-hash <proposalHash> --choice <approved|rejected>',
    );
    expect(design).toContain(
      'comet state complete-design <change-name> --design-doc <design-doc-ref> --approval-hash <proposalHash>',
    );
    expect(design).toContain('以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`');
    expect(design).toContain('实际状态文件由 Runtime 同步');
  });

  it('routes SDK Build configuration, plan, execution, and check through one Run', async () => {
    const build = await chineseSkill('comet-build');
    expect(build).toContain('## SDK Run 路径');
    expect(build).toContain('comet state propose-build <change-name> --file <configuration-json>');
    expect(build).toContain(
      'comet state decide-build <change-name> --proposal-hash <proposalHash> --choice <approved|rejected>',
    );
    expect(build).toContain('comet state submit-plan <change-name> --plan <plan-ref>');
    expect(build).toContain(
      'comet state continue-plan <change-name> --proposal-hash <proposalHash>',
    );
    expect(build).toContain('comet state complete-build <change-name>');
    expect(build).toContain('comet guard <change-name> build --apply -- <program> [args...]');
    expect(build).toContain('以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`');
  });

  it('routes SDK Verify review failures and checked reports through one Run', async () => {
    const verify = await chineseSkill('comet-verify');
    expect(verify).toContain('## SDK Run 路径');
    expect(verify).toContain('comet state next <change-name> --json');
    expect(verify).toContain(
      'comet state transition <change-name> verify-fail --reason "<failure-reason>"',
    );
    expect(verify).toContain('comet guard <change-name> verify --report <report-ref>');
    expect(verify).toContain(
      'comet guard <change-name> verify --report <report-ref> --apply -- <program> [args...]',
    );
    expect(verify).toContain('以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`');
  });

  it('binds SDK Archive and delivery to one approved proposal', async () => {
    const archive = await chineseSkill('comet-archive');
    expect(archive).toContain('## SDK Run 路径');
    expect(archive).toContain('comet state propose-archive <change-name> --summary');
    expect(archive).toContain(
      'comet state decide-archive <change-name> --proposal-hash <proposalHash> --choice <local|push|pr|reverify|later>',
    );
    expect(archive).toContain('comet guard <change-name> archive --apply');
    expect(archive).toContain('comet state complete-delivery <change-name> --commit <sha>');
    expect(archive).toContain('以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`');
  });

  it.each(['hotfix', 'tweak'] as const)(
    'routes SDK %s through preset Open, checked Build, and confirmed escalation',
    async (profile) => {
      const skill = await chineseSkill(`comet-${profile}`);
      expect(skill).toContain('## SDK Run 路径');
      expect(skill).toContain(
        `comet state init <name> ${profile} --isolation <selected-isolation>`,
      );
      expect(skill).toContain('comet state next <change-name> --json');
      expect(skill).toContain('comet guard <change-name> open --apply');
      expect(skill).toContain('comet guard <change-name> build --apply -- <program> [args...]');
      expect(skill).toContain('comet state propose-escalation <change-name> --reason');
      expect(skill).toContain(
        'comet state decide-escalation <change-name> --proposal-hash <proposalHash> --choice <continue|upgrade>',
      );
      expect(skill).toContain('以下旧 Runtime 步骤仅用于 `runtimeFormat: compat`');
    },
  );
});

describe('Classic SDK continuation handoffs in both languages', () => {
  it.each([
    ['Chinese', chineseSkill],
    ['English', englishSkill],
  ] as const)(
    'keeps %s preset routing and the required approval boundary',
    async (_language, readSkill) => {
      const build = await readSkill('comet-build');
      const sdk = build.slice(
        build.indexOf('## SDK Run'),
        build.indexOf('`runtimeFormat: compat`'),
      );
      for (const profile of ['tweak', 'hotfix']) {
        expect(sdk).toContain(`\`${profile}.build.*\``);
        expect(sdk).toContain(`comet-${profile}`);
        const skill = await readSkill(`comet-${profile}`);
        const preset = skill.slice(
          skill.indexOf('## SDK Run'),
          skill.indexOf('`runtimeFormat: compat`'),
        );
        expect(preset).toContain('`data.approvalHash`');
        expect(preset).toContain('`comet guard <change-name> open --json`');
        expect(preset).toContain(
          '`comet guard <change-name> open --apply --approval-hash <approvalHash>`',
        );
        expect(preset).not.toContain('`comet guard <change-name> open --apply`');
        expect(preset).toContain('`agent.continuation` / `data.nextAction`');
        expect(preset).toContain('Run revision');
      }
      expect(sdk).toContain('Run revision');
      expect(sdk).toContain('`comet-build`');
      expect(sdk).toContain('`full.build.*`');
      expect(sdk).toContain('`agent.continuation` / `data.nextAction`');
      if (_language === 'Chinese') {
        expect(sdk).toContain('不要求 full Design Doc 或完整计划');
        expect(sdk).toContain('仅在需要诊断时运行');
        expect(sdk).not.toContain('每次推进后以 `comet state next');
      } else {
        expect(sdk).toContain('Do not require a full Design Doc or implementation plan');
        expect(sdk).toContain('preview only when diagnosis is needed');
        expect(sdk).not.toContain('After every advance, read');
      }
    },
  );
});
