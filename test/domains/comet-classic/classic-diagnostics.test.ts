import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { inspectClassicChange } from '../../../domains/comet-classic/classic-diagnostics.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic diagnostics', () => {
  let projectRoot: string;
  let changeDir: string;
  let previousCwd: string;

  beforeEach(async () => {
    previousCwd = process.cwd();
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-diagnostics-'));
    await prepareClassicLegacyProject(projectRoot);
    changeDir = path.join(projectRoot, 'openspec', 'changes', 'demo');
    await fs.mkdir(changeDir, { recursive: true });
    process.chdir(projectRoot);
    await runClassicCli(['state', 'init', 'demo', 'full']);
    await fs.writeFile(path.join(changeDir, 'proposal.md'), '# Proposal\n');
    await fs.writeFile(path.join(changeDir, 'design.md'), '# Design\n');
    await fs.writeFile(path.join(changeDir, 'tasks.md'), '- [ ] build\n');
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('returns resolver step, evidence, and next command from one source', async () => {
    const diagnostic = await inspectClassicChange(changeDir, 'demo');

    expect(diagnostic.name).toBe('demo');
    expect(diagnostic.valid).toBe(true);
    expect(diagnostic.phase).toBe('open');
    expect(diagnostic.currentStep).toBe('full.open');
    expect(diagnostic.nextCommand).toBe('/comet-open');
    expect(diagnostic.evidence.some((item) => item.code === 'openspec.proposal')).toBe(true);
    expect(diagnostic.runtimeMode).toBe('engine-projection');
    expect(diagnostic.runtimeEval).toMatchObject({
      stepId: 'full.open',
      requiredEvidence: ['openspec.proposal', 'openspec.tasks'],
    });
  });

  it('fails closed with an error instead of throwing to callers', async () => {
    await fs.appendFile(path.join(changeDir, '.comet.yaml'), '\nunknown_field: true\n');

    const diagnostic = await inspectClassicChange(changeDir, 'demo');

    expect(diagnostic.valid).toBe(false);
    expect(diagnostic.error).toContain('unknown field');
    expect(diagnostic.currentStep).toBeNull();
  });
});
