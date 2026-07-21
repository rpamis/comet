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
    await fs.mkdir(path.join(projectRoot, '.comet'));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it('builds the shared default project config with docs as the Native artifact root', () => {
    expect(defaultProjectConfig().native.artifact_root).toBe('docs');
    expect(defaultProjectConfig().native.clarification_mode).toBe('sequential');
  });

  it('round-trips a custom artifact root with stable YAML fields', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    expect(await readProjectConfig(projectRoot)).toEqual({
      schema: 'comet.project.v1',
      default_workflow: 'native',
      workflows: ['native'],
      ambient_resume: true,
      native: {
        artifact_root: 'docs',
        language: 'en',
        clarification_mode: 'sequential',
      },
    });
    const source = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
    expect(source).toContain('# Enables automatic recovery');
    expect(source).toContain('# Controls whether Native asks one clarification at a time');
    expect(source).toContain('ambient_resume: true');
    expect(source).toContain('clarification_mode: sequential');
  });

  it('reads an older project config with the missing Native defaults', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: .\n',
    );

    expect((await readProjectConfig(projectRoot))?.native.language).toBe('en');
    expect((await readProjectConfig(projectRoot))?.native.clarification_mode).toBe('sequential');
    expect((await readProjectConfig(projectRoot))?.ambient_resume).toBe(true);
  });

  it('round-trips the batch clarification mode', async () => {
    const config = defaultProjectConfig('docs');
    config.native.clarification_mode = 'batch';

    await writeProjectConfig(projectRoot, config);

    expect((await readProjectConfig(projectRoot))?.native.clarification_mode).toBe('batch');
    await expect(
      fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
    ).resolves.toContain('clarification_mode: batch');
  });

  it('renders Chinese comments for a Chinese project config', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'zh-CN'));

    const source = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
    expect(source).toContain('# 是否启用只读的环境感知恢复探针');
    expect(source).toContain('# Native 产物的存放根目录');
    expect(source).toContain('# Native 每轮询问一个问题');
    expect(source).not.toContain('# Enables automatic recovery');
  });

  it('rejects a non-boolean Ambient Resume setting', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: native\nambient_resume: sometimes\nnative:\n  artifact_root: .\n',
    );

    await expect(readProjectConfig(projectRoot)).rejects.toThrow(
      'ambient_resume must be true or false',
    );
  });

  it('fails closed for an invalid clarification mode', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: docs\n  clarification_mode: sometimes\n',
    );

    await expect(readProjectConfig(projectRoot)).rejects.toThrow(
      'native.clarification_mode must be sequential or batch',
    );
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
    config.workflows = ['native'];

    await writeProjectConfig(projectRoot, config);

    expect(await readProjectConfig(projectRoot)).toEqual(config);
    expect(await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8')).toContain(
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

  it('uses docs as the default artifact root without config', async () => {
    const nested = path.join(projectRoot, 'src');
    await fs.mkdir(nested);

    const resolved = await resolveNativeProject({ startPath: nested });

    expect(resolved.config.native.artifact_root).toBe('docs');
    expect(resolved.paths.nativeRoot).toBe(path.join(projectRoot, 'docs', 'comet'));
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
    ['missing Native root', 'schema: comet.project.v1\ndefault_workflow: native\nnative: {}\n'],
    [
      'bad pending move',
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: .\n  pending_root_move:\n    id: bad\n    from_artifact_root: .\n    to_artifact_root: docs\n    stage: unknown\n',
    ],
  ])('fails closed for %s', async (_label, source) => {
    await fs.writeFile(path.join(projectRoot, '.comet', 'config.yaml'), source);
    await expect(readProjectConfig(projectRoot)).rejects.toBeInstanceOf(Error);
  });

  it('does not migrate legacy Classic fields during Native config writes', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'language: zh-CN\nreview_mode: thorough\ncustom_setting: keep\n',
    );

    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'zh-CN'));

    const source = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
    expect(source).toContain('review_mode: thorough');
    expect(source).toContain('custom_setting: keep');
    expect(source).toContain('artifact_root: docs');
  });

  it('preserves the nested Classic block during Native config writes', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: .',
        '  language: en',
        'classic:',
        '  language: zh-CN',
        '  context_compression: beta',
        '  review_mode: thorough',
        '  auto_transition: false',
        '',
      ].join('\n'),
    );

    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'zh-CN'));

    const source = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
    expect(source).toContain('classic:');
    expect(source).toContain('context_compression: beta');
    expect(source).toContain('review_mode: thorough');
    expect(source).toContain('auto_transition: false');
  });

  it('rejects an oversized project config before parsing it', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      Buffer.alloc(64 * 1024 + 1),
    );

    await expect(readProjectConfig(projectRoot)).rejects.toThrow('exceeds 65536 bytes');
  });
});
