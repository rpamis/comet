import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { PLATFORMS } from '../../../platform/install/platforms.js';

import {
  DEFAULT_NATIVE_SNAPSHOT_CONFIG,
  defaultProjectConfig,
  mergeNativeSnapshotExcludes,
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
    expect(defaultProjectConfig().native.clarification_mode).toBe('batch');
    expect(defaultProjectConfig().native.archive_confirmation).toBe('automatic');
    expect(defaultProjectConfig().native.max_verify_failures).toBe(5);
    expect(defaultProjectConfig().native.snapshot).toEqual({
      include: ['**/*'],
      exclude: DEFAULT_NATIVE_SNAPSHOT_CONFIG.exclude,
      max_files: 10_000,
      max_total_bytes: 256 * 1024 * 1024,
      max_duration_ms: 60_000,
    });
  });

  it('keeps every supported platform Skill directory outside the default baseline scope', () => {
    expect(DEFAULT_NATIVE_SNAPSHOT_CONFIG.exclude).toEqual(
      expect.arrayContaining(PLATFORMS.map((platform) => `${platform.skillsDir}/skills/**`)),
    );
  });

  it('includes common generated, IDE, and Comet-managed paths in default snapshots', () => {
    expect(DEFAULT_NATIVE_SNAPSHOT_CONFIG.exclude).toEqual(
      expect.arrayContaining([
        '**/.idea/**',
        '**/.vscode/**',
        '.codex/skills/**',
        '**/node_modules/**',
        '**/dist/**',
        '**/target/**',
        '**/__pycache__/**',
        '**/obj/**',
        '**/logs/**',
        '**/tmp/**',
        '**/temp/**',
      ]),
    );
    expect(DEFAULT_NATIVE_SNAPSHOT_CONFIG.exclude).not.toContain('**/bin/**');
  });

  it('preserves custom exclusions while adding missing defaults', () => {
    const merged = mergeNativeSnapshotExcludes(['custom/generated/**', '**/dist/**']);

    expect(merged).toEqual(expect.arrayContaining(['custom/generated/**', '**/dist/**']));
    expect(merged).toEqual(expect.arrayContaining(['**/.idea/**', '**/node_modules/**']));
    expect(new Set(merged).size).toBe(merged.length);
  });

  it('round-trips a custom artifact root without persisting legacy snapshot settings', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));

    expect(await readProjectConfig(projectRoot)).toEqual({
      schema: 'comet.project.v1',
      default_workflow: 'native',
      workflows: ['native'],
      ambient_resume: true,
      memory: {
        learning: true,
        retrieval: true,
      },
      knowledge: {
        provider: 'local',
      },
      native: {
        artifact_root: 'docs',
        language: 'en',
        clarification_mode: 'batch',
        archive_confirmation: 'automatic',
        max_verify_failures: 5,
        snapshot: {
          include: ['**/*'],
          exclude: DEFAULT_NATIVE_SNAPSHOT_CONFIG.exclude,
          max_files: 10_000,
          max_total_bytes: 256 * 1024 * 1024,
          max_duration_ms: 60_000,
        },
      },
    });
    const source = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
    expect(source).toContain('# Enables automatic recovery');
    expect(source).toContain(
      '# Root directory where Native stores Comet specs and changes. Runtime data stays under .comet.',
    );
    expect(source).toContain(
      '# Controls how Native asks clarifying questions: batch asks every currently answerable question per round',
    );
    expect(source).toContain('# Controls whether Native archives automatically');
    expect(source).toContain(
      '# Maximum failed Verify outcomes allowed for one confirmed acceptance target',
    );
    expect(source).toContain('ambient_resume: true');
    expect(source).toContain('clarification_mode: batch');
    expect(source).toContain('archive_confirmation: automatic');
    expect(source).toContain('max_verify_failures: 5');
    expect(source).not.toMatch(/^\s+snapshot:/mu);
  });

  it('does not write Native project config through a linked .comet directory', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-config-outside-'));
    try {
      await fs.rm(path.join(projectRoot, '.comet'), { recursive: true });
      try {
        await fs.symlink(
          outsideRoot,
          path.join(projectRoot, '.comet'),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(writeProjectConfig(projectRoot, defaultProjectConfig('docs'))).rejects.toThrow(
        /symbolic link or junction|real directory/iu,
      );
      await expect(fs.access(path.join(outsideRoot, 'config.yaml'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not replace a Native project config symlink', async () => {
    const outsideRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'comet-native-link-outside-'));
    const outsideConfig = path.join(outsideRoot, 'config.yaml');
    try {
      await fs.writeFile(outsideConfig, 'keep: true\n', 'utf8');
      try {
        await fs.symlink(outsideConfig, path.join(projectRoot, '.comet', 'config.yaml'), 'file');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
        throw error;
      }

      await expect(writeProjectConfig(projectRoot, defaultProjectConfig('docs'))).rejects.toThrow(
        /symbolic link or junction/iu,
      );
      await expect(fs.readFile(outsideConfig, 'utf8')).resolves.toBe('keep: true\n');
    } finally {
      await fs.rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not overwrite a concurrent project config change before commit', async () => {
    const configPath = path.join(projectRoot, '.comet', 'config.yaml');
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs'));
    const concurrentSource = [
      'schema: comet.project.v1',
      'default_workflow: native',
      'workflows: [native]',
      'ambient_resume: true',
      'native:',
      '  artifact_root: concurrent-root',
      '  language: en',
      '  clarification_mode: sequential',
      'concurrent_extension: keep',
      '',
    ].join('\n');

    await expect(
      writeProjectConfig(projectRoot, defaultProjectConfig('updated-root'), {
        beforeCommit: () => fs.writeFile(configPath, concurrentSource, 'utf8'),
      }),
    ).rejects.toThrow('Project config changed before commit');
    await expect(fs.readFile(configPath, 'utf8')).resolves.toBe(concurrentSource);
  });

  it('round-trips Classic layout settings in the shared project config', async () => {
    const value = defaultProjectConfig('docs', 'zh-CN');
    value.default_workflow = 'classic';
    value.workflows = ['classic'];
    value.classic = {
      artifact_layout: 'docs',
      language: 'zh-CN',
      context_compression: 'off',
      review_mode: 'standard',
      auto_transition: true,
    };

    await writeProjectConfig(projectRoot, value);

    await expect(readProjectConfig(projectRoot)).resolves.toEqual(value);
    await expect(
      fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
    ).resolves.toContain('artifact_layout: docs');
  });

  it('normalizes a missing Classic layout to docs without changing the schema version', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: classic',
        'workflows: [classic]',
        'native:',
        '  artifact_root: docs',
        'classic:',
        '  language: zh-CN',
        '',
      ].join('\n'),
    );

    const value = await readProjectConfig(projectRoot);
    expect(value?.classic?.artifact_layout).toBe('docs');
    expect(value?.schema).toBe('comet.project.v1');
  });

  it('reads an older project config with the missing Native defaults', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: .\n',
    );

    expect((await readProjectConfig(projectRoot))?.native.language).toBe('en');
    expect((await readProjectConfig(projectRoot))?.native.clarification_mode).toBe('batch');
    expect((await readProjectConfig(projectRoot))?.native.archive_confirmation).toBe('automatic');
    expect((await readProjectConfig(projectRoot))?.native.max_verify_failures).toBe(5);
    expect((await readProjectConfig(projectRoot))?.native.snapshot).toEqual(
      defaultProjectConfig().native.snapshot,
    );
    expect((await readProjectConfig(projectRoot))?.ambient_resume).toBe(true);
  });

  it('round-trips the sequential clarification mode', async () => {
    const config = defaultProjectConfig('docs');
    config.native.clarification_mode = 'sequential';

    await writeProjectConfig(projectRoot, config);

    expect((await readProjectConfig(projectRoot))?.native.clarification_mode).toBe('sequential');
    await expect(
      fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
    ).resolves.toContain('clarification_mode: sequential');
  });

  it('round-trips required Native archive confirmation', async () => {
    const config = defaultProjectConfig('docs');
    config.native.archive_confirmation = 'required';

    await writeProjectConfig(projectRoot, config);

    expect((await readProjectConfig(projectRoot))?.native.archive_confirmation).toBe('required');
    await expect(
      fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
    ).resolves.toContain('archive_confirmation: required');
  });

  it('round-trips a custom Native completion-loop budget', async () => {
    const config = defaultProjectConfig('docs');
    config.native.max_verify_failures = 8;

    await writeProjectConfig(projectRoot, config);

    expect((await readProjectConfig(projectRoot))?.native.max_verify_failures).toBe(8);
    await expect(
      fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8'),
    ).resolves.toContain('max_verify_failures: 8');
  });

  it.each(['0', '-1', '1.5', '"five"'])(
    'rejects invalid Native completion-loop budget %s',
    async (value) => {
      await fs.writeFile(
        path.join(projectRoot, '.comet', 'config.yaml'),
        `schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: docs\n  max_verify_failures: ${value}\n`,
      );

      await expect(readProjectConfig(projectRoot)).rejects.toThrow(
        'native.max_verify_failures must be a positive integer',
      );
    },
  );

  it('renders Chinese comments for a Chinese project config', async () => {
    await writeProjectConfig(projectRoot, defaultProjectConfig('docs', 'zh-CN'));

    const source = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
    expect(source).toContain('# 是否启用只读的环境感知恢复探针');
    expect(source).toContain('# Native 规格和 change 的存放根目录；运行时数据始终位于 .comet');
    expect(source).toContain('# Native 提问澄清问题的方式');
    expect(source).toContain('# Native 归档检查成功后自动归档');
    expect(source).toContain('# 同一个已确认验收目标最多允许的 Verify 失败次数');
    expect(source).not.toMatch(/^\s+snapshot:/mu);
    expect(source).not.toContain('# Enables automatic recovery');
  });

  it('rejects unsafe snapshot patterns', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        '  snapshot:',
        '    include: ["../outside/**"]',
        '    exclude: []',
        '',
      ].join('\n'),
    );

    await expect(readProjectConfig(projectRoot)).rejects.toThrow(
      'native.snapshot.include contains an unsafe pattern',
    );
  });

  it.each([
    ['max_files', 0],
    ['max_total_bytes', 0],
    ['max_duration_ms', 0],
  ])('rejects invalid snapshot budget %s', async (field, value) => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        '  snapshot:',
        `    ${field}: ${value}`,
        '',
      ].join('\n'),
    );

    await expect(readProjectConfig(projectRoot)).rejects.toThrow(`native.snapshot.${field}`);
  });

  it.each([
    ['a'.repeat(1025), 'exceeds 1024 characters'],
    ['*a'.repeat(65), 'contains more than 64 wildcard tokens'],
  ])('rejects overly complex snapshot pattern', async (pattern, expected) => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'native:',
        '  artifact_root: docs',
        '  snapshot:',
        `    include: ["${pattern}"]`,
        '',
      ].join('\n'),
    );

    await expect(readProjectConfig(projectRoot)).rejects.toThrow(expected);
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

  it('fails closed for an invalid archive confirmation mode', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      'schema: comet.project.v1\ndefault_workflow: native\nnative:\n  artifact_root: docs\n  archive_confirmation: sometimes\n',
    );

    await expect(readProjectConfig(projectRoot)).rejects.toThrow(
      'native.archive_confirmation must be automatic or required',
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

  it('can require an existing Native project config', async () => {
    await expect(
      resolveNativeProject({ startPath: projectRoot, allowMissingConfig: false }),
    ).rejects.toThrow('.comet/config.yaml was not found');
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

  it('preserves extensions outside the retired Native snapshot subtree', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      [
        'schema: comet.project.v1',
        'default_workflow: native',
        'workflows: [native, classic]',
        'native:',
        '  artifact_root: .',
        '  custom_extension:',
        '    owner: user',
        '  snapshot:',
        '    include: ["**/*"]',
        '    snapshot_extension: keep',
        'classic:',
        '  artifact_layout: legacy',
        '  classic_extension: keep',
        'top_extension:',
        '  enabled: true',
        '',
      ].join('\n'),
      'utf8',
    );

    const config = await readProjectConfig(projectRoot);
    expect(config).not.toBeNull();
    config!.native.artifact_root = 'docs';
    await writeProjectConfig(projectRoot, config!);

    const source = await fs.readFile(path.join(projectRoot, '.comet', 'config.yaml'), 'utf8');
    expect(source).toContain('artifact_root: docs');
    expect(source).toContain('custom_extension:');
    expect(source).not.toContain('snapshot_extension: keep');
    expect(source).not.toMatch(/^\s+snapshot:/mu);
    expect(source).toContain('classic_extension: keep');
    expect(source).toContain('top_extension:');
  });

  it('rejects an oversized project config before parsing it', async () => {
    await fs.writeFile(
      path.join(projectRoot, '.comet', 'config.yaml'),
      Buffer.alloc(64 * 1024 + 1),
    );

    await expect(readProjectConfig(projectRoot)).rejects.toThrow('exceeds 65536 bytes');
  });
});
