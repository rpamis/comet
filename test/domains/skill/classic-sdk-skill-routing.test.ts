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
    expect(entry).toContain('新旧 change 均保留 `.comet.yaml`');
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
    expect(open).toContain('change 目录仍保留 `.comet.yaml`');
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
    expect(design).toContain('原 `.comet.yaml` 由 Runtime 同步');
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
