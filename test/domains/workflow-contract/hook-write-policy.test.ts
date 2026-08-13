import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { configuredHookWritePath } from '../../../domains/workflow-contract/hook-write-policy.js';

describe('Hook write policy', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-hook-policy-'));
    await fs.mkdir(path.join(projectRoot, '.comet'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function writeConfig(allowPaths: string[] = ['docs/team-notes']): Promise<void> {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'hook:',
        '  allow_paths:',
        ...allowPaths.map((allowPath) => `    - ${allowPath}`),
        'classic:',
        '  artifact_layout: legacy',
        '',
      ].join('\n'),
    );
  }

  it('matches an allowed directory and does not match a shared prefix', async () => {
    await writeConfig();

    await expect(
      configuredHookWritePath(projectRoot, path.join('docs', 'team-notes', 'note.md')),
    ).resolves.toContain('configured Hook allow path: docs/team-notes');
    await expect(
      configuredHookWritePath(projectRoot, path.join('docs', 'team-notes-archive', 'note.md')),
    ).resolves.toBeNull();
  });

  it('keeps external and reserved paths outside the configurable allowance', async () => {
    await writeConfig(['docs']);

    await expect(
      configuredHookWritePath(projectRoot, path.join('..', 'note.md')),
    ).resolves.toBeNull();
    await expect(
      configuredHookWritePath(projectRoot, path.join('docs', 'note.md'), [
        path.join(projectRoot, 'docs'),
      ]),
    ).resolves.toBeNull();
    await expect(
      configuredHookWritePath(projectRoot, path.join(projectRoot, 'docs', 'note.md')),
    ).resolves.toContain('configured Hook allow path: docs');
    await expect(
      configuredHookWritePath(projectRoot, path.resolve(projectRoot, '..', 'note.md')),
    ).resolves.toBeNull();
  });

  it('preserves an existing allowlist when another workflow rewrites its config', async () => {
    await writeConfig();
    const source = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
    expect(source).toContain('docs/team-notes');
  });

  it('returns null when no project config or target-relative path exists', async () => {
    await expect(configuredHookWritePath(projectRoot, '.')).resolves.toBeNull();
    await expect(
      configuredHookWritePath(path.join(projectRoot, 'missing'), 'docs/note.md'),
    ).resolves.toBeNull();
  });

  it('uses case-sensitive comparison semantics off Windows', async () => {
    await writeConfig(['Docs']);
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { configurable: true, value: 'linux' });
    try {
      await expect(configuredHookWritePath(projectRoot, 'Docs/note.md')).resolves.toContain(
        'configured Hook allow path: Docs',
      );
    } finally {
      Object.defineProperty(process, 'platform', {
        configurable: true,
        value: originalPlatform,
      });
    }
  });
});
