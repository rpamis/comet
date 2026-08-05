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

  it('uses only the public CLI without platform-directory discovery in Chinese', async () => {
    const source = await read('zh', 'SKILL.md');

    expect(source).toContain('只使用 PATH 中的公开 `comet native <cmd>` CLI');
    expect(source).toContain('`comet native <cmd>`');
    expect(source).toContain('不得搜索 Skill 文件、枚举平台目录或直接调用内部 bundle');
    expect(source).not.toContain('Base directory');
    expect(source).not.toContain('comet-native-<cmd>.mjs');
    expect(source).not.toContain('"$PWD/../.claude/skills"');
    expect(source).not.toContain('"$HOME/.claude/skills"');
  });

  it('makes the acceptance-gap completion loop explicit', async () => {
    const variants = [
      {
        language: 'zh' as const,
        terms: [
          'comet native status <change-name> --details',
          'failed/missing acceptance',
          'checkpoint 不是完成证据',
          '执行一次完整审查',
          '`fail` 回到 Build，从第 1 步继续',
          '`pass` 才进入 Archive',
          '一次 Agent turn、一次 checkpoint、一次 `blocked` 或 Agent 自述“已完成”都不是终态',
          'Agent 负责发现并修复缺口，Runtime 负责判断是否完成',
        ],
      },
      {
        language: 'en' as const,
        terms: [
          'comet native status <change-name> --details',
          'failed or missing acceptance items',
          'a checkpoint is not completion evidence',
          'perform one complete review',
          '`fail` returns to Build and repeats from step 1',
          'only `pass` enters Archive',
          'One Agent turn, one checkpoint, one `blocked` result, or the Agent saying “complete” is not a terminal state',
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

  it('treats blocked as recovery and reconfirms changed Build requirements', async () => {
    const variants = [
      {
        language: 'zh' as const,
        skillTerms: [
          '`blocked` 会暂停正常 Build → Verify 循环并进入恢复分支',
          '不因 `blocked` 本身结束任务',
          '出现新的用户决定时保持在 Build',
          '执行 Runtime 返回的命令并传入 `--confirmed`',
        ],
        commandTerms: [
          '如果需求变化引入新的用户决定',
          '保持在 Build 并重新完成澄清与确认',
          '传入 `--confirmed`',
        ],
      },
      {
        language: 'en' as const,
        skillTerms: [
          '`blocked` pauses the normal Build → Verify loop and enters a recovery branch',
          'rather than ending the task because it was `blocked`',
          'If a new user decision appears, stay in Build',
          'run the command returned by the Runtime and pass `--confirmed`',
        ],
        commandTerms: [
          'If changed requirements introduce a new user decision',
          'stay in Build and repeat clarification and confirmation',
          'with `--confirmed`',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await read(variant.language, 'SKILL.md');
      const commands = await read(variant.language, 'reference/commands.md');
      for (const term of variant.skillTerms) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
      for (const term of variant.commandTerms) {
        expect(commands, `${variant.language}: ${term}`).toContain(term);
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
      expect(artifacts).not.toContain('"status": "waived"');

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
      const expectedCommands = [
        'comet native init',
        'comet native root show',
        'comet native root move',
        'comet native new',
        'comet native spec remove',
        'comet native spec rebase',
        'comet native show',
        'comet native status',
        'comet native select',
        'comet native checkpoint',
        'comet native check',
        'comet native evidence format',
        'comet native receipt manual',
        'comet native receipt automated',
        'comet native next',
        'comet native archive',
        'comet native doctor',
      ];
      for (const command of expectedCommands) {
        expect(commands, `${language}: ${command}`).toContain(command);
      }
      expect(commands).not.toContain('--creation-authorization');
      expect(commands).toContain('--allow-partial-scope <sha256>');
      expect(commands).toContain('--expect-preflight <sha256> [--confirmed]');
      expect(commands).not.toContain('receipt implement');
      expect(commands).not.toContain('receipt review');
      expect(commands).not.toContain('receipt waive');
      expect(commands).not.toContain('--independent-review-receipt');
      expect(commands).not.toContain('--waiver');
      expect(commands).not.toContain('comet native list');
      expect(commands).not.toContain('--receipt <required-receipt-ref>');
      expect(commands).not.toContain('--evidence-receipt');
      expect(commands).not.toContain('--failure-category');
      expect(commands).not.toContain('--failed-check');

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

  it('explains project and change commands as a bilingual task-oriented runbook', async () => {
    const commands = await read('zh', 'reference/commands.md');

    for (const heading of [
      '### 首次启用 Native',
      '### 查看或迁移 artifact root',
      '### 发现并读取 change（只读）',
      '### 恢复已有 change',
      '### 创建新 change',
      '### 修正规格轨迹',
    ]) {
      expect(commands).toContain(heading);
    }

    expect(commands).toContain('不要按本节顺序逐条执行');
    expect(commands).toContain('`init` 不迁移已有 artifact root');
    expect(commands).toContain('`root move` 是事务性写操作');
    expect(commands).toContain('无 change 名称的 `status` 返回分页候选');
    expect(commands).toContain('`show` 返回 state、brief 和 proposed specs');
    expect(commands).toContain('`select` 只更新当前 Native change，不改变 phase');
    expect(commands).toContain(
      '只有扫描当前仓库已登记工作目录并确认没有对应 active change 时才运行 `new`',
    );
    expect(commands).toContain(
      '`spec remove` 和 `spec rebase` 都会修改 change 的规格轨迹并返回新的 continuation',
    );
    expect(commands).toContain('执行写命令后立即重读 `status <change-name>`');

    const englishCommands = await read('en', 'reference/commands.md');
    for (const heading of [
      '### Enable Native for the first time',
      '### Inspect or migrate the artifact root',
      '### Discover and read changes (read-only)',
      '### Resume an existing change',
      '### Create a new change',
      '### Correct the specification history',
    ]) {
      expect(englishCommands).toContain(heading);
    }

    expect(englishCommands).toContain('do not execute this section from top to bottom');
    expect(englishCommands).toContain('`init` does not migrate an existing artifact root');
    expect(englishCommands).toContain('`root move` is a transactional write operation');
    expect(englishCommands).toContain(
      '`status` without a change name returns paginated candidates',
    );
    expect(englishCommands).toContain('`show` returns state, the brief, and proposed specs');
    expect(englishCommands).toContain(
      '`select` updates only the current Native selection and does not change the phase',
    );
    expect(englishCommands).toContain(
      'Run `new` only after scanning registered working directories and confirming that no matching active change exists',
    );
    expect(englishCommands).toContain(
      "Both `spec remove` and `spec rebase` modify the change's specification history and return a new continuation",
    );
    expect(englishCommands).toContain('After any write command, immediately reread');
  });

  it('documents automatic change discovery, workspace binding, and finishing in both languages', async () => {
    const variants = [
      {
        language: 'zh' as const,
        skillTerms: [
          'git worktree list --porcelain',
          '不等待用户说“并行”',
          '并行单位是 change',
          'current / branch / worktree',
          'workspace-isolation-required',
          '不自动生成 worktree、不移动文件、不刷新 baseline',
          '归档并本地合并到已绑定目标分支',
          '归档、推送并创建 PR',
          '持久化的 `targetBranch` 作为 PR base',
          'worktree 创建只完成部分步骤时立即停止',
          'comet doctor --repair --scope project',
          '恰好存在一个以目标项目为根的 Router',
          '不让用户手动进入目录',
          '任何语义冲突都中止合并',
        ],
        commandTerms: [
          '--isolation current|branch|worktree',
          '--change-branch <branch>',
          '--target-branch <branch>',
          '--finish merge|push|pull-request|keep',
          'comet.native.workspace.v3',
        ],
      },
      {
        language: 'en' as const,
        skillTerms: [
          'git worktree list --porcelain',
          'do not wait for the user to say “parallel.”',
          'parallelism unit is a change',
          'current / branch / worktree',
          'workspace-isolation-required',
          'do not generate worktrees, move files, or refresh their baselines automatically',
          'archive and merge locally into the bound target branch',
          'archive, push, and open a PR',
          'persisted `targetBranch` as its base',
          'worktree creation completes only some steps',
          'comet doctor --repair --scope project',
          'exactly one Router rooted in the target project',
          'without asking the user to enter it manually',
          'Abort any semantic conflict',
        ],
        commandTerms: [
          '--isolation current|branch|worktree',
          '--change-branch <branch>',
          '--target-branch <branch>',
          '--finish merge|push|pull-request|keep',
          'comet.native.workspace.v3',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await read(variant.language, 'SKILL.md');
      const commands = await read(variant.language, 'reference/commands.md');
      const artifacts = await read(variant.language, 'reference/artifacts.md');
      for (const term of variant.skillTerms) {
        expect(skill, `${variant.language}: ${term}`).toContain(term);
      }
      for (const term of variant.commandTerms) {
        expect(`${commands}\n${artifacts}`, `${variant.language}: ${term}`).toContain(term);
      }
    }
  });

  it('removes the external cryptographic review workflow from both languages', async () => {
    const zhSkill = await read('zh', 'SKILL.md');
    const enSkill = await read('en', 'SKILL.md');
    const zhCommands = await read('zh', 'reference/commands.md');
    const enCommands = await read('en', 'reference/commands.md');

    for (const content of [zhSkill, enSkill, zhCommands, enCommands]) {
      expect(content).not.toMatch(/waiver|independent.review|attestation|签名私钥|独立审核/iu);
      expect(content).not.toMatch(/external.role|外部角色/iu);
    }
  });

  it('does not ask users for an identity label when recording manual evidence', async () => {
    for (const language of ['en', 'zh'] as const) {
      const commands = await read(language, 'reference/commands.md');
      expect(commands).not.toContain('--responsible');
      expect(commands).not.toMatch(/receipt manual[\s\S]{0,180}--confirmed/iu);
      expect(commands).not.toMatch(/\bresponsible\b|观察者标签|身份凭据/iu);
    }
  });

  it('makes repair stops actionable without asking users for Runtime internals', async () => {
    const variants = [
      {
        language: 'zh' as const,
        terms: [
          '新的修复假设',
          '提高 `native.max_verify_failures`',
          '调整已确认契约',
          '停止本次修复',
          '不要让用户提供 signature、hash 或 override 参数',
        ],
      },
      {
        language: 'en' as const,
        terms: [
          'one concrete new repair hypothesis',
          'increase `native.max_verify_failures`',
          'change the confirmed contract',
          'stop this repair',
          'Do not ask the user for a signature, hash, or override argument',
        ],
      },
    ];

    for (const variant of variants) {
      const skill = await read(variant.language, 'SKILL.md');
      const recovery = await read(variant.language, 'reference/recovery.md');
      expect(skill).toContain('`repair-continuation-decision`');
      for (const term of variant.terms) expect(recovery).toContain(term);
    }
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
