import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';

const roots = {
  en: path.resolve('assets', 'skills', 'comet-native'),
  zh: path.resolve('assets', 'skills-zh', 'comet-native'),
};

const markdownFiles = [
  'SKILL.md',
  'reference/artifacts.md',
  'reference/clarification.md',
  'reference/commands.md',
  'reference/recovery.md',
] as const;

async function read(language: keyof typeof roots, relative: string): Promise<string> {
  return fs.readFile(path.join(roots[language], relative), 'utf8');
}

function headings(source: string): string[] {
  return source
    .split(/\r?\n/u)
    .filter((line) => /^##? /u.test(line))
    .map((line) => line.replace(/^#+\s+/u, ''));
}

describe('Comet Native Skills', () => {
  it('keeps valid bilingual entry Skills with progressive references', async () => {
    for (const language of ['en', 'zh'] as const) {
      const source = await read(language, 'SKILL.md');
      const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(source)?.[1];
      expect(frontmatter).toBeTruthy();
      const metadata = parseDocument(frontmatter!).toJS() as {
        name?: string;
        description?: string;
      };
      expect(metadata.name).toBe('comet-native');
      expect(metadata.description).toContain('Native');

      const links = [...source.matchAll(/\]\(([^)]+)\)/gu)].map((match) => match[1]).sort();
      expect(links).toEqual([
        'reference/artifacts.md',
        'reference/clarification.md',
        'reference/commands.md',
        'reference/recovery.md',
      ]);
      await Promise.all(links.map((link) => fs.access(path.join(roots[language], link))));
    }
  });

  it('bounds permanent Native context and keeps bilingual file structure aligned', async () => {
    for (const language of ['en', 'zh'] as const) {
      const contents = await Promise.all(markdownFiles.map((file) => read(language, file)));
      expect(contents[0].split(/\r?\n/u).length).toBeLessThanOrEqual(130);
      expect(
        contents.reduce((total, source) => total + source.split(/\r?\n/u).length, 0),
      ).toBeLessThanOrEqual(400);
      expect(headings(contents[0])).toHaveLength(10);
    }

    for (const file of markdownFiles) {
      const en = await read('en', file);
      const zh = await read('zh', file);
      expect(headings(en).length, file).toBe(headings(zh).length);
      expect(en.split(/\r?\n/u).length, file).toBe(zh.split(/\r?\n/u).length);
    }
  });

  it('keeps the main Skill on decisions while delegating mechanics to public CLI output', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          'comet native <command> --help',
          'CLI 会发现已登记 Git worktree',
          '`workspace.projectRoot`',
          '`preparation.projectRoot`',
          'CLI 负责创建或复用合法绑定的 branch/worktree',
          '用户明确要求当前 change 增加文件或行为时，不得仅因旧计划未列出就拒绝',
          '`--return-to-build`',
          '`commandArgs`',
          '`inputOptions`',
          '`nextPageArgs`',
          '`workspaceFinishResult`',
          '`recoveryArgs`',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'comet native <command> --help',
          'The CLI discovers registered Git worktrees',
          '`workspace.projectRoot`',
          '`preparation.projectRoot`',
          'The CLI creates or reuses a legally bound branch/worktree',
          'do not reject it merely because an earlier plan omitted it',
          '`--return-to-build`',
          '`commandArgs`',
          '`inputOptions`',
          '`nextPageArgs`',
          '`workspaceFinishResult`',
          '`recoveryArgs`',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await read(variant.language, 'SKILL.md');
      for (const term of variant.required) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
      expect(skill).not.toContain('git worktree list --porcelain');
      expect(skill).not.toContain('comet doctor --repair --scope project');
      expect(skill).not.toContain('scripts/comet-native-runtime.mjs');
      expect(skill).not.toContain('comet-native-<cmd>.mjs');
    }
  });

  it('uses one shared clarification decision tree with mode-specific scheduling', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          '可调查事实',
          '用户决定',
          '实现选择',
          '建立并持续维护一棵决策树',
          '可以将彼此独立的事实调查委派给 subagent',
          '一次只提出一个当前可提问节点',
          '本轮全部当前可提问节点',
          '- [blocking] CONFIRM: <确认内容>',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'Investigable fact',
          'User decision',
          'Implementation choice',
          'build and continuously maintain a decision tree',
          'delegate independent fact investigations to subagents',
          'Ask exactly one currently askable node',
          'every currently askable node in this round',
          '- [blocking] CONFIRM: <confirmation>',
        ],
      },
    ];

    for (const variant of variants) {
      const reference = await read(variant.language, 'reference/clarification.md');
      for (const term of variant.required) {
        expect(reference, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });

  it('keeps only Agent-authored artifact formats in the artifact reference', async () => {
    for (const language of ['en', 'zh'] as const) {
      const artifacts = await read(language, 'reference/artifacts.md');
      for (const required of [
        '<artifact-root>/comet/changes/<change-name>/',
        'brief.md',
        'specs/<capability>/spec.md',
        'verification.md',
        '# Acceptance examples',
        '# Verification expectations',
        '# Acceptance evidence',
        'evidence format',
        '"status": "passed"',
        '"status": "failed"',
      ]) {
        expect(artifacts, `${language}: ${required}`).toContain(required);
      }
      for (const RuntimeDetail of [
        'comet.native.workspace.v3',
        'baselineProjectionRef',
        'native-controller-trust.json',
        'events.jsonl',
        'transition.json',
        '512 KiB',
      ]) {
        expect(artifacts, `${language}: ${RuntimeDetail}`).not.toContain(RuntimeDetail);
      }
    }
  });

  it('uses the command reference for semantic exceptions instead of duplicating CLI syntax', async () => {
    for (const language of ['en', 'zh'] as const) {
      const commands = await read(language, 'reference/commands.md');
      expect(commands).toContain('comet native <command> --help');
      expect(commands).toContain('comet native <group> <command> --help');
      for (const field of [
        'commandArgs',
        'inputOptions',
        'workspace',
        'preparation',
        'nextPageArgs',
        'workspaceFinishResult',
      ]) {
        expect(commands).toContain(field);
      }
      expect(commands).toContain('--return-to-build');
      expect(commands).toContain('--confirmed');
      expect(commands).toContain('Partial scope');
      expect(commands).toContain('Receipt refresh');
      expect(commands.match(/comet native/gu)?.length ?? 0).toBeLessThanOrEqual(4);
      expect(commands).not.toContain('--expect-preflight <sha256> [--confirmed]');
      expect(commands).not.toContain('comet native receipt automated <change-name>');
      expect(commands).not.toContain('comet native checkpoint <change-name>');
    }
  });

  it('keeps recovery focused on exceptional safety decisions and exact Runtime actions', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          '`workspace.projectRoot`',
          '不能从当前文件猜测 baseline',
          'automated receipt 重跑',
          '`repair-stagnation-stop` 不是用户决定',
          '`repair-continuation-decision`',
          '`workspaceFinishResult.status` 为 `blocked`',
          '`recoveryArgs`',
        ],
      },
      {
        language: 'en' as const,
        required: [
          '`workspace.projectRoot`',
          'Never infer a baseline from current files',
          'rerun automated receipts',
          '`repair-stagnation-stop` is not a user decision',
          '`repair-continuation-decision`',
          '`workspaceFinishResult.status` is `blocked`',
          '`recoveryArgs`',
        ],
      },
    ];
    for (const variant of variants) {
      const recovery = await read(variant.language, 'reference/recovery.md');
      for (const term of variant.required) {
        expect(recovery, `${variant.language}: ${term}`).toContain(term);
      }
      expect(recovery).not.toContain('git worktree list --porcelain');
      expect(recovery).not.toContain('comet native spec rebase <change-name>');
      expect(recovery).not.toContain('--strategy continue');
      expect(recovery).not.toContain('--strategy rollback');
    }
  });

  it('contains no forbidden wording or external prescriptive workflow dependency', async () => {
    for (const language of ['en', 'zh'] as const) {
      const content = (await Promise.all(markdownFiles.map((file) => read(language, file)))).join(
        '\n',
      );
      expect(content).not.toMatch(
        /openspec|superpowers|grill-me|grilling|brainstorming|requiredSkillCalls|test-driven-development|code-review/iu,
      );
      expect(content).not.toMatch(/comet\s+(state|guard|handoff)\b/iu);
      expect(content).not.toMatch(/waiver|independent.review|attestation|external.role/iu);
      expect(content).not.toContain('host supports delegation');
      expect(content).not.toContain('Subagent unavailability');
    }

    const zh = (await Promise.all(markdownFiles.map((file) => read('zh', file)))).join('\n');
    expect(zh).not.toMatch(/预演|新鲜验证|宿主/u);
  });
});
