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

  it('injects task context and passes OMP tool calls through the same Router session', async () => {
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
        "  if (process.argv.includes('--project-root') || !process.argv.includes('oh-my-pi') || !payload.cwd || payload.session_id !== 'session-file') {",
        "    process.stderr.write('invalid bridge payload\\n');",
        '    process.exitCode = 64;',
        '    return;',
        '  }',
        "  if (payload.hook_event_name === 'before_agent_start') {",
        "    process.stdout.write(JSON.stringify({ hookSpecificOutput: { additionalContext: '<agent_context><context_manifest /></agent_context>' } }) + '\\n');",
        "  } else if (payload.tool_name === 'write') {",
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
    let beforeAgentStart:
      | ((
          event: { prompt: string },
          context: {
            cwd: string;
            sessionManager: { getSessionFile(): string };
          },
        ) => Promise<
          | {
              message: {
                customType: string;
                content: string;
                display: boolean;
              };
            }
          | undefined
        >)
      | undefined;
    const module = (await import(`${pathToFileURL(hookPath).href}?test=${Date.now()}`)) as {
      default: (pi: { on: (event: string, callback: unknown) => void }) => void;
    };
    module.default({
      on(event, callback) {
        if (event === 'tool_call') handler = callback as NonNullable<typeof handler>;
        if (event === 'before_agent_start') {
          beforeAgentStart = callback as NonNullable<typeof beforeAgentStart>;
        }
      },
    });

    expect(handler).toBeDefined();
    expect(beforeAgentStart).toBeDefined();
    await expect(
      beforeAgentStart!(
        { prompt: 'Implement the dashboard' },
        {
          cwd: root,
          sessionManager: { getSessionFile: () => 'session-file' },
        },
      ),
    ).resolves.toMatchObject({
      message: {
        customType: 'comet.context-manifest',
        content: expect.stringContaining('<context_manifest'),
        display: false,
      },
    });
    await expect(
      handler!({ toolName: 'write', input: { path: 'src/file.ts' } }, {
        cwd: root,
        sessionManager: { getSessionFile: () => 'session-file' },
      } as { cwd: string }),
    ).resolves.toEqual({ block: true, reason: 'write denied by Comet' });
    await expect(
      handler!({ toolName: 'read', input: { path: 'src/file.ts' } }, {
        cwd: root,
        sessionManager: { getSessionFile: () => 'session-file' },
      } as { cwd: string }),
    ).resolves.toBeUndefined();
  });
});
