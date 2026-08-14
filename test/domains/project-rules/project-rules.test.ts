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
    await writeFile(path.join(projectRoot, 'pom.xml'), '<project />');
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
