import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  const target = path.join(root, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content);
}

async function makeMinimalRepository(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-architecture-lint-'));
  temporary.push(root);

  const layout = {
    assetsRoot: 'assets',
    manifestPath: 'assets/manifest.json',
    skillsRoots: {
      en: 'assets/skills',
      zh: 'assets/skills-zh',
    },
    classicRuntime: {
      entries: {
        state: 'domains/comet-classic/classic-state-entry.ts',
      },
      outputs: {
        state: 'assets/skills/comet/scripts/comet-state.mjs',
      },
    },
    allowedTopLevelEntries: [
      '.gitignore',
      'AGENTS.md',
      'CLAUDE.md',
      'app',
      'assets',
      'config',
      'domains',
      'eval',
      'package.json',
      'platform',
      'test',
    ],
    sourceRoots: ['app', 'domains', 'platform'],
    appModules: [],
    domainModules: ['comet-classic'],
    platformModules: [],
    scriptModules: [],
    testRoots: ['test'],
  };

  await Promise.all([
    fs.mkdir(path.join(root, 'app'), { recursive: true }),
    fs.mkdir(path.join(root, 'platform'), { recursive: true }),
    fs.mkdir(path.join(root, 'test'), { recursive: true }),
    fs.mkdir(path.join(root, 'assets', 'skills'), { recursive: true }),
    fs.mkdir(path.join(root, 'assets', 'skills-zh'), { recursive: true }),
    writeFile(root, 'config/repository-layout.json', JSON.stringify(layout, null, 2)),
    writeFile(root, 'assets/manifest.json', '{}\n'),
    writeFile(root, 'domains/comet-classic/classic-state-entry.ts', 'export {};\n'),
    writeFile(root, 'assets/skills/comet/scripts/comet-state.mjs', 'export {};\n'),
    writeFile(
      root,
      'package.json',
      JSON.stringify(
        {
          scripts: {
            lint: 'eslint app/ domains/ platform/ && pnpm run lint:architecture',
            'lint:architecture': 'node scripts/lint/architecture.mjs',
          },
        },
        null,
        2,
      ),
    ),
    writeFile(
      root,
      'AGENTS.md',
      '## 项目结构规范\n\n`app/` `domains/` `platform/`\n\nlegacy `test/ts` is banned.\n',
    ),
    writeFile(
      root,
      'CLAUDE.md',
      '## 项目结构规范\n\n`app/` `domains/` `platform/`\n\nlegacy `test/ts` is banned.\n',
    ),
  ]);

  return root;
}

describe('architecture lint', () => {
  it('ignores nested local cache directories listed in .gitignore', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', 'eval/.cache/\neval/**/.cache/\neval/**/.pytest*/\n');
    await Promise.all([
      writeFile(root, 'eval/.cache/langsmith-cc-plugin/src/index.ts', 'export {};\n'),
      writeFile(root, 'eval/eval/.cache/native-oracle/src/index.ts', 'export {};\n'),
      writeFile(root, 'eval/eval/.pytest-cache-controller/src/index.ts', 'export {};\n'),
      writeFile(root, 'eval/eval/.pytest_cache/src/index.ts', 'export {};\n'),
    ]);

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});
