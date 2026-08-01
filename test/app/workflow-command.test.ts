import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { workflowResolveCommand } from '../../app/commands/workflow.js';
import {
  defaultProjectConfig,
  writeProjectConfig,
} from '../../domains/comet-native/native-config.js';

describe('workflow resolve command', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-workflow-command-'));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('prints the stable JSON resolution contract', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('.'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await workflowResolveCommand(projectRoot, { json: true });

    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({
      schema: 'comet.workflow-resolution.v1',
      workflow: 'native',
      skill: 'comet-native',
      source: 'project-config',
    });
  });

  it('fails closed when project configuration is absent', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(workflowResolveCommand(projectRoot)).rejects.toThrow(
      '.comet/config.yaml is missing',
    );

    expect(log).not.toHaveBeenCalled();
  });

  it('fails closed when project configuration is malformed', async () => {
    await fs.mkdir(path.join(projectRoot, '.comet'));
    await fs.writeFile(path.join(projectRoot, '.comet', 'config.yaml'), 'schema: [', 'utf8');
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(workflowResolveCommand(projectRoot, { json: true })).rejects.toThrow(
      /Invalid \.comet\/config\.yaml/u,
    );
    expect(log).not.toHaveBeenCalled();
  });

  it('registers the nested workflow resolve command in Commander', async () => {
    const source = await fs.readFile(path.resolve('app', 'cli', 'index.ts'), 'utf8');

    // Command handlers are lazy-imported inside `.action()`; assert the
    // registration and the lazy import path instead of a top-level import.
    expect(source).toContain(".command('workflow')");
    expect(source).toContain(".command('resolve [path]')");
    expect(source).toContain(
      "const { workflowResolveCommand } = await import('../commands/workflow.js');",
    );
  });
});
