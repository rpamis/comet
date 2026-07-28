import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';

const CLASSIC_CONFIG = [
  'schema: comet.project.v1',
  'default_workflow: classic',
  'workflows: [classic]',
  'classic:',
  '  artifact_layout: legacy',
  '  language: en',
  '',
].join('\n');

function classicState(overrides: Record<string, string> = {}): string {
  const values: Record<string, string> = {
    workflow: 'full',
    language: 'en',
    phase: 'design',
    context_compression: 'off',
    build_mode: 'null',
    build_pause: 'null',
    subagent_dispatch: 'null',
    tdd_mode: 'null',
    review_mode: 'standard',
    isolation: 'null',
    verify_mode: 'null',
    auto_transition: 'false',
    base_ref: 'null',
    design_doc: 'null',
    plan: 'null',
    verify_result: 'pending',
    verify_failures: '0',
    verification_report: 'null',
    branch_status: 'pending',
    created_at: '2026-07-28',
    verified_at: 'null',
    archived: 'false',
    handoff_context: 'null',
    handoff_hash: 'null',
    ...overrides,
  };
  return Object.entries(values)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')
    .concat('\n');
}

async function writeFile(file: string, source: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, source, 'utf8');
}

async function linkDirectory(target: string, link: string): Promise<boolean> {
  try {
    await fs.symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
}

describe.sequential('Classic protected path consumers', () => {
  let projectRoot: string;
  let outsideRoot: string;
  let previousCwd: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-protected-'));
    outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-classic-outside-'));
    previousCwd = process.cwd();
    await fs.mkdir(path.join(projectRoot, '.git'));
    await writeFile(path.join(projectRoot, '.comet', 'config.yaml'), CLASSIC_CONFIG);
    await writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'demo', '.comet.yaml'),
      classicState(),
    );
    process.chdir(projectRoot);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await Promise.all([
      fs.rm(projectRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
      fs.rm(outsideRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
    ]);
  });

  it('rejects a state artifact pointer that crosses a directory junction', async () => {
    await writeFile(path.join(outsideRoot, 'design.md'), 'outside design\n');
    const linked = await linkDirectory(outsideRoot, path.join(projectRoot, 'linked-artifacts'));
    if (!linked) return;
    const stateFile = path.join(projectRoot, 'openspec', 'changes', 'demo', '.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');

    const result = await runClassicCli([
      'state',
      'set',
      'demo',
      'design_doc',
      'linked-artifacts/design.md',
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/symbolic link or junction/iu);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
    expect(await fs.readFile(path.join(outsideRoot, 'design.md'), 'utf8')).toBe('outside design\n');
  });

  it('does not write a Classic artifact through a parent junction replaced before commit', async () => {
    const protectedPaths =
      (await import('../../../domains/comet-classic/classic-protected-path.js')) as unknown as {
        writeClassicProjectText: (
          projectRoot: string,
          target: string,
          content: string,
          options: {
            label: string;
            beforeCommit?: () => void | Promise<void>;
          },
        ) => Promise<void>;
      };
    const parent = path.join(projectRoot, 'openspec', 'changes', 'demo', '.comet', 'handoff');
    const held = `${parent}-held`;
    const target = path.join(parent, 'context.md');
    await fs.mkdir(parent, { recursive: true });

    try {
      await expect(
        protectedPaths.writeClassicProjectText(projectRoot, target, 'managed\n', {
          label: 'Classic protected write race',
          beforeCommit: async () => {
            const temporaryName = (await fs.readdir(parent)).find(
              (entry) => entry.includes('context.md.') && entry.endsWith('.tmp'),
            );
            expect(temporaryName).toBeDefined();
            await fs.rename(parent, held);
            await fs.writeFile(path.join(outsideRoot, 'context.md'), 'keep\n', 'utf8');
            await fs.writeFile(path.join(outsideRoot, temporaryName!), 'outside-temp\n', 'utf8');
            await fs.symlink(
              outsideRoot,
              parent,
              process.platform === 'win32' ? 'junction' : 'dir',
            );
          },
        }),
      ).rejects.toThrow(/changed|junction|outside|managed parent/iu);

      expect(await fs.readFile(path.join(outsideRoot, 'context.md'), 'utf8')).toBe('keep\n');
      expect(await fs.readdir(outsideRoot)).toEqual(
        expect.arrayContaining(['context.md', expect.stringMatching(/^\.?context\.md\..+\.tmp$/u)]),
      );
    } finally {
      try {
        if ((await fs.lstat(parent)).isSymbolicLink()) {
          if (process.platform === 'win32') await fs.rmdir(parent);
          else await fs.unlink(parent);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  });

  it('rejects a nonempty check when the inspected file is replaced before completion', async () => {
    const protectedPaths =
      (await import('../../../domains/comet-classic/classic-protected-path.js')) as unknown as {
        classicProjectFileNonempty: (
          projectRoot: string,
          target: string,
          label: string,
          hooks?: { afterOpen?: () => void | Promise<void> },
        ) => Promise<boolean>;
      };
    const parent = path.join(projectRoot, 'openspec', 'changes', 'demo', 'replacement-probe');
    const held = `${parent}-held`;
    const target = path.join(parent, 'tasks.md');
    const outside = path.join(outsideRoot, 'tasks.md');
    await writeFile(target, 'inside\n');
    await writeFile(outside, 'outside-secret\n');
    const linkProbe = path.join(projectRoot, 'directory-link-probe');
    if (!(await linkDirectory(outsideRoot, linkProbe))) return;
    if (process.platform === 'win32') await fs.rmdir(linkProbe);
    else await fs.unlink(linkProbe);

    try {
      await expect(
        protectedPaths.classicProjectFileNonempty(
          projectRoot,
          target,
          'Classic nonempty replacement',
          {
            afterOpen: async () => {
              await fs.rename(parent, held);
              await fs.symlink(
                outsideRoot,
                parent,
                process.platform === 'win32' ? 'junction' : 'dir',
              );
            },
          },
        ),
      ).rejects.toThrow(
        /changed|regular file|symbolic link|junction|operation not permitted|EPERM/iu,
      );
      expect(await fs.readFile(outside, 'utf8')).toBe('outside-secret\n');
    } finally {
      try {
        if ((await fs.lstat(parent)).isSymbolicLink()) {
          if (process.platform === 'win32') await fs.rmdir(parent);
          else await fs.unlink(parent);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
  });

  it('reports a junction-backed artifact pointer as an unsafe validation failure', async () => {
    await writeFile(path.join(outsideRoot, 'design.md'), 'outside design\n');
    const linked = await linkDirectory(outsideRoot, path.join(projectRoot, 'linked-artifacts'));
    if (!linked) return;
    await writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'demo', '.comet.yaml'),
      classicState({ design_doc: 'linked-artifacts/design.md' }),
    );

    const result = await runClassicCli(['validate', 'demo']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/design_doc=.*unsafe/iu);
    expect(result.stderr).toMatch(/symbolic link or junction/iu);
  });

  it('keeps validator path rules aligned with state-set repository-relative pointers', async () => {
    await writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'demo', '.comet.yaml'),
      classicState({ design_doc: '../outside/design.md' }),
    );

    const result = await runClassicCli(['validate', 'demo']);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('must be a relative repository path');
  });

  it('rejects an active change runtime junction without writing outside the project', async () => {
    await writeFile(path.join(outsideRoot, 'marker.txt'), 'unchanged\n');
    const runtimeDir = path.join(projectRoot, 'openspec', 'changes', 'demo', '.comet');
    const linked = await linkDirectory(outsideRoot, runtimeDir);
    if (!linked) return;
    const stateFile = path.join(projectRoot, 'openspec', 'changes', 'demo', '.comet.yaml');
    const before = await fs.readFile(stateFile, 'utf8');

    const result = await runClassicCli(['state', 'set', 'demo', 'review_mode', 'off']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/symbolic link or junction/iu);
    expect(await fs.readFile(stateFile, 'utf8')).toBe(before);
    expect(await fs.readFile(path.join(outsideRoot, 'marker.txt'), 'utf8')).toBe('unchanged\n');
    expect(await fs.readdir(outsideRoot)).toEqual(['marker.txt']);
  });

  it('blocks guard preflight when an artifact pointer crosses a directory junction', async () => {
    await writeFile(path.join(outsideRoot, 'design.md'), 'outside design\n');
    await writeFile(path.join(outsideRoot, 'marker.txt'), 'unchanged\n');
    const linked = await linkDirectory(outsideRoot, path.join(projectRoot, 'linked-artifacts'));
    if (!linked) return;
    await writeFile(
      path.join(projectRoot, 'openspec', 'changes', 'demo', '.comet.yaml'),
      classicState({ design_doc: 'linked-artifacts/design.md' }),
    );

    const result = await runClassicCli(['guard', 'demo', 'design']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('.comet.yaml schema validation failed');
    expect(await fs.readFile(path.join(outsideRoot, 'marker.txt'), 'utf8')).toBe('unchanged\n');
  });

  it('rejects a symlinked project config before guard can inspect removed fields', async () => {
    const outsideConfig = path.join(outsideRoot, 'config.yaml');
    await writeFile(outsideConfig, CLASSIC_CONFIG);
    await fs.rm(path.join(projectRoot, '.comet', 'config.yaml'));
    try {
      await fs.symlink(outsideConfig, path.join(projectRoot, '.comet', 'config.yaml'), 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }

    const result = await runClassicCli(['guard', 'demo', 'design']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/symbolic link or junction/iu);
    expect(await fs.readFile(outsideConfig, 'utf8')).toBe(CLASSIC_CONFIG);
  });
});
