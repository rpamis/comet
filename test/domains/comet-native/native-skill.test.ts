import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { parseNativeChildrenContract } from '../../../domains/comet-native/native-children.js';

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
  'reference/workspace.md',
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
        'reference/workspace.md',
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
      ).toBeLessThanOrEqual(425); // Includes the copyable Supervisor child-plan example.
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
          'active change 已存在时',
          '`workspace.projectRoot`',
          '`preparation.projectRoot`',
          '工作区选择参考',
          '用户明确补充当前范围时，按同一规则处理',
          '`--revise-implementation`',
          '`commandArgs`',
          '`commandAlternatives`',
          '`inputOptions`',
          '`--expected-state-version`',
          '`--expected-action`',
          '`nextPageArgs`',
          '`workspaceFinishResult`',
          '`recoveryArgs`',
          '`children.yaml`',
          '`childSummary`',
          '`readyChildren`',
          '`review.status=passed`',
          '`scopeIds`',
          '最终全量验证',
          '原先通过 `finish=merge` 完成的合入步骤现由 Runtime 负责',
          'Supervisor 统筹动作',
          '`repair-child`',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'comet native <command> --help',
          'When an active change already exists',
          '`workspace.projectRoot`',
          '`preparation.projectRoot`',
          'workspace selection reference',
          'Apply the same rule when the user explicitly adds to the current scope',
          '`--revise-implementation`',
          '`commandArgs`',
          '`commandAlternatives`',
          '`inputOptions`',
          '`--expected-state-version`',
          '`--expected-action`',
          '`nextPageArgs`',
          '`workspaceFinishResult`',
          '`recoveryArgs`',
          '`children.yaml`',
          '`childSummary`',
          '`readyChildren`',
          '`review.status=passed`',
          '`scopeIds`',
          'final full verification',
          'Runtime now owns the integration step formerly performed through `finish=merge`',
          'Supervisor coordination actions',
          '`repair-child`',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await read(variant.language, 'SKILL.md');
      for (const term of variant.required) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
      const statusMarker =
        variant.language === 'zh'
          ? '状态包含 `childSummary`'
          : 'When status contains `childSummary`';
      expect(skill.match(new RegExp(statusMarker, 'gu')) ?? []).toHaveLength(1);
      expect(skill).not.toContain(
        variant.language === 'zh'
          ? 'Archive 必须逐个使用 `finish=merge` 合入 Supervisor Change 分支'
          : 'Archive them one at a time with `finish=merge` into the Supervisor Change branch',
      );
      expect(skill).not.toContain('git worktree list --porcelain');
      expect(skill).not.toContain('comet doctor --repair --scope project');
      expect(skill).not.toContain('scripts/comet-native-runtime.mjs');
      expect(skill).not.toContain('comet-native-<cmd>.mjs');
    }
  });

  it('keeps clarification coverage aligned with repository and Agent sources', async () => {
    const variants = [
      { language: 'zh' as const, required: '项目文档、现有 Agent 指令' },
      { language: 'en' as const, required: 'project documentation, existing Agent instructions' },
    ];
    for (const variant of variants) {
      const clarification = await read(variant.language, 'reference/clarification.md');
      expect(clarification).toContain(variant.required);
    }
  });

  it('offers explicit cleanup for clean archived change worktrees', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          '普通 change 归档后，如有已经归档且没有未提交修改的 change worktree，向用户提供清理选项',
          '只有用户确认后才执行 `git worktree remove`',
          '存在未提交修改或仍在使用的 worktree 必须保留',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'offer cleanup for an archived worktree with no uncommitted changes',
          'Run `git worktree remove` only after user confirmation',
          'keep any worktree with uncommitted changes or active use',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await read(variant.language, 'SKILL.md');
      for (const term of variant.required) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });

  it('uses Skill language only to initialize config, then project config owns artifacts', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: ['`comet init`', '产物跟随项目配置', '用户明确要求覆盖时才传入 `--language`'],
      },
      {
        language: 'en' as const,
        required: [
          '`comet init`',
          'artifacts follow the project setting',
          '`--language` is only for an explicit user override',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await read(variant.language, 'SKILL.md');
      for (const term of variant.required) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });

  it('keeps the completion loop bounded and preserves v4-only semantics', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          'Build ↔ Verify Loop',
          'Builder 提交候选',
          '新的只读 Verifier',
          '`iteration` 表示实现候选的轮次',
          '`attempt` 表示同一候选启动 Verifier 的次数',
          '所有计数都由 Runtime 更新',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'Build ↔ Verify Loop',
          'the Builder submits a candidate',
          'a fresh read-only Verifier',
          '`iteration` is the implementation-candidate round',
          '`attempt` is the number of times a Verifier has been started',
          'The Runtime updates all counters',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await read(variant.language, 'SKILL.md');
      for (const term of variant.required) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });

  it('lets the Native Skill assess and coordinate large changes without a new mode', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          '拆分检测',
          '可独立实现和验证',
          '最终 Shape 确认',
          '确认前不得创建子 change',
          '多会话协作（推荐）',
          '单会话推进',
          '自动改用 subagent',
          '不再询问推进方式',
          '不得自动改为单会话推进',
          'supervisor-cancel',
          '需求文字长、任务条目多本身不能触发拆分',
          '继续使用单个 Native Change',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'decomposition preflight',
          'implemented and verified independently',
          'final Shape confirmation',
          'Before confirmation, do not create child changes',
          'Multi-session coordination (recommended)',
          'Single-session progression',
          'automatically switch to a subagent',
          'do not ask for the coordination mode again',
          'must not automatically switch to single-session progression',
          'supervisor-cancel',
          'text length and task count alone must not trigger decomposition',
          'continue with one Native Change',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await read(variant.language, 'SKILL.md');
      for (const term of variant.required) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
      expect(skill).not.toMatch(/\b(?:hotfix|tweak)\b/iu);
      expect(skill).toContain(variant.language === 'zh' ? '恢复' : 'resume');
      expect(skill).toContain(variant.language === 'zh' ? '不重复' : 'not duplicate');
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
          '优先使用结构化提问',
          'Sequential 模式一次提交一个单选或多选问题',
          'Batch 模式在一次请求中提交本轮完整的问题集合',
          '- [blocking] CONFIRM: <确认内容>',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'Investigable fact',
          'User decision',
          'Implementation choice',
          'create and continuously maintain a decision tree',
          'independent fact-finding can be delegated to subagents',
          'prefer a structured question',
          'Sequential mode submits one single-choice or multiple-choice question',
          'Batch mode submits the complete current question set',
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

  it('keeps Agent-authored formal artifacts separate from Runtime state and reports', async () => {
    for (const language of ['en', 'zh'] as const) {
      const artifacts = await read(language, 'reference/artifacts.md');
      for (const required of [
        '<artifact-root>/comet/changes/<change-name>/',
        'brief.md',
        'children.yaml',
        'comet.native.children.v1',
        'comet.native.children.v2',
        'acceptance_index',
        'specs/<capability>/spec.md',
        'verification.md',
        '# Acceptance examples',
        '# Verification expectations',
        'comet-state.yaml',
        'verification.md',
        'Runtime',
      ]) {
        expect(artifacts, `${language}: ${required}`).toContain(required);
      }
      expect(artifacts).toContain(
        language === 'zh' ? '完整目标规格' : 'complete target specification',
      );
      expect(artifacts).toContain(language === 'zh' ? '验收循环' : 'acceptance Loop');
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
        'childSummary',
        'readyChildren',
        'workspaceFinishResult',
      ]) {
        expect(commands).toContain(field);
      }
      expect(commands).toContain('builder-handoff');
      expect(commands).toContain('dispatch-verifier');
      expect(commands).toContain('verifier-response');
      expect(commands).toContain('verifier-execution-error');
      expect(commands).toContain('verifier-unavailable');
      expect(commands).toContain('retry-verifier');
      expect(commands).toContain('confirm-verifier-unavailable');
      expect(commands).toContain('skill-coordinated');
      expect(commands).toContain(
        language === 'zh'
          ? '不存在需要另行启动或配置的 Verifier 服务、进程、地址或回调'
          : 'There is no separate Verifier service, process, endpoint, or callback',
      );
      expect(commands).toContain(
        language === 'zh'
          ? '本次任务未启动、执行失败、超时或结束后没有返回'
          : 'this task does not start, fails, times out, or ends without returning a result',
      );
      expect(commands.match(/comet native/gu)?.length ?? 0).toBeLessThanOrEqual(4);
      expect(commands).not.toContain('```json');
      expect(commands).not.toContain('| Exit code |');
      expect(commands).not.toContain('--expect-preflight <sha256> [--confirmed]');
      expect(commands).not.toContain('comet native receipt automated <change-name>');
      expect(commands).not.toContain('comet native checkpoint <change-name>');
    }
  });

  it.each(['en', 'zh'] as const)(
    'provides an executable indexed Supervisor example and workspace guidance in %s',
    async (language) => {
      const artifacts = await read(language, 'reference/artifacts.md');
      const example = /```yaml\n([\s\S]*?)\n```/u.exec(artifacts)?.[1];
      expect(example).toBeTruthy();
      const contract = parseNativeChildrenContract(example!, ['A1', 'A2']);
      expect(contract.acceptance_index).toEqual({
        A1: { source: 'brief.md', text: expect.any(String) },
        A2: { source: 'brief.md', text: expect.any(String) },
      });
      expect(contract.children.map(({ name, covers }) => ({ name, covers }))).toEqual([
        { name: 'alpha', covers: ['A1'] },
        { name: 'beta', covers: ['A2'] },
      ]);
      const commands = await read(language, 'reference/commands.md');
      for (const field of [
        'projectRoot',
        'verificationRoot',
        'changeDir',
        'supervisorStateRef',
        '--project-root',
      ]) {
        expect(commands).toContain(`\`${field}\``);
      }
      expect(commands).toContain(
        language === 'zh' ? '至少一项集成检查' : 'at least one integration check',
      );
    },
  );

  it('keeps recovery focused on exceptional safety decisions and exact Runtime actions', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          '`workspace.projectRoot`',
          '`comet-state.yaml`',
          '`state.json`',
          'Verify（`verify-ready`）',
          '`migration-required`',
          '`workspaceFinishResult.status`',
          '`recoveryArgs`',
          '`repair-child`',
        ],
      },
      {
        language: 'en' as const,
        required: [
          '`workspace.projectRoot`',
          '`comet-state.yaml`',
          '`state.json`',
          'Verify (`verify-ready`)',
          '`migration-required`',
          '`workspaceFinishResult.status`',
          '`recoveryArgs`',
          '`repair-child`',
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

  it('asks about workspace isolation only when it changes the user workflow', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          '当前目录有未提交工作',
          '已有其他 active Native change',
          'Runtime 默认的 `current`',
          '结构化单选工具',
          '| A | 当前目录（`current`）',
          '| B | 新分支（`branch`）',
          '| C | 新 worktree（`worktree`）',
          '`readyChildren`',
          '`workspace.changeBranch`',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'current directory has uncommitted work',
          'Another active Native change already exists',
          'Runtime default, `current`',
          'structured single-choice tool',
          '| A | Current directory (`current`)',
          '| B | New branch (`branch`)',
          '| C | New worktree (`worktree`)',
          '`readyChildren`',
          '`workspace.changeBranch`',
        ],
      },
    ];
    for (const variant of variants) {
      const workspace = await read(variant.language, 'reference/workspace.md');
      for (const term of variant.required) {
        expect(workspace, `${variant.language}: ${term}`).toContain(term);
      }
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
