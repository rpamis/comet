import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';

const readmes = ['README.md', 'README-zh.md'];

describe('README assets', () => {
  it.each(readmes)('uses npm-friendly absolute image URLs in %s', async (readmePath) => {
    const content = await fs.readFile(readmePath, 'utf-8');

    expect(content).not.toMatch(/\b(?:src|srcset)=["'](?:\.\/)?img\//);
    expect(content).toContain('https://github.com/rpamis/comet/blob/master/img/');
  });

  it('keeps the README focused and starts Quick Start with project initialization', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf-8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');

    for (const heading of ['## Commands', '## Skills', '## Workflow', '## Project Structure']) {
      expect(readmeEn).not.toContain(heading);
    }
    for (const heading of ['## CLI命令', '## 技能', '## 工作流', '## 项目结构']) {
      expect(readmeZh).not.toContain(heading);
    }

    const quickStartEn = readmeEn.split('## Quick Start')[1]?.split('## Support')[0] ?? '';
    const quickStartZh = readmeZh.split('## 快速开始')[1]?.split('## 对OpenClaw')[0] ?? '';
    expect(quickStartEn).toContain('cd your-project');
    expect(quickStartEn).toContain('comet init');
    expect(quickStartEn).not.toContain('comet init --scope global');
    expect(quickStartZh).toContain('cd your-project');
    expect(quickStartZh).toContain('comet init');
    expect(quickStartZh).not.toContain('comet init --scope global');
    const { PLATFORMS } = await import('../../platform/install/platforms.js');
    expect(readmeEn).toContain(`\`comet init\` supports ${PLATFORMS.length} AI coding platforms:`);
    expect(readmeZh).toContain(`\`comet init\` 支持 ${PLATFORMS.length} 个 AI 编码平台：`);
    expect(readmeEn).toContain('Prime Agent');
    expect(readmeZh).toContain('Prime Agent');
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
    const match = packageJson.engines.node.match(/^\^(\d+)\.(\d+)\.0 \|\| >=(\d+)\.0\.0$/);
    expect(match).not.toBeNull();
    const minimumMajor = match![1];
    const minimumMinor = match![2];
    const nextMajor = match![3];
    const [readmeEn, readmeZh, contributingEn, contributingZh] = await Promise.all([
      fs.readFile('README.md', 'utf-8'),
      fs.readFile('README-zh.md', 'utf-8'),
      fs.readFile('CONTRIBUTING.md', 'utf-8'),
      fs.readFile('CONTRIBUTING-zh.md', 'utf-8'),
    ]);

    expect(readmeEn).toContain(
      `Node.js ${minimumMajor}.${minimumMinor}+ (${minimumMajor}.x), or ${nextMajor}+`,
    );
    expect(readmeZh).toContain(
      `Node.js ${minimumMajor}.${minimumMinor}+（${minimumMajor}.x），或 ${nextMajor}+`,
    );
    const lockfile = JSON.parse(await fs.readFile('package-lock.json', 'utf-8'));
    const developmentRange = lockfile.packages['node_modules/jsdom'].engines.node;
    expect(contributingEn).toContain(`Node.js \`${developmentRange}\``);
    expect(contributingZh).toContain(`Node.js \`${developmentRange}\``);
  });

  it('highlights the SDK release without retaining prerelease announcements', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf-8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');

    expect(readmeEn).toContain('**Comet 0.5.0:');
    expect(readmeZh).toContain('**Comet 0.5.0：');
    for (const [readme, language] of [
      [readmeEn, 'en'],
      [readmeZh, 'zh'],
    ]) {
      const announcement = readme.split('> [!IMPORTANT]')[1]?.split('> **Comet 0.4.0**')[0];
      expect(announcement).toContain('**Comet SDK**');
      expect(announcement).toContain('**Comet Any**');
      expect(announcement).toContain(`https://docs.comet.rpamis.com/${language}/eval/applications`);
      expect(announcement).toContain(`https://docs.comet.rpamis.com/${language}/sdk/distribution`);
      expect(announcement).toContain(
        `https://docs.comet.rpamis.com/${language}/dashboard/overview`,
      );
    }
    for (const version of ['0.4.0-rc.1', '0.4.0-beta.7', '0.4.0-beta.1', '0.3.9']) {
      expect(readmeEn).not.toContain(`**${version}**`);
      expect(readmeZh).not.toContain(`**${version}**`);
    }
    expect(readmeEn).toContain('https://docs.comet.rpamis.com/en/changelog');
    expect(readmeZh).toContain('https://docs.comet.rpamis.com/zh/changelog');
  });

  it('links memory and knowledge guides and uses the localized Dashboard screenshots', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf-8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');
    for (const [readme, language, suffix, heading] of [
      [readmeEn, 'en', '', '## Why Comet'],
      [readmeZh, 'zh', '-ZH', '## 为什么需要 Comet'],
    ]) {
      const features = readme.split(heading)[1]?.split('## Supervisor Change')[0] ?? '';
      for (const guide of ['PERSONAL-MEMORY', 'PROJECT-KNOWLEDGE']) {
        const guidePath = `docs/operations/${guide}${suffix}.md`;
        expect(features).toContain(guidePath);
        await expect(fs.stat(guidePath)).resolves.toBeDefined();
      }
      expect(readme).toContain('### Comet Dashboard');
      const screenshot = `img/dashboard-workflow-${language}.png`;
      expect(readme).toContain(`https://github.com/rpamis/comet/blob/master/${screenshot}`);
      await expect(fs.stat(screenshot)).resolves.toBeDefined();
    }
  });

  it('keeps the bilingual Supervisor showcase backed by repository assets', async () => {
    const readmeEn = await fs.readFile('README.md', 'utf8');
    const readmeZh = await fs.readFile('README-zh.md', 'utf-8');
    const { README_VIDEOS } = await import('../../scripts/release/npm-readme.mjs');

    for (const video of README_VIDEOS) {
      const url = `https://github.com/user-attachments/assets/${video.attachmentId}`;
      expect(readmeEn).toContain(url);
      expect(readmeZh).toContain(url);
      await expect(fs.stat(`img/${video.name}.mp4`)).resolves.toBeDefined();
      // Preview images are not referenced by the GitHub READMEs: the
      // npm-readme transform swaps them in when packing for npmjs.com, where
      // user-attachment videos cannot render as players.
      await expect(fs.stat(`img/${video.name}-preview.png`)).resolves.toBeDefined();
    }
    for (const readme of [readmeEn, readmeZh]) {
      expect(readme).not.toMatch(/!\[[^\]]*\]\(img\/[a-z0-9-]+\.mp4\)/u);
      expect(readme).not.toContain('-preview.png');
    }
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
