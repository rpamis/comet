import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runClassicCli } from '../../../domains/comet-classic/classic-cli.js';
import { withClassicCommandContext } from '../../../domains/comet-classic/classic-command-context.js';
import { prepareClassicLegacyProject } from '../../helpers/classic-project.js';

describe('Classic executable artifact and recovery contract', () => {
  const roots: string[] = [];
  afterEach(async () => {
    for (const root of roots.splice(0))
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });
  async function fixture(layout: 'legacy' | 'docs') {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic agent 中文 '));
    roots.push(root);
    await prepareClassicLegacyProject(root);
    if (layout === 'docs') {
      await fs.mkdir(path.join(root, 'docs'));
      await fs.rename(path.join(root, 'openspec'), path.join(root, 'docs/openspec'));
      const config = path.join(root, '.comet/config.yaml');
      await fs.writeFile(
        config,
        (await fs.readFile(config, 'utf8')).replace(
          'artifact_layout: legacy',
          'artifact_layout: docs',
        ),
      );
    }
    await fs.mkdir(path.join(root, 'src'));
    const cli = (args: string[], cwd = root) =>
      withClassicCommandContext({ projectRoot: root, invocationCwd: cwd }, () =>
        runClassicCli([...args, '--json']),
      );
    expect((await cli(['state', 'init', 'demo', 'full', '--isolation', 'current'])).exitCode).toBe(
      0,
    );
    const prefix = layout === 'docs' ? 'docs/openspec' : 'openspec';
    const change = path.join(root, prefix, 'changes/demo');
    await fs.writeFile(
      path.join(change, 'proposal.md'),
      '# Proposal\nImplement the requested change.\n',
    );
    await fs.writeFile(
      path.join(change, 'tasks.md'),
      '- [ ] Implement the change <!-- comet-task:a -->\n',
    );
    const design =
      '---\ncomet_change: demo\nrole: technical-design\ncanonical_spec: openspec\n---\n# Design\nPreserve the confirmed decision.\n';
    await fs.writeFile(path.join(change, 'design.md'), design);
    const open = await cli(['guard', 'demo', 'open', '--apply']);
    expect(open.exitCode, open.stdout).toBe(0);
    return { root, change, cli, design };
  }

  it.each(['legacy', 'docs'] as const)(
    'executes returned refs and design continuation from root and src with %s layout',
    async (layout) => {
      const { root, change, cli, design } = await fixture(layout);
      const first = JSON.parse((await cli(['state', 'check', 'demo', 'design'])).stdout!);
      const ref = first.data.artifactRefs.designDoc;
      expect(path.isAbsolute(ref)).toBe(false);
      expect(first.data.artifactRefs.tasks).toBe(
        path.relative(root, path.join(change, 'tasks.md')).replaceAll('\\', '/'),
      );
      const absolute = JSON.parse(
        (await cli(['state', 'set', 'demo', 'design_doc', path.join(change, 'design.md')])).stdout!,
      );
      expect(absolute.exitCode).toBe(1);
      expect(absolute.data.issues[0]).toMatchObject({
        code: 'CLASSIC_ARTIFACT_REF_INVALID',
        field: 'design_doc',
      });
      expect((await cli(['state', 'set', 'demo', 'design_doc', ref])).exitCode).toBe(0);
      for (const cwd of [root, path.join(root, 'src')]) {
        for (const recovery of [[], ['--recover']]) {
          const result = await cli(['state', 'check', 'demo', 'design', ...recovery], cwd);
          expect(result.exitCode, result.stdout).toBe(0);
          const data = JSON.parse(result.stdout!).data;
          expect(data.designReadiness).toMatchObject({ design: 'ready', handoff: 'missing' });
          expect(data.nextAction).toMatchObject({ kind: 'complete-design', cwd: root });
        }
      }
      const ready = JSON.parse((await cli(['state', 'check', 'demo', 'design'])).stdout!).data;
      const result = await cli(ready.nextAction.argv.slice(1), path.join(root, 'src'));
      expect(result.exitCode, result.stdout).toBe(0);
      expect(JSON.parse(result.stdout!).data.phase).toBe('build');
      const before = await fs.readFile(path.join(change, '.comet.yaml'), 'utf8');
      const retry = await cli(
        ['state', 'complete-design', 'demo', '--design-doc', ref],
        path.join(root, 'src'),
      );
      expect(retry.exitCode, retry.stdout).toBe(0);
      expect(await fs.readFile(path.join(change, '.comet.yaml'), 'utf8')).toBe(before);
      expect(await fs.readFile(path.join(change, 'design.md'), 'utf8')).toBe(design);
      expect(
        (await cli(['state', 'check', 'demo', 'build'], path.join(root, 'src'))).exitCode,
      ).toBe(0);
    },
  );

  it('retains broken or wrong-owner registered designs with structured repair details', async () => {
    const { change, cli } = await fixture('docs');
    const entry = JSON.parse((await cli(['state', 'check', 'demo', 'design'])).stdout!);
    expect(
      (await cli(['state', 'set', 'demo', 'design_doc', entry.data.artifactRefs.designDoc]))
        .exitCode,
    ).toBe(0);
    const file = path.join(change, 'design.md');
    const source = (await fs.readFile(file, 'utf8')).replace(
      'comet_change: demo',
      'comet_change: another',
    );
    await fs.writeFile(file, source);
    for (const recovery of [[], ['--recover']]) {
      const result = JSON.parse(
        (await cli(['state', 'check', 'demo', 'design', ...recovery])).stdout!,
      );
      expect(result.exitCode).toBe(1);
      expect(result.data.checks.blocked).toBe(true);
      expect(result.data.issues).toContainEqual(
        expect.objectContaining({
          code: 'CLASSIC_DESIGN_METADATA_INVALID',
          field: 'comet_change',
          actual: 'another',
          expected: 'demo',
        }),
      );
    }
    expect(await fs.readFile(file, 'utf8')).toBe(source);
  });
});
