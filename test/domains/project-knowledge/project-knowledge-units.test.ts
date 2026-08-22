import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  LocalProjectKnowledgeProvider,
  ProjectKnowledgeUnitRepository,
  extractDeterministicProjectUnits,
  expandProjectKnowledgeRelations,
  parseProjectKnowledgeUnit,
  renderProjectKnowledgeUnit,
  validateProjectKnowledgeUnitSources,
  type ProjectKnowledgeUnit,
} from '../../../domains/project-knowledge/index.js';

async function temporaryRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function maintainedUnit(source = 'src/main.ts'): ProjectKnowledgeUnit {
  return {
    schema: 'comet.project-knowledge.unit.v1',
    id: 'unit-main-flow',
    kind: 'module-overview',
    state: 'active',
    origin: 'maintained',
    title: '主流程模块',
    summary: '主流程负责协调入口与验证。',
    applicablePaths: ['src/'],
    operations: ['implement', 'verify'],
    conclusions: [
      {
        text: '修改入口后必须同步验证适配器。',
        sources: [{ source, anchor: 'main' }],
      },
    ],
    relations: [
      {
        type: 'validated-by',
        target: 'unit-build-test',
        sources: [{ source: 'package.json', anchor: 'scripts' }],
      },
    ],
    verification: [{ command: 'pnpm test', expected: 'pass' }],
  };
}

