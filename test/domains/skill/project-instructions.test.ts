import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  installCometProjectInstructions,
  removeCometProjectInstructions,
  syncCometProjectInstructions,
} from '../../../domains/skill/project-instructions.js';

let tmpDir: string;

describe('Comet project instructions', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-instructions-'));
  });

  it('creates AGENTS.md and CLAUDE.md with managed XML blocks', async () => {
    const result = await installCometProjectInstructions(tmpDir, 'zh');

    expect(result.changed).toBe(2);
    for (const name of ['AGENTS.md', 'CLAUDE.md']) {
      const content = await fs.readFile(path.join(tmpDir, name), 'utf8');
      expect(content).toContain('<comet-ambient-resume>');
      expect(content).toContain('</comet-ambient-resume>');
      expect(content).toContain('开始处理需要改动或调查的任务前');
      expect(content).toContain('comet resume-probe . --stdin --json');
      expect(content).toContain('comet.resume_probe.v2');
      expect(content).toContain('只信任返回的 `workflow`、`skill`');
      expect(content).toContain('不得扫描或切换另一套 workflow');
      expect(content).not.toContain('`.comet.yaml`');
    }
  });

  it('preserves existing user rules and updates only the managed block', async () => {
    const agents = path.join(tmpDir, 'AGENTS.md');
    await fs.writeFile(agents, '# User Rules\n\n必须中文回答。\n', 'utf8');

    await installCometProjectInstructions(tmpDir, 'en');
    await installCometProjectInstructions(tmpDir, 'zh');

    const content = await fs.readFile(agents, 'utf8');
    expect(content.startsWith('# User Rules\n\n必须中文回答。')).toBe(true);
    expect(content.match(/<comet-ambient-resume>/gu)).toHaveLength(1);
    expect(content).toContain('开始处理需要改动或调查的任务前');
    expect(content).not.toContain(
      'before starting work that may need code changes or investigation',
    );
  });

  it('renders the same workflow isolation contract in English', async () => {
    await installCometProjectInstructions(tmpDir, 'en');

    const content = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    expect(content).toContain('comet resume-probe . --stdin --json');
    expect(content).toContain('Trust only the returned `workflow`, `skill`');
    expect(content).toContain('Do not scan or switch to the other workflow');
    expect(content).toContain('permanent entry in `nextCommand`');
    expect(content).not.toContain('`.comet.yaml`');
  });

  it.each([
    [
      'zh' as const,
      '用户通过宿主明确调用任意 Comet Skill',
      '不要运行 resume probe',
      '当前请求未明确调用 Comet Skill',
    ],
    [
      'en' as const,
      'user explicitly invokes any Comet Skill through the host',
      'do not run the resume probe',
      'current request did not explicitly invoke a Comet Skill',
    ],
  ])('gives explicit Comet Skill invocation precedence in %s', async (language, ...markers) => {
    await installCometProjectInstructions(tmpDir, language);

    const content = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    for (const marker of markers) {
      expect(content).toContain(marker);
    }
  });

  it.each([
    [
      'zh' as const,
      '正在等待用户回复你在流程中提出的问题',
      '当作当前 change 的继续',
      '绝不表示要暂停或退出一个已在进行的 Comet 流程',
    ],
    [
      'en' as const,
      'waiting for the user to answer a question you asked in that flow',
      'continuation of the current change',
      'never pauses or exits a Comet flow that is already in progress',
    ],
  ])('keeps mid-flow replies inside the running flow in %s', async (language, ...markers) => {
    await installCometProjectInstructions(tmpDir, language);

    const content = await fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8');
    for (const marker of markers) {
      expect(content).toContain(marker);
    }
  });

  it('removes only the managed block', async () => {
    const agents = path.join(tmpDir, 'AGENTS.md');
    await fs.writeFile(agents, '# User\n\nKeep me.\n', 'utf8');
    await installCometProjectInstructions(tmpDir, 'en');

    const result = await removeCometProjectInstructions(tmpDir);

    expect(result.removed).toBeGreaterThan(0);
    expect(await fs.readFile(agents, 'utf8')).toContain('Keep me.');
    expect(await fs.readFile(agents, 'utf8')).not.toContain('<comet-ambient-resume>');
  });

  it('removes managed blocks when Ambient Resume is disabled', async () => {
    await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), '# User\n\nKeep AGENTS rules.\n', 'utf8');
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# User\n\nKeep Claude rules.\n', 'utf8');
    await installCometProjectInstructions(tmpDir, 'en');

    const result = await syncCometProjectInstructions(tmpDir, 'en', false);

    expect(result.changed).toBe(2);
    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toBe(
      '# User\n\nKeep AGENTS rules.\n',
    );
    await expect(fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf8')).resolves.toBe(
      '# User\n\nKeep Claude rules.\n',
    );
  });

  it('updates the in-project target without replacing an AGENTS.md alias', async () => {
    await fs.writeFile(path.join(tmpDir, 'CLAUDE.md'), '# User instructions\n', 'utf8');
    try {
      await fs.symlink('CLAUDE.md', path.join(tmpDir, 'AGENTS.md'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    const result = await installCometProjectInstructions(tmpDir, 'en');

    expect(result.changed).toBe(1);
    expect((await fs.lstat(path.join(tmpDir, 'AGENTS.md'))).isSymbolicLink()).toBe(true);
    const content = await fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf8');
    expect(content).toContain('<comet-ambient-resume>');
    await expect(fs.readFile(path.join(tmpDir, 'AGENTS.md'), 'utf8')).resolves.toBe(content);
  });

  it('creates the target for a dangling in-project AGENTS.md alias', async () => {
    try {
      await fs.symlink('CLAUDE.md', path.join(tmpDir, 'AGENTS.md'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    const result = await installCometProjectInstructions(tmpDir, 'en');

    expect(result.changed).toBe(1);
    expect((await fs.lstat(path.join(tmpDir, 'AGENTS.md'))).isSymbolicLink()).toBe(true);
    await expect(fs.readFile(path.join(tmpDir, 'CLAUDE.md'), 'utf8')).resolves.toContain(
      '<comet-ambient-resume>',
    );
  });
});
