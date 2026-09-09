import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectClassicSpecFiles } from '../../../domains/comet-classic/classic-paths.js';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic nested capability paths', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-spec-paths-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it('collects direct and nested specs in deterministic capability order', async () => {
    for (const name of ['identity/user-auth', 'billing', 'identity', 'identity/session']) {
      const dir = path.join(root, 'specs', name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'spec.md'), name);
    }
    await fs.writeFile(path.join(root, 'specs', 'notes.md'), 'not a spec');
    const files = await collectClassicSpecFiles(root, path.join(root, 'specs'));
    expect(files.map((file) => path.relative(root, file).replaceAll('\\', '/'))).toEqual([
      'specs/billing/spec.md',
      'specs/identity/spec.md',
      'specs/identity/session/spec.md',
      'specs/identity/user-auth/spec.md',
    ]);
  });

  it('allows a missing specs directory', async () => {
    expect(await collectClassicSpecFiles(root, path.join(root, 'specs'))).toEqual([]);
  });

  it.each(['off', 'beta'])(
    'projects nested specs and separates task progress in %s mode',
    async (mode) => {
      await prepareClassicLegacyProject(root);
      const cli = (...args: string[]) =>
        withClassicCommandContext({ projectRoot: root, invocationCwd: root }, () =>
          runClassicCli(args),
        );
      expect((await cli('state', 'init', 'nested', 'full')).exitCode).toBe(0);
      expect((await cli('state', 'set', 'nested', 'context_compression', mode)).exitCode).toBe(0);
      const change = path.join(root, 'openspec', 'changes', 'nested');
      for (const file of ['proposal.md', 'design.md', 'tasks.md']) {
        await fs.writeFile(
          path.join(change, file),
          file === 'tasks.md' ? '- [ ] implement auth\n' : '# Design\nAuth\n',
        );
      }
      const spec = path.join(change, 'specs', 'identity', 'auth', 'spec.md');
      await fs.mkdir(path.dirname(spec), { recursive: true });
      await fs.writeFile(
        spec,
        '## ADDED Requirements\n### Requirement: Authentication\nUsers MUST sign in.\n#### Scenario: Sign in\n- WHEN valid credentials are supplied\n- THEN access is granted\n',
      );
      const state = path.join(change, '.comet.yaml');
      await fs.writeFile(
        state,
        (await fs.readFile(state, 'utf8')).replace('phase: open', 'phase: design'),
      );
      const before = await cli('handoff', 'nested', '--hash-only');
      expect(before.exitCode, before.stderr).toBe(0);
      const written = await cli('handoff', 'nested', 'design', '--write');
      expect(written.exitCode, written.stderr).toBe(0);
      const contextName = mode === 'beta' ? 'spec-context' : 'design-context';
      const markdown = path.join(change, '.comet', 'handoff', `${contextName}.md`);
      expect(await fs.readFile(markdown, 'utf8')).toContain('specs/identity/auth/spec.md');
      if (mode === 'beta') {
        const context = JSON.parse(
          await fs.readFile(path.join(change, '.comet', 'handoff', 'spec-context.json'), 'utf8'),
        );
        expect(context.files).toContainEqual(
          expect.objectContaining({
            path: 'openspec/changes/nested/specs/identity/auth/spec.md',
            role: 'spec',
          }),
        );
      }
      await fs.writeFile(path.join(change, 'tasks.md'), '- [x] implement auth\n');
      expect((await cli('handoff', 'nested', '--hash-only')).stdout).toBe(before.stdout);
      const progressGuard = await cli('guard', 'nested', 'design');
      expect(progressGuard.stderr).not.toContain('OpenSpec artifacts changed');
      expect(progressGuard.stderr).not.toContain('missing current sha256');
      await fs.writeFile(path.join(change, 'tasks.md'), '- [x] implement different auth\n');
      expect((await cli('handoff', 'nested', '--hash-only')).stdout).not.toBe(before.stdout);
      await fs.writeFile(path.join(change, 'tasks.md'), '- [x] implement auth\n');
      await fs.appendFile(spec, '\nAdditional authentication requirement.\n');
      const after = await cli('handoff', 'nested', '--hash-only');
      expect(after.exitCode).toBe(0);
      expect(after.stdout).not.toBe(before.stdout);
      const guard = await cli('guard', 'nested', 'design');
      expect(guard.exitCode).not.toBe(0);
      expect(guard.stderr).toContain('OpenSpec artifacts changed');
    },
  );

  it('rejects a directory symlink cycle rather than recursing forever', async () => {
    await fs.mkdir(path.join(root, 'specs'));
    await fs.symlink(path.join(root, 'specs'), path.join(root, 'specs', 'cycle'), 'junction');
    await expect(collectClassicSpecFiles(root, path.join(root, 'specs'))).rejects.toThrow();
  });
});