describe('project knowledge units', () => {
  test('parses and renders the shared unit format without losing sources', () => {
    const unit = maintainedUnit();
    const parsed = parseProjectKnowledgeUnit(
      renderProjectKnowledgeUnit(unit),
      'docs/comet/knowledge/units/main.md',
    );
    expect(parsed).toEqual(unit);
    expect(renderProjectKnowledgeUnit(unit)).toContain('schema: comet.project-knowledge.unit.v1');
    expect(renderProjectKnowledgeUnit(unit)).toContain('## 来源');
  });

  test('keeps maintained files in the project and generated files in the cache', async () => {
    const root = await temporaryRoot('comet-project-knowledge-units-');
    const cache = await temporaryRoot('comet-project-knowledge-units-cache-');
    const repository = new ProjectKnowledgeUnitRepository({ projectRoot: root, cacheRoot: cache });
    try {
      await repository.writeMaintained(maintainedUnit());
      await repository.writeGenerated({
        ...maintainedUnit(),
        id: 'generated-main',
        origin: 'generated',
      });
      await repository.writeGenerated({
        ...maintainedUnit(),
        id: 'generated-draft',
        origin: 'generated',
        state: 'draft',
      });
      const maintained = await repository.list({ origin: 'maintained' });
      const generated = await repository.list({ origin: 'generated' });
      expect(maintained.map((unit) => unit.id)).toEqual(['unit-main-flow']);
      expect(generated.map((unit) => unit.id)).toEqual(['generated-draft', 'generated-main']);
      expect((await repository.list({ state: 'active' })).map((unit) => unit.id)).toEqual([
        'generated-main',
        'unit-main-flow',
      ]);
      expect(
        await fs.stat(path.join(root, 'docs/comet/knowledge/units/unit-main-flow.md')),
      ).toBeTruthy();
      expect(
        await fs.stat(path.join(cache, 'project-knowledge', 'units', 'generated-main.md')),
      ).toBeTruthy();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cache, { recursive: true, force: true });
    }
  });

  test('extracts project-map, module-overview, and build-test deterministically', async () => {
    const root = await temporaryRoot('comet-project-knowledge-extractor-');
    try {
      await fs.mkdir(path.join(root, 'src', 'feature'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'package.json'),
        JSON.stringify({ scripts: { build: 'tsc', test: 'vitest run' } }),
      );
      await fs.writeFile(
        path.join(root, 'src', 'feature', 'index.ts'),
        "export { run } from './run.js';\nimport { check } from '../check.js';\n",
      );
      await fs.writeFile(
        path.join(root, 'src', 'feature', 'run.ts'),
        'export function run() { return true; }\n',
      );
      const units = await extractDeterministicProjectUnits({ projectRoot: root });
      expect(units.map((unit) => unit.kind)).toEqual([
        'project-map',
        'module-overview',
        'build-test',
      ]);
      expect(units.find((unit) => unit.kind === 'build-test')?.summary).toContain('pnpm run build');
      expect(units.find((unit) => unit.kind === 'module-overview')?.conclusions[0]?.text).toContain(
        'feature',
      );
      expect(units.every((unit) => unit.origin === 'generated' && unit.state === 'draft')).toBe(
        true,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  test('rejects missing, changed, and outside sources with bounded diagnostics', async () => {
    const root = await temporaryRoot('comet-project-knowledge-sources-');
    const outside = await temporaryRoot('comet-project-knowledge-outside-');
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      await fs.writeFile(path.join(root, 'package.json'), '{"scripts":{"test":"vitest run"}}\n');
      const unit = maintainedUnit();
      const valid = await validateProjectKnowledgeUnitSources(unit, { projectRoot: root });
      expect(valid.valid).toBe(true);
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = false;\n');
      const changed = await validateProjectKnowledgeUnitSources(unit, { projectRoot: root });
      expect(changed.valid).toBe(false);
      const outsideUnit = {
        ...unit,
        conclusions: [
          {
            ...unit.conclusions[0],
            sources: [
              { source: 'src/main.ts', anchor: 'main' },
              { source: path.join(outside, 'secret.txt'), anchor: 'secret' },
            ],
          },
        ],
      };
      const rejected = await validateProjectKnowledgeUnitSources(outsideUnit, {
        projectRoot: root,
      });
      expect(rejected.valid).toBe(false);
      expect(rejected.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
        expect.arrayContaining(['source-changed', 'source-path']),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  test('persists generated source state so a new process rejects changed sources', async () => {
    const root = await temporaryRoot('comet-project-knowledge-source-state-');
    const cache = await temporaryRoot('comet-project-knowledge-source-state-cache-');
    try {
      await fs.mkdir(path.join(root, 'src'), { recursive: true });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = true;\n');
      await fs.writeFile(path.join(root, 'package.json'), '{"scripts":{"test":"vitest run"}}\n');
      const first = new ProjectKnowledgeUnitRepository({ projectRoot: root, cacheRoot: cache });
      await first.writeGenerated({
        ...maintainedUnit(),
        origin: 'generated',
        id: 'generated-state',
      });
      await fs.writeFile(path.join(root, 'src', 'main.ts'), 'export const main = false;\n');
      const second = new ProjectKnowledgeUnitRepository({ projectRoot: root, cacheRoot: cache });
      const persisted = await second.read('generated-state');
      expect(persisted?.sourceVersions?.length).toBeGreaterThan(0);
      const validation = await validateProjectKnowledgeUnitSources(persisted!, {
        projectRoot: root,
      });
      expect(validation.valid).toBe(false);
      expect(validation.diagnostics.map((entry) => entry.code)).toContain('source-changed');
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cache, { recursive: true, force: true });
    }
  });

  test('expands only sourced one-hop relations from already matched units', () => {
    const matched = maintainedUnit();
    const related = {
      ...maintainedUnit('package.json'),
      id: 'unit-build-test',
      kind: 'build-test' as const,
      title: '构建验证',
      relations: [],
    };
    const weak = {
      ...maintainedUnit('README.md'),
      id: 'unit-weak',
      title: '弱候选',
      relations: [],
    };
    const result = expandProjectKnowledgeRelations({
      units: [matched, related, weak],
      matchedIds: [matched.id],
    });
    expect(result.map((unit) => unit.id)).toEqual(['unit-build-test']);
  });

  test('recalls active units and their sourced relation through the Local provider', async () => {
    const root = await temporaryRoot('comet-project-knowledge-unit-provider-');
    const cache = await temporaryRoot('comet-project-knowledge-unit-provider-cache-');
    try {
      await fs.mkdir(path.join(root, 'docs'), { recursive: true });
      await fs.writeFile(
        path.join(root, 'docs', 'architecture.md'),
        '# main\n\n入口负责协调调用方。\n',
      );
      await fs.writeFile(path.join(root, 'package.json'), '{"scripts":{"test":"vitest run"}}\n');
      const repository = new ProjectKnowledgeUnitRepository({
        projectRoot: root,
        cacheRoot: cache,
      });
      await repository.writeMaintained(maintainedUnit('docs/architecture.md'));
      await repository.writeMaintained({
        ...maintainedUnit('docs/architecture.md'),
        id: 'unit-build-test',
        kind: 'build-test',
        title: '构建验证',
        summary: '只记录构建与测试命令。',
        conclusions: [
          {
            text: '运行测试命令确认结果。',
            sources: [{ source: 'docs/architecture.md', anchor: 'main' }],
          },
        ],
        relations: [],
      });
      const provider = new LocalProjectKnowledgeProvider({
        projectRoot: root,
        corpus: [],
        indexEnabled: false,
        unitRepository: repository,
        runRipgrep: async () => ({
          stdout: '',
          stderr: '',
          exitCode: 1,
          timedOut: false,
          truncated: false,
          matchLimitReached: false,
        }),
      });
      const results = await provider.retrieve({
        task: '入口调用方',
        path: undefined,
        phase: undefined,
        operation: undefined,
        terms: ['入口', '调用方'],
        strongTerms: [],
        phraseTerms: [],
        weakTerms: ['入口', '调用方'],
        remoteQuery: '入口调用方',
      });
      expect(results.map((result) => result.unit?.id)).toEqual([
        'unit-main-flow',
        'unit-build-test',
      ]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
      await fs.rm(cache, { recursive: true, force: true });
    }
  });
});
