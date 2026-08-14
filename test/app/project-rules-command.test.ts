import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  projectRulesInitCommand,
  projectRulesStatusCommand,
} from '../../app/commands/project-rules.js';

describe('project rules commands', () => {
  const directories: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it('initializes and reports project rules without creating a rule file', async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'comet-project-rules-cli-'));
    directories.push(projectRoot);
    await writeFile(
      path.join(projectRoot, 'package.json'),
      JSON.stringify({ scripts: { test: 'vitest' } }),
    );
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((message?: unknown) =>
      logs.push(String(message ?? '')),
    );

    const initialized = await projectRulesInitCommand(projectRoot, { json: true });
    expect(initialized.initialized).toBe(true);
    expect(JSON.parse(logs.at(-1) ?? '{}')).toMatchObject({
      initialized: true,
      verificationEntrypoints: [expect.objectContaining({ label: 'npm run test' })],
    });
    await expect(
      readFile(path.join(projectRoot, '.comet', 'rules', 'project.md')),
    ).rejects.toMatchObject({
      code: 'ENOENT',
    });

    logs.length = 0;
    const status = await projectRulesStatusCommand(projectRoot, { json: true });
    expect(status.initialized).toBe(true);
    expect(JSON.parse(logs.at(-1) ?? '{}')).toMatchObject({ initialized: true });
  });
});
