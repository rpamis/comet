import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = path.resolve('.');

interface MirroredRule {
  readonly id: string;
  readonly agents: string;
  readonly claude: string;
}

const mirroredRules: readonly MirroredRule[] = [
  { id: 'app-layer', agents: 'app/AGENTS.md', claude: '.claude/rules/11-app-layer.md' },
  { id: 'tests', agents: 'test/AGENTS.md', claude: '.claude/rules/12-tests.md' },
  {
    id: 'classic-runtime',
    agents: 'domains/comet-classic/AGENTS.md',
    claude: '.claude/rules/20-classic-runtime.md',
  },
  {
    id: 'native-runtime',
    agents: 'domains/comet-native/AGENTS.md',
    claude: '.claude/rules/21-native-runtime.md',
  },
  {
    id: 'entry-router',
    agents: 'domains/comet-entry/AGENTS.md',
    claude: '.claude/rules/22-entry-and-hook-router.md',
  },
  {
    id: 'platform-lifecycle',
    agents: 'platform/AGENTS.md',
    claude: '.claude/rules/30-platform-lifecycle.md',
  },
  {
    id: 'assets-and-skills',
    agents: 'assets/AGENTS.md',
    claude: '.claude/rules/40-assets-and-skills.md',
  },
  {
    id: 'documentation',
    agents: 'docs/AGENTS.md',
    claude: '.claude/rules/41-documentation.md',
  },
  {
    id: 'dashboard',
    agents: 'domains/dashboard/AGENTS.md',
    claude: '.claude/rules/50-dashboard.md',
  },
  { id: 'eval', agents: 'eval/AGENTS.md', claude: '.claude/rules/60-eval.md' },
  {
    id: 'project-knowledge',
    agents: 'domains/project-knowledge/AGENTS.md',
    claude: '.claude/rules/70-project-knowledge.md',
  },
  {
    id: 'release',
    agents: 'scripts/release/AGENTS.md',
    claude: '.claude/rules/90-release.md',
  },
];

function removeFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n\r?\n/u, '');
}

describe('development agent rules', () => {
  it('keeps the shared root development rules aligned', async () => {
    const [agents, claude] = await Promise.all([
      fs.readFile(path.join(repositoryRoot, 'AGENTS.md'), 'utf8'),
      fs.readFile(path.join(repositoryRoot, 'CLAUDE.md'), 'utf8'),
    ]);

    const sharedDevelopmentRules = (content: string): string => {
      const start = content.indexOf('## 开发工作区保护');
      const end = content.indexOf('## 测试', start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return content.slice(start, end).replaceAll('\r\n', '\n');
    };

    expect(sharedDevelopmentRules(claude)).toBe(sharedDevelopmentRules(agents));
  });

  it('keeps Codex directory instructions and Claude path rules aligned', async () => {
    for (const rule of mirroredRules) {
      const [agents, claude] = await Promise.all([
        fs.readFile(path.join(repositoryRoot, rule.agents), 'utf8'),
        fs.readFile(path.join(repositoryRoot, rule.claude), 'utf8'),
      ]);

      const marker = `<!-- comet-development-rule:${rule.id} -->`;
      expect(agents).toContain(marker);
      expect(claude).toContain(marker);
      expect(removeFrontmatter(claude).replaceAll('\r\n', '\n')).toBe(
        agents.replaceAll('\r\n', '\n'),
      );
    }
  });

  it('loads the shared Claude rules unconditionally', async () => {
    for (const [file, id] of [
      ['.claude/rules/01-workspace-safety.md', 'workspace-safety'],
      ['.claude/rules/02-evidence-and-verification.md', 'evidence-and-verification'],
    ] as const) {
      const content = await fs.readFile(path.join(repositoryRoot, file), 'utf8');
      expect(content.startsWith('---')).toBe(false);
      expect(content).toContain(`<!-- comet-development-rule:${id} -->`);
    }
  });

  it('keeps Codex command policies in Starlark rule files', async () => {
    for (const file of ['.codex/rules/01-destructive-git.rules', '.codex/rules/02-publish.rules']) {
      const content = await fs.readFile(path.join(repositoryRoot, file), 'utf8');
      expect(content).toContain('prefix_rule(');
      expect(content).toContain('match = [');
      expect(file.endsWith('.rules')).toBe(true);
    }
  });

  it('keeps repository-only agent rules out of the npm package', async () => {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { files?: string[] };

    expect(packageJson.files).toContain('!assets/AGENTS.md');
    expect(packageJson.files).not.toContain('eval/AGENTS.md');
  });
});
