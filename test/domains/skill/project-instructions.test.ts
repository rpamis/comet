import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  installCometProjectInstructions,
  removeCometProjectInstructions,
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

  it('removes only the managed block', async () => {
    const agents = path.join(tmpDir, 'AGENTS.md');
    await fs.writeFile(agents, '# User\n\nKeep me.\n', 'utf8');
    await installCometProjectInstructions(tmpDir, 'en');

    const result = await removeCometProjectInstructions(tmpDir);

    expect(result.removed).toBeGreaterThan(0);
    expect(await fs.readFile(agents, 'utf8')).toContain('Keep me.');
    expect(await fs.readFile(agents, 'utf8')).not.toContain('<comet-ambient-resume>');
  });
});
