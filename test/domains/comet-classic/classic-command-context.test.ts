import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { ClassicCommandHandler } from '../../../domains/comet-classic/classic-cli.js';
import {
  classicCommandProjectRoot,
  withClassicCommandContext,
  withProjectContext,
} from '../../../domains/comet-classic/classic-command-context.js';

describe('withProjectContext', () => {
  const roots: string[] = [];

  async function tempRoot(prefix: string): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
    roots.push(root);
    return root;
  }

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('establishes a command context when none is active yet', async () => {
    const root = await tempRoot('comet-classic-command-context-');
    const handler: ClassicCommandHandler = withProjectContext(async () => ({
      exitCode: 0,
      stdout: classicCommandProjectRoot(),
    }));

    const result = await handler([], { json: false, invocationCwd: root, projectRoot: root });

    expect(result).toEqual({ exitCode: 0, stdout: root });
  });

  it('reuses an already-established context instead of resolving its own options', async () => {
    const outerRoot = await tempRoot('comet-classic-command-context-outer-');
    const innerRoot = await tempRoot('comet-classic-command-context-inner-');
    const handler: ClassicCommandHandler = withProjectContext(async () => ({
      exitCode: 0,
      stdout: classicCommandProjectRoot(),
    }));

    const result = await withClassicCommandContext(
      { projectRoot: outerRoot, invocationCwd: outerRoot },
      () => handler([], { json: false, invocationCwd: innerRoot, projectRoot: innerRoot }),
    );

    expect(result).toEqual({ exitCode: 0, stdout: outerRoot });
  });
});
