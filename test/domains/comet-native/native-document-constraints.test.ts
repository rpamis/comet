import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  validateNativeBrief,
  validateNativeSpecDocumentText,
} from '../../../domains/comet-native/native-artifacts.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';
import {
  ensureNativeDirectories,
  nativeProjectPaths,
} from '../../../domains/comet-native/native-paths.js';
import {
  createNativePortableChange,
  nativePortableChangeDir,
  readNativePortableChange,
  validateNativePortableDocuments,
} from '../../../domains/comet-native/native-portable-runtime.js';
import { nativeNextCommand } from '../../../domains/comet-native/native-next-command.js';
import { runNativeCli } from '../../../domains/comet-native/native-cli.js';
import { inspectNativeSdkRun } from '../../../domains/comet-native/native-runtime-ownership.js';

const completeBrief = `# Outcome
Ship the documented behavior.
# Scope
The requested behavior only.
## Directory structure
### Created
None.
### Modified
- The behavior module.
### Deleted
None.
### Not created
None.
# Non-goals
None.
# Acceptance examples
- The behavior works.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
None.
# Open questions
None.
# Verification expectations
Run the focused Native checks.
`;

describe('Native document constraints', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-document-constraints-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('requires every brief section to contain real content at the strict boundary', async () => {
    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace('# Decisions\nNone.', '# Decisions\n'),
    );

    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'brief-section-empty', path: 'brief.md' })],
    });
  });

  it('accepts explicit no-item statements but rejects template-only content', async () => {
    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace(
        '# Constraints and invariants\nPreserve existing compatibility.',
        '# Constraints and invariants\nTODO: fill this in.',
      ),
    );

    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'brief-section-placeholder' })],
    });

    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace('# Outcome\nShip the documented behavior.', '# Outcome\n- None.'),
    );
    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'brief-section-empty' })],
    });

    await fs.writeFile(path.join(root, 'brief.md'), completeBrief);
    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toEqual({
      valid: true,
      findings: [],
    });
  });

  it('requires the directory structure section under Scope at the strict boundary', async () => {
    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace(
        '## Directory structure\n### Created\nNone.\n### Modified\n- The behavior module.\n### Deleted\nNone.\n### Not created\nNone.\n',
        '',
      ),
    );
    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'brief-structure-missing' })],
    });

    await fs.writeFile(path.join(root, 'brief.md'), completeBrief);
    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toEqual({
      valid: true,
      findings: [],
    });
  });

  it.each([
    ['Directory structure', 'Modified', '- config/defaults.yaml — Adjust the timeout.'],
    ['目录结构', '修改', '- config/defaults.yaml — 调整默认超时时间。'],
    ['Directory structure', 'Created', '```text\nsrc/\n└─ report.ts — Export reports.\n```'],
    ['目录结构', '新建', '```text\nsrc/\n└─ report.ts — 导出报告。\n```'],
    ['目录结构', '明确不建', '- 独立存储层 — 现有接口已满足需求。'],
  ])('accepts only the populated %s / %s category', async (section, category, content) => {
    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace(
        /## Directory structure\n[\s\S]*?(?=# Non-goals)/u,
        `## ${section}\n### ${category}\n${content}\n`,
      ),
    );

    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toEqual({ valid: true, findings: [] });
  });

  it.each([
    '',
    '### Other\n- src/report.ts — Not a recognized category.\n',
    '<!-- ### Modified\n- src/report.ts — Commented example. -->\n',
    '```text\n### Modified\n- src/report.ts — Fenced example.\n```\n',
    '### Modified\n',
    '### Modified\n<!-- Fill this later. -->\n',
    '### Modified\nTODO: fill this in.\n',
    '### Modified\n- src/report.ts — Export reports.\n### Deleted\n',
  ])('rejects missing or unfilled structure categories: %s', async (structure) => {
    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace(
        /## Directory structure\n[\s\S]*?(?=# Non-goals)/u,
        `## Directory structure\n${structure}`,
      ),
    );

    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toMatchObject({
      valid: false,
      findings: expect.arrayContaining([
        expect.objectContaining({ code: 'brief-structure-subsection-missing', path: 'brief.md' }),
      ]),
    });
  });

  it('accepts Chinese directory structure headings and fenced tree content', async () => {
    const zhBrief = `# 目标
交付文档描述的行为。
# 范围
仅请求的行为。
## 目录结构
### 新建
\`\`\`
src/
  ├─ export/ — 组织导出流程
  └─ reporting/ — 提供导出入口
\`\`\`
### 修改
无
### 删除
无
### 明确不建
- 独立的数据访问层 — 现有接口已满足需求
# 非目标
无
# 验收示例
- 行为可用。
# 约束与不变量
保持既有兼容性。
# 决策
无
# 待解决问题
无
# 验证预期
运行相关检查。
`;
    await fs.writeFile(path.join(root, 'brief.md'), zhBrief);
    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toEqual({
      valid: true,
      findings: [],
    });
  });

  it('ignores fenced examples even when fence markers mix backticks and tildes', async () => {
    const mixedFenceBrief = `# Outcome
Ship the documented behavior.
# Scope
The requested behavior only.

Example of the expected format:

\`\`\`
## Directory structure
### Not created
- example row only
~~~
\`\`\`

## Directory structure
### Created
None.
### Modified
\`\`\`
src/module/
  ├─ index.ts — example listing with a tilde line below
~~~
\`\`\`
### Deleted
None.
### Not created
None.
# Non-goals
None.
# Acceptance examples
- The behavior works.
# Constraints and invariants
Preserve existing compatibility.
# Decisions
No product behavior change: documentation-only wording.
# Open questions
None.
# Verification expectations
Run the focused Native checks.
`;
    await fs.writeFile(path.join(root, 'brief.md'), mixedFenceBrief);
    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toEqual({
      valid: true,
      findings: [],
    });
  });

  it.each(['```', '~~~', '````'])('ignores headings inside %s directory trees', async (marker) => {
    const tree = [
      `${marker}text`,
      '# src/module/',
      '## Directory structure',
      '### Deleted',
      '  helper — supporting behavior',
      marker === '````' ? '```' : marker === '```' ? '~~~' : '```',
      '# Scope',
      '  another helper — supporting behavior',
      marker,
    ].join('\n');
    await fs.writeFile(
      path.join(root, 'brief.md'),
      completeBrief.replace('### Created\nNone.', `### Created\n${tree}`),
    );
    await expect(
      validateNativeBrief(root, 'brief.md', { strict: true, structure: true }),
    ).resolves.toEqual({ valid: true, findings: [] });
  });

  it('applies the directory structure requirement only from constraint version 3', async () => {
    const projectRoot = path.join(root, 'legacy-version-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'legacy-version-change',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief
        .replace(
          '## Directory structure\n### Created\nNone.\n### Modified\n- The behavior module.\n### Deleted\nNone.\n### Not created\nNone.\n',
          '',
        )
        .replace(
          '# Decisions\nNone.',
          '# Decisions\nNo product behavior change: documentation-only wording.',
        ),
    );

    for (const version of [1, 2] as const) {
      await expect(
        validateNativePortableDocuments({
          paths,
          state: { ...state, document_constraints_version: version },
          specChanges: [],
        }),
      ).resolves.toMatchObject({ valid: true, findings: [] });
    }
    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, document_constraints_version: 3 },
        specChanges: [],
      }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'brief-structure-missing' })],
    });
  });

  it('rejects empty and template-only target specs with actionable findings', () => {
    expect(validateNativeSpecDocumentText('', 'specs/auth/spec.md')).toMatchObject({
      valid: false,
      findings: [
        expect.objectContaining({ code: 'spec-document-empty', path: 'specs/auth/spec.md' }),
      ],
    });
    expect(validateNativeSpecDocumentText('# Authentication', 'specs/auth/spec.md')).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-empty' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\nTODO: fill this in.', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\n<TODO>', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\n**<TODO>**', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\nTODO: explain later', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
    expect(
      validateNativeSpecDocumentText('# Authentication\n```\nTODO\n```', 'specs/auth/spec.md'),
    ).toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-placeholder' })],
    });
  });

  it('rejects placeholder-only product behavior exemptions at the Shape boundary', async () => {
    const projectRoot = path.join(root, 'placeholder-exemption-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'placeholder-exemption', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'placeholder-exemption');
    for (const reason of [
      'No product behavior change: TODO',
      'No product behavior change: TODO: explain later',
      'No product behavior change: 待补充',
      'No product behavior change: 不涉及产品行为',
      '<!-- No product behavior change: explain reason here -->',
      'No product behavior change: {{reason}}',
    ]) {
      await fs.writeFile(
        path.join(changeDir, 'brief.md'),
        completeBrief.replace('# Decisions\nNone.', `# Decisions\n${reason}`),
      );

      await expect(
        nativeNextCommand(['placeholder-exemption', '--summary', 'Prepare Shape'], projectRoot),
      ).rejects.toThrow(/spec-exemption-missing/u);
    }

    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace(
        '# Decisions\nNone.',
        '# Decisions\nNo product behavior change: 仅更新说明文档。',
      ),
    );
    await expect(
      nativeNextCommand(['placeholder-exemption', '--summary', 'Prepare Shape'], projectRoot),
    ).resolves.toMatchObject({ exitCode: 0 });
  });

  it('blocks the public Shape transition and succeeds after the documented repair', async () => {
    const projectRoot = path.join(root, 'project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'doc-change', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'doc-change');
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace('# Decisions\nNone.', '# Decisions\n'),
    );

    await expect(
      nativeNextCommand(['doc-change', '--summary', 'Prepare Shape'], projectRoot),
    ).rejects.toThrow(/brief-section-empty[\s\S]*rerun the latest continuation command/u);

    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace(
        '# Decisions\nNone.',
        '# Decisions\nNo product behavior change: documentation-only wording.',
      ),
    );
    const prepared = await nativeNextCommand(
      ['doc-change', '--summary', 'Prepare Shape'],
      projectRoot,
    );
    expect(prepared.exitCode).toBe(0);
    expect(prepared.data as { state: { status: string } }).toMatchObject({
      state: { status: 'await-user' },
    });
    await expect(readNativePortableChange(paths, 'doc-change')).resolves.toMatchObject({
      document_constraints_version: 3,
    });
  });

  it('allows a formal removal without a target Spec or exemption', async () => {
    const projectRoot = path.join(root, 'removal-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'remove-change',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    const removal = { capability: 'legacy-capability', operation: 'remove' as const, source: null };

    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [removal] },
        specChanges: [removal],
      }),
    ).resolves.toMatchObject({ valid: true, findings: [] });
  });

  it('does not let an exemption hide a previously declared missing target Spec', async () => {
    const projectRoot = path.join(root, 'missing-spec-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'missing-spec-change',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace(
        '# Decisions\nNone.',
        '# Decisions\nNo product behavior change: documentation-only wording.',
      ),
    );
    const declared = {
      capability: 'declared-capability',
      operation: 'create' as const,
      source: 'specs/declared-capability/spec.md',
    };

    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [declared] },
        specChanges: [],
      }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-missing' })],
    });
  });

  it('lets Shape replace a previously declared target Spec before confirmation', async () => {
    const projectRoot = path.join(root, 'retarget-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    await createNativePortableChange({ paths, name: 'retarget-change', language: 'en' });
    const changeDir = nativePortableChangeDir(paths, 'retarget-change');
    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    const writeSpec = async (capability: string) => {
      await fs.mkdir(path.join(changeDir, 'specs', capability), { recursive: true });
      await fs.writeFile(
        path.join(changeDir, 'specs', capability, 'spec.md'),
        `# ${capability}\n\n## Requirement\nThe ${capability} behavior is complete.\n`,
      );
    };
    await writeSpec('original-capability');

    const first = await nativeNextCommand(
      ['retarget-change', '--summary', 'Prepare Shape'],
      projectRoot,
    );
    expect(first.exitCode).toBe(0);
    await expect(readNativePortableChange(paths, 'retarget-change')).resolves.toMatchObject({
      phase: 'shape',
      status: 'await-user',
      spec_changes: [expect.objectContaining({ capability: 'original-capability' })],
    });

    await fs.rm(path.join(changeDir, 'specs', 'original-capability'), {
      recursive: true,
      force: true,
    });
    await writeSpec('replacement-capability');
    await expect(
      nativeNextCommand(
        [
          'retarget-change',
          '--confirmed',
          '--summary',
          'Confirm Shape',
          '--expected-state-version',
          '2',
          '--expected-action',
          'confirm-shape',
        ],
        projectRoot,
      ),
    ).rejects.toThrow('returned to Shape');
    await expect(readNativePortableChange(paths, 'retarget-change')).resolves.toMatchObject({
      phase: 'shape',
      status: 'active',
      loop: { next_action: 'prepare-shape-confirmation' },
    });

    const retargeted = await nativeNextCommand(
      ['retarget-change', '--summary', 'Prepare Shape'],
      projectRoot,
    );
    expect(retargeted.exitCode).toBe(0);
    const prepared = await readNativePortableChange(paths, 'retarget-change');
    expect(prepared).toMatchObject({
      phase: 'shape',
      status: 'await-user',
      spec_changes: [
        {
          capability: 'replacement-capability',
          operation: 'create',
          source: 'specs/replacement-capability/spec.md',
        },
      ],
    });
  });

  it('lets an SDK Shape revision replace a previously declared target Spec', async () => {
    const projectRoot = path.join(root, 'sdk-retarget-project');
    const home = path.join(root, 'sdk-retarget-home');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(home, { recursive: true });
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    vi.stubEnv('XDG_DATA_HOME', path.join(home, '.local/share'));
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: projectRoot, stdio: 'ignore' });
      const cli = async (...args: string[]) => {
        const result = await runNativeCli([...args, '--project-root', projectRoot, '--json']);
        return { exitCode: result.exitCode, json: JSON.parse(result.stdout ?? '{}') };
      };
      expect((await cli('new', 'sdk-retarget', '--runtime', 'sdk')).exitCode).toBe(0);
      const changeDir = path.join(projectRoot, 'docs/comet/changes/sdk-retarget');
      await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
      const writeSpec = async (capability: string) => {
        await fs.mkdir(path.join(changeDir, 'specs', capability), { recursive: true });
        await fs.writeFile(
          path.join(changeDir, 'specs', capability, 'spec.md'),
          `# ${capability}\n\n## Requirement\nThe ${capability} behavior is complete.\n`,
        );
      };
      const state = async () =>
        (await inspectNativeSdkRun(projectRoot, 'sdk-retarget', { readOnly: true })).state;
      await writeSpec('original-capability');
      expect((await cli('next', 'sdk-retarget', '--summary', 'Prepare Shape')).exitCode).toBe(0);
      expect(await state()).toMatchObject({
        status: 'await-user',
        spec_changes: [expect.objectContaining({ capability: 'original-capability' })],
      });

      await fs.rm(path.join(changeDir, 'specs', 'original-capability'), {
        recursive: true,
        force: true,
      });
      await writeSpec('replacement-capability');
      const status = await cli('status', 'sdk-retarget');
      const revise = (
        status.json.data.continuation.commandAlternatives as Array<{
          name: string;
          commandArgs: string[];
        }>
      ).find(({ name }) => name === 'revise-requirements');
      expect(revise).toBeDefined();
      const reviseArgs = revise!.commandArgs
        .slice(2)
        .map((arg) => (arg === '<summary>' ? 'User changed the target capability.' : arg))
        .filter(
          (arg, index, all) =>
            arg !== '--json' && arg !== '--project-root' && all[index - 1] !== '--project-root',
        );
      const revised = await cli(...reviseArgs);
      expect(revised.exitCode, JSON.stringify(revised.json.summary)).toBe(0);
      const prepared = await state();
      expect(prepared).toMatchObject({
        phase: 'shape',
        status: 'await-user',
        spec_changes: [
          {
            capability: 'replacement-capability',
            operation: 'create',
            source: 'specs/replacement-capability/spec.md',
          },
        ],
      });

      const confirmed = await cli(
        'next',
        'sdk-retarget',
        '--confirmed',
        '--summary',
        'User approved Shape.',
        '--expected-state-version',
        String(prepared.state_version),
        '--expected-action',
        'confirm-shape',
      );
      expect(confirmed.exitCode).toBe(0);
      expect(await state()).toMatchObject({
        phase: 'build',
        spec_changes: [expect.objectContaining({ capability: 'replacement-capability' })],
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps a confirmed target Spec bound after Shape', async () => {
    const projectRoot = path.join(root, 'confirmed-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'confirmed-change',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    await fs.mkdir(path.join(changeDir, 'specs', 'replacement-capability'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'replacement-capability', 'spec.md'),
      '# Replacement\n\n## Requirement\nThe replacement behavior is complete.\n',
    );
    const declared = {
      capability: 'declared-capability',
      operation: 'create' as const,
      source: 'specs/declared-capability/spec.md',
    };
    const replacement = {
      capability: 'replacement-capability',
      operation: 'create' as const,
      source: 'specs/replacement-capability/spec.md',
    };

    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [declared] },
        specChanges: [replacement],
      }),
    ).resolves.toMatchObject({ valid: true, findings: [] });
    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, phase: 'build', spec_changes: [declared] },
        specChanges: [replacement],
      }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [
        expect.objectContaining({
          code: 'spec-document-missing',
          path: 'specs/declared-capability/spec.md',
        }),
      ],
    });
  });

  it('does not let an unrelated Shape removal hide a declared target Spec', async () => {
    const projectRoot = path.join(root, 'unrelated-removal-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'unrelated-removal-change',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);
    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    const declared = {
      capability: 'declared-capability',
      operation: 'modify' as const,
      source: 'specs/declared-capability/spec.md',
    };
    const remove = (capability: string) => ({
      capability,
      operation: 'remove' as const,
      source: null,
    });

    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [declared] },
        specChanges: [remove('legacy-capability')],
      }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [
        expect.objectContaining({
          code: 'spec-document-missing',
          path: 'specs/declared-capability/spec.md',
        }),
      ],
    });
    await expect(
      validateNativePortableDocuments({
        paths,
        state: { ...state, spec_changes: [declared] },
        specChanges: [remove('declared-capability')],
      }),
    ).resolves.toMatchObject({ valid: true, findings: [] });
  });

  it('covers reject-repair-retry for exemption, target content, and formal path checks', async () => {
    const projectRoot = path.join(root, 'repair-matrix-project');
    await fs.mkdir(path.join(projectRoot, '.git'), { recursive: true });
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'en'));
    const paths = await nativeProjectPaths(projectRoot, 'docs');
    await ensureNativeDirectories(paths);
    const state = await createNativePortableChange({
      paths,
      name: 'repair-matrix',
      language: 'en',
    });
    const changeDir = nativePortableChangeDir(paths, state.name);

    await fs.writeFile(path.join(changeDir, 'brief.md'), completeBrief);
    await expect(
      validateNativePortableDocuments({ paths, state, specChanges: [] }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-exemption-missing' })],
    });
    await fs.writeFile(
      path.join(changeDir, 'brief.md'),
      completeBrief.replace(
        '# Decisions\nNone.',
        '# Decisions\nNo product behavior change: documentation-only wording.',
      ),
    );
    await expect(
      validateNativePortableDocuments({ paths, state, specChanges: [] }),
    ).resolves.toMatchObject({ valid: true, findings: [] });

    const declared = {
      capability: 'repairable-capability',
      operation: 'create' as const,
      source: 'specs/repairable-capability/spec.md',
    };
    const declaredState = { ...state, spec_changes: [declared] };
    await expect(
      validateNativePortableDocuments({ paths, state: declaredState, specChanges: [] }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-document-missing' })],
    });
    await fs.mkdir(path.join(changeDir, 'specs', 'repairable-capability'), { recursive: true });
    await fs.writeFile(
      path.join(changeDir, 'specs', 'repairable-capability', 'spec.md'),
      '# Repairable capability\n\n## Requirement\nThe repaired target is complete.\n',
    );
    await expect(
      validateNativePortableDocuments({ paths, state: declaredState, specChanges: [declared] }),
    ).resolves.toMatchObject({ valid: true, findings: [] });

    await expect(
      validateNativePortableDocuments({
        paths,
        state: declaredState,
        specChanges: [{ ...declared, source: 'specs/wrong-location/spec.md' }],
      }),
    ).resolves.toMatchObject({
      valid: false,
      findings: [expect.objectContaining({ code: 'spec-source-path-invalid' })],
    });
    await expect(
      validateNativePortableDocuments({ paths, state: declaredState, specChanges: [declared] }),
    ).resolves.toMatchObject({ valid: true, findings: [] });
  });
});
