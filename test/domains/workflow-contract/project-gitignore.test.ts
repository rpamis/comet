import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ensureCometProjectGitignore,
  renderCometProjectGitignore,
} from '../../../domains/workflow-contract/project-gitignore.js';

function git(projectRoot: string, args: string[]) {
  return spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8' });
}

describe('Comet project .gitignore', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-project-gitignore-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('preserves user rules and normalizes one idempotent managed block', () => {
    const source = [
      'node_modules/',
      '# >>> Comet managed project state >>>',
      '.comet/',
      '# <<< Comet managed project state <<<',
      'coverage/',
      '',
    ].join('\r\n');

    const rendered = renderCometProjectGitignore(source);

    expect(rendered).toMatch(/^node_modules\/\r\n/u);
    expect(rendered).toMatch(/# <<< Comet managed project state <<<\r\ncoverage\/\r\n$/u);
    expect(rendered).toContain(
      [
        '# >>> Comet managed project state >>>',
        '!/.comet/',
        '/.comet/*',
        '!/.comet/config.yaml',
        '.comet-archive-staging/',
        '.*.comet-archive-cas-*',
        '.*.comet-runtime-migration.json*',
        '.*.comet-runtime-source-*',
        '.*.comet-runtime-stage-*',
        '**/comet/changes/*/runtime',
        '**/comet/archive/*/runtime',
        '**/.comet/run-state.json',
        '**/.comet/pending-action.json',
        '**/.comet/trajectory.jsonl',
        '**/.comet/context.md',
        '**/.comet/artifacts.json',
        '**/.comet/checkpoint.json',
        '**/.comet/skill-snapshots',
        '**/.comet/checks',
        '**/.comet/coordination.json',
        '**/.comet/subagent-progress.md',
        '.comet-state.lock',
        '.comet-state-transaction.json',
        '# <<< Comet managed project state <<<',
        '',
      ].join('\r\n'),
    );
    expect(rendered.match(/>>> Comet managed project state >>>/gu)).toHaveLength(1);
    expect(renderCometProjectGitignore(rendered)).toBe(rendered);
  });

  it('allows only config.yaml while keeping every local .comet category ignored and unstaged', async () => {
    expect(git(root, ['init']).status).toBe(0);
    await fs.writeFile(
      path.join(root, '.gitignore'),
      ['node_modules/', '.comet/', 'dist/', ''].join('\n'),
      'utf8',
    );
    const files = [
      '.comet/config.yaml',
      '.comet/current-change.json',
      '.comet/skills/demo/SKILL.md',
      '.comet/drafts/demo.md',
      '.comet/cache/index.json',
      '.comet/runtime/native/changes/demo/state.json',
      '.comet/runtime/native/locks/demo.lock',
      '.comet/runtime/native/transactions/demo/journal.json',
      'comet/specs/demo/.comet-archive-staging/transaction/spec.candidate',
      'comet/specs/demo/.spec.md.comet-archive-cas-transaction.original',
      'comet/changes/demo/.runtime.comet-runtime-migration.json',
      'comet/changes/demo/.runtime.comet-runtime-source-test/evidence/checks.log',
      'openspec/changes/demo/.comet/.trajectory.jsonl.comet-runtime-source-test',
      'openspec/changes/demo/.comet/.trajectory.jsonl.comet-runtime-migration.json.recovery.lock',
      'openspec/changes/demo/..comet-state.lock.comet-runtime-stage-test/.comet-runtime-migration.json',
    ];
    for (const relative of files) {
      const target = path.join(root, ...relative.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, `${relative}\n`, 'utf8');
    }

    await ensureCometProjectGitignore(root);
    const once = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    await ensureCometProjectGitignore(root);

    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe(once);
    expect(once).toContain('node_modules/\n');
    expect(once).toContain('dist/\n');
    expect(git(root, ['check-ignore', '--quiet', '.comet/config.yaml']).status).toBe(1);
    for (const relative of files.slice(1)) {
      expect(git(root, ['check-ignore', '--quiet', relative]).status, relative).toBe(0);
    }
    expect(git(root, ['add', '--dry-run', '--', '.comet/config.yaml']).status).toBe(0);
    expect(git(root, ['diff', '--cached', '--name-only']).stdout).toBe('');
    expect(git(root, ['status', '--short', '--untracked-files=all', '--', '.comet']).stdout).toBe(
      '?? .comet/config.yaml\n',
    );
  });

  it('preserves custom managed-block rules, comments and precedence across repeated updates', async () => {
    expect(git(root, ['init']).status).toBe(0);
    const target = 'docs/comet/changes/demo/.comet/context.md';
    const source =
      renderCometProjectGitignore('node_modules/\n').replace(
        '# <<< Comet managed project state <<<',
        `# Keep my archived state\n**/changes/**/custom-state/\n!${target}\n# <<< Comet managed project state <<<`,
      ) + `# Outside override\n!docs/comet/changes/demo/.comet/checkpoint.json\n`;
    await fs.writeFile(path.join(root, '.gitignore'), source);
    for (let iteration = 0; iteration < 2; iteration++) {
      await ensureCometProjectGitignore(root);
      expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe(source);
      expect(git(root, ['check-ignore', '--no-index', '--quiet', target]).status).toBe(1);
      expect(
        git(root, [
          'check-ignore',
          '--no-index',
          '--quiet',
          'docs/comet/changes/demo/.comet/checkpoint.json',
        ]).status,
      ).toBe(1);
      expect(
        git(root, [
          'check-ignore',
          '--no-index',
          '--quiet',
          'docs/comet/changes/demo/custom-state/file',
        ]).status,
      ).toBe(0);
    }
  });

  it('fails closed for malformed managed state and redirected project roots', async () => {
    await fs.writeFile(
      path.join(root, '.gitignore'),
      '# >>> Comet managed project state >>>\n.comet/\n',
      'utf8',
    );
    await expect(ensureCometProjectGitignore(root)).rejects.toThrow('managed block is incomplete');

    const realRoot = path.join(root, 'real-project');
    const linkedRoot = path.join(root, 'linked-project');
    await fs.mkdir(realRoot);
    await fs.symlink(realRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(ensureCometProjectGitignore(linkedRoot)).rejects.toThrow(
      'project root must be a real directory',
    );
  });
});
