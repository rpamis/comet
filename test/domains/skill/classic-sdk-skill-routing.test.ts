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
  it('loads Open and Design Skills and enforces the confirmed reply rule at the Chinese entry', async () => {
    const skill = await chineseSkill('comet-classic');
    expect(skill).toContain('**立即执行：** 使用 Skill 工具加载 comet-open 技能。禁止跳过此步骤。');
    expect(skill).toContain(
      '**立即执行：** 使用 Skill 工具加载 comet-design 技能。禁止跳过此步骤。',
    );
    expect(skill).toContain('不能代替生成后产物的批准');
    expect(skill).toContain('实际回复');
    expect(skill).toContain('结束当前回复');
    expect(skill).toContain('同一未变');
  });
  it('loads Open and Design Skills and enforces the confirmed reply rule at the English entry', async () => {
    const skill = await englishSkill('comet-classic');
    expect(skill).toContain(
      '**Immediately execute:** Use the Skill tool to load the comet-open skill. Skipping this step is prohibited.',
    );
    expect(skill).toContain(
      '**Immediately execute:** Use the Skill tool to load the comet-design skill. Skipping this step is prohibited.',
    );
    expect(skill).toContain('does not approve');
    expect(skill).toContain('actual reply');
    expect(skill).toContain('end the current response');
    expect(skill).toContain('same unchanged');
  });
  it.each([
    ['skills-zh', '结束当前回复', '实际回复', '编写并确认'],
    ['skills', 'end the current response', 'actual reply', 'author and confirm'],
  ])(
    'keeps text-only approval pauses explicit in the shared decision protocol in %s',
    async (root, stop, reply, request) => {
      const reference = await readFile(
        path.resolve('assets', root, 'comet-classic/reference/decision-point.md'),
        'utf8',
      );
      expect(reference).toContain(stop);
      expect(reference).toContain(reply);
      expect(reference).toContain(request);
    },
  );
  it.each(['comet-open', 'comet-design'])(
    'requires the actual reply to the presented content before approving %s',
    async (name) => {
      const skill = await chineseSkill(name);
      expect(skill).toContain('不能代替');
      expect(skill).toContain('实际回复');
      expect(skill).toContain('结束当前回复');
      expect(skill).toContain('同一未变');
    },
  );
  it.each(['comet-open', 'comet-design'])(
    'requires the actual reply to the presented English content before approving %s',
    async (name) => {
      const skill = await englishSkill(name);
      expect(skill).toContain('does not approve');
      expect(skill).toContain('actual reply');
      expect(skill).toContain('end the current response');
      expect(skill).toContain('same unchanged');
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
