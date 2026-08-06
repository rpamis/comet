import { describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';

const CLASSIC_SKILLS = [
  'comet-classic',
  'comet-open',
  'comet-design',
  'comet-build',
  'comet-verify',
  'comet-archive',
  'comet-hotfix',
  'comet-tweak',
];

const LANGUAGE_CASES = [
  {
    label: 'Chinese',
    languageRoot: 'skills-zh',
    ruleFiles: ['comet-phase-guard.md', 'comet-workflow-guard.md'],
    allowedLayoutDescriptionLines: new Set([
      '- 新 Classic 项目默认使用 `docs/openspec/`。',
      '- 缺少 `classic.artifact_layout` 时默认使用 `docs/openspec/`；`comet update` 检测到已有根目录 `openspec/` 产物时会显式补为 `legacy`，不会移动产物。',
    ]),
  },
  {
    label: 'English',
    languageRoot: 'skills',
    ruleFiles: ['comet-phase-guard.en.md', 'comet-workflow-guard.en.md'],
    allowedLayoutDescriptionLines: new Set([
      '- New Classic projects default to `docs/openspec/`.',
      '- A missing `classic.artifact_layout` defaults to `docs/openspec/`. When `comet update` detects existing root-level `openspec/` artifacts, it explicitly backfills `legacy` without moving them.',
    ]),
  },
] as const;

const BARE_OPENSPEC_COMMAND =
  /(?<!comet classic )\bopenspec\s+(?:--version|<args\.\.\.>|[a-z][a-z0-9-]*)/u;
const FIXED_OPENSPEC_PATH = /openspec\//u;
const EXTERNAL_OPENSPEC_SKILL_INVOCATION = /(?:加载|load)[^`\r\n]*`openspec-[a-z0-9-]+`/iu;
const EXTERNAL_OPENSPEC_OVERRIDE = /external-openspec-skill-override/u;

async function markdownFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const resolved = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return markdownFiles(resolved);
      }
      return entry.isFile() && entry.name.endsWith('.md') ? [resolved] : [];
    }),
  );
  return files.flat();
}

async function classicGuidanceFiles(
  languageRoot: string,
  ruleFiles: readonly string[],
): Promise<string[]> {
  const assetRoot = path.resolve('assets', languageRoot);
  const files = CLASSIC_SKILLS.map((skill) => path.join(assetRoot, skill, 'SKILL.md'));
  files.push(...(await markdownFiles(path.join(assetRoot, 'comet-classic', 'reference'))));
  files.push(...(await markdownFiles(path.join(assetRoot, 'comet-any'))));
  files.push(...ruleFiles.map((rule) => path.resolve('assets', 'skills', 'comet', 'rules', rule)));
  return files;
}

describe('Classic layout Skill contract', () => {
  it.each(['skills-zh', 'skills'])(
    'ships the layout resolver and adapter protocol in %s',
    async (languageRoot) => {
      const reference = await fs.readFile(
        path.resolve('assets', languageRoot, 'comet-classic', 'reference', 'classic-layout.md'),
        'utf8',
      );
      expect(reference).toContain('comet classic root show');
      expect(reference).toContain('comet classic openspec -- <args...>');
      expect(reference).toContain('openSpecRoot');
      expect(reference).toContain('superpowersRoot');
      expect(reference).toContain('comet classic root move docs --dry-run');

      for (const skill of CLASSIC_SKILLS) {
        const source = await fs.readFile(
          path.resolve('assets', languageRoot, skill, 'SKILL.md'),
          'utf8',
        );
        expect(source, skill).toContain('comet-classic/reference/classic-layout.md');
      }
    },
  );

  describe.each(LANGUAGE_CASES)(
    '$label Comet-owned guidance',
    ({ languageRoot, ruleFiles, allowedLayoutDescriptionLines }) => {
      it('uses the adapter and resolver-backed logical roots everywhere', async () => {
        const files = await classicGuidanceFiles(languageRoot, ruleFiles);
        const violations: string[] = [];

        for (const file of files) {
          const source = await fs.readFile(file, 'utf8');
          const isLayoutReference =
            path.basename(file) === 'classic-layout.md' &&
            path.basename(path.dirname(file)) === 'reference';

          source.split(/\r?\n/u).forEach((line, index) => {
            const lineNumber = index + 1;
            if (BARE_OPENSPEC_COMMAND.test(line)) {
              violations.push(`${path.relative(process.cwd(), file)}:${lineNumber}: bare command`);
            }
            if (
              FIXED_OPENSPEC_PATH.test(line) &&
              !(
                isLayoutReference &&
                (allowedLayoutDescriptionLines as ReadonlySet<string>).has(line)
              )
            ) {
              violations.push(`${path.relative(process.cwd(), file)}:${lineNumber}: fixed path`);
            }
          });
        }

        expect(violations).toEqual([]);
      });

      it('overrides every external OpenSpec Skill command and cwd instruction locally', async () => {
        const files = await classicGuidanceFiles(languageRoot, ruleFiles);
        const violations: string[] = [];

        for (const file of files) {
          const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/u);
          lines.forEach((line, index) => {
            if (!EXTERNAL_OPENSPEC_SKILL_INVOCATION.test(line)) return;
            const localInstructions = lines.slice(index + 1, index + 6).join('\n');
            if (!EXTERNAL_OPENSPEC_OVERRIDE.test(localInstructions)) {
              violations.push(
                `${path.relative(process.cwd(), file)}:${index + 1}: missing local external Skill override`,
              );
            }
          });
        }

        expect(violations).toEqual([]);
      });
    },
  );
});
