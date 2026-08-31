import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';

const readmes = ['README.md', 'README-zh.md'];

describe('README assets', () => {
  it.each(readmes)('uses npm-friendly absolute image URLs in %s', async (readmePath) => {
    const content = await fs.readFile(readmePath, 'utf-8');

    expect(content).not.toMatch(/\b(?:src|srcset)=["'](?:\.\/)?img\//);
    expect(content).toContain('https://github.com/rpamis/comet/blob/master/img/');
  });

  it('documents build_pause in README state examples and field descriptions', async () => {
    const en = await fs.readFile('README.md', 'utf-8');
    const zh = await fs.readFile('README-zh.md', 'utf-8');

    expect(en).toContain('build_pause: null');
    expect(en).toContain('`build_pause` records an internal build-phase pause point');
    expect(en).toContain('`plan-ready` means the plan has been generated');

    expect(zh).toContain('build_pause: null');
    expect(zh).toContain('`build_pause` 记录 build 阶段内部暂停点');
    expect(zh).toContain('`plan-ready` 表示 plan 已生成');
  });

  it('documents Ambient Resume probe and managed project instructions', async () => {
    const en = await fs.readFile('README.md', 'utf-8');
    const zh = await fs.readFile('README-zh.md', 'utf-8');

    expect(en).toContain('comet resume-probe [path]');
    expect(en).toContain('managed block');
    expect(en).toContain('<comet-ambient-resume>');
    expect(en).toContain('preserving user-authored rules');
    expect(zh).toContain('comet resume-probe [path]');
    expect(zh).toContain('managed block');
    expect(zh).toContain('<comet-ambient-resume>');
    expect(zh).toContain('保留用户已有规则');
  });

  it('documents status and doctor as diagnostics-aware user commands', async () => {
    const readme = await fs.readFile('README.md', 'utf-8');

    expect(readme).toContain('runtime mode');
    expect(readme).toContain('current step');
    expect(readme).toContain('diagnostic');
  });

  it('keeps English and Chinese README feature summaries aligned', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf-8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');

    expect(readmeZh).toContain('Skill 平台');
    expect(readmeEn).toContain('Skill platform');
  });

  it('keeps the documented Node.js requirement aligned with package engines', async () => {
    const packageJson = JSON.parse(await fs.readFile('package.json', 'utf-8')) as {
      engines: { node: string };
    };
    const match = packageJson.engines.node.match(/^>=(\d+)/);
    expect(match).not.toBeNull();
    const minimumMajor = match![1];
    const [readmeEn, readmeZh, contributingEn, contributingZh] = await Promise.all([
      fs.readFile('README.md', 'utf-8'),
      fs.readFile('README-zh.md', 'utf-8'),
      fs.readFile('CONTRIBUTING.md', 'utf-8'),
      fs.readFile('CONTRIBUTING-zh.md', 'utf-8'),
    ]);

    expect(readmeEn).toContain(`Node.js ${minimumMajor}+`);
    expect(readmeZh).toContain(`Node.js ${minimumMajor}+`);
    expect(contributingEn).toContain(`Node.js \`>=${minimumMajor}\``);
    expect(contributingZh).toContain(`Node.js \`>=${minimumMajor}\``);
  });

  it('highlights the current release candidate and links the website changelog', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf-8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');

    for (const version of ['0.4.0-rc.1', '0.4.0-beta.7', '0.4.0-beta.1', '0.3.9']) {
      expect(readmeEn).toContain(`**${version}**`);
      expect(readmeZh).toContain(`**${version}**`);
    }
    expect(readmeEn).toContain('https://docs.comet.rpamis.com/en/changelog');
    expect(readmeZh).toContain('https://docs.comet.rpamis.com/zh/changelog');
  });

  it('documents the compact current project configuration in both languages', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf-8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');
    const configEn = readmeEn.split('### Project configuration')[1]?.split('## Support')[0] ?? '';
    const configZh = readmeZh.split('### 项目配置')[1]?.split('## 对OpenClaw')[0] ?? '';
    const managedFields = [
      'schema: comet.project.v1',
      'default_workflow: native',
      'workflows: [native, classic]',
      'ambient_resume: true',
      'memory:',
      'learning: true',
      'retrieval: true',
      'knowledge:',
      'provider: local',
      'hook:',
      'allow_paths: []',
      'native:',
      'artifact_root: docs',
      'clarification_mode: batch',
      'archive_confirmation: automatic',
      'max_verify_failures: 5',
      'classic:',
      'artifact_layout: docs',
      'context_compression: off',
      'review_mode: standard',
      'auto_transition: true',
    ];

    for (const field of managedFields) {
      expect(configEn).toContain(field);
      expect(configZh).toContain(field);
    }
    expect(configEn).toContain('language: en');
    expect(configZh).toContain('language: zh-CN');
    expect(configEn).toContain('Cloud Knowledge and self-hosted PR');
    expect(configZh).toContain('云端知识、私有化 PR');
    expect(configEn).not.toContain('snapshot:');
    expect(configZh).not.toContain('snapshot:');
    expect(configZh).not.toContain('远端知识');
    expect(configZh).not.toContain('仓库自有 PR');
  });

  it('keeps the bilingual Supervisor showcase backed by repository assets', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf-8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');
    const assets = [
      'supervisor-codex.mp4',
      'supervisor-codex-preview.png',
      'supervisor-claude-code.mp4',
      'supervisor-claude-code-preview.png',
    ];

    for (const asset of assets) {
      await expect(fs.stat(`img/${asset}`)).resolves.toBeDefined();
      const url = `https://github.com/rpamis/comet/blob/master/img/${asset}`;
      expect(readmeEn).toContain(url);
      expect(readmeZh).toContain(url);
    }
  });

  it('documents Native and Classic skills and keeps both project structures folded', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf-8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');
    const skillsEn = readmeEn.split('### Comet Skills')[1]?.split('</details>')[0] ?? '';
    const skillsZh = readmeZh.split('### Comet 技能')[1]?.split('</details>')[0] ?? '';

    expect(skillsEn).toContain('| `/comet-native`');
    expect(skillsEn).toContain('| `/comet-classic`');
    expect(skillsZh).toContain('| `/comet-native`');
    expect(skillsZh).toContain('| `/comet-classic`');
    expect(readmeEn).toContain('<summary>Native project structure');
    expect(readmeEn).toContain('<summary>Classic project structure');
    expect(readmeZh).toContain('<summary>Native 项目结构');
    expect(readmeZh).toContain('<summary>Classic 项目结构');
    expect(readmeEn).toContain('<summary>View the Native phase flow');
    expect(readmeEn).toContain('<summary>View Native state and artifacts');
    expect(readmeEn).toContain('<summary>View Native reliability and recovery');
    expect(readmeZh).toContain('<summary>查看 Native 阶段流程');
    expect(readmeZh).toContain('<summary>查看 Native 状态与产物');
    expect(readmeZh).toContain('<summary>查看 Native 可靠性与恢复');
  });

  it('documents task-first paths for comet-any and eval without making Bundle CLI the default user path', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf-8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');

    expect(readmeEn).toContain('Create or optimize a reusable Skill');
    expect(readmeEn).toContain('`/comet-any` is an optional Skill creation and composition path');
    expect(readmeEn).toContain('`comet eval`');
    expect(readmeEn).toContain('`comet creator`');
    expect(readmeEn).toContain('`comet publish`');
    expect(readmeEn).toContain('`comet creator status` / `comet creator next`');
    expect(readmeEn).toContain('`comet publish distribute --preview`');
    expect(readmeEn).toContain('stable composed Skill');
    expect(readmeEn).toContain('Advanced Bundle backend');
    expect(readmeEn).toContain('Advanced Engine Run');
    expect(readmeEn).toContain('`comet skill run` / `comet skill continue`');
    expect(readmeEn).toContain('Skill creation guide');
    expect(readmeZh).toContain('创建或优化可复用 Skill');
    expect(readmeZh).toContain('`/comet-any` 是可选的 Skill 创建与组合路径');
    expect(readmeZh).toContain('`comet eval`');
    expect(readmeZh).toContain('`comet creator`');
    expect(readmeZh).toContain('`comet publish`');
    expect(readmeZh).toContain('`comet creator status` / `comet creator next`');
    expect(readmeZh).toContain('`comet publish distribute --preview`');
    expect(readmeZh).toContain('稳定组合 Skill');
    expect(readmeZh).toContain('高级 Bundle 后端');
    expect(readmeZh).toContain('高级 Engine Run');
    expect(readmeZh).toContain('`comet skill run` / `comet skill continue`');
    expect(readmeZh).toContain('Skill 创建文档');
  });

  it('keeps Skill Creator backend commands in advanced operation docs', async () => {
    const guideEn = await fs.readFile('docs/operations/SKILL-CREATION.md', 'utf-8');
    const guideZh = await fs.readFile('docs/operations/SKILL-CREATION-ZH.md', 'utf-8');
    const ordinaryEn = guideEn.split('## Advanced backend reference')[0];
    const ordinaryZh = guideZh.split('## 高级后端参考')[0];

    expect(guideEn).toContain('## Advanced backend reference');
    expect(guideZh).toContain('## 高级后端参考');
    expect(guideEn).toContain('comet creator next <name>');
    expect(guideZh).toContain('comet creator next <name>');
    expect(ordinaryEn).not.toContain('comet bundle factory-guide');
    expect(ordinaryEn).not.toContain('comet bundle factory-propose');
    expect(ordinaryEn).not.toContain('comet bundle factory-init');
    expect(ordinaryEn).not.toContain('comet bundle list');
    expect(ordinaryEn).not.toContain('comet bundle status');
    expect(ordinaryZh).not.toContain('comet bundle factory-guide');
    expect(ordinaryZh).not.toContain('comet bundle factory-propose');
    expect(ordinaryZh).not.toContain('comet bundle factory-init');
    expect(ordinaryZh).not.toContain('comet bundle list');
    expect(ordinaryZh).not.toContain('comet bundle status');
  });
});
