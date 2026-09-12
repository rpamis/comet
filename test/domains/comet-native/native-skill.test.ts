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

function markdownLinks(source: string): string[] {
  return [...source.matchAll(/\]\(([^)]+)\)/gu)].map((match) => match[1]);
}

function section(source: string, anchor: string): string {
  const lines = source.split(/\r?\n/u);
  let fenced = false;
  let start = -1;
  let level = 0;
  for (const [index, line] of lines.entries()) {
    if (/^\s*```/u.test(line)) fenced = !fenced;
    if (fenced) continue;
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (!heading) continue;
    if (start >= 0 && heading[1].length <= level) return lines.slice(start, index).join('\n');
    const slug = heading[2]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/gu, '-');
    if (slug === anchor) {
      start = index;
      level = heading[1].length;
    }
  }
  expect(start, `Missing Markdown anchor: ${anchor}`).toBeGreaterThanOrEqual(0);
  return lines.slice(start).join('\n');
}

async function reachableInstructions(language: keyof typeof roots): Promise<{
  content: string;
  files: string[];
}> {
  const queue = [{ file: 'SKILL.md', anchor: '' }];
  const visited = new Set<string>();
  const files = new Set<string>();
  const contents: string[] = [];
  while (queue.length > 0) {
    const { file, anchor } = queue.shift()!;
    const key = `${file}#${anchor}`;
    if (visited.has(key)) continue;
    visited.add(key);
    files.add(file);
    const source = await read(language, file);
    const content = anchor ? section(source, anchor) : source;
    contents.push(content);
    for (const target of markdownLinks(content)) {
      const [relative, nextAnchor = ''] = target.split('#');
      const nextFile = relative ? path.posix.join(path.posix.dirname(file), relative) : file;
      expect(markdownFiles, `${language}: ${target}`).toContain(nextFile);
      queue.push({ file: nextFile, anchor: nextAnchor });
    }
  }
  return { content: contents.join('\n'), files: [...files].sort() };
}

async function readReachable(language: keyof typeof roots): Promise<string> {
  return (await reachableInstructions(language)).content;
}

async function readAction(language: keyof typeof roots, chineseTarget: string): Promise<string> {
  const entry = await read(language, 'SKILL.md');
  const englishTargets: Record<string, string> = {
    'reference/workspace.md#archive-收尾': 'reference/workspace.md#archive-completion',
    'reference/workspace.md#创建-change': 'reference/workspace.md#create-a-change',
    'reference/commands.md#supervisor-协作': 'reference/commands.md#supervisor-coordination',
    'reference/clarification.md#澄清': 'reference/clarification.md#clarification',
  };
  const target = language === 'zh' ? chineseTarget : englishTargets[chineseTarget];
  expect(target).toBeTruthy();
  expect(markdownLinks(entry)).toContain(target);
  const [file, anchor] = target.split('#');
  const content = await read(language, file);
  return `${entry}\n${section(content, anchor)}`;
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

      const links = [...new Set(markdownLinks(source).map((link) => link.split('#')[0]))].sort();
      expect(links).toEqual([
        'reference/artifacts.md',
        'reference/clarification.md',
        'reference/commands.md',
        'reference/recovery.md',
        'reference/workspace.md',
      ]);
      expect((await reachableInstructions(language)).files).toEqual([...markdownFiles].sort());
    }
  });

  it.each(['en', 'zh'] as const)(
    'bounds the permanent %s entry by characters',
    async (language) => {
      // Character limits include whitespace so one long line cannot bypass the context budget.
      // Language-specific sizes are not token counts; both entrypoints retain the same contracts.
      const budget = language === 'zh' ? 6_000 : 12_000;
      expect((await read(language, 'SKILL.md')).length).toBeLessThanOrEqual(budget);
    },
  );

  it('routes ordinary Chinese Verify to its protocol without unrelated execution branches', async () => {
    const skill = await read('zh', 'SKILL.md');
    const verifyTarget = 'reference/commands.md#verify-协议';
    expect(markdownLinks(skill)).toContain(verifyTarget);
    const verify = section(await read('zh', 'reference/commands.md'), 'verify-协议');
    for (const term of [
      '新的只读 Verifier',
      '全部验收项',
      '--accept-result',
      '等待同一个 Verifier',
    ]) {
      expect(`${skill}\n${verify}`, term).toContain(term);
    }
    expect(`${skill}\n${verify}`).not.toContain('supervisor-cancel');
    expect(verify).not.toContain('comet memory observe');
    expect(verify).not.toContain('Codex 独立会话');
    expect(`${skill}\n${verify}`.length).toBeLessThanOrEqual(8_500);
    expect(skill).toContain('不一次加载整份命令参考或所有参考');
    const enEntry = await read('en', 'SKILL.md');
    expect(markdownLinks(enEntry)).toContain('reference/commands.md#verify-protocol');
    const enVerify = section(await read('en', 'reference/commands.md'), 'verify-protocol');
    for (const term of [
      'new read-only Verifier',
      'every acceptance item',
      '--accept-result',
      'waiting for the same Verifier',
    ])
      expect(enEntry + enVerify, term).toContain(term);
    expect(enEntry + enVerify).not.toContain('supervisor-cancel');
    expect(enVerify).not.toContain('comet memory observe');
    expect(enVerify).not.toContain('Codex independent sessions');
  });

  it('makes normal Runtime input rules available before template submission or returnAction', async () => {
    const entry = await read('zh', 'SKILL.md');
    const target = 'reference/commands.md#填写命令输入';
    const trigger = entry.split('\n').find((line) => line.includes(`(${target})`));
    expect(trigger).toContain('首次填写 Runtime 模板或通过 `returnAction` 回传结果前');
    expect(trigger).toContain('必须读取');
    const input = section(await read('zh', 'reference/commands.md'), '填写命令输入');
    for (const term of [
      '`exclusiveGroup`',
      '`template` 作为单个 JSON 对象',
      '临时 JSON 文件',
      '任务标识都原样保留',
      '`error.issues`',
      '`returnAction` 指定的控制目录、命令和模板',
    ]) {
      expect(input, term).toContain(term);
    }
    expect(input).not.toContain('supervisor-cancel');
    expect(input).not.toContain('comet memory observe');
    const enEntry = await read('en', 'SKILL.md');
    const enTarget = 'reference/commands.md#filling-command-inputs';
    const enTrigger = enEntry.split('\n').find((line) => line.includes('(' + enTarget + ')'));
    expect(enTrigger).toContain(
      'Before first filling a Runtime template or returning a result through `returnAction`',
    );
    const enInput = section(await read('en', 'reference/commands.md'), 'filling-command-inputs');
    for (const term of [
      'system temporary JSON file',
      'Preserve all supplied iteration, attempt, state-version, and task identifiers exactly',
      '`exclusiveGroup`',
      'as a single JSON object',
      '`error.issues`',
      'controller directory, command, and template specified by `returnAction`',
    ])
      expect(enInput, term).toContain(term);
    expect(enInput).not.toContain('supervisor-cancel');
    expect(enInput).not.toContain('comet memory observe');
  });

  it('keeps current-candidate verification bindings and child receipts on their normal action routes', async () => {
    const commands = await read('zh', 'reference/commands.md');
    const verify = section(commands, 'verify-协议');
    for (const term of [
      '`projectRoot`',
      '`verificationRoot`',
      '`changeDir`',
      '`supervisorStateRef`',
      '`--project-root`',
      '`candidateId`',
      '`verifierExecutionRef`',
      '恰好标记一次',
      '至少一项集成检查',
      '只在 `inputOptions.template` 中补充缺失或失效的检查',
      '等待同一个 Verifier',
      '`verifier-execution-error`',
      '`verifier-unavailable`',
    ]) {
      expect(verify, term).toContain(term);
    }
    expect(markdownLinks(verify)).toContain('#填写命令输入');
    expect(markdownLinks(verify)).toContain('#命令输入与异常');

    const supervisor = section(commands, 'supervisor-协作');
    for (const term of [
      '子任务角色、任务包、worktree、基线提交、`runId`、验收项的编号与引用、依赖关系和停止条件',
      '`supervisor-checks`',
      '`contractHash`',
      '`verificationBoundary`',
      '非空、`repeatable: true`',
      '`retry_check_ids`',
      '`receiptRef`',
      '每个验收 ID 必须恰好出现一次',
      '全部通过才记录为 `integrated`',
      '`supervisor-cancel`',
    ]) {
      expect(supervisor, term).toContain(term);
    }
    expect(markdownLinks(supervisor)).toContain('#填写命令输入');
    expect(markdownLinks(supervisor)).toContain('recovery.md#等待外部输入与监控');
    const enCommands = await read('en', 'reference/commands.md');
    const enVerify = section(enCommands, 'verify-protocol');
    for (const term of [
      '`projectRoot`',
      '`verificationRoot`',
      '`changeDir`',
      '`supervisorStateRef`',
      '`--project-root`',
      '`candidateId`',
      '`verifierExecutionRef`',
      'exactly once',
      'at least one integration check',
      'Add only missing or invalidated checks',
      'waiting for the same Verifier',
      '`verifier-execution-error`',
      '`verifier-unavailable`',
    ])
      expect(enVerify, term).toContain(term);
    expect(markdownLinks(enVerify)).toContain('#filling-command-inputs');
    expect(markdownLinks(enVerify)).toContain('#command-inputs-and-exceptions');
    const enSupervisor = section(enCommands, 'supervisor-coordination');
    for (const term of [
      'role, task package, worktree, baseline commit, `runId`, acceptance IDs and references, dependencies, and stopping conditions',
      '`supervisor-checks`',
      '`contractHash`',
      '`verificationBoundary`',
      'nonempty',
      '`repeatable: true`',
      '`retry_check_ids`',
      '`receiptRef`',
      'Every task-package acceptance ID must occur exactly once',
      'records `integrated` only when all pass',
      '`supervisor-cancel`',
    ])
      expect(enSupervisor, term).toContain(term);
    expect(markdownLinks(enSupervisor)).toContain('#filling-command-inputs');
    expect(markdownLinks(enSupervisor)).toContain('recovery.md#external-input-and-monitoring');
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
          '最终验收，覆盖全部验收项',
          '原先通过 `finish=merge` 完成的合入步骤现由 Runtime 负责',
          'Supervisor 统筹动作',
          '`repair-child`',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'comet native <command> --help',
          'When an active change exists',
          '`workspace.projectRoot`',
          '`preparation.projectRoot`',
          'workspace selection',
          'Apply the same rules when the user explicitly adds to the current scope',
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
          'final verification of every Supervisor acceptance item',
          'Runtime now owns the integration step formerly performed through `finish=merge`',
          'Supervisor coordination actions',
          '`repair-child`',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await readReachable(variant.language);
      for (const term of variant.required) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
      const statusMarker =
        variant.language === 'zh'
          ? '状态包含 `childSummary`'
          : 'When state contains `childSummary`';
      const entry = await read(variant.language, 'SKILL.md');
      expect(entry.match(new RegExp(statusMarker, 'gu')) ?? []).toHaveLength(1);
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
          '普通 change 归档后，如果该 change 的 worktree 已没有未提交修改，向用户提供清理选项',
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
      const skill = await readAction(variant.language, 'reference/workspace.md#archive-收尾');
      for (const term of variant.required) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });

  it('uses Skill language only to initialize config, then project config owns artifacts', async () => {
    const variants = [
      {
        language: 'zh' as const,
        required: [
          '`comet init`',
          '后续文档使用项目配置中的语言',
          '用户明确要求改用其他语言时，才传入 `--language`',
        ],
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
      const skill = await readAction(variant.language, 'reference/workspace.md#创建-change');
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
          '`iteration` 表示提交实现的轮次',
          '`attempt` 表示对同一份候选实现启动 Verifier 的次数',
          '所有计数都由 Runtime 更新',
        ],
      },
      {
        language: 'en' as const,
        required: [
          'Build ↔ Verify Loop',
          'the Builder submits a candidate',
          'a new read-only Verifier',
          '`iteration` counts implementation submissions',
          '`attempt` counts Verifier launches for the same candidate',
          'Runtime updates all counters',
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
          '检查是否需要由 Supervisor Change 统筹多个子任务',
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
          'do not automatically switch to single-session progression',
          'supervisor-cancel',
          'text length and task count alone must not trigger decomposition',
          'continue with one Native Change',
        ],
      },
    ];

    for (const variant of variants) {
      const execution = await readAction(variant.language, 'reference/commands.md#supervisor-协作');
      const clarification = await readAction(variant.language, 'reference/clarification.md#澄清');
      const shapeAnchor =
        variant.language === 'zh'
          ? 'supervisor-拆分与确认'
          : 'supervisor-decomposition-and-confirmation';
      expect(markdownLinks(clarification)).toContain('#' + shapeAnchor);
      const shape = section(
        await read(variant.language, 'reference/clarification.md'),
        shapeAnchor,
      );
      const skill = `${execution}\n${clarification}\n${shape}`;
      for (const term of variant.required) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
      expect(skill).not.toMatch(/\b(?:hotfix|tweak)\b/iu);
      expect(skill).toContain(variant.language === 'zh' ? '恢复' : 'resume');
      expect(skill).toContain(variant.language === 'zh' ? '不重复' : 'not duplicate');
    }
  });

  it('keeps clarification dependencies and mode-specific scheduling without mandatory simple-task trees', async () => {
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
          '`prepare-shape-confirmation`',
          '不要为最终确认再写一条 `[blocking]`',
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
          '`prepare-shape-confirmation`',
          'do not create another confirmation blocker',
        ],
      },
    ];

    for (const variant of variants) {
      const reference = await read(variant.language, 'reference/clarification.md');
      for (const term of variant.required) {
        expect(reference, `${variant.language}: ${term}`).toContain(term);
      }
      expect(reference).not.toContain('[blocking] CONFIRM');
      if (variant.language === 'zh') {
        expect(reference).toContain('简单问题列出未决项和必要的依赖关系即可');
        expect(reference).toContain('只有多个决定相互依赖、回答会改变后续分支时');
        expect(reference).not.toContain('在提出第一道用户问题前，先建立');
      }
    }
  });

  it('persists each Chinese clarification round before asking and preserves unanswered Batch identities', async () => {
    const clarification = await read('zh', 'reference/clarification.md');
    const sequential = section(clarification, 'sequential-模式');
    expect(sequential.indexOf('保存 `- [blocking]')).toBeGreaterThan(-1);
    expect(sequential.indexOf('保存 `- [blocking]')).toBeLessThan(
      sequential.indexOf('一次只提出这一个问题'),
    );
    expect(sequential).toContain('立即把已确定的决定写入 Decisions、brief 和完整目标规格');
    expect(sequential).toContain('更新问题之间的依赖关系，重新确定下一轮可以提出的问题');

    const batch = section(clarification, 'batch-模式');
    expect(batch.indexOf('保存 `- [blocking] Q1:')).toBeGreaterThan(-1);
    expect(batch.indexOf('保存 `- [blocking] Q1:')).toBeLessThan(
      batch.indexOf('一次提出本轮全部问题'),
    );
    expect(batch).toContain('每个独立决定保留为单独问题');
    expect(batch).toContain('后续轮次不把已有标识改用于其他问题');
    expect(batch).toContain('部分、模糊或未回答的问题保留原标识及 `[blocking]`');
    expect(batch).toContain('再确定下一轮需要一起提出的全部问题');
    const en = await read('en', 'reference/clarification.md');
    const enSequential = section(en, 'sequential-mode');
    expect(enSequential.indexOf('first save `- [blocking]')).toBeGreaterThan(-1);
    expect(enSequential.indexOf('first save `- [blocking]')).toBeLessThan(
      enSequential.indexOf('Ask only this question'),
    );
    expect(enSequential).toContain(
      'Immediately record confirmed decisions in Decisions, the brief, and complete target Specs',
    );
    const enBatch = section(en, 'batch-mode');
    expect(enBatch.indexOf('Before asking, save all questions')).toBeLessThan(
      enBatch.indexOf('Ask the complete current set at once'),
    );
    expect(enBatch).toContain('Keep each independent decision as a separate question');
    expect(enBatch).toContain('Never reuse an existing ID for another question');
    expect(enBatch).toContain('Preserve original IDs and `[blocking]`');
    expect(enBatch).toContain('then determine the next complete set');
    const format = section(en, 'batch-text-format');
    for (const term of [
      '`Q1`, `Q2`',
      '💬 **Q1｜',
      '💡 **Recommended answer:',
      'single choice',
      'Reason:',
      'do not renumber later rounds',
      'examples are not defaults',
    ])
      expect(format, term).toContain(term);
  });

  it('presents both Supervisor modes as intact three-column choices with an explicit decision boundary', async () => {
    const clarification = await read('zh', 'reference/clarification.md');
    const supervisor = section(clarification, 'supervisor-拆分与确认');
    const table = supervisor
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    expect(table).toHaveLength(4);
    expect(table.every((row) => row.length === 3)).toBe(true);
    expect(table.slice(2).map((row) => row[0])).toEqual(['A', 'B']);
    expect(table[2][1]).toContain('多会话协作');
    expect(table[2][2]).toContain('自动改用 subagent');
    expect(table[3][1]).toContain('单会话推进');
    expect(table[3][2]).toContain('由当前会话依次处理');
    expect(supervisor).toContain('必须同时展示 A、B 两项');
    expect(supervisor).toContain('文本提问使用上表');
    expect(supervisor).toContain('等待用户明确选择');
    expect(supervisor).toContain('不得把普通“确认”视为已选择');
    expect(supervisor).toContain('用户仍需再次明确确认完整 Shape');
    expect(markdownLinks(supervisor)).toContain('commands.md#supervisor-协作');
    const enSupervisor = section(
      await read('en', 'reference/clarification.md'),
      'supervisor-decomposition-and-confirmation',
    );
    const enRows = enSupervisor
      .split('\n')
      .filter((line) => line.startsWith('|'))
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      );
    expect(enRows).toHaveLength(4);
    expect(enRows.every((row) => row.length === 3)).toBe(true);
    expect(enRows.slice(2).map((row) => row[0])).toEqual(['A', 'B']);
    expect(enRows[2][2]).toContain('automatically switch to a subagent');
    expect(enRows[3][2]).toContain('current session handles all children sequentially');
    expect(enSupervisor).toContain('show both A and B');
    expect(enSupervisor).toContain('wait for explicit selection');
    expect(enSupervisor).toContain('a generic confirmation is insufficient');
    expect(enSupervisor).toContain('The user must explicitly confirm the complete Shape');
    expect(markdownLinks(enSupervisor)).toContain('commands.md#supervisor-coordination');
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
          ? '它不会启动独立服务或进程，也不需要配置服务地址或回调'
          : 'It does not start an independent service or process, and requires no service address or callback',
      );
      expect(commands).toContain(
        language === 'zh'
          ? '本次任务未启动、执行失败、超时或结束后没有返回'
          : 'this task did not start, failed, timed out, or ended without returning a result',
      );
      const exceptions = section(
        commands,
        language === 'zh' ? '命令输入与异常' : 'command-inputs-and-exceptions',
      );
      expect(exceptions.match(/comet native/gu)?.length ?? 0).toBeLessThanOrEqual(5);
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

  it('defines Chinese Supervisor monitoring pause and recovery boundaries', async () => {
    const skill = await read('zh', 'SKILL.md');
    const recovery = await read('zh', 'reference/recovery.md');
    expect(skill).toContain('等待外部输入时，按恢复参考中的');
    expect(markdownLinks(skill)).toContain('reference/recovery.md#等待外部输入与监控');
    for (const term of [
      '没有可执行子任务、没有仍在执行的相关任务，也没有需要定期检查的外部状态',
      '保留独立任务及其监控',
      '实际暂停监控，并核对返回状态',
      '无法识别、权限不足或暂停失败时',
      '监控尚未确认暂停',
      '停止回复消息不等于停止定期触发任务',
      '首次进入等待时，一次性告知用户',
      '已有的任务记录',
      '普通进度消息不能解除阻塞',
      '重新读取 Runtime 状态，沿用原 change、任务标识和已完成结果',
      '只有仍需定期检查时，才恢复对应监控',
      '不等同于 Runtime 的 `blocked` / `await-user`',
      '不得直接修改状态文件，也不得用 Verifier 状态表示缺少实现所需的资料',
    ]) {
      expect(recovery, term).toContain(term);
    }
  });

  it('defines English Supervisor monitoring pause and recovery boundaries', async () => {
    const skill = await read('en', 'SKILL.md');
    const recovery = await read('en', 'reference/recovery.md');
    expect(skill).toContain(
      'When waiting for external input, follow [external input and monitoring]',
    );
    for (const term of [
      'no child is ready, no relevant task is running, and no external state needs periodic checks',
      'Keep independent tasks and their monitors',
      'actually pause it through the platform and check the returned state',
      'If it cannot be identified, permission is missing, or pausing fails',
      'the pause is unconfirmed',
      'Stopping chat replies does not stop recurring task triggers',
      'on first entering the wait, explain the blocker',
      'existing task records',
      'An ordinary progress message does not resolve the blocker',
      'retaining the change, task identifiers, and completed results',
      'Resume the relevant monitor only if periodic checks are still needed',
      'is not Runtime `blocked` / `await-user`',
      'Do not edit state files directly or use Verifier status to represent missing implementation material',
    ]) {
      expect(recovery, term).toContain(term);
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
          'Another active Native change exists',
          "Runtime's default `current`",
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
        expect(workspace.replace(/[\t ]+/gu, ' '), `${variant.language}: ${term}`).toContain(term);
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
