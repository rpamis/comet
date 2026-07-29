import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const roots = {
  en: path.resolve('assets', 'skills', 'comet-native'),
  zh: path.resolve('assets', 'skills-zh', 'comet-native'),
};

async function read(language: keyof typeof roots, relative: string): Promise<string> {
  return fs.readFile(path.join(roots[language], relative), 'utf8');
}

describe('Comet Native Skills', () => {
  it('keeps the main Skill focused on phase behavior and continuation', async () => {
    const variants = [
      {
        language: 'zh' as const,
        headings: [
          '## 开始或恢复',
          '## Shape',
          '## Build',
          '## Completion Loop',
          '## Verify',
          '## Archive',
          '## Continuation 与停止条件',
        ],
        terms: [
          'native.clarification_mode',
          'native.archive_confirmation',
          'native.max_verify_failures',
          'comet native select <change-name>',
          'comet native next <change-name>',
          'comet native archive <change-name> --dry-run',
          '持续执行 Build → Verify',
          '`await-user`',
          '`blocked`',
          '`done`',
        ],
      },
      {
        language: 'en' as const,
        headings: [
          '## Start or resume',
          '## Shape',
          '## Build',
          '## Completion Loop',
          '## Verify',
          '## Archive',
          '## Continuation and stop points',
        ],
        terms: [
          'native.clarification_mode',
          'native.archive_confirmation',
          'native.max_verify_failures',
          'comet native select <change-name>',
          'comet native next <change-name>',
          'comet native archive <change-name> --dry-run',
          'Continue Build → Verify',
          '`await-user`',
          '`blocked`',
          '`done`',
        ],
      },
    ];

    for (const variant of variants) {
      const source = await read(variant.language, 'SKILL.md');
      const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(source)?.[1];
      expect(frontmatter).toBeTruthy();
      const metadata = parseDocument(frontmatter!).toJS() as {
        name?: string;
        description?: string;
      };
      expect(metadata.name).toBe('comet-native');
      expect(metadata.description).toContain('Native');

      let previous = -1;
      for (const heading of variant.headings) {
        const offset = source.indexOf(heading);
        expect(offset, `${variant.language}: ${heading}`).toBeGreaterThan(previous);
        previous = offset;
      }
      for (const term of variant.terms) {
        expect(source, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });

  it('makes the acceptance-gap completion loop explicit', async () => {
    const variants = [
      {
        language: 'zh' as const,
        terms: [
          'status <change-name> --details',
          'failed/missing acceptance',
          'checkpoint 不是完成证据',
          '执行一次完整审查',
          '`fail` 回到 Build，从第 1 步继续',
          '`pass` 才进入 Archive',
          '一次 Agent turn、一次 checkpoint 或 Agent 自述“已完成”都不是终态',
          'Agent 负责发现并修复缺口，Runtime 负责判断是否完成',
        ],
      },
      {
        language: 'en' as const,
        terms: [
          'status <change-name> --details',
          'failed or missing acceptance items',
          'a checkpoint is not completion evidence',
          'perform one complete review',
          '`fail` returns to Build and repeats from step 1',
          'only `pass` enters Archive',
          'One Agent turn, one checkpoint, or the Agent saying “complete” is not a terminal state',
          'The Agent finds and repairs gaps; the Runtime decides whether completion has been proven',
        ],
      },
    ];

    for (const variant of variants) {
      const source = await read(variant.language, 'SKILL.md');
      const start = source.indexOf('## Completion Loop');
      const end = source.indexOf('## Verify', start);
      const loop = source.slice(start, end);
      expect(start, variant.language).toBeGreaterThan(0);
      expect(end, variant.language).toBeGreaterThan(start);
      for (const term of variant.terms) {
        expect(loop, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });

  it('loads task-specific references progressively', async () => {
    for (const language of ['en', 'zh'] as const) {
      const source = await read(language, 'SKILL.md');
      const links = [...source.matchAll(/\]\(([^)]+)\)/gu)].map((match) => match[1]).sort();

      expect(links).toEqual([
        'reference/artifacts.md',
        'reference/clarification.md',
        'reference/commands.md',
        'reference/recovery.md',
      ]);
      await Promise.all(links.map((link) => fs.access(path.join(roots[language], link))));
      expect(source).not.toContain('scripts/comet-native-runtime.mjs');
    }
  });

  it('separates facts, user decisions, and implementation choices', async () => {
    const variants = [
      {
        language: 'zh' as const,
        terms: [
          '可调查事实',
          '用户决定',
          '实现选择',
          '实质改变用户可见结果',
          '问题：',
          '推荐：',
          '影响：',
          '- [blocking] <问题>',
          '- [blocking] Q1: <问题>',
          '- [blocking] CONFIRM: <确认内容>',
          '不要把多个独立决定压缩成一道多选题',
          '立即写入现有 change',
        ],
      },
      {
        language: 'en' as const,
        terms: [
          'Investigable fact',
          'User decision',
          'Implementation choice',
          'materially change user-visible results',
          'Question:',
          'Recommendation:',
          'Impact:',
          '- [blocking] <question>',
          '- [blocking] Q1: <question>',
          '- [blocking] CONFIRM: <confirmation>',
          'Do not compress independent decisions into one multi-select question',
          'immediately into Decisions',
        ],
      },
    ];

    for (const variant of variants) {
      const source = await read(variant.language, 'reference/clarification.md');
      for (const term of variant.terms) {
        expect(source, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });

  it('documents only Agent-authored artifacts and their required formats', async () => {
    for (const language of ['en', 'zh'] as const) {
      const artifacts = await read(language, 'reference/artifacts.md');
      expect(artifacts).toContain('<artifact-root>/comet/changes/<change-name>/');
      expect(artifacts).toContain('brief.md');
      expect(artifacts).toContain('specs/<capability>/spec.md');
      expect(artifacts).toContain('verification.md');
      expect(artifacts).toContain('clarification_mode: sequential');
      expect(artifacts).toContain('archive_confirmation: automatic');
      expect(artifacts).toContain('max_verify_failures: 5');
      expect(artifacts).toContain('# Acceptance examples');
      expect(artifacts).toContain('# Verification expectations');
      expect(artifacts).toContain('# Acceptance evidence');
      expect(artifacts).toContain('comet native evidence format');
      expect(artifacts).toContain('"status": "passed"');
      expect(artifacts).toContain('"status": "failed"');
      expect(artifacts).toContain('"status": "waived"');

      for (const implementationDetail of [
        'native-controller-trust.json',
        'schema: comet.native.v3',
        'transition.json',
        'events.jsonl',
        'quarantine',
        '256 KiB',
      ]) {
        expect(artifacts, `${language}: ${implementationDetail}`).not.toContain(
          implementationDetail,
        );
      }
    }
  });

  it('keeps executable commands while excluding trust provisioning internals', async () => {
    for (const language of ['en', 'zh'] as const) {
      const commands = await read(language, 'reference/commands.md');
      for (const command of [
        'init',
        'root show',
        'root move',
        'new',
        'spec remove',
        'spec rebase',
        'list',
        'show',
        'status',
        'select',
        'checkpoint',
        'check',
        'evidence format',
        'receipt manual',
        'receipt automated',
        'receipt implement',
        'receipt review',
        'next',
        'archive',
        'doctor',
      ]) {
        expect(commands, `${language}: ${command}`).toContain(command);
      }
      expect(commands).not.toContain('--creation-authorization');
      expect(commands).toContain('--allow-partial-scope <sha256>');
      expect(commands).toContain('--independent-review-receipt <review-receipt-ref>');
      expect(commands).toContain('--expect-preflight <sha256> [--confirmed]');

      for (const provisioningDetail of [
        'trust keygen',
        'trust identity',
        'trust policy',
        'trust authorize',
        '--private-key-env',
        'Ed25519',
        'different UID',
        '不同 UID',
      ]) {
        expect(commands, `${language}: ${provisioningDetail}`).not.toContain(provisioningDetail);
      }
    }
  });

  it('keeps external approval fail-closed without teaching private-key handling', async () => {
    const zhSkill = await read('zh', 'SKILL.md');
    const enSkill = await read('en', 'SKILL.md');
    const zhCommands = await read('zh', 'reference/commands.md');
    const enCommands = await read('en', 'reference/commands.md');

    expect(zhSkill).toContain('不要接收签名私钥');
    expect(zhSkill).toContain('不要代替外部审批角色');
    expect(enSkill).toContain('Do not receive signing private keys');
    expect(enSkill).toContain('impersonate an external approval role');
    expect(zhCommands).toContain('不得执行外部角色的 approve/sign');
    expect(enCommands).toContain("must not perform an external role's approve or sign action");
  });

  it('uses recovery as an actionable runbook rather than a Runtime design document', async () => {
    for (const language of ['en', 'zh'] as const) {
      const recovery = await read(language, 'reference/recovery.md');
      expect(recovery).toContain('comet native doctor [<change-name>]');
      expect(recovery).toContain('baseline-snapshot-missing');
      expect(recovery).toContain('comet native spec rebase <change-name>');
      expect(recovery).toContain('--strategy continue');
      expect(recovery).toContain('--strategy rollback');
      expect(recovery).toContain('pending_root_move');

      for (const implementationDetail of [
        'CAS',
        'split-brain',
        'events.jsonl',
        'dependents-before-dependencies',
        '4096',
        '512 KiB',
      ]) {
        expect(recovery, `${language}: ${implementationDetail}`).not.toContain(
          implementationDetail,
        );
      }
    }
  });

  it('contains no external workflow or prescriptive-method dependency', async () => {
    for (const language of ['en', 'zh'] as const) {
      const files = await Promise.all(
        [
          'SKILL.md',
          'reference/artifacts.md',
          'reference/clarification.md',
          'reference/commands.md',
          'reference/recovery.md',
        ].map((file) => read(language, file)),
      );
      const content = files.join('\n');
      expect(content).not.toMatch(
        /openspec|superpowers|grill-me|grilling|brainstorming|requiredSkillCalls|subagent|test-driven-development|code-review/iu,
      );
      expect(content).not.toMatch(/comet\s+(state|guard|handoff)\b/iu);
    }
  });
});
