import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ProjectRulesService } from '../../../domains/project-rules/index.js';

const temporaryDirectories: string[] = [];

async function projectDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'comet-project-rules-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('ProjectRulesService', () => {
  it('scans readable Markdown without creating an empty rules file', async () => {
    const projectRoot = await projectDirectory();
    await mkdir(path.join(projectRoot, '.comet', 'rules'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.comet', 'rules', 'database.md'),
      '# Database\n\n适用范围：server/**/migration/**\n\n- 每个迁移必须同步回滚说明。\n\n# Naming\n\n- DTO 使用 PascalCase。\n',
    );
    await writeFile(
      path.join(projectRoot, 'AGENTS.md'),
      '# Repository\n\n- Run checks before finishing.\n',
    );

    const service = new ProjectRulesService({ projectRoot });
    const status = await service.init();

    expect(status.initialized).toBe(true);
    expect(status.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '.comet/rules/database.md', sectionCount: 2 }),
        expect.objectContaining({ path: 'AGENTS.md', sectionCount: 1 }),
      ]),
    );
    expect(
      await service.select({ task: 'update migration', path: 'server/db/migration/V1.sql' }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Database', scope: 'server/**/migration/**' }),
      ]),
    );
    await expect(
      readFile(path.join(projectRoot, '.comet', 'rules', 'project.md')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('appends explicit rules while preserving existing Markdown', async () => {
    const projectRoot = await projectDirectory();
    const target = path.join(projectRoot, '.comet', 'rules', 'database.md');
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '# Existing\n\n- Keep this comment.\n');

    const service = new ProjectRulesService({ projectRoot });
    await service.addRule('迁移必须同步回滚说明', '.comet/rules/database.md');

    await expect(readFile(target, 'utf8')).resolves.toBe(
      '# Existing\n\n- Keep this comment.\n\n- 迁移必须同步回滚说明\n',
    );
    await expect(service.addRule('escape', '../outside.md')).rejects.toThrow(/escaped|under/iu);
  });

  it('creates a candidate after two independent successful changes and deduplicates recovery', async () => {
    const projectRoot = await projectDirectory();
    const service = new ProjectRulesService({ projectRoot });
    const first = await service.recordObservation({
      candidateKey: 'dto-naming',
      text: 'DTO 使用 PascalCase。',
      workflow: 'native',
      changeId: 'change-a',
      success: true,
    });
    expect(first).toBeNull();
    await service.recordObservation({
      candidateKey: 'dto-naming',
      text: 'DTO 使用 PascalCase。',
      workflow: 'native',
      changeId: 'change-a',
      success: true,
    });
    expect(await service.candidates()).toHaveLength(0);

    const candidate = await service.recordObservation({
      candidateKey: 'dto-naming',
      text: 'DTO 使用 PascalCase。',
      workflow: 'classic',
      changeId: 'change-b',
      success: true,
    });
    expect(candidate).toMatchObject({ status: 'pending', observations: 2 });
    expect(await service.candidates()).toHaveLength(1);

    await service.snoozeCandidate(candidate?.id ?? '');
    expect(await service.candidates()).toEqual([
      { text: 'DTO 使用 PascalCase。', state: 'snoozed' },
    ]);
    await service.restoreCandidate(candidate?.id ?? '');
    expect(await service.candidates()).toEqual([
      { text: 'DTO 使用 PascalCase。', state: 'pending' },
    ]);

    await service.adoptCandidate(candidate?.id ?? '');
    expect(await service.candidates()).toHaveLength(0);
    await expect(
      readFile(path.join(projectRoot, '.comet', 'rules', 'project.md'), 'utf8'),
    ).resolves.toContain('DTO 使用 PascalCase');
  });

  it('discovers project-native verification entrypoints without imposing one command', async () => {
    const projectRoot = await projectDirectory();
    await writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({
        packageManager: 'pnpm@10.0.0',
        scripts: { lint: 'eslint .', test: 'vitest' },
      }),
    );
    await writeFile(
      path.join(projectRoot, 'pom.xml'),
      '<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>demo</artifactId><version>1.0.0</version></project>',
    );
    await writeFile(path.join(projectRoot, 'Makefile'), 'check:\n\t@echo ok\n');

    const service = new ProjectRulesService({ projectRoot });
    const entrypoints = await service.discoverVerificationEntrypoints();

    expect(entrypoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'pnpm run lint', executable: 'pnpm' }),
        expect.objectContaining({ label: 'pnpm run test', executable: 'pnpm' }),
        expect.objectContaining({ label: 'mvn verify', executable: 'mvn' }),
        expect.objectContaining({ label: 'make check', executable: 'make' }),
      ]),
    );

    await writeFile(
      path.join(projectRoot, 'pom.xml'),
      '<project><modelVersion>4.0.0</modelVersion><groupId>demo</groupId><artifactId>demo</artifactId><version>1.0.0</version>',
    );
    expect(await service.discoverVerificationEntrypoints()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'maven-verify' })]),
    );
    await writeFile(
      path.join(projectRoot, 'pom.xml'),
      '<project><modelVersion>4.0.0</modelVersion><dependencies><dependency><groupId>demo</groupId><artifactId>demo</artifactId><version>1.0.0</version></dependency></dependencies></project>',
    );
    expect(await service.discoverVerificationEntrypoints()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'maven-verify' })]),
    );
  });

  it('does not claim an empty Gradle script and preserves the Python source', async () => {
    const projectRoot = await projectDirectory();
    await writeFile(path.join(projectRoot, 'build.gradle'), '// generated placeholder\n');
    await writeFile(path.join(projectRoot, 'pytest.ini'), '[pytest]\naddopts = -q\n');

    const service = new ProjectRulesService({ projectRoot });
    const entrypoints = await service.discoverVerificationEntrypoints();

    expect(entrypoints).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'gradle-check' })]),
    );
    expect(entrypoints).toEqual([
      expect.objectContaining({ id: 'python-pytest', sourcePath: 'pytest.ini' }),
    ]);

    await writeFile(
      path.join(projectRoot, 'build.gradle'),
      "version = '1.0'\n// plugins { id 'java' }\n",
    );
    expect(await service.discoverVerificationEntrypoints()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'gradle-check' })]),
    );

    await rm(path.join(projectRoot, 'pytest.ini'));
    await writeFile(path.join(projectRoot, 'pyproject.toml'), '[project]\nname = "demo"\n');
    expect(await service.discoverVerificationEntrypoints()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'python-pytest' })]),
    );
    await writeFile(
      path.join(projectRoot, 'pyproject.toml'),
      '[project]\ndescription = "pytest is not used here"\n',
    );
    expect(await service.discoverVerificationEntrypoints()).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'python-pytest' })]),
    );
  });

  it('keeps selection bounded, relevant, source-filtered, and glob-safe', async () => {
    const projectRoot = await projectDirectory();
    await mkdir(path.join(projectRoot, '.comet', 'rules'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.comet', 'rules', 'many.md'),
      '# Build\n\n- Build rule one.\n\n# Unrelated\n\n- Database rule.\n\n# Deep\n\n适用范围：server/**/migration/**\n\n- Migration rule.\n',
    );
    await writeFile(path.join(projectRoot, 'AGENTS.md'), '# Agent\n\n- Agent build rule.\n');
    const service = new ProjectRulesService({ projectRoot });

    const selected = await service.select({
      task: 'build',
      path: 'server/a/migration/V1.sql',
      maxSections: 999,
      maxBytes: 999999,
      sourceKinds: ['comet-rules'],
    });
    expect(selected.length).toBeLessThanOrEqual(5);
    expect(Buffer.byteLength(JSON.stringify(selected), 'utf8')).toBeLessThanOrEqual(8 * 1024);
    expect(
      selected.every((rule) => Buffer.byteLength(`${rule.title}\n${rule.text}`) <= 8 * 1024),
    ).toBe(true);
    expect(selected).toEqual(expect.arrayContaining([expect.objectContaining({ title: 'Deep' })]));
    expect(selected).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Unrelated' })]),
    );
    expect(selected).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ sourcePath: 'AGENTS.md' })]),
    );
  });

  it('persists source index, project identity, and confines Runtime state', async () => {
    const projectRoot = await projectDirectory();
    await mkdir(path.join(projectRoot, '.comet', 'rules'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.comet', 'rules', 'project.md'),
      '# Build\n\n- Run checks.\n',
    );
    const service = new ProjectRulesService({ projectRoot, projectId: 'project-a' });
    await service.scan();
    await service.recordObservation({
      candidateKey: 'checks',
      text: 'Run checks.',
      workflow: 'native',
      changeId: 'change-a',
      success: true,
    });
    const state = JSON.parse(
      await readFile(
        path.join(projectRoot, '.comet', 'runtime', 'project-rules', 'state.json'),
        'utf8',
      ),
    ) as { sources: unknown[]; observations: Array<{ projectId: string }> };
    expect(state.sources).toHaveLength(1);
    expect(state.observations[0]?.projectId).toBe('project-a');
    expect(
      () => new ProjectRulesService({ projectRoot, runtimeDirectory: path.dirname(projectRoot) }),
    ).toThrow(/must be .comet\/runtime\/project-rules/iu);
  });

  it('upgrades a failed change only when the same evidence later succeeds', async () => {
    const projectRoot = await projectDirectory();
    const service = new ProjectRulesService({ projectRoot });
    await service.recordObservation({
      candidateKey: 'dto',
      text: 'DTO 使用 PascalCase。',
      workflow: 'native',
      changeId: 'change-a',
      success: false,
    });
    await service.recordObservation({
      candidateKey: 'dto',
      text: 'DTO 使用 PascalCase。',
      workflow: 'native',
      changeId: 'change-a',
      success: true,
    });
    await service.recordObservation({
      candidateKey: 'dto',
      text: 'DTO 使用 PascalCase。',
      workflow: 'classic',
      changeId: 'change-b',
      success: true,
    });
    expect(await service.candidateDetails()).toEqual([
      expect.objectContaining({ key: 'dto', observations: 2 }),
    ]);
    await expect(
      service.recordObservation({
        candidateKey: 'dto',
        text: 'DTO 使用 PascalCase。',
        workflow: ' ',
        changeId: 'change-c',
        success: true,
      }),
    ).rejects.toThrow(/require candidate key/iu);
    await expect(
      service.recordObservation({
        candidateKey: 'dto',
        text: 'DTO 使用 PascalCase。',
        workflow: 'other',
        changeId: 'change-c',
        success: true,
      }),
    ).rejects.toThrow(/workflow family/iu);
    await expect(
      service.recordObservation({
        candidateKey: 'dto',
        text: 'DTO 使用 PascalCase。',
        workflow: 'full',
        changeId: 'change-d',
        success: true,
      }),
    ).resolves.toBeDefined();
  });

  it('keeps context selection within conservative limits', async () => {
    const projectRoot = await projectDirectory();
    await mkdir(path.join(projectRoot, '.comet', 'rules'), { recursive: true });
    await writeFile(
      path.join(projectRoot, '.comet', 'rules', 'many.md'),
      '# Build\n\n- Build rule one.\n\n# Test\n\n- Test rule two.\n\n# Deploy\n\n- Deploy rule three.\n',
    );
    const service = new ProjectRulesService({ projectRoot });
    const selected = await service.select({
      task: 'build test deploy',
      maxSections: 2,
      maxBytes: 256,
    });
    expect(selected).toHaveLength(2);
    expect(selected.every((rule) => rule.score > 0)).toBe(true);
  });
});
