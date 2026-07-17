import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

import {
  defaultProjectConfig,
  readProjectConfig,
  resolveNativeProject,
  writeProjectConfig,
} from '../../../domains/comet-native/native-config.js';

describe('Native project configuration', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-config-'));
    await fs.mkdir(path.join(projectRoot, '.git'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('round-trips a custom artifact root with stable YAML fields', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    expect(await readProjectConfig(projectRoot)).toEqual({
      schema: 'comet.project.v1',
      default_workflow: 'native',
      native: { artifact_root: 'docs', language: 'en' },
    });
    expect(await fs.readFile(path.join(projectRoot, 'comet.config.yaml'), 'utf8')).toBe(
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: docs\n  language: en\n',
    );
  });

  it('reads an older project config without a language as English', async () => {
    await fs.writeFile(
      path.join(projectRoot, 'comet.config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: .\n',
    );

    expect((await readProjectConfig(projectRoot))?.native.language).toBe('en');
  });

  it('round-trips a transaction-bound root-move cleanup marker', async () => {
    const config = defaultProjectConfig('docs');
    config.native.pending_root_move = {
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      fromArtifactRoot: '.',
      toArtifactRoot: 'docs',
      stage: 'switched',
      cleanup: {
        kind: 'forward-source',
        state: 'deleting',
        manifestHash: 'a'.repeat(64),
      },
    };

    await writeProjectConfig(projectRoot, config);

    expect(await readProjectConfig(projectRoot)).toEqual(config);
    expect(await fs.readFile(path.join(projectRoot, 'comet.config.yaml'), 'utf8')).toContain(
      'manifest_hash: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    );
  });

  it('discovers the nearest configured project from a nested directory', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const nested = path.join(projectRoot, 'src', 'feature');
    await fs.mkdir(nested, { recursive: true });

    const resolved = await resolveNativeProject({ startPath: nested });

    expect(resolved.paths.projectRoot).toBe(projectRoot);
    expect(resolved.paths.nativeRoot).toBe(path.join(projectRoot, 'docs', 'comet'));
    expect(resolved.configured).toBe(true);
  });

  it('uses the repository root and default comet directory without config', async () => {
    const nested = path.join(projectRoot, 'src');
    await fs.mkdir(nested);

    const resolved = await resolveNativeProject({ startPath: nested });

    expect(resolved.config.native.artifact_root).toBe('.');
    expect(resolved.paths.nativeRoot).toBe(path.join(projectRoot, 'comet'));
    expect(resolved.configured).toBe(false);
  });

  it('refuses an explicit root that conflicts with persisted config', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    await expect(
      resolveNativeProject({ startPath: projectRoot, explicitArtifactRoot: 'artifacts' }),
    ).rejects.toThrow('refusing conflicting root');
  });

  it.each([
    [
      'duplicate keys',
      'schema: comet.project.v1\nschema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: .\n',
    ],
    [
      'unknown root field',
      'schema: comet.project.v1\ndefault_workflow: native\nunknown: true\nnative:\n  artifact_root: .\n',
    ],
    ['missing Native root', 'schema: comet.project.v1\ndefault_workflow: native\nnative: {}\n'],
    [
      'bad pending move',
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: .\n  pending_root_move:\n    id: bad\n    from_artifact_root: .\n    to_artifact_root: docs\n    stage: unknown\n',
    ],
  ])('fails closed for %s', async (_label, source) => {
    await fs.writeFile(path.join(projectRoot, 'comet.config.yaml'), source);
    await expect(readProjectConfig(projectRoot)).rejects.toBeInstanceOf(Error);
  });

  it('rejects an oversized project config before parsing it', async () => {
    await fs.writeFile(path.join(projectRoot, 'comet.config.yaml'), Buffer.alloc(64 * 1024 + 1));

    await expect(readProjectConfig(projectRoot)).rejects.toThrow('exceeds 65536 bytes');
  });
});
