import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

interface DependencyTestLayout {
  domainModules: string[];
  dependencyRules: {
    allowedDomainDependencies: Array<{ from: string; to: string }>;
    crossDomainEntrypoints: string[];
    compatibilityFacades: Array<{ facade: string; implementations: string[] }>;
    restrictedDependencies: Array<{ target: string; importers: string[]; reason: string }>;
  };
}

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
      'tsconfig.json',
    ],
    sourceRoots: ['app', 'domains', 'platform'],
    dependencyRules: {
      allowedDomainDependencies: [],
      compatibilityFacades: [],
      crossDomainEntrypoints: [],
      exceptions: [],
      pureModelModules: [],
      restrictedDependencies: [],
      workflowCoreModules: [],
    },
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
    writeFile(
      root,
      'tsconfig.json',
      JSON.stringify(
        {
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            target: 'ES2022',
          },
          include: ['app/**/*', 'domains/**/*', 'platform/**/*'],
        },
        null,
        2,
      ),
    ),
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
  it('ignores Git-ignored ZCode runtime files', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '.zcode\n');
    await writeFile(root, '.zcode/skills/comet/scripts/runtime.mjs', 'export {};\n');

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

  it('ignores LangSmith experiment logs without excluding LangSmith source', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', 'logs\n');
    await writeFile(
      root,
      'eval/langsmith/logs/experiments/run/artifacts/skill/scripts/runtime.mjs',
      'export {};\n',
    );

    const ignoredLog = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );

    expect(ignoredLog.stderr).toBe('');
    expect(ignoredLog.status).toBe(0);

    await writeFile(root, 'eval/langsmith/source.mjs', 'export {};\n');
    const realSource = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );

    expect(realSource.status).toBe(1);
    expect(realSource.stderr).toContain(
      'eval/langsmith/source.mjs is code outside an approved code root',
    );
  });

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

  it('rejects runtime dependency cycles and reports the dependency chain', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', 'logs\n');
    await writeFile(root, 'domains/comet-classic/a.ts', "import './b.js';\n");
    await writeFile(root, 'domains/comet-classic/b.ts', "import './a.js';\n");

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime dependency cycle:');
    expect(result.stderr).toContain('domains/comet-classic/a.ts');
    expect(result.stderr).toContain('domains/comet-classic/b.ts');
  });

  it('does not treat type-only import cycles as runtime dependency cycles', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'domains/comet-classic/a.ts',
      "import type { B } from './b.js';\nexport type A = B;\n",
    );
    await writeFile(
      root,
      'domains/comet-classic/b.ts',
      "import type { A } from './a.js';\nexport type B = A;\n",
    );

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

  it('does not treat inline type-only import and re-export cycles as runtime dependencies', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'domains/comet-classic/a.ts',
      "import { type B } from './b.js';\nexport { type B } from './b.js';\nexport type A = B;\n",
    );
    await writeFile(
      root,
      'domains/comet-classic/b.ts',
      "import { type A } from './a.js';\nexport { type A } from './a.js';\nexport type B = A;\n",
    );

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('rejects cycles connected through runtime re-exports', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(root, 'domains/comet-classic/a.ts', "export * from './b.js';\n");
    await writeFile(root, 'domains/comet-classic/b.ts', "export * from './a.js';\n");

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'domains/comet-classic/a.ts -> domains/comet-classic/b.ts -> domains/comet-classic/a.ts',
    );
  });

  it('rejects platform-to-domain and domain-to-app dependencies', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'platform/runtime.ts',
      "import '../domains/comet-classic/classic-state-entry.js';\n",
    );
    await writeFile(root, 'app/runtime.ts', 'export {};');
    await writeFile(root, 'domains/comet-classic/domain.ts', "import '../../app/runtime.js';\n");

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'platform/runtime.ts must not depend on domains/comet-classic/classic-state-entry.ts',
    );
    expect(result.stderr).toContain(
      'domains/comet-classic/domain.ts must not depend on app/runtime.ts',
    );
  });

  it('includes literal dynamic imports in the runtime dependency graph', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'domains/comet-classic/a.ts',
      "export async function load() { return import('./b.js'); }\n",
    );
    await writeFile(root, 'domains/comet-classic/b.ts', "import './a.js';\n");

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      {
        cwd: root,
        encoding: 'utf8',
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime dependency cycle:');
  });

  it('rejects Native dynamic imports of Classic and workflow imports of Entry', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(root, 'domains/comet-entry/index.ts', 'export {};\n');
    await writeFile(
      root,
      'domains/comet-classic/workflow.ts',
      "import '../comet-entry/index.js';\n",
    );
    await writeFile(
      root,
      'domains/comet-native/runtime.ts',
      "export async function load() { return import('../comet-classic/classic-state-entry.js'); }\n",
    );
    const layoutPath = path.join(root, 'config', 'repository-layout.json');
    const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')) as Record<string, unknown>;
    layout.domainModules = ['comet-classic', 'comet-entry', 'comet-native'];
    layout.dependencyRules = {
      exceptions: [],
      pureModelModules: [],
      workflowCoreModules: ['domains/comet-classic', 'domains/comet-native'],
    };
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'domains/comet-native/runtime.ts must not depend on domains/comet-classic/classic-state-entry.ts',
    );
    expect(result.stderr).toContain(
      'domains/comet-classic/workflow.ts must not depend on domains/comet-entry/index.ts',
    );
  });

  it('rejects platform dependencies from configured pure model modules', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'domains/comet-classic/model.ts',
      "import fs from 'node:fs';\nvoid fs;\n",
    );
    const layoutPath = path.join(root, 'config', 'repository-layout.json');
    const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')) as Record<string, unknown>;
    layout.dependencyRules = {
      exceptions: [],
      pureModelModules: ['domains/comet-classic/model.ts'],
      workflowCoreModules: [],
    };
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'domains/comet-classic/model.ts is a pure model and must not depend on node:fs',
    );
  });

  it('reports non-literal dynamic imports without guessing a target', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'domains/comet-classic/runtime.ts',
      'export async function load(target: string) { return import(target); }\n',
    );

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'domains/comet-classic/runtime.ts:1 has a dynamic import that cannot be resolved statically',
    );
  });

  it('resolves local imports written with Windows path separators', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(root, 'domains/comet-classic/a.ts', "import '.\\\\nested\\\\b.js';\n");
    await writeFile(root, 'domains/comet-classic/nested/b.ts', "import '../a.js';\n");

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime dependency cycle:');
  });

  it('allows only exact dependency exceptions with a reason', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'platform/adapter.ts',
      "import '../domains/comet-classic/classic-state-entry.js';\n",
    );
    const layoutPath = path.join(root, 'config', 'repository-layout.json');
    const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')) as Record<string, unknown>;
    layout.dependencyRules = {
      exceptions: [
        {
          from: 'platform/adapter.ts',
          to: 'domains/comet-classic/classic-state-entry.ts',
          reason: 'Legacy edge retained while the adapter is migrated.',
        },
      ],
      pureModelModules: [],
      workflowCoreModules: [],
    };
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));

    const allowed = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );
    expect(allowed.stderr).toBe('');
    expect(allowed.status).toBe(0);

    (layout.dependencyRules as { exceptions: Array<Record<string, string>> }).exceptions[0].from =
      'platform/*';
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));
    const wildcard = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );
    expect(wildcard.status).toBe(1);
    expect(wildcard.stderr).toContain('dependency exception paths must be exact files');
  });

  it('does not let a dependency exception hide a runtime cycle', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'platform/adapter.ts',
      "import '../domains/comet-classic/classic-state-entry.js';\n",
    );
    await writeFile(
      root,
      'domains/comet-classic/classic-state-entry.ts',
      "import '../../platform/adapter.js';\n",
    );
    const layoutPath = path.join(root, 'config', 'repository-layout.json');
    const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')) as Record<string, unknown>;
    layout.dependencyRules = {
      exceptions: [
        {
          from: 'platform/adapter.ts',
          to: 'domains/comet-classic/classic-state-entry.ts',
          reason: 'Legacy platform edge retained temporarily.',
        },
      ],
      pureModelModules: [],
      workflowCoreModules: [],
    };
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('runtime dependency cycle:');
  });

  it('rejects an internal implementation that imports its compatibility facade', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'domains/comet-classic/facade.ts',
      "export * from './implementation.js';\n",
    );
    await writeFile(root, 'domains/comet-classic/implementation.ts', "import './facade.js';\n");
    const layoutPath = path.join(root, 'config', 'repository-layout.json');
    const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')) as Record<string, unknown>;
    layout.dependencyRules = {
      compatibilityFacades: [
        {
          facade: 'domains/comet-classic/facade.ts',
          implementations: ['domains/comet-classic/implementation.ts'],
        },
      ],
      exceptions: [],
      pureModelModules: [],
      workflowCoreModules: [],
    };
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'domains/comet-classic/implementation.ts must not depend on compatibility facade domains/comet-classic/facade.ts',
    );
  });

  it('allows only declared domain dependencies through declared cross-domain entrypoints', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(root, 'domains/shared/index.ts', 'export const shared = true;\n');
    await writeFile(
      root,
      'domains/comet-classic/consumer.ts',
      "import { shared } from '../shared/index.js';\nexport { shared };\n",
    );
    const layoutPath = path.join(root, 'config', 'repository-layout.json');
    const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')) as DependencyTestLayout;
    layout.domainModules = ['comet-classic', 'shared'];
    layout.dependencyRules.allowedDomainDependencies = [{ from: 'comet-classic', to: 'shared' }];
    layout.dependencyRules.crossDomainEntrypoints = ['domains/shared/index.ts'];
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));

    const allowed = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );
    expect(allowed.stderr).toBe('');
    expect(allowed.status).toBe(0);

    layout.dependencyRules.allowedDomainDependencies = [];
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));
    const undeclared = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );
    expect(undeclared.status).toBe(1);
    expect(undeclared.stderr).toContain(
      'domains/comet-classic/consumer.ts must not add undeclared domain dependency comet-classic -> shared',
    );

    layout.dependencyRules.allowedDomainDependencies = [{ from: 'comet-classic', to: 'shared' }];
    layout.dependencyRules.crossDomainEntrypoints = [];
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));
    const privateImport = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );
    expect(privateImport.status).toBe(1);
    expect(privateImport.stderr).toContain(
      'domains/comet-classic/consumer.ts must use a declared cross-domain entrypoint for domains/shared/index.ts',
    );
  });

  it('keeps compatibility facades declarative', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(
      root,
      'domains/comet-classic/facade.ts',
      "export * from './implementation.js';\nexport const runtimeValue = 1;\n",
    );
    await writeFile(root, 'domains/comet-classic/implementation.ts', 'export const value = 1;\n');
    const layoutPath = path.join(root, 'config', 'repository-layout.json');
    const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')) as DependencyTestLayout;
    layout.dependencyRules.compatibilityFacades = [
      {
        facade: 'domains/comet-classic/facade.ts',
        implementations: ['domains/comet-classic/implementation.ts'],
      },
    ];
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'compatibility facade domains/comet-classic/facade.ts must contain only imports and re-exports',
    );
  });

  it('requires model modules to be registered as pure models', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(root, 'domains/comet-classic/order-model.ts', 'export const order = {};\n');

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'domains/comet-classic/order-model.ts must be registered in dependencyRules.pureModelModules',
    );
  });

  it('provides stable JSON diagnostics for agent tooling', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(root, 'domains/shared/index.ts', 'export const shared = true;\n');
    await writeFile(
      root,
      'domains/comet-classic/consumer.ts',
      "import { shared } from '../shared/index.js';\nexport { shared };\n",
    );
    const layoutPath = path.join(root, 'config', 'repository-layout.json');
    const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')) as DependencyTestLayout;
    layout.domainModules = ['comet-classic', 'shared'];
    layout.dependencyRules.crossDomainEntrypoints = ['domains/shared/index.ts'];
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs'), '--json'],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      violations: [
        {
          code: 'ARCH_DOMAIN_DEPENDENCY',
        },
      ],
    });
  });

  it('restricts capability-owning dependencies to reviewed importers', async () => {
    const root = await makeMinimalRepository();
    await writeFile(root, '.gitignore', '\n');
    await writeFile(root, 'domains/comet-classic/lock.ts', 'export const lock = true;\n');
    await writeFile(
      root,
      'domains/comet-classic/approved.ts',
      "import { lock } from './lock.js';\nexport { lock };\n",
    );
    await writeFile(
      root,
      'domains/comet-classic/unreviewed.ts',
      "import { lock } from './lock.js';\nexport { lock };\n",
    );
    const layoutPath = path.join(root, 'config', 'repository-layout.json');
    const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8')) as DependencyTestLayout;
    layout.dependencyRules.restrictedDependencies = [
      {
        target: 'domains/comet-classic/lock.ts',
        importers: ['domains/comet-classic/approved.ts'],
        reason: 'Only reviewed mutation entrypoints acquire the lock.',
      },
    ];
    await fs.writeFile(layoutPath, JSON.stringify(layout, null, 2));

    const result = spawnSync(
      process.execPath,
      [path.resolve('scripts', 'lint', 'architecture.mjs')],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'domains/comet-classic/unreviewed.ts must not depend on restricted module domains/comet-classic/lock.ts',
    );
  });
});
