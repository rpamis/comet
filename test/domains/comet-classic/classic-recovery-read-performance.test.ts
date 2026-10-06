import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import * as protectedPaths from '../../../domains/comet-classic/classic-protected-path.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic recovery field read budgets', () => {
  let root: string;
  let stateFile: string;
  const cli = (phase: string) =>
    withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
      runClassicCli(['state', 'check', 'demo', phase, '--recover']),
    );
  const source = (phase: string) =>
    [
      'workflow: full',
      `phase: ${phase}`,
      'build_mode: null',
      'isolation: null',
      'verify_mode: null',
      'design_doc: null',
      'plan: null',
      'verify_result: pending',
      'archived: false',
      'custom_extension: { keep: this }',
      '',
    ].join('\n');

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-recovery-read-'));
    await prepareClassicLegacyProject(root);
    stateFile = path.join(root, 'openspec/changes/demo/.comet.yaml');
    await fs.mkdir(path.dirname(stateFile), { recursive: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  it.each(['verify', 'archive'])(
    'reads %s display fields from one fresh document and preserves unknown fields',
    async (phase) => {
      const yaml = source(phase);
      await fs.writeFile(stateFile, yaml);
      const read = vi.spyOn(protectedPaths, 'readClassicProjectFile');
      const result = await cli(phase);
      expect(result.exitCode, result.stderr).toBe(0);
      expect(
        read.mock.calls.filter(
          ([, file, options]) =>
            String(file) === stateFile &&
            options?.label === 'Classic state openspec/changes/demo/.comet.yaml',
        ),
      ).toHaveLength(2); // One sparse-state fallback and one display read.
      expect(result.stdout).toContain(`Phase: ${phase}`);
      expect(result.stdout).toContain('verify_result: DONE (pending)');
      if (phase === 'verify') expect(result.stdout).toContain('verify_failures: 0');
      else expect(result.stdout).toContain('archive_confirmation: PENDING');
      expect(await fs.readFile(stateFile, 'utf8')).toBe(yaml);

      await fs.writeFile(stateFile, yaml.replace('verify_result: pending', 'verify_result: pass'));
      expect((await cli(phase)).stdout).toContain('verify_result: DONE (pass)');
      expect(await fs.readFile(stateFile, 'utf8')).toContain('custom_extension: { keep: this }');
    },
  );

  it('still rejects malformed state without rewriting its source', async () => {
    const yaml = source('verify') + 'broken: [\n';
    await fs.writeFile(stateFile, yaml);
    const result = await cli('verify');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Invalid|YAML|flow sequence/iu);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(yaml);
  });
});
