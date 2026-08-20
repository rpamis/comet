import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { transform } from 'esbuild';

import { renderOmpHookModule } from '../../../domains/skill/platform-install.js';

describe('Oh My Pi Hook bridge', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-omp-hook-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('passes OMP tool_call payloads to the Router and returns blocking decisions', async () => {
    const hookDir = path.join(root, '.omp', 'hooks', 'pre');
    const routerDir = path.join(root, '.omp', 'skills', 'comet', 'scripts');
    await fs.mkdir(hookDir, { recursive: true });
    await fs.mkdir(routerDir, { recursive: true });

    const compiled = await transform(renderOmpHookModule(), {
      format: 'esm',
      loader: 'ts',
      target: 'es2022',
    });
    const hookPath = path.join(hookDir, 'comet-hook-router.mjs');
    await fs.writeFile(hookPath, compiled.code, 'utf8');
    await fs.writeFile(
      path.join(routerDir, 'comet-hook-router.mjs'),
      [
        "let source = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', (chunk) => (source += chunk));",
        "process.stdin.on('end', () => {",
        '  const payload = JSON.parse(source);',
        "  if (process.argv.includes('--project-root') || !process.argv.includes('oh-my-pi') || !payload.cwd) {",
        "    process.stderr.write('invalid bridge payload\\n');",
        '    process.exitCode = 64;',
        '    return;',
        '  }',
        "  if (payload.tool_name === 'write') {",
        "    process.stderr.write('write denied by Comet\\n');",
        '    process.exitCode = 2;',
        '  }',
        '});',
        '',
      ].join('\n'),
      'utf8',
    );

    let handler:
      | ((
          event: { toolName: string; input: Record<string, unknown> },
          context: { cwd: string },
        ) => Promise<{ block: true; reason: string } | undefined>)
      | undefined;
    const module = (await import(`${pathToFileURL(hookPath).href}?test=${Date.now()}`)) as {
      default: (pi: { on: (event: string, callback: NonNullable<typeof handler>) => void }) => void;
    };
    module.default({
      on(event, callback) {
        if (event === 'tool_call') handler = callback;
      },
    });

    expect(handler).toBeDefined();
    await expect(
      handler!({ toolName: 'write', input: { path: 'src/file.ts' } }, { cwd: root }),
    ).resolves.toEqual({ block: true, reason: 'write denied by Comet' });
    await expect(
      handler!({ toolName: 'read', input: { path: 'src/file.ts' } }, { cwd: root }),
    ).resolves.toBeUndefined();
  });
});
